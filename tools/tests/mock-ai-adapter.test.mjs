import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockAiAdapter } from '../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';
import { AGENT_CAPABILITIES } from '../ai/contracts.mjs';

function fixture() {
  const adapter = createMockAiAdapter({ streamDelayMs: 1 });
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

test('MockAiAdapter declares only canonical capabilities and creates provider sessions', async () => {
  const { adapter } = fixture();
  assert.equal(adapter.descriptor.id, 'mock');
  assert.deepEqual(Object.keys(adapter.descriptor.capabilities).sort(), [...AGENT_CAPABILITIES].sort());
  for (const cap of AGENT_CAPABILITIES) {
    assert.equal(typeof adapter.descriptor.capabilities[cap], 'boolean');
  }

  const created = await adapter.createSession({ title: 'Test Session' });
  assert.equal(created.provider, 'mock');
  assert.ok(created.providerSessionId);
  assert.equal(created.sessionId, undefined);
});

test('normal, permission, and question flows stream and continue through the shared runtime', async () => {
  const { adapter, runtime } = fixture();
  const session1 = await adapter.createSession({ title: 'Normal' });
  const normal = await runtime.startTurn({ provider: 'mock', providerSessionId: session1.providerSessionId, message: 'hello' });
  const normalDone = await waitFor(runtime, normal.turnId, value => value.status === 'completed');
  assert.ok(normalDone.events.filter(event => event.type === 'text.delta').length >= 12);
  assert.equal(normalDone.providerSessionId, session1.providerSessionId);

  const session2 = await adapter.createSession({ title: 'Permission' });
  const permission = await runtime.startTurn({ provider: 'mock', providerSessionId: session2.providerSessionId, message: 'please request permission' });
  const permissionWait = await waitFor(runtime, permission.turnId, value => value.pendingInteraction);
  assert.deepEqual(permissionWait.pendingInteraction.input, { command: 'npm --prefix tools/dashboard test' });
  assert.ok(JSON.stringify(permissionWait.pendingInteraction.input).length < 200);
  await runtime.resolveInteraction(permission.turnId, permissionWait.pendingInteraction.id, { decision: 'allow' });
  await waitFor(runtime, permission.turnId, value => value.status === 'completed');

  const session3 = await adapter.createSession({ title: 'Question' });
  const question = await runtime.startTurn({ provider: 'mock', providerSessionId: session3.providerSessionId, message: 'ask a question' });
  const questionWait = await waitFor(runtime, question.turnId, value => value.pendingInteraction);
  const [style, checks] = questionWait.pendingInteraction.questions;
  await runtime.resolveInteraction(question.turnId, questionWait.pendingInteraction.id, {
    answers: [{ questionId: style.id, value: 'Focused' }, { questionId: checks.id, value: ['Tests', 'Build'] }],
  });
  await waitFor(runtime, question.turnId, value => value.status === 'completed');
});
