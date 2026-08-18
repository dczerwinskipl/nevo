import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../../ai/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../../ai/binding-service.mjs';
import { createDashboardServer, listen } from '../server/index.mjs';

const specId = '70609aaf-bb62-40bf-a25e-bec65c583495';

function fakeHub() {
  return { subscribe: () => () => {}, close: () => {} };
}

function createStack() {
  const adapter = createMockAiAdapter({ specId, taskIds: ['task-a', 'task-b'], streamDelayMs: 1 });
  const registry = createAiAdapterRegistry([adapter]);
  const transcriptCache = createTranscriptCacheService();
  const bindingService = createAgentSessionBindingService();
  const turnRuntime = createAiTurnRuntime({ registry, transcriptCache });
  return { adapter, service: createAiSessionService({ registry, turnRuntime, transcriptCache, bindingService }) };
}

function control(body, extra = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1', ...extra },
    body: JSON.stringify(body),
  };
}

async function waitFor(baseUrl, turnId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const response = await fetch(`${baseUrl}/api/ai/turns/${encodeURIComponent(turnId)}`);
    const turn = (await response.json()).turn;
    if (predicate(turn)) return turn;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for API turn state.');
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
  const server = createDashboardServer({
    aiService: service,
    aiAccessPolicy: ({ capability }) => { policyCalls.push(capability); return true; },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
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
    const completedTurn = await waitFor(baseUrl, turnId, turn => turn.status === 'completed');
    assert.equal(completedTurn.events[0].type, 'turn.started');
    assert.equal(completedTurn.events.at(-1).type, 'turn.completed');

    // 3. List bindings: GET /api/agent-sessions?specId=...&taskId=...
    const filtered = await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}&taskId=task-a`);
    const bindings = (await filtered.json()).sessions;
    assert.ok(bindings.some(b => b.providerSessionId === providerSessionId && b.specId === specId));

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

    // 5. Subsequent turn: POST /api/agent-sessions/:provider/:providerSessionId/turns
    const secondTurnResponse = await fetch(
      `${baseUrl}/api/agent-sessions/mock/${encodeURIComponent(providerSessionId)}/turns`,
      control({ message: 'Subsequent turn message' }),
    );
    assert.equal(secondTurnResponse.status, 202);
    const { turnId: secondTurnId } = await secondTurnResponse.json();
    await waitFor(baseUrl, secondTurnId, turn => turn.status === 'completed');

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

test('Session SSE replays events, preserves pending interaction, and resolves via session endpoint', async () => {
  const { service } = createStack();
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const start = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-a-1/turns`, control({
      message: 'permission please',
      idempotencyKey: 'permission-1',
    }));
    const { turnId } = await start.json();
    const pendingTurn = await waitFor(baseUrl, turnId, turn => turn.pendingInteraction);

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

    const completed = await waitFor(baseUrl, turnId, turn => turn.status === 'completed');
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
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const firstResponse = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-1/turns`, control({
      message: 'ask a question',
      idempotencyKey: 'q-1',
    }));
    const first = await firstResponse.json();
    await waitFor(baseUrl, first.turnId, turn => turn.pendingInteraction);

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

    const turn = await waitFor(baseUrl, first.turnId, value => value.pendingInteraction);
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
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    assert.equal((await fetch(`${baseUrl}/api/agent-providers`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions`, control({ provider: 'mock', specId, providerSessionId: 'x' }, { origin: 'https://attacker.example' }))).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/agent-sessions/%2e%2e/%2e%2e/messages`)).status, 404);

    const malformed = await fetch(`${baseUrl}/api/agent-sessions`, {
      method: 'POST', headers: { 'x-nevo-dashboard-action': '1' }, body: '{',
    });
    assert.equal(malformed.status, 400);

    const start = await fetch(`${baseUrl}/api/agent-sessions/mock/demo-task-b-2/turns`, control({ message: 'permission before cancel' }));
    const { turnId } = await start.json();
    await waitFor(baseUrl, turnId, turn => turn.pendingInteraction);
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
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // 1. Start turns on two distinct sessions
    const startA = await fetch(`${baseUrl}/api/agent-sessions/mock/session-alpha/turns`, control({
      message: 'permission on alpha',
      idempotencyKey: 'key-alpha',
    }));
    const { turnId: turnIdA } = await startA.json();
    const turnA = await waitFor(baseUrl, turnIdA, t => t.pendingInteraction);

    const startB = await fetch(`${baseUrl}/api/agent-sessions/mock/session-beta/turns`, control({
      message: 'permission on beta',
      idempotencyKey: 'key-beta',
    }));
    const { turnId: turnIdB } = await startB.json();
    const turnB = await waitFor(baseUrl, turnIdB, t => t.pendingInteraction);

    // 2. Cross-session cancel attempt: trying to cancel turnIdA using session-beta route
    const crossCancel = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-beta/turns/${turnIdA}/cancel`,
      control({}),
    );
    assert.equal(crossCancel.status, 404);
    const crossCancelJson = await crossCancel.json();
    assert.equal(crossCancelJson.error.code, 'AI_NOT_FOUND');

    // Verify session-alpha turn is still waitingForUser and NOT cancelled
    const checkTurnA = await (await fetch(`${baseUrl}/api/ai/turns/${turnIdA}`)).json();
    assert.equal(checkTurnA.turn.status, 'waitingForUser');

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
    const completedA = await waitFor(baseUrl, turnIdA, t => t.status === 'completed');
    assert.equal(completedA.status, 'completed');

    const validCancel = await fetch(
      `${baseUrl}/api/agent-sessions/mock/session-beta/turns/${turnIdB}/cancel`,
      control({}),
    );
    assert.equal(validCancel.status, 200);
    const cancelledB = await waitFor(baseUrl, turnIdB, t => t.status === 'failed');
    assert.equal(cancelledB.events.at(-1).error.code, 'AI_TURN_CANCELLED');
  } finally {
    await closeServer(server);
  }
});

test('pending interaction can be resolved after server restart retaining persisted transcript state with strict correlation', async () => {
  const adapter = createMockAiAdapter({ specId, taskIds: ['task-a', 'task-b'], streamDelayMs: 1 });
  const registry = createAiAdapterRegistry([adapter]);
  const transcriptCache = createTranscriptCacheService();
  const bindingService = createAgentSessionBindingService();

  // Phase 1: Server 1 runs, turn reaches waitingForUser
  const turnRuntime1 = createAiTurnRuntime({ registry, transcriptCache });
  const service1 = createAiSessionService({ registry, turnRuntime: turnRuntime1, transcriptCache, bindingService });
  const server1 = createDashboardServer({ aiService: service1, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
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
    const turnA = await waitFor(baseUrl1, turnIdAlpha, t => t.pendingInteraction);
    interactionIdAlpha = turnA.pendingInteraction.id;

    const startB = await fetch(`${baseUrl1}/api/agent-sessions/mock/restart-beta/turns`, control({
      message: 'permission on beta',
      idempotencyKey: 'restart-key-beta',
    }));
    const resB = await startB.json();
    turnIdBeta = resB.turnId;
    await waitFor(baseUrl1, turnIdBeta, t => t.pendingInteraction);
  } finally {
    await closeServer(server1);
  }

  // Phase 2: Server 2 starts with a fresh turnRuntime (simulating restart) sharing persisted transcriptCache
  const turnRuntime2 = createAiTurnRuntime({ registry, transcriptCache });
  const service2 = createAiSessionService({ registry, turnRuntime: turnRuntime2, transcriptCache, bindingService });
  const server2 = createDashboardServer({ aiService: service2, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
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
    const completedA = await waitFor(baseUrl2, turnIdAlpha, t => t.status === 'completed');
    assert.equal(completedA.status, 'completed');

    // 6. Cancel on restart-beta also works after restart
    const cancelRes = await fetch(
      `${baseUrl2}/api/agent-sessions/mock/restart-beta/turns/${turnIdBeta}/cancel`,
      control({}),
    );
    assert.equal(cancelRes.status, 200);
    const cancelledB = await waitFor(baseUrl2, turnIdBeta, t => t.status === 'failed');
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
  const customAdapter = createMockAiAdapter({
    specId,
    taskIds: ['task-mode'],
    streamDelayMs: 1,
  });
  const originalStartTurn = customAdapter.startTurn.bind(customAdapter);
  customAdapter.startTurn = (params) => {
    lastExecutedMode = params.mode;
    return originalStartTurn(params);
  };

  const createTestServer = () => {
    const registry = createAiAdapterRegistry([customAdapter]);
    const bindingService = createAgentSessionBindingService({ storageDir });
    const transcriptCache = createTranscriptCacheService({ baseDir: transcriptDir, flushDebounceMs: 0 });
    const turnRuntime = createAiTurnRuntime({ registry, transcriptCache });
    const service = createAiSessionService({ registry, turnRuntime, transcriptCache, bindingService });
    const server = createDashboardServer({
      aiService: service,
      eventHub: fakeHub(),
      distDir: 'Z:/does-not-exist',
    });
    return { server, service, bindingService };
  };

  // 1. Start Server 1: Create session with mode 'agent' and another with 'ask'
  const stack1 = createTestServer();
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

    const stack2 = createTestServer();
    const baseUrl2 = await listen(stack2.server, { port: 0 });

    try {
      // 3. GET session details for agent session
      const getAgentRes = await fetch(`${baseUrl2}/api/agent-sessions/mock/${agentSessionId}`);
      assert.equal(getAgentRes.status, 200);
      const getAgentData = await getAgentRes.json();
      // 4. Returned session mode is 'agent'
      assert.equal(getAgentData.session.mode, 'agent');

      // 5. Starting a subsequent turn without explicit override invokes adapter with 'agent'
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

