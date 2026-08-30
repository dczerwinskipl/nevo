import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockAgentProvider } from '../server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { listen } from '../server/index.mjs';
import { createDefaultAgentSessionService } from '../server/ai/routes.mjs';
import { buildAiTestApp } from './helpers/ai-test-app.mjs';

const specId = '70609aaf-bb62-40bf-a25e-bec65c583495';

// Real disk paths, isolated per call — never the repo's own `.nevo-ai-local/`, which
// boot-time reconciliation now actually scans (`listPersistedSessions`), so leftover
// cross-run fixtures there would otherwise leak into whichever test happens to reuse the
// same deterministic mock session ID.
function isolatedTranscriptCache() {
  return createTranscriptCacheService({ baseDir: join(tmpdir(), `nevo-ai-server-test-${randomUUID()}`) });
}

function createStack(options = {}) {
  const provider = createMockAgentProvider({ specId, taskIds: ['task-a', 'task-b'], streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);
  const transcriptCache = isolatedTranscriptCache();
  const bindingService = createAgentSessionBindingService(
    options.storageDir ? { storageDir: options.storageDir } : (options.storageFile ? { storageFile: options.storageFile } : {})
  );
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  return { provider, service: createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService }) };
}

function control(body, extra = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1', ...extra },
    body: JSON.stringify(body),
  };
}

// Polls the AI service directly (in-process) rather than through HTTP: the
// dashboard's HTTP surface has no "get turn by ID alone" endpoint (the
// canonical, session-correlated API doesn't need one — this test
// infrastructure is the only thing that ever wanted raw turn-by-ID
// polling), and `service` is already right here.
async function waitFor(service, turnId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const turn = service.getTurn(turnId);
    if (predicate(turn)) return turn;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for turn state.');
}

async function waitForSession(baseUrl, provider, providerSessionId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const response = await fetch(`${baseUrl}/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}`);
    const session = (await response.json()).session;
    if (predicate(session)) return session;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for API session state.');
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('Agent session routes expose the complete provider-neutral session and turn lifecycle', async () => {
  const policyCalls = [];
  const { service } = createStack();
  const server = await buildAiTestApp({
    service,
    accessPolicy: ({ capability }) => { policyCalls.push(capability); return true; },
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // 1. Providers
    const providers = await fetch(`${baseUrl}/api/agent-providers`);
    const providerBody = await providers.json();
    assert.equal(providers.status, 200);
    assert.equal(providerBody.providers[0].id, 'mock');
    assert.deepEqual(providerBody.access, { mode: 'trusted-network', identityAuthenticated: false });

    // 2. Atomic first turn creation: POST /api/agent-sessions/turns
    const firstTurnResponse = await fetch(`${baseUrl}/api/agent-sessions/turns`, control({
      provider: 'mock',
      specId,
      taskId: 'task-a',
      message: 'Initial prompt for atomic session',
    }));
    assert.equal(firstTurnResponse.status, 201);
    const { turnId, providerSessionId } = await firstTurnResponse.json();
    assert.ok(turnId);
    assert.ok(providerSessionId);

    // Wait for first turn completion
    const completedTurn = await waitFor(service, turnId, turn => turn.status === 'completed');
    assert.equal(completedTurn.events[0].type, 'turn.started');
    assert.equal(completedTurn.events.at(-1).type, 'turn.completed');

    // 3. List bindings: GET /api/agent-sessions?specId=...&taskId=...
    const filtered = await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}&taskId=task-a`);
    const bindings = (await filtered.json()).sessions;
    assert.ok(bindings.some(b => b.providerSessionId === providerSessionId && b.specId === specId));
    assert.ok(bindings.some(b => b.sessionId === providerSessionId));

    // 4. Session details snapshot: GET /api/agent-sessions/:provider/:providerSessionId
    const sessionDetails = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(providerSessionId)}`);
    const sessionBody = (await sessionDetails.json()).session;
    assert.equal(sessionBody.provider, 'mock');
    assert.equal(sessionBody.providerSessionId, providerSessionId);
    assert.equal(sessionBody.specId, specId);
    assert.equal(sessionBody.taskId, 'task-a');
    assert.equal(sessionBody.status, 'idle');
    assert.ok(sessionBody.messages.length >= 2);
    assert.ok(sessionBody.lastEventSeq > 0);
    // Regression guard: registry.get(provider) returns { provider, descriptor }, not the
    // descriptor itself — a session snapshot must still surface the provider's real
    // declared capabilities (this is what drives the chat UI's cancel-button visibility).
    assert.equal(sessionBody.capabilities.cancelTurn, true);
    assert.equal(sessionBody.mode, 'edit');

    // 5. Subsequent turn: POST /api/agent-sessions/:provider/:providerSessionId/turns
    const secondTurnResponse = await fetch(
      `${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(providerSessionId)}/turns`,
      control({ message: 'Subsequent turn message' }),
    );
    assert.equal(secondTurnResponse.status, 202);
    const { turnId: secondTurnId } = await secondTurnResponse.json();
    await waitFor(service, secondTurnId, turn => turn.status === 'completed');

    // 6. Messages list
    const messagesResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(providerSessionId)}/messages`);
    const messagesBody = await messagesResponse.json();
    assert.equal(messagesBody.messages.length, 4);

    // 7. Manual pre-allocated session attachment: POST /api/agent-sessions
    const attachResponse = await fetch(`${baseUrl}/api/agent-sessions`, control({
      provider: 'mock',
      providerSessionId: 'pre-allocated-sess-1',
      specId,
      taskId: 'task-b',
    }));
    assert.equal(attachResponse.status, 201);
    const attachBody = await attachResponse.json();
    assert.equal(attachBody.session.providerSessionId, 'pre-allocated-sess-1');

    // 8. New session allocation via modal flow (omitting providerSessionId): POST /api/agent-sessions
    const createModalResponse = await fetch(`${baseUrl}/api/agent-sessions`, control({
      provider: 'mock',
      specId,
      taskIds: ['task-a'],
      title: 'Modal allocated session',
    }));
    assert.equal(createModalResponse.status, 201);
    const createModalBody = await createModalResponse.json();
    assert.ok(createModalBody.session.providerSessionId);
    assert.equal(createModalBody.session.sessionId, createModalBody.session.providerSessionId);
    assert.equal(createModalBody.session.specId, specId);
    assert.equal(createModalBody.session.taskId, 'task-a');

    // 9. Delete / unbind session
    const deleteResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/pre-allocated-sess-1`, {
      method: 'DELETE',
      headers: { 'x-nevo-dashboard-action': '1' },
    });
    assert.equal(deleteResponse.status, 200);

    assert.ok(policyCalls.includes('read'));
    assert.ok(policyCalls.includes('control'));
  } finally {
    await closeServer(server);
  }
});

test('default dashboard AI service registers only providers enabled in the local config', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'nevo-ai-service-config-'));
  const providerConfigPath = join(configDir, 'ai-providers.yaml');
  await writeFile(providerConfigPath, `version: 1
providers:
  codex:
    enabled: true
  claude:
    enabled: true
  antigravity:
    enabled: false
  mock:
    enabled: true
`, 'utf8');
  const service = createDefaultAgentSessionService({ dataLoader: () => ({ active: [] }), providerConfigPath });
  try {
    assert.deepEqual(service.registry.list(), ['codex', 'claude', 'mock']);
    const descriptor = service.registry.get('codex').descriptor;
    assert.equal(descriptor.label, 'OpenAI Codex');
    assert.equal(descriptor.capabilities.resumeSession, true);
    assert.equal(descriptor.capabilities.steerTurn, false);
    assert.equal(descriptor.capabilities.planUpdates, false);
  } finally {
    await service.shutdown();
    await rm(configDir, { recursive: true, force: true });
  }
});

test('durable session history remains readable after its provider is disabled', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service, accessPolicy: () => true });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const created = await fetch(`${baseUrl}/api/agent-sessions`, control({
      provider: 'mock',
      specId,
      taskId: 'task-a',
    }));
    assert.equal(created.status, 201);
    const session = (await created.json()).session;

    service.registry.unregister('mock');

    const history = await fetch(
      `${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(session.providerSessionId)}`
    );
    assert.equal(history.status, 200);
    const snapshot = (await history.json()).session;
    assert.equal(snapshot.providerSessionId, session.providerSessionId);
    assert.deepEqual(snapshot.capabilities, {});

    const newTurn = await fetch(
      `${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(session.providerSessionId)}/turns`,
      control({ message: 'must remain blocked while the provider is disabled' })
    );
    assert.equal(newTurn.status, 404);
  } finally {
    await closeServer(server);
  }
});

test('default dashboard AI service registers no providers when the local config is absent', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'nevo-ai-service-missing-config-'));
  const service = createDefaultAgentSessionService({
    dataLoader: () => ({ active: [] }),
    providerConfigPath: join(configDir, 'missing.yaml'),
  });
  try {
    assert.deepEqual(service.registry.list(), []);
    assert.deepEqual(service.listProviders(), []);
  } finally {
    await service.shutdown();
    await rm(configDir, { recursive: true, force: true });
  }
});

test('Session SSE replays events, preserves pending interaction, and resolves via session endpoint', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const start = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-a-1/turns`, control({
      message: 'permission please',
      idempotencyKey: 'permission-1',
    }));
    const { turnId } = await start.json();
    const pendingTurn = await waitFor(service, turnId, turn => turn.pendingInteraction);

    // Subscribe to session SSE stream
    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-a-1/events`, {
      headers: { 'last-event-id': '0' },
      signal: controller.signal,
    });
    const reader = stream.body.getReader();
    const { value } = await reader.read();
    const firstChunk = new TextDecoder().decode(value);
    assert.match(firstChunk, /event: turn\.started/);
    controller.abort();
    await reader.cancel().catch(() => {});

    // Verify session snapshot has waitingForUser state and pendingInteraction
    const session = await waitForSession(baseUrl, 'mock', 'demo-task-a-1', s => s.pendingInteraction);
    assert.equal(session.status, 'waitingForUser');
    const interactionId = session.pendingInteraction.id;

    // Resolve interaction via POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond
    const resolved = await fetch(
      `${baseUrl}/api/agent-sessions/mock/demo-task-a-1/interactions/${interactionId}/respond`,
      control({ decision: 'allow' }),
    );
    assert.equal(resolved.status, 200);

    const completed = await waitFor(service, turnId, turn => turn.status === 'completed');
    assert.ok(completed.events.some(event => event.type === 'interaction.resolved'));

    // Replay SSE after sequence
    const replayController = new AbortController();
    const replayStream = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-a-1/events?after=1`, {
      signal: replayController.signal,
    });
    const replayReader = replayStream.body.getReader();
    const { value: replayChunk } = await replayReader.read();
    const replayText = new TextDecoder().decode(replayChunk);
    replayController.abort();
    await replayReader.cancel().catch(() => {});
    assert.match(replayText, /event: text\.delta/);
    assert.match(replayText, /event: turn\.completed/);
  } finally {
    await closeServer(server);
  }
});

test('single-active-turn and stable question correlation are enforced through HTTP', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const firstResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-1/turns`, control({
      message: 'ask a question',
      idempotencyKey: 'q-1',
    }));
    const first = await firstResponse.json();
    await waitFor(service, first.turnId, turn => turn.pendingInteraction);

    const retryResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-1/turns`, control({
      message: 'ask a question',
      idempotencyKey: 'q-1',
    }));
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { turnId: first.turnId, idempotent: true });

    const conflictResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-1/turns`, control({
      message: 'different request',
      idempotencyKey: 'q-2',
    }));
    assert.equal(conflictResponse.status, 409);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.turnId, first.turnId);

    const turn = await waitFor(service, first.turnId, value => value.pendingInteraction);
    const [one, two] = turn.pendingInteraction.questions;
    const wrong = await fetch(
      `${baseUrl}/api/agent-sessions/mock/demo-task-b-1/interactions/${turn.pendingInteraction.id}/respond`,
      control({
        answers: [{ questionId: one.question, value: 'Focused' }, { questionId: two.id, value: 'Tests' }],
      }),
    );
    assert.equal(wrong.status, 400);

    const correct = await fetch(
      `${baseUrl}/api/agent-sessions/mock/demo-task-b-1/interactions/${turn.pendingInteraction.id}/respond`,
      control({
        answers: [{ questionId: one.id, value: 'Focused' }, { questionId: two.id, value: ['Tests'] }],
      }),
    );
    assert.equal(correct.status, 200);
  } finally {
    await closeServer(server);
  }
});

test('AI controls validate methods, guards, traversal, malformed and oversized input, and explicit cancellation', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    assert.equal((await fetch(`${baseUrl}/api/agent-providers`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions`, control({ provider: 'mock', specId, providerSessionId: 'x' }, { origin: 'https://attacker.example' }))).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions/%2e%2e/%2e%2e/messages`)).status, 404);

    const malformed = await fetch(`${baseUrl}/api/agent-sessions`, {
      method: 'POST', headers: { 'x-nevo-dashboard-action': '1' }, body: '{',
    });
    assert.equal(malformed.status, 400);

    const start = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-2/turns`, control({ message: 'permission before cancel' }));
    const { turnId } = await start.json();
    await waitFor(service, turnId, turn => turn.pendingInteraction);
    const cancelled = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-2/turns/${turnId}/cancel`, control({}));
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).turn.events.at(-1).error.code, 'AI_TURN_CANCELLED');

    const oversized = await fetch(`${baseUrl}/api/agent-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ provider: 'mock', specId, providerSessionId: 'x'.repeat(20_000) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await closeServer(server);
  }
});

test('session control endpoints enforce strict correlation between provider, session, turn, and interaction', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // 1. Start turns on two distinct sessions
    const startA = await fetch(`${baseUrl}/api/agent-sessions/mock/session-alpha/turns`, control({
      message: 'permission on alpha',
      idempotencyKey: 'key-alpha',
    }));
    const { turnId: turnIdA } = await startA.json();
    const turnA = await waitFor(service, turnIdA, t => t.pendingInteraction);

    const startB = await fetch(`${baseUrl}/api/agent-sessions/mock/session-beta/turns`, control({
      message: 'permission on beta',
      idempotencyKey: 'key-beta',
    }));
    const { turnId: turnIdB } = await startB.json();
    const turnB = await waitFor(service, turnIdB, t => t.pendingInteraction);

    // 2. Cross-session cancel attempt: trying to cancel turnIdA using session-beta route
    const crossCancel = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-beta/turns/${turnIdA}/cancel`,
      control({}),
    );
    assert.equal(crossCancel.status, 404);
    const crossCancelJson = await crossCancel.json();
    assert.equal(crossCancelJson.error.code, 'AI_NOT_FOUND');

    // Verify session-alpha turn is still waitingForUser and NOT cancelled
    const checkTurnA = service.getTurn(turnIdA);
    assert.equal(checkTurnA.status, 'waitingForUser');

    // 3. Cross-session interaction response: trying to resolve turnA's interaction using session-beta route
    const crossRespond = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-beta/interactions/${turnA.pendingInteraction.id}/respond`,
      control({ decision: 'allow', turnId: turnIdA }),
    );
    assert.equal(crossRespond.status, 404);
    const crossRespondJson = await crossRespond.json();
    assert.equal(crossRespondJson.error.code, 'AI_NOT_FOUND');

    // 4. Non-pending interaction ID on session-alpha
    const fakeRespond = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-alpha/interactions/non-existent-interaction/respond`,
      control({ decision: 'allow' }),
    );
    assert.equal(fakeRespond.status, 404);

    // 5. Normal matching-session interaction response and cancel still work
    const validRespond = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-alpha/interactions/${turnA.pendingInteraction.id}/respond`,
      control({ decision: 'allow' }),
    );
    assert.equal(validRespond.status, 200);
    const completedA = await waitFor(service, turnIdA, t => t.status === 'completed');
    assert.equal(completedA.status, 'completed');

    const validCancel = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-beta/turns/${turnIdB}/cancel`,
      control({}),
    );
    assert.equal(validCancel.status, 200);
    const cancelledB = await waitFor(service, turnIdB, t => t.status === 'failed');
    assert.equal(cancelledB.events.at(-1).error.code, 'AI_TURN_CANCELLED');
  } finally {
    await closeServer(server);
  }
});

test('pending interaction can be resolved after server restart retaining persisted transcript state with strict correlation', async () => {
  const provider = createMockAgentProvider({ specId, taskIds: ['task-a', 'task-b'], streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);
  const transcriptCache = isolatedTranscriptCache();
  const bindingService = createAgentSessionBindingService();

  // Phase 1: Server 1 runs, turn reaches waitingForUser
  const turnRuntime1 = createAgentTurnRuntime({ registry, transcriptCache });
  const service1 = createAgentSessionService({ registry, turnRuntime: turnRuntime1, transcriptCache, bindingService });
  const server1 = await buildAiTestApp({ service: service1 });
  const baseUrl1 = await listen(server1, { port: 0 });

  let turnIdAlpha;
  let interactionIdAlpha;
  let turnIdBeta;

  try {
    const startA = await fetch(`${baseUrl1}/api/agent-sessions/mock/restart-alpha/turns`, control({
      message: 'permission on alpha',
      idempotencyKey: 'restart-key-alpha',
    }));
    const resA = await startA.json();
    turnIdAlpha = resA.turnId;
    const turnA = await waitFor(service1, turnIdAlpha, t => t.pendingInteraction);
    interactionIdAlpha = turnA.pendingInteraction.id;

    const startB = await fetch(`${baseUrl1}/api/agent-sessions/mock/restart-beta/turns`, control({
      message: 'permission on beta',
      idempotencyKey: 'restart-key-beta',
    }));
    const resB = await startB.json();
    turnIdBeta = resB.turnId;
    await waitFor(service1, turnIdBeta, t => t.pendingInteraction);
  } finally {
    await closeServer(server1);
  }

  // Phase 2: Server 2 starts with a fresh turnRuntime (simulating restart) sharing persisted transcriptCache
  const turnRuntime2 = createAgentTurnRuntime({ registry, transcriptCache });
  const service2 = createAgentSessionService({ registry, turnRuntime: turnRuntime2, transcriptCache, bindingService });
  const server2 = await buildAiTestApp({ service: service2 });
  const baseUrl2 = await listen(server2, { port: 0 });

  try {
    // 1. Session snapshot restores pending interaction on GET
    const sessionRes = await fetch(`${baseUrl2}/api/agent-sessions/mock/restart-alpha`);
    assert.equal(sessionRes.status, 200);
    const sessionData = await sessionRes.json();
    assert.equal(sessionData.session.pendingInteraction?.id, interactionIdAlpha);
    assert.equal(sessionData.session.activeTurn?.turnId, turnIdAlpha);

    // 2. Cross-session turnId after restart is rejected (turnIdBeta sent to restart-alpha endpoint)
    const crossTurnRes = await fetch(
      `${baseUrl2}/api/agent-sessions/mock/restart-alpha/interactions/${interactionIdAlpha}/respond`,
      control({ decision: 'allow', turnId: turnIdBeta }),
    );
    assert.equal(crossTurnRes.status, 404);
    assert.equal((await crossTurnRes.json()).error.code, 'AI_NOT_FOUND');

    // 3. Wrong interactionId after restart is rejected
    const wrongInteractionRes = await fetch(
      `${baseUrl2}/api/agent-sessions/mock/restart-alpha/interactions/wrong-interaction-id/respond`,
      control({ decision: 'allow' }),
    );
    assert.equal(wrongInteractionRes.status, 404);
    assert.equal((await wrongInteractionRes.json()).error.code, 'AI_NOT_FOUND');

    // 4. Verify restart-beta was not mutated by either mismatch
    const betaSession = await (await fetch(`${baseUrl2}/api/agent-sessions/mock/restart-beta`)).json();
    assert.equal(betaSession.session.activeTurn?.turnId, turnIdBeta);
    assert.ok(betaSession.session.pendingInteraction);

    // 5. Resolving interaction on restart-alpha without turnId (or with matching turnId) works cleanly
    const validRespond = await fetch(
      `${baseUrl2}/api/agent-sessions/mock/restart-alpha/interactions/${interactionIdAlpha}/respond`,
      control({ decision: 'allow' }),
    );
    assert.equal(validRespond.status, 200);
    const completedA = await waitFor(service2, turnIdAlpha, t => t.status === 'completed');
    assert.equal(completedA.status, 'completed');

    // 6. Cancel on restart-beta also works after restart
    const cancelRes = await fetch(
      `${baseUrl2}/api/agent-sessions/mock/restart-beta/turns/${turnIdBeta}/cancel`,
      control({}),
    );
    assert.equal(cancelRes.status, 200);
    const cancelledB = await waitFor(service2, turnIdBeta, t => t.status === 'failed');
    assert.equal(cancelledB.events.at(-1).error.code, 'AI_TURN_CANCELLED');
  } finally {
    await closeServer(server2);
  }
});

test('Session mode preference persistence across server restarts and snapshot exposure', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-mode-restart-test-'));
  const storageDir = join(tmpDir, 'sessions');
  const transcriptDir = join(tmpDir, 'transcripts');

  let lastExecutedMode = null;
  const customProvider = createMockAgentProvider({
    specId,
    taskIds: ['task-mode'],
    streamDelayMs: 1,
  });
  const originalStartTurn = customProvider.startTurn.bind(customProvider);
  customProvider.startTurn = (params) => {
    lastExecutedMode = params.mode;
    return originalStartTurn(params);
  };

  const createTestServer = async () => {
    const registry = createAgentProviderRegistry([customProvider]);
    const bindingService = createAgentSessionBindingService({ storageDir });
    const transcriptCache = createTranscriptCacheService({ baseDir: transcriptDir, flushDebounceMs: 0 });
    const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
    const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });
    const server = await buildAiTestApp({ service });
    return { server, service, bindingService };
  };

  // 1. Start Server 1: Create session with mode 'agent' and another with 'ask'
  const stack1 = await createTestServer();
  const baseUrl1 = await listen(stack1.server, { port: 0 });

  try {
    const createAgentRes = await fetch(`${baseUrl1}/api/agent-sessions`, control({
      provider: 'mock',
      specId,
      taskId: 'task-mode',
      mode: 'agent',
    }));
    assert.equal(createAgentRes.status, 201);
    const agentSessionData = await createAgentRes.json();
    const agentSessionId = agentSessionData.session.providerSessionId;

    const createAskRes = await fetch(`${baseUrl1}/api/agent-sessions`, control({
      provider: 'mock',
      specId,
      taskId: 'task-mode',
      mode: 'ask',
    }));
    assert.equal(createAskRes.status, 201);
    const askSessionData = await createAskRes.json();
    const askSessionId = askSessionData.session.providerSessionId;

    // 2. Restart server (simulating reload of binding/service state)
    await closeServer(stack1.server);

    const stack2 = await createTestServer();
    const baseUrl2 = await listen(stack2.server, { port: 0 });

    try {
      // 3. GET session details for agent session
      const getAgentRes = await fetch(`${baseUrl2}/api/agent-sessions/mock/${agentSessionId}`);
      assert.equal(getAgentRes.status, 200);
      const getAgentData = await getAgentRes.json();
      // 4. Returned session mode is 'agent'
      assert.equal(getAgentData.session.mode, 'agent');

      // 5. Starting a subsequent turn without explicit override invokes provider with 'agent'
      lastExecutedMode = null;
      const turn1Res = await fetch(`${baseUrl2}/api/agent-sessions/mock/${agentSessionId}/turns`, control({
        message: 'continue in restored mode',
      }));
      assert.equal(turn1Res.status, 202);
      assert.equal(lastExecutedMode, 'agent');

      // 6. Check ask session
      const getAskRes = await fetch(`${baseUrl2}/api/agent-sessions/mock/${askSessionId}`);
      assert.equal(getAskRes.status, 200);
      const getAskData = await getAskRes.json();
      assert.equal(getAskData.session.mode, 'ask');

      lastExecutedMode = null;
      const turn2Res = await fetch(`${baseUrl2}/api/agent-sessions/mock/${askSessionId}/turns`, control({
        message: 'continue in ask mode',
      }));
      assert.equal(turn2Res.status, 202);
      assert.equal(lastExecutedMode, 'ask');

      // 7. Genuinely fresh session created without mode defaults to 'edit'
      const freshCreateRes = await fetch(`${baseUrl2}/api/agent-sessions`, control({
        provider: 'mock',
        specId,
        taskId: 'task-mode',
      }));
      assert.equal(freshCreateRes.status, 201);
      const freshData = await freshCreateRes.json();
      const freshSessionId = freshData.session.providerSessionId;

      const getFreshRes = await fetch(`${baseUrl2}/api/agent-sessions/mock/${freshSessionId}`);
      assert.equal(getFreshRes.status, 200);
      assert.equal((await getFreshRes.json()).session.mode, 'edit');

      lastExecutedMode = null;
      const turn3Res = await fetch(`${baseUrl2}/api/agent-sessions/mock/${freshSessionId}/turns`, control({
        message: 'fresh turn',
      }));
      assert.equal(turn3Res.status, 202);
      assert.equal(lastExecutedMode, 'edit');
    } finally {
      await closeServer(stack2.server);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('AC7 & AC8: Multi-task session creation returns complete taskIds[] and list filtering does not truncate', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-multi-task-test-'));
  const storageDir = join(tmpDir, 'sessions');
  const specId = 'a1111111-1111-4111-a111-111111111111';

  const { service } = createStack({ storageDir });
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // 1. Create session with multiple taskIds: POST /api/agent-sessions
    const createRes = await fetch(`${baseUrl}/api/agent-sessions`, control({
      provider: 'mock',
      specId,
      taskIds: ['task-alpha', 'task-beta', 'task-gamma'],
      title: 'Multi-task session',
    }));
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    const sessionId = createData.session.providerSessionId;
    assert.deepEqual(createData.session.taskIds, ['task-alpha', 'task-beta', 'task-gamma']);

    // 2. AC7: HTTP GET /api/agent-sessions/:provider/:providerSessionId returns complete taskIds[]
    const getRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.session.specId, specId);
    assert.deepEqual(getData.session.taskIds, ['task-alpha', 'task-beta', 'task-gamma']);

    // 3. AC8: GET /api/agent-sessions?specId=...&taskId=task-beta includes session and does not truncate taskIds[]
    const listRes = await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}&taskId=task-beta`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.sessions.length, 1);
    const listedSession = listData.sessions[0];
    assert.equal(listedSession.providerSessionId, sessionId);
    assert.deepEqual(listedSession.taskIds, ['task-alpha', 'task-beta', 'task-gamma']);

    // 4. Listing by non-matching task filters out the session
    const listNonMatch = await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}&taskId=task-nonexistent`);
    assert.equal(listNonMatch.status, 200);
    assert.equal((await listNonMatch.json()).sessions.length, 0);
  } finally {
    await closeServer(server);
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('AC9: Cross-spec session binding isolation (D10) never produces merged taskIds and uses latest lastSeenAt', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-cross-spec-test-'));
  const storageDir = join(tmpDir, 'sessions');
  const specA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const specB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const sharedSessionId = 'shared-agent-session-42';

  const { service } = createStack({ storageDir });
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // 1. Bind sharedSessionId under Spec A with tasks A1 and A2 (earlier lastSeenAt)
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specA,
      taskId: 'task-a1',
      lastSeenAt: '2026-08-20T10:00:00.000Z',
    });
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specA,
      taskId: 'task-a2',
      lastSeenAt: '2026-08-20T10:05:00.000Z',
    });

    // 2. Bind same sharedSessionId under Spec B with task B1 (more recent lastSeenAt)
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specB,
      taskId: 'task-b1',
      lastSeenAt: '2026-08-21T12:00:00.000Z',
    });

    // 3. GET single session: Spec B is current due to more recent lastSeenAt, returns ONLY Spec B tasks
    const getRes1 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sharedSessionId)}`);
    assert.equal(getRes1.status, 200);
    const getData1 = (await getRes1.json()).session;
    assert.equal(getData1.specId, specB);
    assert.deepEqual(getData1.taskIds, ['task-b1']);

    // 4. Update Spec A lastSeenAt to be newer
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specA,
      taskId: 'task-a1',
      lastSeenAt: '2026-08-23T15:00:00.000Z',
    });

    // 5. GET single session now resolves to Spec A, returning ONLY Spec A tasks [task-a1, task-a2]
    const getRes2 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sharedSessionId)}`);
    assert.equal(getRes2.status, 200);
    const getData2 = (await getRes2.json()).session;
    assert.equal(getData2.specId, specA);
    assert.deepEqual(getData2.taskIds, ['task-a1', 'task-a2']);

    // 6. List sessions filtered by specId=specA returns only Spec A tasks
    const listSpecARes = await fetch(`${baseUrl}/api/agent-sessions?specId=${specA}`);
    const listSpecA = (await listSpecARes.json()).sessions;
    assert.equal(listSpecA.length, 1);
    assert.equal(listSpecA[0].specId, specA);
    assert.deepEqual(listSpecA[0].taskIds, ['task-a1', 'task-a2']);

    // 7. List sessions filtered by specId=specB returns only Spec B tasks
    const listSpecBRes = await fetch(`${baseUrl}/api/agent-sessions?specId=${specB}`);
    const listSpecB = (await listSpecBRes.json()).sessions;
    assert.equal(listSpecB.length, 1);
    assert.equal(listSpecB[0].specId, specB);
    assert.deepEqual(listSpecB[0].taskIds, ['task-b1']);

    // 8. List unfiltered: returns 2 separate spec-scoped entries, never merged taskIds
    const listAllRes = await fetch(`${baseUrl}/api/agent-sessions`);
    const listAll = (await listAllRes.json()).sessions;
    assert.equal(listAll.length, 2);
    const entryA = listAll.find(s => s.specId === specA);
    const entryB = listAll.find(s => s.specId === specB);
    assert.ok(entryA);
    assert.ok(entryB);
    assert.deepEqual(entryA.taskIds, ['task-a1', 'task-a2']);
    assert.deepEqual(entryB.taskIds, ['task-b1']);
  } finally {
    await closeServer(server);
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('Finding 2: PATCH session mode updates only the current spec rows and does not switch current spec', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-patch-mode-spec-'));
  const storageDir = join(tmpDir, 'sessions');
  const { service } = createStack({ storageDir });
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const specA = '11111111-1111-4111-8111-111111111111';
    const specB = '22222222-2222-4222-8222-222222222222';
    const sharedSessionId = 'sess-patch-mode-test';

    // Spec A older
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specA,
      taskId: 'task-a1',
      mode: 'edit',
      createdAt: '2026-08-20T10:00:00.000Z',
      lastSeenAt: '2026-08-20T10:00:00.000Z',
    });

    // Spec B newer
    await service.bindingService.bindSession({
      provider: 'mock',
      providerSessionId: sharedSessionId,
      specId: specB,
      taskId: 'task-b1',
      mode: 'edit',
      createdAt: '2026-08-22T10:00:00.000Z',
      lastSeenAt: '2026-08-22T10:00:00.000Z',
    });

    // GET resolves to Spec B
    const getRes1 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sharedSessionId)}`);
    assert.equal(getRes1.status, 200);
    const session1 = (await getRes1.json()).session;
    assert.equal(session1.specId, specB);
    assert.equal(session1.mode, 'edit');

    // PATCH mode to 'agent'
    const patchRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sharedSessionId)}`, {
      ...control({ mode: 'agent' }),
      method: 'PATCH',
    });
    assert.equal(patchRes.status, 200);

    // Verify Spec A remains untouched
    const specABindings = await service.bindingService.listBindings({ specId: specA });
    assert.equal(specABindings[0].mode, 'edit');
    assert.equal(specABindings[0].lastSeenAt, '2026-08-20T10:00:00.000Z');

    // Subsequent GET still returns Spec B with mode 'agent'
    const getRes2 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sharedSessionId)}`);
    assert.equal(getRes2.status, 200);
    const session2 = (await getRes2.json()).session;
    assert.equal(session2.specId, specB);
    assert.equal(session2.mode, 'agent');
  } finally {
    await closeServer(server);
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});



test('ai slice: registered service is shut down when the app closes', async () => {
  let shutdownCalled = false;
  const { service } = createStack();
  const originalShutdown = service.shutdown.bind(service);
  service.shutdown = async () => {
    shutdownCalled = true;
    await originalShutdown();
  };

  const server = await buildAiTestApp({ service });
  await server.listen({ port: 0 });
  await server.close();

  assert.equal(shutdownCalled, true, 'AI service was shut down when the app closed');
});

test('ai events SSE: connecting to an idle session sends headers immediately and keeps connection alive', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/agent-sessions/mock/idle-session/events?after=0`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    assert.equal(stream.headers.get('cache-control'), 'no-cache');
    assert.equal(stream.headers.get('connection'), 'keep-alive');

    controller.abort();
  } finally {
    await closeServer(server);
  }
});
