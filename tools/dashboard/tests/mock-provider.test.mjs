import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockAgentProvider } from '../server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { AGENT_CAPABILITIES } from '../server/ai/contracts.mjs';

function fixture() {
  const provider = createMockAgentProvider({ streamDelayMs: 1 });
  const runtime = createAgentTurnRuntime({ registry: createAgentProviderRegistry([provider]) });
  return { provider, runtime };
}

async function waitFor(runtime, turnId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const value = runtime.getSnapshot(turnId);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for mock turn.');
}

test('MockAgentProvider declares only canonical capabilities', async () => {
  const { provider } = fixture();
  assert.equal(provider.descriptor.id, 'mock');
  assert.deepEqual(Object.keys(provider.descriptor.capabilities).sort(), [...AGENT_CAPABILITIES].sort());
  for (const cap of AGENT_CAPABILITIES) {
    assert.equal(typeof provider.descriptor.capabilities[cap], 'boolean');
  }
});

test('normal, permission, and question flows stream and continue through the shared runtime', async () => {
  const { runtime } = fixture();
  // 1. Initial turn creates session atomically
  const normal = await runtime.startTurn({ provider: 'mock', message: 'hello' });
  const normalDone = await waitFor(runtime, normal.turnId, (value) => value.status === 'completed');
  assert.ok(normalDone.events.filter((event) => event.type === 'text.delta').length >= 12);
  assert.ok(normalDone.providerSessionId);

  // 2. Permission turn
  const permission = await runtime.startTurn({
    provider: 'mock',
    providerSessionId: 'sess-permission',
    message: 'please request permission',
  });
  const permissionWait = await waitFor(runtime, permission.turnId, (value) => value.pendingInteraction);
  assert.deepEqual(permissionWait.pendingInteraction.input, { command: 'npm --prefix tools/dashboard test' });
  assert.ok(JSON.stringify(permissionWait.pendingInteraction.input).length < 200);
  await runtime.resolveInteraction(permission.turnId, permissionWait.pendingInteraction.id, { decision: 'allow' });
  await waitFor(runtime, permission.turnId, (value) => value.status === 'completed');

  // 3. Question turn
  const question = await runtime.startTurn({
    provider: 'mock',
    providerSessionId: 'sess-question',
    message: 'ask a question',
  });
  const questionWait = await waitFor(runtime, question.turnId, (value) => value.pendingInteraction);
  const [style, checks] = questionWait.pendingInteraction.questions;
  await runtime.resolveInteraction(question.turnId, questionWait.pendingInteraction.id, {
    answers: [
      { questionId: style.id, value: 'Focused' },
      { questionId: checks.id, value: ['Tests', 'Build'] },
    ],
  });
  await waitFor(runtime, question.turnId, (value) => value.status === 'completed');
});
