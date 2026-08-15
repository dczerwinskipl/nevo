import assert from 'node:assert/strict';
import test from 'node:test';

import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createDashboardServer, listen } from '../server/index.mjs';

const specId = '70609aaf-bb62-40bf-a25e-bec65c583495';

function fakeHub() {
  return { subscribe: () => () => {}, close: () => {} };
}

function createStack() {
  const adapter = createMockAiAdapter({ specId, taskIds: ['task-a', 'task-b'] });
  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  return { adapter, service: createAiSessionService({ registry, turnRuntime }) };
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

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('AI routes expose the provider-neutral session and turn lifecycle with read/control policy', async () => {
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
    const providers = await fetch(`${baseUrl}/api/ai/providers`);
    const providerBody = await providers.json();
    assert.equal(providers.status, 200);
    assert.equal(providerBody.providers[0].id, 'mock');
    assert.deepEqual(providerBody.access, { mode: 'trusted-network', identityAuthenticated: false });

    const filtered = await fetch(`${baseUrl}/api/ai/sessions?specId=${specId}&taskId=task-a`);
    const seeded = (await filtered.json()).sessions;
    assert.equal(seeded.length, 4);
    assert.deepEqual(seeded.map(session => session.sessionId), ['demo-task-a-4', 'demo-task-a-3', 'demo-task-a-2', 'demo-task-a-1']);

    const createdResponse = await fetch(`${baseUrl}/api/ai/sessions`, control({
      provider: 'mock', specId, taskIds: ['task-a', 'task-b'], title: 'Created in API test',
    }));
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).session;
    assert.deepEqual(created.taskIds, ['task-a', 'task-b']);

    const metadata = await fetch(`${baseUrl}/api/ai/sessions/mock/${encodeURIComponent(created.sessionId)}`);
    assert.equal((await metadata.json()).session.title, 'Created in API test');
    const messages = await fetch(`${baseUrl}/api/ai/sessions/mock/${encodeURIComponent(created.sessionId)}/messages`);
    assert.deepEqual((await messages.json()).messages, []);

    const startedResponse = await fetch(`${baseUrl}/api/ai/sessions/mock/${encodeURIComponent(created.sessionId)}/turns`, control({ message: 'normal message' }));
    assert.equal(startedResponse.status, 202);
    const { turnId } = await startedResponse.json();
    const completed = await waitFor(baseUrl, turnId, turn => turn.status === 'completed');
    assert.deepEqual(completed.events.map(event => event.type), [
      'turn.started', 'message.delta', 'message.delta', 'message.delta', 'turn.completed',
    ]);

    const history = await fetch(`${baseUrl}/api/ai/sessions/mock/${encodeURIComponent(created.sessionId)}/messages`);
    assert.equal((await history.json()).messages.length, 2);
    assert.ok(policyCalls.includes('read'));
    assert.ok(policyCalls.includes('control'));
  } finally {
    await closeServer(server);
  }
});

test('SSE replays identified events, preserves pending interaction on disconnect, and HTTP resolves it', async () => {
  const { service } = createStack();
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const start = await fetch(`${baseUrl}/api/ai/sessions/mock/demo-task-a-1/turns`, control({ message: 'permission please', idempotencyKey: 'permission-1' }));
    const { turnId } = await start.json();
    const pending = await waitFor(baseUrl, turnId, turn => turn.pendingInteraction);

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/ai/turns/${turnId}/events`, {
      headers: { 'last-event-id': '1' },
      signal: controller.signal,
    });
    const reader = stream.body.getReader();
    const { value } = await reader.read();
    const firstChunk = new TextDecoder().decode(value);
    assert.match(firstChunk, /event: snapshot/);
    assert.match(firstChunk, /pendingInteraction/);
    controller.abort();
    await reader.cancel().catch(() => {});

    const afterDisconnect = await waitFor(baseUrl, turnId, turn => turn.pendingInteraction);
    assert.equal(afterDisconnect.status, 'waitingForUser');
    const interactionId = pending.pendingInteraction.id;
    const resolved = await fetch(`${baseUrl}/api/ai/turns/${turnId}/interactions/${interactionId}/response`, control({ decision: 'allow' }));
    assert.equal(resolved.status, 200);
    const completed = await waitFor(baseUrl, turnId, turn => turn.status === 'completed');
    assert.ok(completed.events.some(event => event.type === 'interaction.resolved'));

    const replay = await fetch(`${baseUrl}/api/ai/turns/${turnId}/events?after=1`);
    const replayText = await replay.text();
    assert.match(replayText, /id: 2/);
    assert.match(replayText, /event: interaction.requested/);
    assert.match(replayText, /event: turn.completed/);

    const duplicate = await fetch(`${baseUrl}/api/ai/turns/${turnId}/interactions/${interactionId}/response`, control({ decision: 'deny' }));
    assert.equal(duplicate.status, 404);
  } finally {
    await closeServer(server);
  }
});

test('single-active-turn and stable question correlation are enforced through HTTP', async () => {
  const { service } = createStack();
  const server = createDashboardServer({ aiService: service, eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const firstResponse = await fetch(`${baseUrl}/api/ai/sessions/mock/demo-task-b-1/turns`, control({ message: 'ask a question', idempotencyKey: 'q-1' }));
    const first = await firstResponse.json();
    await waitFor(baseUrl, first.turnId, turn => turn.pendingInteraction);

    const retryResponse = await fetch(`${baseUrl}/api/ai/sessions/mock/demo-task-b-1/turns`, control({ message: 'ask a question', idempotencyKey: 'q-1' }));
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { turnId: first.turnId, idempotent: true });

    const conflictResponse = await fetch(`${baseUrl}/api/ai/sessions/mock/demo-task-b-1/turns`, control({ message: 'different request', idempotencyKey: 'q-2' }));
    assert.equal(conflictResponse.status, 409);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.turnId, first.turnId);

    const turn = await waitFor(baseUrl, first.turnId, value => value.pendingInteraction);
    const [one, two] = turn.pendingInteraction.questions;
    const wrong = await fetch(`${baseUrl}/api/ai/turns/${first.turnId}/interactions/${turn.pendingInteraction.id}/response`, control({
      answers: [{ questionId: one.question, value: 'Focused' }, { questionId: two.id, value: 'Tests' }],
    }));
    assert.equal(wrong.status, 400);
    const correct = await fetch(`${baseUrl}/api/ai/turns/${first.turnId}/interactions/${turn.pendingInteraction.id}/response`, control({
      answers: [{ questionId: one.id, value: 'Focused' }, { questionId: two.id, value: ['Tests'] }],
    }));
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
    assert.equal((await fetch(`${baseUrl}/api/ai/providers`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${baseUrl}/api/ai/sessions`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/ai/sessions`, control({ provider: 'mock', specId, taskIds: [] }, { origin: 'https://attacker.example' }))).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/ai/sessions/%2e%2e/%2e%2e/messages`)).status, 404);

    const malformed = await fetch(`${baseUrl}/api/ai/sessions`, {
      method: 'POST', headers: { 'x-nevo-dashboard-action': '1' }, body: '{',
    });
    assert.equal(malformed.status, 400);

    const start = await fetch(`${baseUrl}/api/ai/sessions/mock/demo-task-b-2/turns`, control({ message: 'permission before cancel' }));
    const { turnId } = await start.json();
    await waitFor(baseUrl, turnId, turn => turn.pendingInteraction);
    const cancelled = await fetch(`${baseUrl}/api/ai/turns/${turnId}/cancel`, control({}));
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).turn.events.at(-1).error.code, 'AI_TURN_CANCELLED');

    const oversized = await fetch(`${baseUrl}/api/ai/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ provider: 'mock', specId, taskIds: [], title: 'x'.repeat(20_000) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await closeServer(server);
  }
});
