import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_CAPABILITIES,
  DEFAULT_AGENT_CAPABILITIES,
  CapabilityNotSupportedError,
  validateAgentEvent,
  validateAgentIdentity,
  validateAgentExecutionMode,
  validateProviderDescriptor,
  validateAiEvent,
  validateInteractionResponse,
  normalizeCapabilities,
} from '../ai/contracts.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { createAiSessionService } from '../ai/service.mjs';
import { createAiTurnRuntime } from '../ai/turn-runtime.mjs';

const capabilities = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: false,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
});

test('validateAgentIdentity enforces canonical pair (provider, providerSessionId)', () => {
  const identity = validateAgentIdentity({ provider: 'claude', providerSessionId: 'sess-123' });
  assert.deepEqual(identity, { provider: 'claude', providerSessionId: 'sess-123' });

  assert.throws(() => validateAgentIdentity({ provider: '', providerSessionId: 's1' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentIdentity({ provider: 'claude', providerSessionId: '' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentIdentity(null), { name: 'AiValidationError' });
});

test('normalizeCapabilities normalizes canonical AGENT_CAPABILITIES', () => {
  const normalized = normalizeCapabilities({
    interactivePermissions: true,
    toolCalls: true,
  });
  assert.equal(normalized.interactivePermissions, true);
  assert.equal(normalized.toolCalls, true);
  assert.equal(normalized.interactiveQuestions, false);
  assert.equal(normalized.reasoning, false);
});

test('unsupported capabilities return CapabilityNotSupportedError without invoking methods', async () => {
  let invoked = false;
  const adapter = {
    descriptor: { id: 'limited', label: 'Limited', capabilities: {} },
    async startTurn() {},
    async cancelTurn() { invoked = true; },
  };
  const registry = createAiAdapterRegistry([adapter]);
  assert.throws(() => registry.require('limited', 'cancelTurn', 'cancelTurn'), error => {
    assert.ok(error instanceof CapabilityNotSupportedError);
    assert.equal(error.name, 'CapabilityNotSupportedError');
    assert.deepEqual(error.toJSON().error.details, { provider: 'limited', capability: 'cancelTurn' });
    return true;
  });
  assert.equal(invoked, false);
});

test('registry rejects provider adapters missing required methods (startTurn, cancelTurn)', () => {
  assert.throws(
    () => createAiAdapterRegistry([{ descriptor: { id: 'missing-all', label: 'Missing', capabilities: {} } }]),
    { name: 'AiValidationError' },
  );

  assert.throws(
    () => createAiAdapterRegistry([{
      descriptor: { id: 'missing-start', label: 'Missing', capabilities: {} },
      async cancelTurn() {},
    }]),
    { name: 'AiValidationError' },
  );

  assert.throws(
    () => createAiAdapterRegistry([{
      descriptor: { id: 'missing-cancel', label: 'Missing', capabilities: {} },
      async startTurn() {},
    }]),
    { name: 'AiValidationError' },
  );
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
    { ...base, type: 'tool.completed', toolId: 'tool-1', output: 'success', durationMs: 150, status: 'completed' },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-1', kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } } },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-2', kind: 'question', questions: [{ id: 'q-1', question: 'Choose?', multiSelect: false }] } },
    { ...base, type: 'interaction.requested', interaction: { id: 'int-3', kind: 'confirmation', message: 'Proceed with changes?' } },
    { ...base, type: 'interaction.resolved', interactionId: 'int-2', response: { answers: [{ questionId: 'q-1', value: 'yes' }] } },
    { ...base, type: 'usage.updated', tokensIn: 100, tokensOut: 50, cost: 0.002 },
    { ...base, type: 'turn.completed', durationMs: 1200, finishReason: 'stop' },
    { ...base, type: 'turn.failed', error: { code: 'FAILED', message: 'failed' } },
  ]) assert.equal(validateAgentEvent(event).type, event.type);

  assert.throws(() => validateAiEvent({ ...base, type: 'tool.completed', toolId: 'tool-1', output: 'success' }), { name: 'AiValidationError' }, 'tool.completed must require a terminal status');
  assert.throws(() => validateAiEvent({ ...base, type: 'tool.completed', toolId: 'tool-1', status: 'running' }), { name: 'AiValidationError' }, 'tool.completed status must be completed or failed, not running');

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
      async startTurn() {},
      async cancelTurn() {},
    };
  }
  const registry = createAiAdapterRegistry([fake('claude'), fake('antigravity'), fake('mock')]);
  assert.deepEqual(registry.list(), ['claude', 'antigravity', 'mock']);
  assert.equal(registry.has('claude'), true);
  assert.equal(registry.has('antigravity'), true);
  assert.equal(registry.has('mock'), true);
});

test('AiSessionService uses binding service for listings and transcript cache for messages', async () => {
  const bindingService = {
    async listBindings(filters) {
      return [{ provider: 'claude', providerSessionId: 'sess-1', specId: filters?.specId }];
    },
    async getBinding(provider, providerSessionId) {
      return { provider, providerSessionId, specId: 'my-spec' };
    },
  };
  const transcriptCache = {
    async getTranscript(provider, providerSessionId) {
      return { provider, providerSessionId, messages: [{ role: 'user', text: 'hi' }], updatedAt: '2026-08-18T10:00:00.000Z' };
    },
  };
  const adapter = {
    descriptor: { id: 'claude', label: 'Claude', capabilities },
    async startTurn() {},
    async cancelTurn() {},
  };
  const registry = createAiAdapterRegistry([adapter]);
  const service = createAiSessionService({ registry, bindingService, transcriptCache });

  const sessions = await service.listSessions({ specId: 'spec-123' });
  assert.deepEqual(sessions, [{
    provider: 'claude',
    providerSessionId: 'sess-1',
    specId: 'spec-123',
    lastActivityAt: '2026-08-18T10:00:00.000Z',
    status: 'idle',
    activeTurn: null,
    pendingInteraction: null,
  }]);

  const session = await service.getSession('claude', 'sess-1');
  assert.deepEqual(session, { provider: 'claude', providerSessionId: 'sess-1', specId: 'my-spec' });

  const untouchedBindingService = {
    async listBindings() {
      return [{ provider: 'claude', providerSessionId: 'sess-untouched', specId: 'spec-123', lastSeenAt: '2026-08-01T00:00:00.000Z' }];
    },
  };
  const untouchedTranscriptCache = {
    // Mirrors SessionTranscriptCacheService.getTranscript's real fallback: a synthetic,
    // empty transcript timestamped "now" for a session that never had a turn.
    async getTranscript() {
      return { provider: 'claude', providerSessionId: 'sess-untouched', messages: [], lastEventSeq: 0, updatedAt: new Date().toISOString() };
    },
  };
  const untouchedService = createAiSessionService({ registry, bindingService: untouchedBindingService, transcriptCache: untouchedTranscriptCache });
  const untouchedSessions = await untouchedService.listSessions();
  assert.equal(untouchedSessions[0].lastActivityAt, '2026-08-01T00:00:00.000Z');

  const messages = await service.listMessages('claude', 'sess-1');
  assert.deepEqual(messages, [{ role: 'user', text: 'hi' }]);
});

test('integration: new chat -> first prompt -> provider identity created and bound -> second prompt resumes', async () => {
  const bindings = [];
  const bindingService = {
    async bindSession(binding) {
      bindings.push(binding);
      return binding;
    },
    async listBindings() {
      return bindings;
    },
  };

  let resumeCalledWith = null;
  const adapter = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId, message, emitTextDelta }) {
      if (!providerSessionId) {
        const newId = 'fake-allocated-uuid-999';
        setProviderSessionId(newId);
        emitTextDelta('first turn response');
        return { providerSessionId: newId };
      } else {
        resumeCalledWith = providerSessionId;
        emitTextDelta('second turn response');
        return { providerSessionId };
      }
    },
    async cancelTurn() {},
  };

  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  const service = createAiSessionService({ registry, turnRuntime, bindingService });

  // 1. First prompt in blank chat without providerSessionId
  const turn1 = await service.startTurn('fake', null, {
    message: 'First prompt from new chat',
    specId: 'spec-integration-test',
    taskId: 'task-1',
  });

  // Direct return value MUST have providerSessionId populated
  assert.equal(turn1.providerSessionId, 'fake-allocated-uuid-999');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].provider, 'fake');
  assert.equal(bindings[0].providerSessionId, 'fake-allocated-uuid-999');
  assert.equal(bindings[0].specId, 'spec-integration-test');

  for (let i = 0; i < 50; i++) {
    const snap = service.getTurn(turn1.turnId);
    if (snap?.status === 'completed') break;
    await new Promise(r => setTimeout(r, 5));
  }

  // 2. Second prompt resumes using the established providerSessionId
  const turn2 = await service.startTurn('fake', 'fake-allocated-uuid-999', {
    message: 'Follow-up prompt',
  });

  assert.equal(turn2.providerSessionId, 'fake-allocated-uuid-999');

  for (let i = 0; i < 50; i++) {
    const snap = service.getTurn(turn2.turnId);
    if (snap?.status === 'completed') break;
    await new Promise(r => setTimeout(r, 5));
  }

  assert.equal(resumeCalledWith, 'fake-allocated-uuid-999');
});

test('first-turn binding failure causes startTurn rejection and turn failure', async () => {
  const bindingService = {
    async bindSession() {
      throw new Error('Database/disk binding error simulation');
    },
  };

  const adapter = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId }) {
      if (!providerSessionId) {
        await setProviderSessionId('new-fail-uuid');
      }
    },
    async cancelTurn() {},
  };

  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  const service = createAiSessionService({ registry, turnRuntime, bindingService });

  await assert.rejects(
    () => service.startTurn('fake', null, { message: 'hi', specId: 'spec-1' }),
    { message: 'Database/disk binding error simulation' },
  );
});

test('validateAgentExecutionMode accepts canonical modes and rejects invalid strings', () => {
  assert.equal(validateAgentExecutionMode('ask'), 'ask');
  assert.equal(validateAgentExecutionMode('edit'), 'edit');
  assert.equal(validateAgentExecutionMode('agent'), 'agent');

  assert.throws(() => validateAgentExecutionMode('dontAsk'), { name: 'AiValidationError' });
  assert.throws(() => validateAgentExecutionMode('bypassPermissions'), { name: 'AiValidationError' });
  assert.throws(() => validateAgentExecutionMode('auto'), { name: 'AiValidationError' });
  assert.throws(() => validateAgentExecutionMode(''), { name: 'AiValidationError' });
  assert.throws(() => validateAgentExecutionMode(123), { name: 'AiValidationError' });
});

test('validateProviderDescriptor validates supportedModes and defaultMode', () => {
  const descriptor = validateProviderDescriptor({
    id: 'custom',
    label: 'Custom AI',
    capabilities: {},
    supportedModes: ['ask', 'edit'],
    defaultMode: 'ask',
  });
  assert.deepEqual(descriptor.supportedModes, ['ask', 'edit']);
  assert.equal(descriptor.defaultMode, 'ask');

  const defaultDescriptor = validateProviderDescriptor({
    id: 'default-desc',
    label: 'Default Desc',
    capabilities: {},
  });
  assert.deepEqual(defaultDescriptor.supportedModes, ['ask', 'edit', 'agent']);
  assert.equal(defaultDescriptor.defaultMode, 'edit');
});

test('Execution mode precedence: turn.mode > session.mode > provider.defaultMode', async () => {
  let executedMode = null;
  const adapter = {
    descriptor: { id: 'prec', label: 'Precedence', capabilities, defaultMode: 'edit', supportedModes: ['ask', 'edit', 'agent'] },
    async startTurn({ mode }) { executedMode = mode; },
    async cancelTurn() {},
  };

  const fakeBindings = new Map();
  const bindingService = {
    async getBinding(p, sid) { return fakeBindings.get(sid) || null; },
    async bindSession({ provider, providerSessionId, specId, mode }) {
      const rec = { provider, providerSessionId, specId, mode };
      fakeBindings.set(providerSessionId, rec);
      return rec;
    },
    async updateSessionMode(p, sid, mode) {
      const rec = fakeBindings.get(sid) || { provider: p, providerSessionId: sid };
      rec.mode = mode;
      fakeBindings.set(sid, rec);
      return rec;
    },
  };

  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  const service = createAiSessionService({ registry, turnRuntime, bindingService });

  // 1. Omitted turn mode on fresh session resolves to provider defaultMode ('edit') without escalation
  await service.startTurn('prec', 'sess-1', { message: 'test 1' });
  assert.equal(executedMode, 'edit');

  // 2. Session created with explicit mode 'ask' uses session mode when turn mode is omitted
  fakeBindings.set('sess-ask', { provider: 'prec', providerSessionId: 'sess-ask', mode: 'ask' });
  await service.startTurn('prec', 'sess-ask', { message: 'test 2' });
  assert.equal(executedMode, 'ask');

  // 3. Turn mode 'agent' overrides session mode 'ask'
  await service.startTurn('prec', 'sess-ask', { message: 'test 3', mode: 'agent' });
  assert.equal(executedMode, 'agent');
  // And persisted session mode was updated to 'agent'
  assert.equal(fakeBindings.get('sess-ask').mode, 'agent');
});


