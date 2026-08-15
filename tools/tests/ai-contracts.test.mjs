import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiUnsupportedOperationError,
  validateAiEvent,
  validateAiSession,
  validateInteractionResponse,
  sortAiSessions,
} from '../ai/contracts.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiSessionService } from '../ai/service.mjs';

const capabilities = Object.freeze({
  listSessions: true,
  sessionMetadata: true,
  messages: true,
  createSession: true,
  startTurn: true,
  streamEvents: true,
  resumeTurn: false,
  resolveInteractions: true,
  cancelTurn: false,
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

test('complete sessions normalize and invalid required fields are rejected', () => {
  const value = validateAiSession(session());
  assert.equal(value.lastActivityAt, '2026-08-15T11:00:00.000Z');
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

test('unsupported capabilities return a normalized error without invoking methods', async () => {
  let invoked = false;
  const adapter = {
    descriptor: { id: 'limited', label: 'Limited', capabilities: {} },
    async createSession() { invoked = true; },
  };
  const service = createAiSessionService({ registry: createAiAdapterRegistry([adapter]) });
  await assert.rejects(() => service.createSession('limited', {}), error => {
    assert.ok(error instanceof AiUnsupportedOperationError);
    assert.deepEqual(error.toJSON().error.details, { provider: 'limited', capability: 'createSession' });
    return true;
  });
  assert.equal(invoked, false);
});

test('required events validate stable interaction and question IDs and reject provider request fields', () => {
  const base = { id: 1, turnId: 'turn-1', timestamp: '2026-08-15T12:00:00Z' };
  for (const event of [
    { ...base, type: 'turn.started' },
    { ...base, type: 'message.delta', messageId: 'message-1', delta: 'hello' },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-1', kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } } },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-2', kind: 'question', questions: [{ id: 'q-1', question: 'Choose?', multiSelect: false }] } },
    { ...base, type: 'interaction.resolved', interactionId: 'int-2' },
    { ...base, type: 'turn.completed' },
    { ...base, type: 'turn.failed', error: { code: 'FAILED', message: 'failed' } },
  ]) assert.equal(validateAiEvent(event).type, event.type);
  assert.throws(() => validateAiEvent({ ...base, type: 'turn.started', providerRequestId: 'secret' }), { name: 'AiValidationError' });
  assert.throws(() => validateAiEvent({ ...base, type: 'interaction.requested', interaction: { id: 'i', kind: 'permission', toolName: 'x', input: { rawPayload: {} } } }), { name: 'AiValidationError' });

  const question = validateAiEvent({ ...base, type: 'interaction.requested', interaction: { id: 'int-2', kind: 'question', questions: [{ id: 'q-1', question: 'Same?' }, { id: 'q-2', question: 'Same?' }] } }).interaction;
  assert.deepEqual(validateInteractionResponse(question, { answers: [{ questionId: 'q-1', value: 'A' }, { questionId: 'q-2', value: 'B' }] }).answers.map(item => item.questionId), ['q-1', 'q-2']);
  assert.throws(() => validateInteractionResponse(question, { answers: [{ questionId: 'Same?', value: 'A' }, { questionId: 'q-2', value: 'B' }] }));
});

test('two adapters are selected through one registry and neutral service', async () => {
  function fake(id) {
    return {
      descriptor: { id, label: id.toUpperCase(), capabilities },
      async listSessions() { return [session({ provider: id, sessionId: `${id}-session` })]; },
    };
  }
  const service = createAiSessionService({ registry: createAiAdapterRegistry([fake('alpha'), fake('beta')]) });
  const sessions = await service.listSessions();
  assert.deepEqual(sessions.map(item => item.provider), ['alpha', 'beta']);
});
