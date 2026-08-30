import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCodexAppServerClient } from '../server/ai/providers/codex/app-server-client.mjs';

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

test('a server-request handler throw before answering sends one safe error and fails all work closed', async () => {
  let pendingId;
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
      if (envelope.method === 'turn/start') pendingId = envelope.id;
    },
  });
  const client = clientWithProcess(child);
  client.onServerRequest(() => {
    throw new Error('private handler detail');
  });
  const pending = client.request('turn/start', { threadId: 't', input: [] });
  const waiter = client.waitForNotification(() => false);
  await tick();

  child.send({ id: 'approval-handler-failed', method: 'item/fileChange/requestApproval', params: {} });

  const outcomes = await Promise.allSettled([pending, waiter]);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected'));
  assert.ok(outcomes.every(outcome => outcome.reason.code === 'AI_PROVIDER_PROTOCOL_ERROR'));
  const responses = child.received.filter(message => message.id === 'approval-handler-failed');
  assert.deepEqual(responses, [{
    id: 'approval-handler-failed',
    error: { code: -32603, message: 'Codex server request handler failed.' },
  }]);
  assert.equal(JSON.stringify(responses).includes('private handler detail'), false);
  assert.ok(pendingId);
  child.send({ id: pendingId, result: { late: true } });
  await tick();
  assert.equal(client.pendingRequestCount, 0);
  assert.equal(client.activeWaiterCount, 0);
  await assert.rejects(client.request('thread/start', {}), error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
});

test('a server-request handler throw after answering does not send a second response and still fails closed', async () => {
  const child = createFakeProcess({
    onEnvelope(envelope, process) {
      respondToInitialize(envelope, process);
    },
  });
  const client = clientWithProcess(child);
  client.onServerRequest(request => {
    request.respond({ decision: 'accept' });
    throw new Error('unexpected post-response failure');
  });
  await client.initialize();
  const pending = client.request('turn/start', { threadId: 't', input: [] });

  child.send({ id: 'approval-answered-then-failed', method: 'item/commandExecution/requestApproval', params: {} });

  await assert.rejects(pending, error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
  assert.deepEqual(
    child.received.filter(message => message.id === 'approval-answered-then-failed'),
    [{ id: 'approval-answered-then-failed', result: { decision: 'accept' } }],
  );
  assert.equal(client.pendingRequestCount, 0);
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

test('CodexAppServerClient raw capture: JSON-RPC ID is not session ID and global unscoped events go to _global', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-codex-norpcid-'));
  try {
    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
      },
    });
    const client = createCodexAppServerClient({
      executable: 'fake-codex',
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });
    await client.initialize();
    child.stderr.write('Codex app-server booting...\n');
    await tick();
    await client.flushRawCapture('_global');

    const globalPath = client.getRawCapturePath(null);
    assert.equal(globalPath, join(tmpDir, '_global', 'raw.ndjson'));
    const content = await readFile(globalPath, 'utf8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    assert.ok(lines.length >= 2, 'Expected initialize request, initialize response, or stderr');
    for (const record of lines) {
      assert.equal(record.providerSessionId, null, 'Unscoped events must NOT have a fake providerSessionId');
    }

    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(join(tmpDir, 'nevo-1')), false, 'JSON-RPC id nevo-1 must NOT become a session directory');

    const globalMeta = JSON.parse(await readFile(join(tmpDir, '_global', 'session.json'), 'utf8'));
    assert.equal(globalMeta.provider, 'codex');
    assert.equal(globalMeta.global, true);

    await client.dispose();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('CodexAppServerClient raw capture: thread/start correlates response and request to allocated threadId', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-codex-threadstart-'));
  try {
    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
        if (envelope.method === 'thread/start') {
          process.send({
            id: envelope.id,
            result: { thread: { id: 'thread-alpha-123' } },
          });
        }
      },
    });
    const client = createCodexAppServerClient({
      executable: 'fake-codex',
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });
    await client.initialize();
    const threadResult = await client.request('thread/start', { model: 'o3-mini' });
    assert.equal(threadResult.thread.id, 'thread-alpha-123');

    await client.flushRawCapture('thread-alpha-123');
    const rawPath = client.getRawCapturePath('thread-alpha-123');
    assert.equal(rawPath, join(tmpDir, 'thread-alpha-123', 'raw.ndjson'));

    const content = await readFile(rawPath, 'utf8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    assert.equal(lines.length, 2);
    assert.equal(lines[0].stream, 'stdin');
    assert.equal(lines[0].providerSessionId, 'thread-alpha-123');
    assert.equal(lines[0].requestId, 'nevo-2');
    assert.equal(lines[0].raw.method, 'thread/start');

    assert.equal(lines[1].stream, 'stdout');
    assert.equal(lines[1].providerSessionId, 'thread-alpha-123');
    assert.equal(lines[1].requestId, 'nevo-2');
    assert.equal(lines[1].raw.result.thread.id, 'thread-alpha-123');

    const sessionMeta = JSON.parse(await readFile(join(tmpDir, 'thread-alpha-123', 'session.json'), 'utf8'));
    assert.equal(sessionMeta.provider, 'codex');
    assert.equal(sessionMeta.providerSessionId, 'thread-alpha-123');

    // Verify backfill marker
    assert.equal(lines[0].backfill, true, 'Backfilled thread/start request must be explicitly marked with backfill: true');
    assert.equal(lines[1].backfill, undefined, 'Physical stdout response must not be marked as backfill');

    await client.dispose();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('CodexAppServerClient raw capture: captures turn-scoped events and server-request permission lifecycle', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-codex-turnperm-'));
  try {
    let serverRequestHandled = false;
    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
        if (envelope.method === 'turn/start') {
          process.send({ id: envelope.id, result: { turn: { id: 'turn-beta-99', status: 'inProgress' } } });
        }
      },
    });
    const client = createCodexAppServerClient({
      executable: 'fake-codex',
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });
    client.onServerRequest(async request => {
      serverRequestHandled = true;
      request.respond({ decision: 'allow' });
    });

    await client.initialize();
    await client.request('turn/start', { threadId: 'thread-beta-456', turnId: 'turn-beta-99', input: [] });

    child.send({
      id: 777,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-beta-456', turnId: 'turn-beta-99', command: 'npm test' },
    });
    await tick();
    assert.ok(serverRequestHandled);

    child.send({
      method: 'item/completed',
      params: { threadId: 'thread-beta-456', turnId: 'turn-beta-99', item: { id: 'item-1', status: 'completed' } },
    });
    child.send({
      method: 'turn/completed',
      params: { threadId: 'thread-beta-456', turn: { id: 'turn-beta-99', status: 'completed' } },
    });

    await client.flushRawCapture('thread-beta-456');
    const rawPath = client.getRawCapturePath('thread-beta-456');
    const content = await readFile(rawPath, 'utf8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    const turnStartReq = lines.find(l => l.stream === 'stdin' && l.raw?.method === 'turn/start');
    assert.ok(turnStartReq);
    assert.equal(turnStartReq.providerSessionId, 'thread-beta-456');
    assert.equal(turnStartReq.turnId, 'turn-beta-99');

    const turnStartRes = lines.find(l => l.stream === 'stdout' && l.raw?.result?.turn?.id === 'turn-beta-99');
    assert.ok(turnStartRes);
    assert.equal(turnStartRes.providerSessionId, 'thread-beta-456');
    assert.equal(turnStartRes.turnId, 'turn-beta-99');

    const serverReq = lines.find(l => l.stream === 'stdout' && l.serverRequestId === 777);
    assert.ok(serverReq);
    assert.equal(serverReq.providerSessionId, 'thread-beta-456');
    assert.equal(serverReq.turnId, 'turn-beta-99');
    assert.equal(serverReq.raw.method, 'item/commandExecution/requestApproval');

    const serverRes = lines.find(l => l.stream === 'stdin' && l.serverRequestId === 777);
    assert.ok(serverRes);
    assert.equal(serverRes.providerSessionId, 'thread-beta-456');
    assert.equal(serverRes.turnId, 'turn-beta-99');
    assert.deepEqual(serverRes.raw.result, { decision: 'allow' });

    const itemDone = lines.find(l => l.stream === 'stdout' && l.raw?.method === 'item/completed');
    assert.ok(itemDone);
    assert.equal(itemDone.providerSessionId, 'thread-beta-456');
    assert.equal(itemDone.turnId, 'turn-beta-99');

    const turnDone = lines.find(l => l.stream === 'stdout' && l.raw?.method === 'turn/completed');
    assert.ok(turnDone);
    assert.equal(turnDone.providerSessionId, 'thread-beta-456');
    assert.equal(turnDone.turnId, 'turn-beta-99');

    await client.dispose();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('CodexAppServerClient raw capture: captures stdout and stderr emitted during child shutdown without mutating settled runtime', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-codex-lateshutdown-'));
  try {
    let notificationsReceivedAfterDispose = 0;
    let lateChildRef = null;

    const child = createFakeProcess({
      onEnvelope(envelope, process) {
        respondToInitialize(envelope, process);
      },
    });
    lateChildRef = child;

    const client = createCodexAppServerClient({
      executable: 'fake-codex',
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
      disposeGraceMs: 50,
    });

    client.onNotification(() => {
      notificationsReceivedAfterDispose++;
    });

    await client.initialize();

    // Start dispose
    const disposePromise = client.dispose();

    // While disposal is underway and child is draining/exiting, emit late stdout and stderr
    child.send({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-late-shutdown', turnId: 'turn-ls-1', delta: 'late shutdown stdout' },
    });
    child.stderr.write('late shutdown stderr diagnostic\n');

    await disposePromise;

    // 1. Verify late notification was NOT dispatched to listener (runtime state not mutated)
    assert.equal(notificationsReceivedAfterDispose, 0, 'Late events during/after dispose must not trigger semantic dispatch');

    // 2. Verify late stdout was recorded in thread diagnostics
    const threadRawPath = client.getRawCapturePath('thread-late-shutdown');
    const threadContent = await readFile(threadRawPath, 'utf8');
    const threadLines = threadContent.trim().split('\n').map(l => JSON.parse(l));
    assert.ok(threadLines.some(l => l.providerSessionId === 'thread-late-shutdown' && l.raw?.params?.delta === 'late shutdown stdout'));

    // 3. Verify late stderr was recorded in global diagnostics
    const globalRawPath = client.getRawCapturePath(null);
    const globalContent = await readFile(globalRawPath, 'utf8');
    const globalLines = globalContent.trim().split('\n').map(l => JSON.parse(l));
    assert.ok(globalLines.some(l => l.stream === 'stderr' && l.rawText?.includes('late shutdown stderr diagnostic')));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
