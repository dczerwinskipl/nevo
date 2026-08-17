import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CAPABILITIES,
  CapabilityNotSupportedError,
  validateAgentEvent,
  validateAgentIdentity,
  validateAiEvent,
  validateAiSession,
  validateInteractionResponse,
  sortAiSessions,
} from '../ai/contracts.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiSessionService } from '../ai/service.mjs';

const capabilities = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: false,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  listSessions: true,
  sessionMetadata: true,
  messages: true,
  createSession: true,
  startTurn: true,
  streamEvents: true,
});

function session(overrides = {}) {
  return {
    specId: '70609aaf-bb62-40bf-a25e-bec65c583495',
    provider: 'fake',
    sessionId: 'opaque/id?yes',
    taskIds: ['task-a'],
    status: 'idle',
    createdAt: '2026-08-15T10:00:00Z',
    lastActivityAt: '2026-08-15T11:00:00Z',
    capabilities,
    ...overrides,
  };
}

test('validateAgentIdentity enforces canonical pair (provider, providerSessionId)', () => {
  const identity = validateAgentIdentity({ provider: 'claude', providerSessionId: 'sess-123' });
  assert.deepEqual(identity, { provider: 'claude', providerSessionId: 'sess-123' });

  assert.throws(() => validateAgentIdentity({ provider: '', providerSessionId: 's1' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentIdentity({ provider: 'claude', providerSessionId: '' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentIdentity(null), { name: 'AiValidationError' });
});

test('complete sessions normalize and invalid required fields are rejected', () => {
  const value = validateAiSession(session());
  assert.equal(value.lastActivityAt, '2026-08-15T11:00:00.000Z');
  assert.equal(value.providerSessionId, 'opaque/id?yes');
  for (const field of ['specId', 'provider', 'sessionId', 'taskIds', 'status', 'createdAt', 'lastActivityAt']) {
    const invalid = session();
    delete invalid[field];
    assert.throws(() => validateAiSession(invalid), { name: 'AiValidationError' }, field);
  }
  assert.throws(() => validateAiSession(session({ specId: 'slug-not-uuid' })), { name: 'AiValidationError' });
});

test('session sorting is activity descending with deterministic ties and no isActive', () => {
  const sorted = sortAiSessions([
    session({ provider: 'z', sessionId: '2', lastActivityAt: '2026-08-15T12:00:00Z' }),
    session({ provider: 'a', sessionId: '1', lastActivityAt: '2026-08-15T12:00:00Z' }),
    session({ provider: 'a', sessionId: '0', lastActivityAt: '2026-08-15T13:00:00Z', isActive: true }),
  ]);
  assert.deepEqual(sorted.map(item => item.sessionId), ['0', '1', '2']);
  assert.equal('isActive' in sorted[0], false);
});

test('unsupported capabilities return CapabilityNotSupportedError without invoking methods', async () => {
  let invoked = false;
  const adapter = {
    descriptor: { id: 'limited', label: 'Limited', capabilities: {} },
    async createSession() { invoked = true; },
  };
  const service = createAiSessionService({ registry: createAiAdapterRegistry([adapter]) });
  await assert.rejects(() => service.createSession('limited', {}), error => {
    assert.ok(error instanceof CapabilityNotSupportedError);
    assert.equal(error.name, 'CapabilityNotSupportedError');
    assert.deepEqual(error.toJSON().error.details, { provider: 'limited', capability: 'createSession' });
    return true;
  });
  assert.equal(invoked, false);
});

test('required events validate all normalized schemas and reject provider request fields', () => {
  const base = { id: 1, turnId: 'turn-1', timestamp: '2026-08-15T12:00:00Z' };
  for (const event of [
    { ...base, type: 'turn.started' },
    { ...base, type: 'message.started', messageId: 'msg-1', role: 'assistant' },
    { ...base, type: 'text.delta', text: 'hello' },
    { ...base, type: 'reasoning.delta', text: 'thinking about code' },
    { ...base, type: 'tool.started', toolId: 'tool-1', toolName: 'Shell', input: { command: 'npm test' } },
    { ...base, type: 'tool.updated', toolId: 'tool-1', output: 'running...', status: 'running' },
    { ...base, type: 'tool.completed', toolId: 'tool-1', output: 'success', durationMs: 150 },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-1', kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } } },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-2', kind: 'question', questions: [{ id: 'q-1', question: 'Choose?', multiSelect: false }] } },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-3', kind: 'confirmation', message: 'Proceed with changes?' } },
    { ...base, type: 'interaction.resolved', interactionId: 'int-2', response: { answers: [{ questionId: 'q-1', value: 'yes' }] } },
    { ...base, type: 'usage.updated', tokensIn: 100, tokensOut: 50, cost: 0.002 },
    { ...base, type: 'turn.completed', durationMs: 1200, finishReason: 'stop' },
    { ...base, type: 'turn.failed', error: { code: 'FAILED', message: 'failed' } },
  ]) assert.equal(validateAgentEvent(event).type, event.type);

  assert.throws(() => validateAiEvent({ ...base, type: 'turn.started', providerRequestId: 'secret' }), { name: 'AiValidationError' });
  assert.throws(() => validateAiEvent({ ...base, type: 'interaction.requested', interaction: { id: 'i', kind: 'permission', toolName: 'x', input: { rawPayload: {} } } }), { name: 'AiValidationError' });

  const question = validateAiEvent({ ...base, type: 'interaction.requested', interaction: { id: 'int-2', kind: 'question', questions: [{ id: 'q-1', question: 'Same?' }, { id: 'q-2', question: 'Same?' }] } }).interaction;
  assert.deepEqual(validateInteractionResponse(question, { answers: [{ questionId: 'q-1', value: 'A' }, { questionId: 'q-2', value: 'B' }] }).answers.map(item => item.questionId), ['q-1', 'q-2']);
  assert.throws(() => validateInteractionResponse(question, { answers: [{ questionId: 'Same?', value: 'A' }, { questionId: 'q-2', value: 'B' }] }));

  const confirmation = { id: 'int-3', kind: 'confirmation', title: 'Confirm', message: 'Sure?' };
  assert.deepEqual(validateInteractionResponse(confirmation, { confirmed: true }), { confirmed: true, decision: 'confirm' });
  assert.deepEqual(validateInteractionResponse(confirmation, { decision: 'deny' }), { confirmed: false, decision: 'cancel' });
});

test('multi-provider registry supports multiple registered providers (claude, antigravity, mock)', async () => {
  function fake(id) {
    return {
      descriptor: { id, label: id.toUpperCase(), capabilities },
      async listSessions() { return [session({ provider: id, sessionId: `${id}-session` })]; },
    };
  }
  const registry = createAiAdapterRegistry([fake('claude'), fake('antigravity'), fake('mock')]);
  assert.deepEqual(registry.list(), ['claude', 'antigravity', 'mock']);
  assert.equal(registry.has('claude'), true);
  assert.equal(registry.has('antigravity'), true);
  assert.equal(registry.has('mock'), true);

  const service = createAiSessionService({ registry });
  const sessions = await service.listSessions();
  assert.deepEqual(sessions.map(item => item.provider), ['antigravity', 'claude', 'mock']);
});

