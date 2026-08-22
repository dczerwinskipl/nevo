import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';
import {
  CODEX_CAPABILITIES,
  CodexAgentProvider,
  createCodexAgentProvider,
} from '../ai/codex-adapter.mjs';
import { createDefaultDashboardAiService } from '../dashboard/server/ai-services.mjs';

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

async function waitFor(read, predicate, label = 'condition') {
  for (let index = 0; index < 100; index += 1) {
    const value = read();
    if (predicate(value)) return value;
    await tick();
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

class FakeCodexClient {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
    this.notifications = new Set();
    this.serverRequests = new Set();
    this.waiters = new Set();
    this.disposals = 0;
  }

  onNotification(handler) {
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }

  onServerRequest(handler) {
    this.serverRequests.add(handler);
    return () => this.serverRequests.delete(handler);
  }

  request(method, params) {
    this.calls.push({ method, params });
    return this.handler(method, params, this);
  }

  waitForNotification(predicate, { signal } = {}) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      this.waiters.add(waiter);
      if (signal) {
        const abort = () => {
          this.waiters.delete(waiter);
          reject(Object.assign(new Error('cancelled'), { code: 'AI_TURN_CANCELLED' }));
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
    });
  }

  async emitNotification(method, params = {}) {
    const notification = { method, params };
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(notification)) {
        this.waiters.delete(waiter);
        waiter.resolve(notification);
      }
    }
    for (const handler of this.notifications) await handler(notification);
  }

  emitServerRequest(method, params, id = 'private-request') {
    let response;
    let answered = false;
    const request = {
      method,
      params,
      respond(result) {
        if (answered) throw new Error('answered twice');
        answered = true;
        response = { id, result };
      },
      reject(error) {
        if (answered) throw new Error('answered twice');
        answered = true;
        response = { id, error };
      },
    };
    const handler = [...this.serverRequests][0];
    const completion = Promise.resolve(handler(request));
    return { completion, get response() { return response; }, get answered() { return answered; } };
  }

  fail(error = Object.assign(new Error('client failed'), { code: 'AI_PROVIDER_PROCESS_ERROR' })) {
    for (const waiter of [...this.waiters]) waiter.reject(error);
    this.waiters.clear();
  }

  async dispose() {
    this.disposals += 1;
    this.fail(Object.assign(new Error('disposed'), { code: 'AI_PROVIDER_DISPOSED' }));
  }
}

function standardClient({ threadId = 'thread-1', turnId = 'codex-turn-1', overrides = {} } = {}) {
  return new FakeCodexClient(async (method, params, client) => {
    if (overrides[method]) return overrides[method](params, client);
    if (method === 'thread/start') return { thread: { id: threadId } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'turn/start') return { turn: { id: turnId, status: 'inProgress', items: [] } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected method ${method}`);
  });
}

function directTurn(provider, values = {}) {
  const emitted = {
    text: [], reasoning: [], started: [], updated: [], completed: [], usage: [], events: [], interactions: [],
  };
  let operation;
  const promise = provider.startTurn({
    turnId: values.turnId ?? 'nevo-turn-1',
    providerSessionId: values.providerSessionId,
    message: values.message ?? 'Hello',
    mode: values.mode ?? 'edit',
    setProviderSessionId: values.setProviderSessionId,
    setOperation: value => { operation = value; },
    emitTextDelta: (text, messageId) => emitted.text.push({ text, messageId }),
    emitReasoningDelta: (text, messageId) => emitted.reasoning.push({ text, messageId }),
    emitToolStarted: value => emitted.started.push(value),
    emitToolUpdated: value => emitted.updated.push(value),
    emitToolCompleted: value => emitted.completed.push(value),
    emitUsageUpdated: value => emitted.usage.push(value),
    emitEvent: (type, value) => emitted.events.push({ type, ...value }),
    requestInteraction: value => {
      const interaction = {
        ...value,
        id: `interaction-${emitted.interactions.length + 1}`,
        ...(value.questions ? {
          questions: value.questions.map((question, index) => ({ ...question, id: `neutral-question-${index + 1}` })),
        } : {}),
      };
      emitted.interactions.push(interaction);
      return interaction;
    },
  });
  return { promise, emitted, get operation() { return operation; } };
}

async function completeTurn(client, threadId = 'thread-1', turnId = 'codex-turn-1', status = 'completed') {
  await client.emitNotification('turn/completed', {
    threadId,
    turn: { id: turnId, status, items: [] },
  });
}

test('declares the exact honest descriptor, mode metadata, and availability', () => {
  const provider = new CodexAgentProvider({ client: standardClient(), probeExecutable: () => true });
  assert.equal(provider.descriptor.id, 'codex');
  assert.equal(provider.descriptor.label, 'OpenAI Codex');
  assert.deepEqual(Object.keys(provider.descriptor.capabilities).sort(), [
    'cancelTurn', 'interactiveConfirmations', 'interactivePermissions', 'interactiveQuestions',
    'planUpdates', 'reasoning', 'resumeSession', 'steerTurn', 'toolCalls', 'usage',
  ].sort());
  assert.deepEqual(provider.descriptor.capabilities, CODEX_CAPABILITIES);
  assert.equal(provider.descriptor.capabilities.steerTurn, false);
  assert.equal(provider.descriptor.capabilities.planUpdates, false);
  assert.deepEqual(provider.descriptor.supportedModes, ['ask', 'edit', 'agent']);
  assert.equal(provider.descriptor.defaultMode, 'edit');
  assert.deepEqual(provider.isAvailable(), { available: true });

  const missing = createCodexAgentProvider({ client: standardClient(), probeExecutable: () => false });
  assert.equal(missing.isAvailable().available, false);
  assert.match(missing.isAvailable().unavailableReason, /Codex CLI/);
});

test('createSession binds only authoritative thread.id and maps safe mode settings', async () => {
  for (const [mode, approvalPolicy, sandbox] of [
    ['ask', 'never', 'read-only'],
    ['edit', 'on-request', 'workspace-write'],
    ['agent', 'never', 'workspace-write'],
  ]) {
    const client = standardClient({ threadId: `thread-${mode}` });
    const provider = createCodexAgentProvider({ client });
    assert.deepEqual(await provider.createSession({ mode }), { providerSessionId: `thread-${mode}` });
    const call = client.calls.find(value => value.method === 'thread/start');
    assert.equal(call.params.approvalPolicy, approvalPolicy);
    assert.equal(call.params.sandbox, sandbox);
    assert.ok(!Object.hasOwn(call.params, 'sessionId'));
  }
});

test('atomic first turn publishes thread.id before turn/start and uses generated-schema mode fields', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  let established;
  const turn = directTurn(provider, {
    mode: 'ask',
    setProviderSessionId: async id => { established = id; },
  });
  await waitFor(() => client.calls, calls => calls.some(call => call.method === 'turn/start'), 'turn/start');

  assert.equal(established, 'thread-1');
  assert.deepEqual(client.calls.map(call => call.method), ['thread/start', 'turn/start']);
  const start = client.calls[1].params;
  assert.equal(start.threadId, 'thread-1');
  assert.deepEqual(start.input, [{ type: 'text', text: 'Hello' }]);
  assert.equal(start.approvalPolicy, 'never');
  assert.deepEqual(start.sandboxPolicy, { type: 'readOnly' });

  await completeTurn(client);
  assert.equal((await turn.promise).providerSessionId, 'thread-1');
});

test('turn/start rejects an identity that conflicts with an earlier turn/started notification', async () => {
  const client = standardClient({ overrides: {
    'turn/start': async (params, currentClient) => {
      await currentClient.emitNotification('turn/started', {
        threadId: params.threadId,
        turn: { id: 'notification-turn', status: 'inProgress', items: [] },
      });
      return { turn: { id: 'response-turn', status: 'inProgress', items: [] } };
    },
  } });
  const provider = createCodexAgentProvider({ client });

  await assert.rejects(
    directTurn(provider, { providerSessionId: 'thread-1' }).promise,
    error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR' && /identity/.test(error.message),
  );
});

test('recorded sessions resume once per client and failed resume never creates replacement history', async () => {
  const client = standardClient({ threadId: 'unused' });
  const provider = createCodexAgentProvider({ client });

  const first = directTurn(provider, { providerSessionId: 'existing-thread' });
  await waitFor(() => client.calls, calls => calls.some(call => call.method === 'turn/start'));
  await completeTurn(client, 'existing-thread');
  await first.promise;

  const second = directTurn(provider, { providerSessionId: 'existing-thread', turnId: 'nevo-turn-2' });
  await waitFor(() => client.calls.filter(call => call.method === 'turn/start').length, count => count === 2);
  await completeTurn(client, 'existing-thread');
  await second.promise;
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 1);

  const failedClient = standardClient({ overrides: {
    'thread/resume': async () => { throw Object.assign(new Error('missing thread'), { code: 'AI_PROVIDER_REQUEST_ERROR' }); },
  } });
  const failedProvider = createCodexAgentProvider({ client: failedClient });
  await assert.rejects(directTurn(failedProvider, { providerSessionId: 'missing-thread' }).promise, /missing thread/);
  assert.deepEqual(failedClient.calls.map(call => call.method), ['thread/resume']);
});

test('maps input, assistant, reasoning, tools, usage, and authoritative completion without private IDs', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  const turn = directTurn(provider, { providerSessionId: 'thread-1' });
  await waitFor(() => turn.operation, Boolean, 'operation');
  await waitFor(() => client.calls, calls => calls.some(call => call.method === 'turn/start'));

  await client.emitNotification('remoteControl/status/changed', { status: 'disconnected' });
  await client.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', startedAtMs: 1,
    item: { id: 'private-user', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
  });
  await client.emitNotification('item/completed', {
    threadId: 'thread-1', turnId: 'codex-turn-1', completedAtMs: 2,
    item: { id: 'private-user', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
  });
  await client.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', startedAtMs: 3,
    item: { id: 'private-message', type: 'agentMessage', text: '' },
  });
  await client.emitNotification('item/agentMessage/delta', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'private-message', delta: 'Hello ',
  });
  await client.emitNotification('item/completed', {
    threadId: 'thread-1', turnId: 'codex-turn-1', completedAtMs: 4,
    item: { id: 'private-message', type: 'agentMessage', text: 'Hello world' },
  });
  await client.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', startedAtMs: 5,
    item: { id: 'private-reasoning', type: 'reasoning', summary: [], content: [] },
  });
  await client.emitNotification('item/reasoning/summaryTextDelta', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'private-reasoning', summaryIndex: 0, delta: 'Thinking',
  });
  await client.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', startedAtMs: 6,
    item: { id: 'private-tool', type: 'commandExecution', command: 'npm test', cwd: 'D:\\repo', commandActions: [], status: 'inProgress' },
  });
  await client.emitNotification('item/completed', {
    threadId: 'thread-1', turnId: 'codex-turn-1', completedAtMs: 7,
    item: { id: 'private-tool', type: 'commandExecution', command: 'npm test', cwd: 'D:\\repo', commandActions: [], status: 'completed', aggregatedOutput: 'ok', exitCode: 0, durationMs: 12 },
  });
  await client.emitNotification('thread/tokenUsage/updated', {
    threadId: 'thread-1', turnId: 'codex-turn-1',
    tokenUsage: { last: { inputTokens: 12, outputTokens: 5 }, total: { inputTokens: 12, outputTokens: 5 } },
  });
  await completeTurn(client);
  await turn.promise;

  assert.deepEqual(turn.emitted.text.map(value => value.text), ['Hello ', 'world']);
  assert.deepEqual(turn.emitted.reasoning.map(value => value.text), ['Thinking']);
  assert.equal(turn.emitted.started.length, 1);
  assert.equal(turn.emitted.completed[0].status, 'completed');
  assert.deepEqual(turn.emitted.usage, [{ tokensIn: 12, tokensOut: 5 }]);
  assert.equal(turn.emitted.events.filter(event => event.type === 'message.started').length, 1);
  assert.equal(JSON.stringify(turn.emitted).includes('private-message'), false);
  assert.equal(JSON.stringify(turn.emitted).includes('private-tool'), false);
});

test('ignores unrelated correlated events and fails closed on conflicting final assistant text', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  const turn = directTurn(provider, { providerSessionId: 'thread-1' });
  await waitFor(() => turn.operation, Boolean);
  await client.emitNotification('item/started', {
    threadId: 'other-thread', turnId: 'other-turn', item: { id: 'x', type: 'agentMessage', text: '' }, startedAtMs: 1,
  });
  assert.equal(turn.emitted.events.length, 0);

  await client.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', item: { id: 'm', type: 'agentMessage', text: '' }, startedAtMs: 1,
  });
  await client.emitNotification('item/agentMessage/delta', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'm', delta: 'alpha',
  });
  await assert.rejects(client.emitNotification('item/completed', {
    threadId: 'thread-1', turnId: 'codex-turn-1', item: { id: 'm', type: 'agentMessage', text: 'different' }, completedAtMs: 2,
  }), error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
  client.fail(Object.assign(new Error('protocol failed'), { code: 'AI_PROVIDER_PROTOCOL_ERROR' }));
  await assert.rejects(turn.promise, error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
});

for (const [method, params, response, expected] of [
  ['item/commandExecution/requestApproval', { command: 'npm test', cwd: 'D:\\repo' }, { decision: 'allow' }, { decision: 'accept' }],
  ['item/fileChange/requestApproval', { reason: 'edit files' }, { decision: 'deny' }, { decision: 'decline' }],
  ['item/permissions/requestApproval', { cwd: 'D:\\repo', permissions: { network: { enabled: true } } }, { decision: 'allow' }, { permissions: { network: { enabled: true } }, scope: 'turn' }],
]) {
  test(`${method} stays private, responds once, and keeps the original turn running`, async () => {
    const client = standardClient();
    const provider = createCodexAgentProvider({ client });
    const turn = directTurn(provider, { providerSessionId: 'thread-1' });
    await waitFor(() => turn.operation, Boolean);
    const server = client.emitServerRequest(method, {
      ...params, threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'private-item', startedAtMs: 1,
    });
    const interaction = await waitFor(() => turn.emitted.interactions[0], Boolean, 'interaction');
    assert.equal(JSON.stringify(interaction).includes('private-request'), false);
    const result = await provider.respondInteraction({
      turnId: 'nevo-turn-1', providerSessionId: 'thread-1', interactionId: interaction.id, response,
    });
    assert.equal(result.continuesTurn, true);
    await server.completion;
    assert.deepEqual(server.response.result, expected);
    assert.equal(server.answered, true);
    assert.equal(turn.operation.settled, false);
    await completeTurn(client);
    await turn.promise;
  });
}

test('user-input questions map neutral IDs back to private answer keys exactly once', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  const turn = directTurn(provider, { providerSessionId: 'thread-1' });
  await waitFor(() => turn.operation, Boolean);
  const server = client.emitServerRequest('item/tool/requestUserInput', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'private-item', isBlocking: true,
    questions: [
      { id: 'private-q-1', question: 'Style?', header: 'Style', options: [{ label: 'Focused', description: 'Small diff' }] },
      { id: 'private-q-2', question: 'Tests?', header: 'Tests', options: null },
    ],
  });
  const interaction = await waitFor(() => turn.emitted.interactions[0], Boolean, 'question');
  assert.deepEqual(interaction.questions.map(question => question.id), ['neutral-question-1', 'neutral-question-2']);
  await provider.respondInteraction({
    turnId: 'nevo-turn-1', providerSessionId: 'thread-1', interactionId: interaction.id,
    response: { answers: [
      { questionId: 'neutral-question-1', value: 'Focused' },
      { questionId: 'neutral-question-2', value: ['Unit', 'Integration'] },
    ] },
  });
  await server.completion;
  assert.deepEqual(server.response.result, {
    answers: {
      'private-q-1': { answers: ['Focused'] },
      'private-q-2': { answers: ['Unit', 'Integration'] },
    },
  });
  await completeTurn(client);
  await turn.promise;
});

test('cancellation while waiting declines the request, interrupts provider turn, and clears correlation', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  const turn = directTurn(provider, { providerSessionId: 'thread-1' });
  await waitFor(() => turn.operation, Boolean);
  const server = client.emitServerRequest('item/commandExecution/requestApproval', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'item', startedAtMs: 1, command: 'npm test', cwd: 'D:\\repo',
  });
  const interaction = await waitFor(() => turn.emitted.interactions[0], Boolean);
  await provider.cancelTurn({ operation: turn.operation });
  await server.completion;
  assert.deepEqual(server.response.result, { decision: 'decline' });
  assert.ok(client.calls.some(call => call.method === 'turn/interrupt'));
  await assert.rejects(provider.respondInteraction({
    turnId: 'nevo-turn-1', providerSessionId: 'thread-1', interactionId: interaction.id, response: { decision: 'allow' },
  }), error => error.code === 'AI_NOT_FOUND');
  await completeTurn(client, 'thread-1', 'codex-turn-1', 'interrupted');
  await assert.rejects(turn.promise, error => ['AI_TURN_CANCELLED', 'AI_TURN_INTERRUPTED'].includes(error.code));
});

test('cancellation requested during turn/start waits for the Codex turn id and then interrupts it', async () => {
  let releaseStart;
  const startResult = new Promise(resolve => { releaseStart = resolve; });
  const client = standardClient({ overrides: { 'turn/start': async () => startResult } });
  const provider = createCodexAgentProvider({ client });
  const turn = directTurn(provider, { providerSessionId: 'thread-1' });
  await waitFor(() => turn.operation, Boolean, 'provisional operation');

  const cancellation = provider.cancelTurn({ operation: turn.operation });
  await tick();
  assert.equal(client.calls.some(call => call.method === 'turn/interrupt'), false);
  releaseStart({ turn: { id: 'codex-turn-1', status: 'inProgress', items: [] } });
  await cancellation;
  assert.deepEqual(client.calls.find(call => call.method === 'turn/interrupt').params, {
    threadId: 'thread-1', turnId: 'codex-turn-1',
  });
  await completeTurn(client, 'thread-1', 'codex-turn-1', 'interrupted');
  await assert.rejects(turn.promise, error => error.code === 'AI_TURN_CANCELLED');
});

test('runtime integration keeps a persistent Codex interaction waiting until real completion', async () => {
  const client = standardClient();
  const provider = createCodexAgentProvider({ client });
  const registry = createAiAdapterRegistry([provider]);
  const runtime = createAiTurnRuntime({ registry, idleTimeoutMs: 0 });
  const started = await runtime.startTurn({ provider: 'codex', providerSessionId: 'thread-1', message: 'Run tests' });
  await waitFor(() => client.calls, calls => calls.some(call => call.method === 'turn/start'), 'adapter turn/start');
  const server = client.emitServerRequest('item/fileChange/requestApproval', {
    threadId: 'thread-1', turnId: 'codex-turn-1', itemId: 'item', startedAtMs: 1, reason: 'edit',
  });
  const waiting = await waitFor(() => runtime.getSnapshot(started.turnId), value => value.pendingInteraction, 'runtime interaction');
  await runtime.resolveInteraction(started.turnId, waiting.pendingInteraction.id, { decision: 'allow' });
  await server.completion;
  await tick();
  assert.equal(runtime.getSnapshot(started.turnId).status, 'running');
  await completeTurn(client);
  const completed = await waitFor(() => runtime.getSnapshot(started.turnId), value => value.status === 'completed');
  assert.equal(completed.events.filter(event => event.type === 'turn.completed').length, 1);
  await runtime.shutdown();
});

test('failed/interrupted turns, unfinished tools, client failure, and disposal never become success', async () => {
  for (const status of ['failed', 'interrupted']) {
    const client = standardClient();
    const provider = createCodexAgentProvider({ client });
    const turn = directTurn(provider, { providerSessionId: 'thread-1' });
    await waitFor(() => turn.operation, Boolean);
    await completeTurn(client, 'thread-1', 'codex-turn-1', status);
    await assert.rejects(turn.promise);
  }

  const unfinishedClient = standardClient();
  const unfinishedProvider = createCodexAgentProvider({ client: unfinishedClient });
  const unfinished = directTurn(unfinishedProvider, { providerSessionId: 'thread-1' });
  await waitFor(() => unfinished.operation, Boolean);
  await unfinishedClient.emitNotification('item/started', {
    threadId: 'thread-1', turnId: 'codex-turn-1', startedAtMs: 1,
    item: { id: 'tool', type: 'fileChange', changes: [], status: 'inProgress' },
  });
  await completeTurn(unfinishedClient);
  await assert.rejects(unfinished.promise, error => error.code === 'AI_PROVIDER_PROTOCOL_ERROR');
  assert.equal(unfinished.emitted.completed[0].status, 'failed');

  const failedClient = standardClient();
  const failedProvider = createCodexAgentProvider({ client: failedClient });
  const failed = directTurn(failedProvider, { providerSessionId: 'thread-1' });
  await waitFor(() => failed.operation, Boolean);
  failedClient.fail(Object.assign(new Error('process exited'), { code: 'AI_PROVIDER_EXIT_ERROR' }));
  await assert.rejects(failed.promise, error => error.code === 'AI_PROVIDER_EXIT_ERROR');

  const disposedClient = standardClient();
  const disposedProvider = createCodexAgentProvider({ client: disposedClient });
  const disposed = directTurn(disposedProvider, { providerSessionId: 'thread-1' });
  await waitFor(() => disposed.operation, Boolean);
  await Promise.all([disposedProvider.dispose(), disposedProvider.dispose()]);
  await assert.rejects(disposed.promise, error => error.code === 'AI_PROVIDER_DISPOSED');
  assert.equal(disposedClient.disposals, 1);
});

test('default dashboard service registers Codex without starting a live app-server', async () => {
  const service = createDefaultDashboardAiService({ dataLoader: () => ({ active: [] }) });
  assert.deepEqual(service.registry.list(), ['claude', 'antigravity', 'codex', 'mock']);
  await service.shutdown();
});
