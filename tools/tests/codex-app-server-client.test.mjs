import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCodexAppServerClient } from '../ai/codex-app-server-client.mjs';

const FIXTURE_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'codex-app-server');

const initializeResult = {
  codexHome: 'C:\\Users\\test\\.codex',
  platformFamily: 'windows',
  platformOs: 'windows',
  userAgent: 'codex_cli_rs/0.149.0',
};

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function createFakeProcess({ onEnvelope, exitOnStdinEnd = false, ignoreSigint = false } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.received = [];
  child.killCalls = [];
  let input = '';

  const exit = (code = 0, signal = null) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = signal ? null : code;
    child.signalCode = signal;
    child.emit('exit', child.exitCode, signal);
    child.emit('close', child.exitCode, signal);
  };

  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      input += chunk.toString();
      const lines = input.split(/\r?\n/);
      input = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const envelope = JSON.parse(line);
        child.received.push(envelope);
        Promise.resolve(onEnvelope?.(envelope, child)).catch(error => child.emit('error', error));
      }
      callback();
    },
    final(callback) {
      if (exitOnStdinEnd) setImmediate(() => exit(0));
      callback();
    },
  });

  child.send = (envelope, { splitAt } = {}) => {
    const line = `${JSON.stringify(envelope)}\n`;
    if (splitAt) {
      child.stdout.write(line.slice(0, splitAt));
      child.stdout.write(line.slice(splitAt));
    } else {
      child.stdout.write(line);
    }
  };
  child.sendRaw = value => child.stdout.write(value);
  child.exit = exit;
  child.kill = signal => {
    child.killCalls.push(signal);
    if (ignoreSigint && signal === 'SIGINT') return true;
    setImmediate(() => exit(0, signal));
    return true;
  };
  return child;
}

function clientWithProcess(child, capture = {}) {
  return createCodexAppServerClient({
    executable: 'fake-codex',
    spawnProcess(executable, args, options) {
      capture.executable = executable;
      capture.args = args;
      capture.options = options;
      capture.spawnCount = (capture.spawnCount ?? 0) + 1;
      return child;
    },
    disposeGraceMs: 10,
    forceGraceMs: 10,
  });
}

function respondToInitialize(envelope, child) {
  if (envelope.method === 'initialize') child.send({ id: envelope.id, result: initializeResult });
}

test('initializes once, sends initialized before gated requests, and uses persistent stdio transport', async () => {
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
      if (envelope.method === 'thread/start') process.send({ id: envelope.id, result: { thread: { id: 'thread-1' } } });
    },
  });
  const capture = {};
  const client = clientWithProcess(child, capture);

  const [first, second] = await Promise.all([
    client.request('thread/start', { cwd: 'D:\\repo' }),
    client.initialize(),
  ]);

  assert.equal(first.thread.id, 'thread-1');
  assert.deepEqual(second, initializeResult);
  assert.equal(capture.spawnCount, 1);
  assert.equal(capture.executable, 'fake-codex');
  assert.deepEqual(capture.args, ['app-server', '--listen', 'stdio://']);
  assert.equal(capture.options.shell, false);
  assert.deepEqual(capture.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(child.received.map(message => message.method), ['initialize', 'initialized', 'thread/start']);
  assert.equal(child.received[0].params.clientInfo.name, 'nevo');
  assert.deepEqual(child.received[0].params.capabilities, { experimentalApi: true });
  assert.ok(!Object.hasOwn(child.received[0], 'jsonrpc'));
  assert.deepEqual(child.received[1], { method: 'initialized' });
});

test('correlates concurrent responses by explicit id when they arrive out of order', async () => {
  const queued = [];
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
      if (envelope.method === 'thread/start' || envelope.method === 'thread/resume') {
        queued.push(envelope);
        if (queued.length === 2) {
          process.send({ id: queued[1].id, result: { value: 'second' } });
          process.send({ id: queued[0].id, result: { value: 'first' } });
        }
      }
    },
  });
  const client = clientWithProcess(child);

  const [first, second] = await Promise.all([
    client.request('thread/start', {}),
    client.request('thread/resume', { threadId: 'thread-1' }),
  ]);

  assert.deepEqual(first, { value: 'first' });
  assert.deepEqual(second, { value: 'second' });
  assert.notEqual(queued[0].id, queued[1].id);
  assert.equal(client.pendingRequestCount, 0);
});

test('parses split and multiple JSONL messages, tolerates jsonrpc 2.0, and ignores global notifications', async () => {
  const observed = [];
  const child = createFakeProcess({ onEnvelope: respondToInitialize });
  const client = clientWithProcess(child);
  client.onNotification(notification => observed.push(notification.method));
  await client.initialize();

  const fixture = await readFile(join(FIXTURE_ROOT, 'provider-global-notifications.jsonl'), 'utf8');
  const firstLineEnd = fixture.indexOf('\n') + 1;
  child.sendRaw(fixture.slice(0, 13));
  child.sendRaw(fixture.slice(13, firstLineEnd));
  child.sendRaw(fixture.slice(firstLineEnd));
  child.send({ jsonrpc: '2.0', method: 'unknown/futureNotification', params: {} }, { splitAt: 7 });
  await tick();
  await tick();

  assert.deepEqual(observed, [
    'remoteControl/status/changed',
    'mcpServer/startupStatus/updated',
    'skills/changed',
    'unknown/futureNotification',
  ]);
});

test('maps provider request errors without failing later requests', async () => {
  let requestNumber = 0;
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
      if (envelope.method === 'thread/start') {
        requestNumber += 1;
        if (requestNumber === 1) {
          process.send({ id: envelope.id, error: { code: -32000, message: 'thread failed' } });
        } else {
          process.send({ id: envelope.id, result: { ok: true } });
        }
      }
    },
  });
  const client = clientWithProcess(child);

  await assert.rejects(client.request('thread/start', {}), error => {
    assert.equal(error.code, 'AI_PROVIDER_REQUEST_ERROR');
    assert.equal(error.details.providerCode, -32000);
    return true;
  });
  assert.deepEqual(await client.request('thread/start', {}), { ok: true });
});

test('dispatches server requests through a single-use response path', async () => {
  const child = createFakeProcess({ onEnvelope: respondToInitialize });
  const client = clientWithProcess(child);
  client.onServerRequest(request => {
    assert.equal(request.method, 'item/commandExecution/requestApproval');
    request.respond({ decision: 'accept' });
  });
  await client.initialize();

  child.send({ id: 77, method: 'item/commandExecution/requestApproval', params: { itemId: 'item-1' } });
  await tick();
  await tick();

  const response = child.received.find(message => message.id === 77);
  assert.deepEqual(response, { id: 77, result: { decision: 'accept' } });
});

test('a second server-request response is protocol corruption and rejects active work', async () => {
  let pendingId;
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
      if (envelope.method === 'turn/start') pendingId = envelope.id;
    },
  });
  const client = clientWithProcess(child);
  client.onServerRequest(request => {
    request.respond({ decision: 'accept' });
    request.respond({ decision: 'decline' });
  });
  const pending = client.request('turn/start', { threadId: 't', input: [] });
  await tick();
  child.send({ id: 'approval-1', method: 'item/fileChange/requestApproval', params: {} });

  await assert.rejects(pending, error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
  assert.ok(pendingId);
  assert.equal(child.received.filter(message => message.id === 'approval-1').length, 1);
});

for (const [name, corrupt] of [
  ['malformed JSON', '{broken\n'],
  ['invalid response envelope', `${JSON.stringify({ id: 'nevo-2' })}\n`],
  ['unknown response id', `${JSON.stringify({ id: 'missing', result: {} })}\n`],
  ['invalid jsonrpc member', `${JSON.stringify({ jsonrpc: '1.0', method: 'skills/changed', params: {} })}\n`],
]) {
  test(`${name} fails closed, rejects all pending work, and ignores later success`, async () => {
    let pendingId;
    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
        if (envelope.method === 'turn/start') pendingId = envelope.id;
      },
    });
    const client = clientWithProcess(child);
    const pending = client.request('turn/start', { threadId: 'thread-1', input: [] });
    await tick();
    child.sendRaw(corrupt);
    await assert.rejects(pending, error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
    child.send({ id: pendingId, result: { shouldNotResolve: true } });
    await tick();
    assert.equal(client.pendingRequestCount, 0);
    await assert.rejects(client.request('thread/start', {}), error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
  });
}

test('initialization failure fans out to all gated callers', async () => {
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      if (envelope.method === 'initialize') {
        process.send({ id: envelope.id, error: { code: -32603, message: 'init failed' } });
      }
    },
  });
  const client = clientWithProcess(child);
  const calls = [client.request('thread/start', {}), client.request('thread/resume', { threadId: 't' })];
  const outcomes = await Promise.allSettled(calls);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected'));
  assert.ok(outcomes.every(outcome => outcome.reason.code === 'AI_PROVIDER_INITIALIZATION_FAILED'));
  assert.equal(child.received.filter(message => message.method === 'initialize').length, 1);
});

test('process errors and unexpected exits reject requests and notification waiters', async () => {
  for (const fail of [
    child => child.emit('error', new Error('boom')),
    child => child.exit(9),
  ]) {
    let pendingId;
    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
        if (envelope.method === 'turn/start') pendingId = envelope.id;
      },
    });
    const client = clientWithProcess(child);
    await client.initialize();
    const request = client.request('turn/start', { threadId: 't', input: [] });
    const waiter = client.waitForNotification(() => false);
    await tick();
    fail(child);
    const results = await Promise.allSettled([request, waiter]);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.ok(pendingId);
    assert.equal(client.pendingRequestCount, 0);
    assert.equal(client.activeWaiterCount, 0);
  }
});

test('dispose is idempotent, bounded, rejects operations, and removes process listeners', async () => {
  const child = createFakeProcess({ onEnvelope: respondToInitialize, exitOnStdinEnd: true });
  const client = clientWithProcess(child);
  await client.initialize();
  const pending = client.request('turn/start', { threadId: 't', input: [] });
  const waiter = client.waitForNotification(() => false);
  const operationResults = Promise.allSettled([pending, waiter]);

  await Promise.all([client.dispose(), client.dispose()]);
  const results = await operationResults;
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(client.pendingRequestCount, 0);
  assert.equal(client.activeWaiterCount, 0);
  assert.equal(client.isDisposed, true);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
  await assert.rejects(client.request('thread/start', {}), error => error.code === 'AI_PROVIDER_DISPOSED');
});

test('dispose escalates through the shared bounded termination helper when stdin close is ignored', async () => {
  const child = createFakeProcess({ onEnvelope: respondToInitialize, ignoreSigint: true });
  const client = clientWithProcess(child);
  await client.initialize();
  await client.dispose();
  assert.deepEqual(child.killCalls, ['SIGINT', 'SIGKILL']);
});
