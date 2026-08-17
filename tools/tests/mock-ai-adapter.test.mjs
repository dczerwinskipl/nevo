import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockAiAdapter } from '../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';

const specId = '70609aaf-bb62-40bf-a25e-bec65c583495';

function fixture() {
  const adapter = createMockAiAdapter({ specId, taskIds: ['task-a', 'task-b'], streamDelayMs: 1 });
  const runtime = createAiTurnRuntime({ registry: createAiAdapterRegistry([adapter]) });
  return { adapter, runtime };
}

async function waitFor(runtime, turnId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const value = runtime.getSnapshot(turnId);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for mock turn.');
}

test('seeded and created sessions are available on the mock adapter', async () => {
  const { adapter } = fixture();
  const sessions = await adapter.listSessions();
  assert.ok(sessions.length > 0);
  const created = await adapter.createSession({ title: 'Test Session' });
  assert.equal(created.sessionId, 'session-001');
  assert.equal(created.provider, 'mock');
});

test('normal, permission, and question flows stream and continue through the shared runtime', async () => {
  const { adapter, runtime } = fixture();
  const normal = await runtime.startTurn({ provider: 'mock', sessionId: 'demo-task-a-1', message: 'hello' });
  const normalDone = await waitFor(runtime, normal.turnId, value => value.status === 'completed');
  assert.ok(normalDone.events.filter(event => event.type === 'text.delta').length >= 12);

  const permission = await runtime.startTurn({ provider: 'mock', sessionId: 'demo-task-a-2', message: 'please request permission' });
  const permissionWait = await waitFor(runtime, permission.turnId, value => value.pendingInteraction);
  assert.deepEqual(permissionWait.pendingInteraction.input, { command: 'npm --prefix tools/dashboard test' });
  assert.ok(JSON.stringify(permissionWait.pendingInteraction.input).length < 200);
  await runtime.resolveInteraction(permission.turnId, permissionWait.pendingInteraction.id, { decision: 'allow' });
  await waitFor(runtime, permission.turnId, value => value.status === 'completed');

  const created = await adapter.createSession({ title: 'Question test' });
  const question = await runtime.startTurn({ provider: 'mock', sessionId: created.sessionId, message: 'ask a question' });
  const questionWait = await waitFor(runtime, question.turnId, value => value.pendingInteraction);
  const [style, checks] = questionWait.pendingInteraction.questions;
  await runtime.resolveInteraction(question.turnId, questionWait.pendingInteraction.id, {
    answers: [{ questionId: style.id, value: 'Własny styl demonstracyjny' }, { questionId: checks.id, value: ['Tests', 'Build'] }],
  });
  await waitFor(runtime, question.turnId, value => value.status === 'completed');
  assert.match((await adapter.listMessages(created.sessionId)).at(-1).text, /Własny styl demonstracyjny/);
});

test('runtime timestamps never move deterministic session activity before creation', async () => {
  const adapter = createMockAiAdapter();
  const session = await adapter.createSession({});
  adapter.onTurnState({ sessionId: session.sessionId, sessionStatus: 'running', timestamp: '2020-01-01T00:00:00.000Z' });
  const updated = await adapter.getSession(session.sessionId);
  assert.equal(updated.lastActivityAt, session.createdAt);
});
