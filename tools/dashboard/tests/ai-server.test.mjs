import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { projectChatV1 } from '../server/ai/contracts.mjs';
import { createMockAgentProvider } from '../server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { listen } from '../server/index.mjs';
import { createDefaultAgentSessionService } from '../server/ai/routes.mjs';
import { buildAiTestApp } from './helpers/ai-test-app.mjs';
import { serializePublicTurn, deriveLegacyUserMessageText } from '../server/ai/model/serialization.mjs';

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
  server?.server?.closeAllConnections?.();
  server?.closeAllConnections?.();
  await server?.close?.();
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
    let replayText = '';
    while (true) {
      const { value: chunk, done } = await replayReader.read();
      if (done || !chunk) break;
      replayText += new TextDecoder().decode(chunk);
      if (replayText.includes('event: turn.completed')) break;
    }
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

test('ai events SSE: live SSE stream delivers interaction.requested events in real-time to already connected client', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const sseUrl = `${baseUrl}/api/agent-sessions/mock/session-test-live/events?after=0`;
    const controller = new AbortController();
    const response = await fetch(sseUrl, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const eventsPromise = (async () => {
      let fullText = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        fullText += text;
        if (fullText.includes('event: interaction.requested')) {
          break;
        }
      }
      return fullText;
    })();

    await new Promise(r => setTimeout(r, 50));

    const startRes = await fetch(`${baseUrl}/api/agent-sessions/mock/session-test-live/turns`, control({
      message: 'permission please',
    }));
    assert.equal(startRes.status, 202);

    const receivedText = await Promise.race([
      eventsPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for interaction.requested over SSE!')), 3000)),
    ]);

    assert.ok(receivedText.includes('event: turn.started'));
    assert.ok(receivedText.includes('event: interaction.requested'));
    controller.abort();
  } finally {
    await closeServer(server);
  }
});

test('Task 07: Live application and fresh reload produce semantically equal Turn status, ordered Work, and FinalAnswer', async () => {
  const cacheDir = join(tmpdir(), `nevo-ai-reload-test-${randomUUID()}`);
  const transcriptCache1 = createTranscriptCacheService({ baseDir: cacheDir });

  let completeTurnPromiseResolve;
  const completeTurnPromise = new Promise(r => { completeTurnPromiseResolve = r; });

  const richTurnProvider1 = {
    descriptor: Object.freeze({
      id: 'mock',
      label: 'Mock Rich Provider',
      enabled: true,
      capabilities: { cancelTurn: true, toolCalls: true, reasoning: true, usage: true },
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    }),
    isAvailable() { return { available: true }; },
    async startTurn({ turnId, providerSessionId, emitCommentaryDelta, emitToolStarted, emitToolCompleted }) {
      emitCommentaryDelta('Initial commentary step.\n');

      emitToolStarted({ toolId: 'tool-exec-1', toolName: 'RunBuild', input: { script: 'build' } });
      emitToolCompleted({ toolId: 'tool-exec-1', output: { success: true }, durationMs: 42, status: 'completed' });

      emitCommentaryDelta('Intermediate analysis commentary.\n');

      emitToolStarted({ toolId: 'tool-exec-2', toolName: 'RunTests', input: { suite: 'unit' } });
      emitToolCompleted({ toolId: 'tool-exec-2', output: { passed: 5 }, durationMs: 88, status: 'completed' });

      await completeTurnPromise;
      return { providerSessionId };
    },
    async cancelTurn() {},
  };

  const registry1 = createAgentProviderRegistry([richTurnProvider1]);
  const bindingService1 = createAgentSessionBindingService();
  const turnRuntime1 = createAgentTurnRuntime({ registry: registry1, transcriptCache: transcriptCache1 });
  const service1 = createAgentSessionService({ registry: registry1, turnRuntime: turnRuntime1, transcriptCache: transcriptCache1, bindingService: bindingService1 });
  const server1 = await buildAiTestApp({ service: service1 });
  const baseUrl1 = await listen(server1, { port: 0 });

  let turnId;
  const sessionId = 'session-reload-canonical';
  let liveTurn;

  try {
    const startRes = await fetch(`${baseUrl1}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/turns`, control({
      message: 'Run rich turn for reload verification',
    }));
    assert.equal(startRes.status, 202);
    const body = await startRes.json();
    turnId = body.turnId;

    // Add nested ToolAction to tool-exec-1 and set separate FinalAnswer through coordinator
    const coordinator = turnRuntime1.getCoordinator(turnId);
    assert.ok(coordinator);
    coordinator.addToolAction('tool-exec-1', {
      id: 'action-1',
      title: 'Compile TS',
      kind: 'execute',
      status: 'completed',
      output: '0 errors',
      durationMs: 25,
    });
    coordinator.addToolAction('tool-exec-1', {
      id: 'action-2',
      title: 'Bundle assets',
      kind: 'write',
      status: 'completed',
      output: 'bundle.js created',
      durationMs: 17,
    });

    service1.setFinalAnswer(turnId, {
      id: 'final-answer-turn-1',
      text: 'Build and tests completed successfully.',
      status: 'completed',
    });

    completeTurnPromiseResolve();

    await waitFor(service1, turnId, t => t.status === 'completed');
    await transcriptCache1.flushAll();

    const liveDetails = await fetch(`${baseUrl1}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    assert.equal(liveDetails.status, 200);
    const liveBody = await liveDetails.json();
    assert.equal(liveBody.turns.length, 1);
    liveTurn = liveBody.turns[0];

    assert.equal(liveTurn.id, turnId);
    assert.equal(liveTurn.status.outcome, 'completed');
    assert.equal(liveTurn.finalAnswer.id, 'final-answer-turn-1');
    assert.equal(liveTurn.finalAnswer.text, 'Build and tests completed successfully.');
    assert.equal(liveTurn.work.length, 4);
    assert.equal(liveTurn.work[0].type, 'commentary');
    assert.equal(liveTurn.work[1].type, 'tool');
    assert.equal(liveTurn.work[1].id, 'tool-exec-1');
    assert.equal(liveTurn.work[1].actions.length, 2);
    assert.equal(liveTurn.work[1].actions[0].id, 'action-1');
    assert.equal(liveTurn.work[1].actions[1].id, 'action-2');
    assert.equal(liveTurn.work[2].type, 'commentary');
    assert.equal(liveTurn.work[3].type, 'tool');
    assert.equal(liveTurn.work[3].id, 'tool-exec-2');
  } finally {
    await closeServer(server1);
  }

  // Phase 2: Start new server instance from same persisted cacheDir (simulating fresh reload)
  const transcriptCache2 = createTranscriptCacheService({ baseDir: cacheDir });
  const richTurnProvider2 = {
    descriptor: richTurnProvider1.descriptor,
    isAvailable() { return { available: true }; },
    async startTurn() {},
    async cancelTurn() {},
  };
  const registry2 = createAgentProviderRegistry([richTurnProvider2]);
  const bindingService2 = createAgentSessionBindingService();
  const turnRuntime2 = createAgentTurnRuntime({ registry: registry2, transcriptCache: transcriptCache2 });
  const service2 = createAgentSessionService({ registry: registry2, turnRuntime: turnRuntime2, transcriptCache: transcriptCache2, bindingService: bindingService2 });
  const server2 = await buildAiTestApp({ service: service2 });
  const baseUrl2 = await listen(server2, { port: 0 });

  try {
    const reloadedDetails = await fetch(`${baseUrl2}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    assert.equal(reloadedDetails.status, 200);
    const reloadedBody = await reloadedDetails.json();
    assert.equal(reloadedBody.turns.length, 1);
    const reloadedTurn = reloadedBody.turns[0];

    // Deep semantic assertions comparing live coordinator canonical Turn vs reloaded Turn
    assert.deepStrictEqual(reloadedTurn, liveTurn);
    assert.equal(reloadedTurn.finalAnswer.id, 'final-answer-turn-1');
    assert.equal(reloadedTurn.finalAnswer.text, 'Build and tests completed successfully.');
    assert.equal(reloadedTurn.work.length, 4);
    assert.equal(reloadedTurn.work[1].actions.length, 2);
    assert.equal(reloadedTurn.work[1].actions[0].title, 'Compile TS');
    assert.equal(reloadedTurn.work[1].actions[1].title, 'Bundle assets');
    assert.equal(reloadedBody.readiness.status, 'ready');
    assert.equal(reloadedBody.workSummary.status, 'completed');
  } finally {
    await closeServer(server2);
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: Server workSummary supplies activityCount, currentActivity, and attention without client guessing', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });
  const sessionId = 'session-summary-test';

  try {
    const startRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/turns`, control({
      message: 'permission on summary test',
    }));
    assert.equal(startRes.status, 202);
    const { turnId } = await startRes.json();

    // Wait until turn is waiting for user interaction
    const turn = await waitFor(service, turnId, t => t.pendingInteraction);
    assert.ok(turn.pendingInteraction);

    const chatResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    assert.equal(chatResponse.status, 200);
    const chatBody = await chatResponse.json();

    assert.equal(chatBody.readiness.status, 'requiresAttention');
    assert.ok(chatBody.workSummary);
    assert.equal(chatBody.workSummary.status, 'waitingForUser');
    assert.equal(chatBody.workSummary.attention.required, true);
    assert.ok(chatBody.workSummary.attention.interactionId);
    assert.equal(chatBody.workSummary.expandable, true);

    // Resolve the interaction
    const resolveRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(turn.pendingInteraction.id)}/respond`, control({
      decision: 'allow',
    }));
    assert.equal(resolveRes.status, 200);

    await waitFor(service, turnId, t => t.status === 'completed');

    const completedChat = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    const completedBody = await completedChat.json();
    assert.equal(completedBody.readiness.status, 'ready');
    assert.equal(completedBody.workSummary.status, 'completed');
    assert.equal(completedBody.workSummary.attention, null);
  } finally {
    await closeServer(server);
  }
});

test('Task 07: Corrupt/unreadable persistence state does not become empty ready/idle', async () => {
  const cacheDir = join(tmpdir(), `nevo-ai-corrupt-test-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir });
  const provider = createMockAgentProvider({ specId, taskIds: ['task-a'] });
  const registry = createAgentProviderRegistry([provider]);
  const bindingService = createAgentSessionBindingService();
  await bindingService.bindSession({ provider: 'mock', providerSessionId: 'corrupt-session', specId, purpose: 'corrupt test' });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });

  const sessionId = 'corrupt-session';
  const corruptFilePath = join(cacheDir, 'mock', `${sessionId}.json`);
  await mkdir(join(cacheDir, 'mock'), { recursive: true });
  await writeFile(corruptFilePath, '{ invalid json content !!!', 'utf8');

  try {
    // 1. Session listing check
    const listRes = await fetch(`${baseUrl}/api/agent-sessions`);
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    const listedSession = listBody.sessions.find(s => s.providerSessionId === sessionId);
    assert.ok(listedSession);
    assert.equal(listedSession.status, 'unavailable');

    // 2. Direct session details check
    const detailsResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}`);
    assert.equal(detailsResponse.status, 200);
    const details = (await detailsResponse.json()).session;

    assert.equal(details.status, 'unavailable');
    assert.equal(details.readiness.status, 'unavailable');
    assert.equal(details.readiness.reason, 'persistence_corrupt');
  } finally {
    await closeServer(server);
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: V1 and V2 can project the same session and representation switching has no lifecycle write effect', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });
  const sessionId = 'session-v1-v2-projection';

  try {
    const startRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/turns`, control({
      message: 'Dual representation projection test',
    }));
    assert.equal(startRes.status, 202);
    const { turnId } = await startRes.json();
    await waitFor(service, turnId, t => t.status === 'completed');

    // 1. Query with representation=v1 -> Must return messages, must NOT return turns or workSummary or readiness
    const v1Res = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}?representation=v1`);
    assert.equal(v1Res.status, 200);
    const v1Body = (await v1Res.json()).session;
    assert.ok(Array.isArray(v1Body.messages));
    assert.ok(v1Body.messages.length >= 2);
    assert.equal(v1Body.turns, undefined);
    assert.equal(v1Body.workSummary, undefined);
    assert.equal(v1Body.readiness, undefined);

    // 2. Query with representation=v2 -> Must return turns, workSummary, readiness, must NOT return messages
    const v2Res = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}?representation=v2`);
    assert.equal(v2Res.status, 200);
    const v2Body = (await v2Res.json()).session;
    assert.ok(Array.isArray(v2Body.turns));
    assert.equal(v2Body.turns.length, 1);
    assert.ok(v2Body.workSummary);
    assert.equal(v2Body.readiness.status, 'ready');
    assert.equal(v2Body.messages, undefined);

    // 3. Query /chat endpoint
    const chatRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    assert.equal(chatRes.status, 200);
    const chatBody = await chatRes.json();
    assert.ok(Array.isArray(chatBody.turns));
    assert.equal(chatBody.turns.length, 1);
    assert.equal(chatBody.turns[0].id, turnId);
    assert.equal(chatBody.workSummary.status, 'completed');

    // 4. Repeated representation queries do not alter session turns count or status
    const repeatV1 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}?representation=v1`);
    const repeatV2 = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}?representation=v2`);
    assert.equal(repeatV1.status, 200);
    assert.equal(repeatV2.status, 200);
    const postTurns = await service.listTurns('mock', sessionId);
    assert.equal(postTurns.length, 1);
    assert.equal(postTurns[0].status.outcome, 'completed');
  } finally {
    await closeServer(server);
  }
});

test('V2 public Turn projection is identical across HTTP, live SSE, replay, chat, and Turn list paths', async () => {
  const cacheDir = join(tmpdir(), `nevo-public-turn-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const sessionId = 'session-public-turn-projection';

  let continueToTools;
  let completeEdit;
  let finishTurn;
  const toolsGate = new Promise(resolve => { continueToTools = resolve; });
  const editGate = new Promise(resolve => { completeEdit = resolve; });
  const terminalGate = new Promise(resolve => { finishTurn = resolve; });

  const provider = {
    descriptor: {
      id: 'projection',
      label: 'Projection Provider',
      capabilities: { streaming: true, toolCalls: true, cancelTurn: true },
    },
    async startTurn(ctx) {
      ctx.emitCommentaryDelta('Inspecting the target files.', 'commentary-1');
      await toolsGate;
      ctx.emitToolStarted({
        toolId: 'read-1',
        toolName: 'Read',
        kind: 'read',
        title: 'Read source file',
        description: 'src/input.ts',
        input: { path: 'src/input.ts' },
      });
      ctx.emitToolCompleted({ toolId: 'read-1', status: 'completed', output: 'source' });
      ctx.emitToolStarted({
        toolId: 'edit-1',
        toolName: 'Edit',
        kind: 'edit',
        title: 'Edit source file',
        description: 'src/input.ts',
        input: { path: 'src/input.ts' },
      });
      await editGate;
      ctx.emitToolCompleted({ toolId: 'edit-1', status: 'completed', output: 'updated' });
      await terminalGate;
      ctx.setFinalAnswer({ id: 'answer-1', text: 'The edit is complete.', status: 'completed' });
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache });
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });
  const liveUpdates = [];

  const waitForUpdate = async (predicate, message) => {
    for (let index = 0; index < 200; index += 1) {
      const match = liveUpdates.findLast(predicate);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${message}.`);
  };

  const readHttpTurn = async path => {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    return body.session?.turns?.[0] ?? body.turns?.[0];
  };

  const unsubscribe = service.subscribeToSession('projection', sessionId, {
    onEvent: event => {
      if (event.type === 'turn.updated') liveUpdates.push(structuredClone(event.turn));
    },
  });

  try {
    const { turnId } = await service.startTurn('projection', sessionId, {
      message: 'Inspect, read, and edit the source file.',
    });

    const commentaryTurn = await waitForUpdate(
      turn => turn.currentActivity?.kind === 'commentary',
      'streaming commentary activity',
    );
    assert.equal(commentaryTurn.currentActivity.subjectId, 'commentary-1');
    assert.deepEqual(commentaryTurn.historicalWork, []);

    continueToTools();
    const activeEditSse = await waitForUpdate(
      turn => turn.currentActivity?.subjectId === 'edit-1',
      'active edit activity',
    );
    assert.deepEqual(activeEditSse.historicalWork.map(item => item.id), ['commentary-1', 'read-1']);
    assert.equal(activeEditSse.currentActivity.kind, 'tool');
    assert.equal(activeEditSse.currentActivity.toolKind, 'edit');
    assert.equal(activeEditSse.currentActivity.title, 'Edit source file');
    assert.equal(activeEditSse.currentActivity.description, 'src/input.ts');
    assert.ok(!activeEditSse.historicalWork.some(item => item.id === 'edit-1'));
    assert.ok(activeEditSse.work.some(item => item.id === 'edit-1'), 'full Work remains available for Work Details');

    const detailsPath = `/api/agent-sessions/projection/${sessionId}?representation=v2`;
    const activeEditHttp = await readHttpTurn(detailsPath);
    assert.deepEqual(activeEditHttp, activeEditSse);

    const activeChatTurn = await readHttpTurn(`/api/agent-sessions/projection/${sessionId}/chat`);
    const activeListTurn = await readHttpTurn(`/api/agent-sessions/projection/${sessionId}/turns`);
    assert.deepEqual(activeChatTurn, activeEditHttp);
    assert.deepEqual(activeListTurn, activeEditHttp);

    const replayedUpdates = [];
    const unsubscribeReplay = service.subscribeToSession('projection', sessionId, {
      afterSequence: 0,
      onEvent: event => {
        if (event.type === 'turn.updated') replayedUpdates.push(structuredClone(event.turn));
      },
    });
    unsubscribeReplay();
    const replayedActiveEdit = replayedUpdates.findLast(turn => turn.currentActivity?.subjectId === 'edit-1');
    assert.deepEqual(replayedActiveEdit, activeEditHttp);

    completeEdit();
    const completedEditSse = await waitForUpdate(
      turn => turn.historicalWork?.some(item => item.id === 'edit-1')
        && turn.currentActivity?.kind === 'waiting_for_model',
      'completed edit followed by model wait',
    );
    assert.deepEqual(
      completedEditSse.historicalWork.map(item => item.id),
      ['commentary-1', 'read-1', 'edit-1'],
    );
    assert.equal(completedEditSse.currentActivity.subjectId, undefined);
    assert.deepEqual(await readHttpTurn(detailsPath), completedEditSse);

    finishTurn();
    const terminalSse = await waitForUpdate(
      turn => turn.status?.status === 'terminal',
      'terminal Turn projection',
    );
    assert.equal(terminalSse.currentActivity, null);
    assert.equal(terminalSse.finalAnswer.text, 'The edit is complete.');
    assert.deepEqual(await readHttpTurn(detailsPath), terminalSse);

    await transcriptCache.flush('projection', sessionId);
    const canonicalTranscript = await transcriptCache.getTranscript('projection', sessionId);
    const canonicalTurn = canonicalTranscript.turns.find(turn => turn.id === turnId);
    assert.equal(canonicalTurn.historicalWork, undefined, 'persistence remains canonical, not presentation-shaped');
    assert.equal(canonicalTurn.currentActivity, undefined, 'persistence does not store derived activity');
  } finally {
    unsubscribe();
    await closeServer(server);
    await service.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: API and SSE serialization contain no provider-private IDs or diagnostic sidecar content', async () => {
  const { service } = createStack();
  const server = await buildAiTestApp({ service });
  const baseUrl = await listen(server, { port: 0 });
  const sessionId = 'session-neutral-payload';

  try {
    const startRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/turns`, control({
      message: 'Verify clean neutral serialization',
    }));
    assert.equal(startRes.status, 202);
    const { turnId } = await startRes.json();
    await waitFor(service, turnId, t => t.status === 'completed');

    const detailsRes = await fetch(`${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(sessionId)}/chat`);
    const rawText = await detailsRes.text();

    assert.ok(!rawText.includes('__private'));
    assert.ok(!rawText.includes('internalDiagnostic'));
    assert.ok(!rawText.includes('rawTrace'));
  } finally {
    await closeServer(server);
  }
});

test('Task 07: Protocol silence timeout terminalization preserves canonical state across reload and restart reconciliation', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-timeout-term-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const silentProvider = {
    descriptor: { id: 'silent', label: 'Silent Provider', capabilities: { streaming: true, cancelTurn: true } },
    async startTurn({ signal }) {
      // Simulate hung provider that never resolves until aborted
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Turn aborted')), { once: true });
      });
    },
    async cancelTurn() {},
  };
  const registry = createAgentProviderRegistry([silentProvider]);
  let currentTime = 1000;
  const clock = () => new Date(currentTime);

  const turnRuntime = createAgentTurnRuntime({
    registry,
    transcriptCache,
    idleTimeoutMs: 50,
    idleCheckIntervalMs: 10,
    clock,
  });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  try {
    const { turnId } = await service.startTurn('silent', 'sess-silence-test', {
      prompt: 'Hang and timeout',
    });

    // Advance time past the idle timeout window and trigger check
    currentTime += 100;
    await new Promise(r => setTimeout(r, 60));

    // 1. In-memory turn is terminal/failed with timeout cause
    const inMemoryTurn = turnRuntime.getCanonicalTurn(turnId);
    assert.equal(inMemoryTurn.status.status, 'terminal');
    assert.equal(inMemoryTurn.status.outcome, 'failed');
    assert.equal(inMemoryTurn.status.cause, 'timeout/protocol-silence');

    // 2. Persisted state on disk is exactly the same terminal state
    await transcriptCache.flush('silent', 'sess-silence-test');
    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('silent', 'sess-silence-test');
    assert.equal(persisted.turns.length, 1);
    assert.equal(persisted.turns[0].status.status, 'terminal');
    assert.equal(persisted.turns[0].status.outcome, 'failed');
    assert.equal(persisted.turns[0].status.cause, 'timeout/protocol-silence');

    // 3. Restart reconciliation on fresh runtime leaves terminal timeout turn untouched
    const freshRuntime = createAgentTurnRuntime({ registry, transcriptCache: diskCache });
    const { reconciledCount } = await freshRuntime.reconcileOrphanedTurns();
    assert.equal(reconciledCount, 0);

    const afterRecon = await diskCache.getTranscript('silent', 'sess-silence-test');
    assert.equal(afterRecon.turns[0].status.outcome, 'failed');
    assert.equal(afterRecon.turns[0].status.cause, 'timeout/protocol-silence');
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: Terminal persistence flush is awaitable and persists before graceful shutdown finishes', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-term-flush-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 50 });
  const provider = createMockAgentProvider({ specId, streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);

  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  try {
    const { turnId } = await service.startTurn('mock', 'sess-term-flush', {
      prompt: 'Active turn to be interrupted on shutdown',
    });
    // Do not wait for turn to complete; shut down immediately
    await turnRuntime.shutdown();

    // Fresh transcript cache reading directly from disk
    const freshCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const transcript = await freshCache.getTranscript('mock', 'sess-term-flush');
    assert.equal(transcript.turns.length, 1);
    assert.equal(transcript.turns[0].id, turnId);
    assert.equal(transcript.turns[0].status.status, 'terminal');
    assert.equal(transcript.turns[0].status.outcome, 'interrupted');
    assert.ok(['turn_interrupted', 'AI_TURN_INTERRUPTED'].includes(transcript.turns[0].status.cause));
  } finally {
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: Single V1 projector produces identical assistant message across all V1 read paths for interrupted turn', async () => {
  const interruptedTurn = {
    id: 'turn-int-proj-1',
    providerSessionId: 'sess-proj',
    mode: 'agent',
    status: {
      status: 'terminal',
      outcome: 'interrupted',
      initiator: 'shutdown',
      cause: 'turn_interrupted',
      error: { message: 'Interrupted by server restart.' },
    },
    work: [
      { id: 'c1', type: 'commentary', text: 'Partial text before crash', status: 'completed' },
    ],
    startedAt: '2026-08-31T10:00:00.000Z',
    completedAt: '2026-08-31T10:00:05.000Z',
  };

  // 1. Direct projectChatV1 call
  const fromDirectProjector = projectChatV1([interruptedTurn]);

  // 2. TranscriptCache getTranscript() messages
  const cacheDir = join(tmpdir(), `nevo-test-proj-v1-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  transcriptCache.recordCanonicalTurn('mock', 'sess-proj', interruptedTurn);
  await transcriptCache.flush('mock', 'sess-proj');

  const transcript = await transcriptCache.getTranscript('mock', 'sess-proj');
  const fromCache = transcript.messages;

  // 3. AgentSessionService listMessages()
  const provider = createMockAgentProvider({ specId });
  const registry = createAgentProviderRegistry([provider]);
  const service = createAgentSessionService({ registry, transcriptCache });
  const fromService = await service.listMessages('mock', 'sess-proj');

  assert.deepEqual(fromDirectProjector, fromCache);
  assert.deepEqual(fromDirectProjector, fromService);
  assert.equal(fromDirectProjector[0].text, 'Interrupted by server restart.');

  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

test('Task 07: Explicit schema validation rejects unsupported schema version as corrupt/unavailable', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-unsupported-schema-${randomUUID()}`);
  const filePath = join(cacheDir, 'mock', 'sess-unsupported.json');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({
    schemaVersion: 99,
    provider: 'mock',
    providerSessionId: 'sess-unsupported',
    turns: [{ id: 't1' }],
  }), 'utf-8');

  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const transcript = await transcriptCache.getTranscript('mock', 'sess-unsupported');

  assert.equal(transcript.health, 'corrupt');
  assert.ok(transcript.error.includes('Unsupported schema version: 99'));

  const provider = createMockAgentProvider({ specId });
  const registry = createAgentProviderRegistry([provider]);
  const service = createAgentSessionService({ registry, transcriptCache });

  const session = await service.getSessionDetails('mock', 'sess-unsupported');
  assert.equal(session.status, 'unavailable');
  assert.equal(session.readiness.status, 'unavailable');
  assert.equal(session.readiness.reason, 'persistence_corrupt');

  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

test('Task 07: Per-session write serialization guarantees newest snapshot wins', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-write-ser-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  // Rapid fire updates to canonical Turn snapshots
  const turnV1 = { id: 'turn-seq', providerSessionId: 'sess-ser', status: { status: 'active' }, work: [], count: 1 };
  const turnV2 = { id: 'turn-seq', providerSessionId: 'sess-ser', status: { status: 'active' }, work: [], count: 2 };
  const turnV3 = { id: 'turn-seq', providerSessionId: 'sess-ser', status: { status: 'terminal', outcome: 'completed' }, work: [], count: 3 };

  transcriptCache.recordCanonicalTurn('mock', 'sess-ser', turnV1);
  const p1 = transcriptCache.flush('mock', 'sess-ser');

  transcriptCache.recordCanonicalTurn('mock', 'sess-ser', turnV2);
  const p2 = transcriptCache.flush('mock', 'sess-ser');

  transcriptCache.recordCanonicalTurn('mock', 'sess-ser', turnV3);
  const p3 = transcriptCache.flush('mock', 'sess-ser');

  await Promise.all([p1, p2, p3]);

  // Read back directly from disk
  const freshCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const diskState = await freshCache.getTranscript('mock', 'sess-ser');

  assert.equal(diskState.turns.length, 1);
  assert.equal(diskState.turns[0].count, 3);
  assert.equal(diskState.turns[0].status.outcome, 'completed');

  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

test('Task 07: Timeout terminal arbitration: accepted timeout intent prevails over concurrent provider completion during deferred cleanup', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-timeout-arb-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  let finishProviderPromise;
  const slowCancelProvider = {
    descriptor: { id: 'slow-cancel', label: 'Slow Cancel Provider', capabilities: { streaming: true, cancelTurn: true } },
    async startTurn() {
      return new Promise((resolve) => {
        finishProviderPromise = resolve;
      });
    },
    async cancelTurn() {
      // While cancelTurn is awaiting, provider completes
      if (finishProviderPromise) {
        finishProviderPromise({ providerSessionId: 'sess-arb-1' });
      }
      await new Promise(r => setTimeout(r, 20));
    },
  };
  const registry = createAgentProviderRegistry([slowCancelProvider]);
  let currentTime = 1000;
  const clock = () => new Date(currentTime);

  const turnRuntime = createAgentTurnRuntime({
    registry,
    transcriptCache,
    idleTimeoutMs: 50,
    idleCheckIntervalMs: 10,
    clock,
  });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  try {
    const { turnId } = await service.startTurn('slow-cancel', 'sess-arb-1', {
      prompt: 'Test timeout arbitration vs completion',
    });

    // Advance clock to trigger watchdog timeout
    currentTime += 100;
    await new Promise(r => setTimeout(r, 60));

    // 1. In-memory turn is terminal failed with timeout cause (NOT completed!)
    const inMemoryTurn = turnRuntime.getCanonicalTurn(turnId);
    assert.equal(inMemoryTurn.status.status, 'terminal');
    assert.equal(inMemoryTurn.status.outcome, 'failed');
    assert.equal(inMemoryTurn.status.cause, 'timeout/protocol-silence');

    // 2. Persisted state is failed with timeout/protocol-silence
    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('slow-cancel', 'sess-arb-1');
    assert.equal(persisted.turns.length, 1);
    assert.equal(persisted.turns[0].status.status, 'terminal');
    assert.equal(persisted.turns[0].status.outcome, 'failed');
    assert.equal(persisted.turns[0].status.cause, 'timeout/protocol-silence');
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: Timeout terminal arbitration: provider cancellation failure does not replace timeout cause', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-timeout-fail-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  const failingCancelProvider = {
    descriptor: { id: 'fail-cancel', label: 'Fail Cancel Provider', capabilities: { streaming: true, cancelTurn: true } },
    async startTurn({ signal }) {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Turn aborted by signal')), { once: true });
      });
    },
    async cancelTurn() {
      throw new Error('Provider cancellation connection reset');
    },
  };
  const registry = createAgentProviderRegistry([failingCancelProvider]);
  let currentTime = 1000;
  const clock = () => new Date(currentTime);

  const turnRuntime = createAgentTurnRuntime({
    registry,
    transcriptCache,
    idleTimeoutMs: 50,
    idleCheckIntervalMs: 10,
    clock,
  });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  try {
    const { turnId } = await service.startTurn('fail-cancel', 'sess-arb-2', {
      prompt: 'Test timeout arbitration vs cancellation error',
    });

    currentTime += 100;
    await new Promise(r => setTimeout(r, 60));

    const inMemoryTurn = turnRuntime.getCanonicalTurn(turnId);
    assert.equal(inMemoryTurn.status.status, 'terminal');
    assert.equal(inMemoryTurn.status.outcome, 'failed');
    assert.equal(inMemoryTurn.status.cause, 'timeout/protocol-silence');

    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('fail-cancel', 'sess-arb-2');
    assert.equal(persisted.turns[0].status.outcome, 'failed');
    assert.equal(persisted.turns[0].status.cause, 'timeout/protocol-silence');
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: Canonical V2 SSE streaming and replay deliver exact canonical Work, nested ToolActions, and FinalAnswer', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-v2-sse-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  const manualProvider = {
    descriptor: { id: 'manual', label: 'Manual Provider', capabilities: { streaming: true, cancelTurn: true } },
    async startTurn(ctx) {
      // 1. Commentary
      ctx.emitCommentaryDelta('I will inspect files.\n');
      // 2. Tool with nested actions
      const tool = { toolId: 'tool-read-1', toolName: 'readFile', input: { path: 'file.txt' }, status: 'running' };
      ctx.emitToolStarted(tool);
      ctx.addToolAction('tool-read-1', { id: 'act-1', kind: 'search', title: 'Check file size' });
      ctx.addToolAction('tool-read-1', { id: 'act-2', kind: 'read', title: 'Read bytes' });
      ctx.emitToolCompleted({ toolId: 'tool-read-1', status: 'completed', output: 'content' });
      // 3. Second commentary
      ctx.emitCommentaryDelta('File inspected successfully.\n');
      // 4. Final Answer
      ctx.setFinalAnswer({ id: 'fa-1', text: 'All done and verified.', status: 'completed' });

      return { providerSessionId: 'sess-v2-test' };
    },
    async cancelTurn() {},
  };
  const registry = createAgentProviderRegistry([manualProvider]);
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  const liveV2Updates = [];
  try {
    // Subscribe to live session stream before starting turn
    const unsubscribe = turnRuntime.subscribeToSession({ provider: 'manual', providerSessionId: 'sess-v2-test' }, {
      onEvent: (ev) => {
        if (ev.type === 'turn.updated') {
          liveV2Updates.push(ev.turn);
        }
      },
    });

    const { turnId } = await service.startTurn('manual', 'sess-v2-test', {
      prompt: 'V2 canonical stream test',
    });

    await new Promise(r => setTimeout(r, 20));
    unsubscribe();

    // 1. Live stream received turn.updated events including nested ToolActions and FinalAnswer
    assert.ok(liveV2Updates.length > 0);
    const lastLiveTurn = liveV2Updates[liveV2Updates.length - 1];
    const liveTool = lastLiveTurn.work.find(w => w.id === 'tool-read-1');
    assert.ok(liveTool);
    assert.equal(liveTool.actions.length, 2);
    assert.equal(liveTool.actions[0].id, 'act-1');
    assert.equal(liveTool.actions[1].id, 'act-2');
    assert.equal(lastLiveTurn.finalAnswer?.text, 'All done and verified.');

    // 2. Reconnect / replay with afterSequence = 0 recovers identical canonical snapshots
    const replayV2Updates = [];
    turnRuntime.subscribeToSession({ provider: 'manual', providerSessionId: 'sess-v2-test' }, {
      afterSequence: 0,
      onEvent: (ev) => {
        if (ev.type === 'turn.updated') {
          replayV2Updates.push(ev.turn);
        }
      },
    })();
    const lastReplayTurn = replayV2Updates[replayV2Updates.length - 1];
    assert.deepEqual(lastReplayTurn.work, lastLiveTurn.work);
    assert.deepEqual(lastReplayTurn.finalAnswer, lastLiveTurn.finalAnswer);

    // 3. HTTP V2 read / in-memory canonical turn converges with persisted reload
    const inMemTurn = turnRuntime.getCanonicalTurn(turnId);
    assert.equal(inMemTurn.work.length, 3);
    assert.equal(inMemTurn.work[1].actions.length, 2);
    assert.deepEqual(inMemTurn.finalAnswer, lastLiveTurn.finalAnswer);

    // 4. Persisted reload from disk converges to exact same semantic Turn
    await transcriptCache.flush('manual', 'sess-v2-test');
    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('manual', 'sess-v2-test');
    const persistedTurn = persisted.turns[0];
    assert.deepEqual(persistedTurn.work, inMemTurn.work);
    assert.deepEqual(persistedTurn.finalAnswer, lastLiveTurn.finalAnswer);
    assert.equal(persistedTurn.work[1].actions.length, 2);
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Task 07: flushAll() completion guarantee awaits all dirty and queued writes', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-flushall-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 100 });

  const turnA = { id: 'turn-a', providerSessionId: 'sess-a', status: { status: 'active' }, work: [] };
  const turnB = { id: 'turn-b', providerSessionId: 'sess-b', status: { status: 'active' }, work: [] };

  transcriptCache.recordCanonicalTurn('mock', 'sess-a', turnA);
  transcriptCache.recordCanonicalTurn('mock', 'sess-b', turnB);

  // Both are dirty; flushAll must flush and wait for disk writes of both sessions
  await transcriptCache.flushAll();

  const freshCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const docA = await freshCache.getTranscript('mock', 'sess-a');
  const docB = await freshCache.getTranscript('mock', 'sess-b');

  assert.equal(docA.turns.length, 1);
  assert.equal(docA.turns[0].id, 'turn-a');
  assert.equal(docB.turns.length, 1);
  assert.equal(docB.turns[0].id, 'turn-b');

  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

test('Task 07: deleteTranscript() serializes with in-progress writes and guarantees transcript file is deleted', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-del-ser-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  const turn = { id: 'turn-del', providerSessionId: 'sess-del', status: { status: 'active' }, work: [] };
  transcriptCache.recordCanonicalTurn('mock', 'sess-del', turn);

  // Start flush, then immediately request deleteTranscript while flush is queued/in progress
  const flushPromise = transcriptCache.flush('mock', 'sess-del');
  const deletePromise = transcriptCache.deleteTranscript('mock', 'sess-del');

  await Promise.all([flushPromise, deletePromise]);

  const filePath = join(cacheDir, 'mock', 'sess-del.json');
  let exists = true;
  try {
    await stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') exists = false;
  }
  assert.equal(exists, false, 'Transcript file must remain deleted and not recreated by queued write');

  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

test('Task 07: V1 queued tool status compatibility maps queued to running instead of failed', () => {
  const queuedToolTurn = {
    id: 'turn-q-1',
    providerSessionId: 'sess-q',
    status: { status: 'active' },
    work: [
      { id: 'tool-q', type: 'tool', toolName: 'build', status: 'queued' },
      { id: 'tool-r', type: 'tool', toolName: 'test', status: 'active' },
      { id: 'tool-c', type: 'tool', toolName: 'lint', status: 'completed' },
      { id: 'tool-f', type: 'tool', toolName: 'deploy', status: 'failed' },
    ],
  };

  const messages = projectChatV1([queuedToolTurn]);
  assert.equal(messages.length, 1);
  const toolCalls = messages[0].toolCalls;
  assert.equal(toolCalls.length, 4);
  assert.equal(toolCalls[0].status, 'running', 'queued status must map to running in V1 projection');
  assert.equal(toolCalls[1].status, 'running', 'active status must map to running in V1 projection');
  assert.equal(toolCalls[2].status, 'completed');
  assert.equal(toolCalls[3].status, 'failed');
});

test('Task 07: CanonicalTurn session identity invariant holds across first turn and subsequent turns', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-sess-inv-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });

  const provider = createMockAgentProvider({ specId, streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const bindingService = createAgentSessionBindingService();
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });

  try {
    // 1. Turn 1 (session creation)
    const turn1Result = await service.startTurn('mock', null, { specId, prompt: 'First turn' });
    const providerSessionId = turn1Result.providerSessionId;
    assert.ok(providerSessionId);
    await waitFor(service, turn1Result.turnId, t => t.status === 'completed');

    // Turn 1 canonical in-memory state
    const turn1Snap = turnRuntime.getCanonicalTurn(turn1Result.turnId);
    assert.equal(turn1Snap.providerSessionId, providerSessionId);
    assert.equal(turn1Snap.sessionId, providerSessionId);
    assert.notEqual(turn1Snap.sessionId, turn1Result.turnId, 'sessionId must never fabricate turnId');

    // 2. Turn 2 in the established session
    const turn2Result = await service.startTurn('mock', providerSessionId, { specId, prompt: 'Second turn' });
    assert.equal(turn2Result.providerSessionId, providerSessionId);
    await waitFor(service, turn2Result.turnId, t => t.status === 'completed');

    const turn2Snap = turnRuntime.getCanonicalTurn(turn2Result.turnId);
    assert.equal(turn2Snap.providerSessionId, providerSessionId);
    assert.equal(turn2Snap.sessionId, providerSessionId);
    assert.notEqual(turn2Snap.sessionId, turn2Result.turnId, 'sessionId must never fabricate turnId');

    // 3. Persisted transcript turns
    await transcriptCache.flush('mock', providerSessionId);
    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('mock', providerSessionId);
    assert.equal(persisted.turns.length, 2);
    assert.equal(persisted.turns[0].providerSessionId, providerSessionId);
    assert.equal(persisted.turns[0].sessionId, providerSessionId);
    assert.equal(persisted.turns[1].providerSessionId, providerSessionId);
    assert.equal(persisted.turns[1].sessionId, providerSessionId);
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ── task 11 correction: canonical userMessage — the user-visible chat message, distinct
// from `prompt` (the enriched text actually sent to the provider) ────────────────────

test('V2 correction: a plain composer send has userMessage.text equal to the message, surviving reload/persistence', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-usermsg-plain-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const provider = createMockAgentProvider({ specId, streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache });

  try {
    const { turnId, providerSessionId } = await service.startTurn('mock', null, { specId, message: 'Continue' });
    await waitFor(service, turnId, t => t.status === 'completed');

    const details = await service.getSessionDetails('mock', providerSessionId, { representation: 'v2' });
    const publicTurn = details.turns.find(t => t.id === turnId);
    assert.deepEqual(publicTurn.userMessage?.text, 'Continue');

    await transcriptCache.flush('mock', providerSessionId);
    const diskCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
    const persisted = await diskCache.getTranscript('mock', providerSessionId);
    const persistedTurn = persisted.turns.find(t => t.id === turnId);
    assert.equal(persistedTurn.userMessage.text, 'Continue', 'the clean user-visible message must be persisted on the canonical Turn');
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('V2 correction: an enriched initial-dispatch prompt keeps userMessage clean while prompt carries the full enriched text sent to the provider', async () => {
  const cacheDir = join(tmpdir(), `nevo-test-usermsg-enriched-${randomUUID()}`);
  const transcriptCache = createTranscriptCacheService({ baseDir: cacheDir, flushDebounceMs: 0 });
  const provider = createMockAgentProvider({ specId, streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache });

  const enrichedPrompt = "[NEvo Context: Specification 'demo']\nTitle: \"Demo\"\nLocation: specs/active/demo/\nScope: Full specification\n\nDo the thing";

  try {
    const { turnId, providerSessionId } = await service.startTurn('mock', null, {
      specId,
      message: enrichedPrompt,
      userMessage: 'Do the thing',
    });
    await waitFor(service, turnId, t => t.status === 'completed');

    const details = await service.getSessionDetails('mock', providerSessionId, { representation: 'v2' });
    const publicTurn = details.turns.find(t => t.id === turnId);
    assert.equal(publicTurn.userMessage?.text, 'Do the thing', 'the chat bubble text must never contain the injected Nevo context');
    assert.ok(!JSON.stringify(publicTurn).includes('NEvo Context'), 'the public DTO must not leak the enriched prompt anywhere');

    const canonicalTurn = turnRuntime.getCanonicalTurn(turnId);
    assert.equal(canonicalTurn.prompt, enrichedPrompt, 'the full enriched prompt actually sent to the provider is preserved separately');
  } finally {
    await turnRuntime.shutdown();
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('V2 correction: legacy Turns persisted before userMessage existed fall back to a cleaned userMessage derived from prompt', () => {
  const legacyTurnWithContext = {
    id: 'turn-legacy-1', turnId: 'turn-legacy-1', provider: 'mock', providerSessionId: 'sess-1',
    mode: 'edit', status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since: new Date().toISOString(), source: 'coordinator' },
    work: [], activityCount: 0, finalAnswer: null,
    prompt: "[NEvo Context: Specification 'demo']\nTitle: \"Demo\"\nLocation: specs/active/demo/\nScope: Full specification\n\nStart working on the task.",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const publicLegacy = serializePublicTurn(legacyTurnWithContext);
  assert.equal(publicLegacy.userMessage.text, 'Start working on the task.');
  assert.ok(!publicLegacy.userMessage.text.includes('NEvo Context'));

  const legacyTurnPlain = { ...legacyTurnWithContext, id: 'turn-legacy-2', turnId: 'turn-legacy-2', prompt: 'Posprzątałem, masz czysto' };
  const publicPlain = serializePublicTurn(legacyTurnPlain);
  assert.equal(publicPlain.userMessage.text, 'Posprzątałem, masz czysto', 'a legacy prompt with no injected header passes through unchanged');
});

test('V2 correction: deriveLegacyUserMessageText only strips its own known Nevo marker, never arbitrary text', () => {
  assert.equal(
    deriveLegacyUserMessageText("[NEvo Context: Specification 'x']\nScope: Full specification\n\nHello there"),
    'Hello there',
  );
  assert.equal(deriveLegacyUserMessageText('Context: tasks a, b\n\nDo it'), 'Do it');
  assert.equal(deriveLegacyUserMessageText('Plain message, no header'), 'Plain message, no header');
  assert.equal(deriveLegacyUserMessageText(''), '');
});



