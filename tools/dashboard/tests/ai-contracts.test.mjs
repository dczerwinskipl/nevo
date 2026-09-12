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
  validateInteractionResponse,
  normalizeCapabilities,
  validateTurnStatus,
  createTurnStatus,
  validateWorkItem,
  validateCommentaryWorkItem,
  validateReasoningWorkItem,
  validateToolInvocationWorkItem,
  validateToolAction,
  validateInteractionWorkItem,
  validateFinalAnswer,
  createFinalAnswer,
  validateCanonicalTurn,
  createCanonicalTurn,
  appendWorkItem,
  updateWorkItem,
  addToolAction,
  setFinalAnswer,
  setTurnStatus,
  computeCurrentActivity,
  serializePublicTurn,
  buildClaudeScenarioTurn,
  buildCodexScenarioTurn,
  buildAntigravityScenarioTurn,
  assertValidCanonicalTurn,
  assertWorkOrderIntegrity,
  assertToolActionHierarchy,
  AI_FAILURE_CODES,
  AI_RECOVERY_HINTS,
  AI_ERROR_HTTP_STATUS,
  DEFAULT_RECOVERY_HINTS,
  AiError,
  validateAiFailureCode,
  validateAiRecoveryHint,
  PROVIDER_HEALTH_STATUSES,
  validateProviderHealth,
  MODEL_SOURCES,
  validateAgentModelDescriptor,
  validateAgentModelTraits,
  createAgentModelDescriptor,
  normalizeModelIdentifier,
  permissiveModelPassthrough,
} from '../server/ai/contracts.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';

const capabilities = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: false,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  steerTurn: false,
  planUpdates: false,
});

test('validateAgentIdentity enforces canonical pair (provider, providerSessionId)', () => {
  const identity = validateAgentIdentity({ provider: 'claude', providerSessionId: 'sess-123' });
  assert.deepEqual(identity, { provider: 'claude', providerSessionId: 'sess-123' });

  assert.throws(() => validateAgentIdentity({ provider: '', providerSessionId: 's1' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentIdentity({ provider: 'claude', providerSessionId: '' }), {
    name: 'AiValidationError',
  });
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
  const provider = {
    descriptor: { id: 'limited', label: 'Limited', capabilities: {} },
    async startTurn() {},
    async cancelTurn() {
      invoked = true;
    },
  };
  const registry = createAgentProviderRegistry([provider]);
  assert.throws(
    () => registry.require('limited', 'cancelTurn', 'cancelTurn'),
    (error) => {
      assert.ok(error instanceof CapabilityNotSupportedError);
      assert.equal(error.name, 'CapabilityNotSupportedError');
      assert.deepEqual(error.toJSON().error.details, { provider: 'limited', capability: 'cancelTurn' });
      return true;
    },
  );
  assert.equal(invoked, false);
});

test('registry rejects providers missing required methods (startTurn, cancelTurn)', () => {
  assert.throws(
    () => createAgentProviderRegistry([{ descriptor: { id: 'missing-all', label: 'Missing', capabilities: {} } }]),
    { name: 'AiValidationError' },
  );

  assert.throws(
    () =>
      createAgentProviderRegistry([
        {
          descriptor: { id: 'missing-start', label: 'Missing', capabilities: {} },
          async cancelTurn() {},
        },
      ]),
    { name: 'AiValidationError' },
  );

  assert.throws(
    () =>
      createAgentProviderRegistry([
        {
          descriptor: { id: 'missing-cancel', label: 'Missing', capabilities: {} },
          async startTurn() {},
        },
      ]),
    { name: 'AiValidationError' },
  );
});

test('required events validate all normalized schemas and reject provider request fields', () => {
  const base = { id: 1, turnId: 'turn-1', timestamp: '2026-08-15T12:00:00Z' };
  for (const event of [
    { ...base, type: 'turn.started' },
    { ...base, type: 'message.started', messageId: 'msg-1', role: 'assistant' },
    { ...base, type: 'text.delta', text: 'hello' },
    { ...base, type: 'progress.delta', progressId: 'progress-1', text: 'checking files' },
    { ...base, type: 'reasoning.delta', text: 'thinking about code' },
    { ...base, type: 'tool.started', toolId: 'tool-1', toolName: 'Shell', input: { command: 'npm test' } },
    { ...base, type: 'tool.updated', toolId: 'tool-1', output: 'running...', status: 'running' },
    { ...base, type: 'tool.completed', toolId: 'tool-1', output: 'success', durationMs: 150, status: 'completed' },
    {
      ...base,
      type: 'interaction.requested',
      interaction: { id: 'int-1', kind: 'permission', toolName: 'Shell', input: { command: 'npm test' } },
    },
    {
      ...base,
      type: 'interaction.requested',
      interaction: {
        id: 'int-2',
        kind: 'question',
        questions: [{ id: 'q-1', question: 'Choose?', multiSelect: false }],
      },
    },
    {
      ...base,
      type: 'interaction.requested',
      interaction: { id: 'int-3', kind: 'confirmation', message: 'Proceed with changes?' },
    },
    {
      ...base,
      type: 'interaction.resolved',
      interactionId: 'int-2',
      response: { answers: [{ questionId: 'q-1', value: 'yes' }] },
    },
    { ...base, type: 'usage.updated', tokensIn: 100, tokensOut: 50, cost: 0.002 },
    { ...base, type: 'turn.completed', durationMs: 1200, finishReason: 'stop' },
    { ...base, type: 'turn.failed', error: { code: 'FAILED', message: 'failed' } },
  ])
    assert.equal(validateAgentEvent(event).type, event.type);

  assert.throws(
    () => validateAgentEvent({ ...base, type: 'tool.completed', toolId: 'tool-1', output: 'success' }),
    { name: 'AiValidationError' },
    'tool.completed must require a terminal status',
  );
  assert.throws(() => validateAgentEvent({ ...base, type: 'progress.delta', text: 'missing correlation' }), {
    name: 'AiValidationError',
  });
  assert.throws(
    () => validateAgentEvent({ ...base, type: 'tool.completed', toolId: 'tool-1', status: 'running' }),
    { name: 'AiValidationError' },
    'tool.completed status must be completed or failed, not running',
  );

  assert.throws(() => validateAgentEvent({ ...base, type: 'turn.started', providerRequestId: 'secret' }), {
    name: 'AiValidationError',
  });
  assert.throws(
    () =>
      validateAgentEvent({
        ...base,
        type: 'interaction.requested',
        interaction: { id: 'i', kind: 'permission', toolName: 'x', input: { rawPayload: {} } },
      }),
    { name: 'AiValidationError' },
  );

  const question = validateAgentEvent({
    ...base,
    type: 'interaction.requested',
    interaction: {
      id: 'int-2',
      kind: 'question',
      questions: [
        { id: 'q-1', question: 'Same?' },
        { id: 'q-2', question: 'Same?' },
      ],
    },
  }).interaction;
  assert.equal(question.resumePolicy, 'restart');
  assert.deepEqual(
    validateInteractionResponse(question, {
      answers: [
        { questionId: 'q-1', value: 'A' },
        { questionId: 'q-2', value: 'B' },
      ],
    }).answers.map((item) => item.questionId),
    ['q-1', 'q-2'],
  );
  assert.throws(() =>
    validateInteractionResponse(question, {
      answers: [
        { questionId: 'Same?', value: 'A' },
        { questionId: 'q-2', value: 'B' },
      ],
    }),
  );

  const liveInteraction = validateAgentEvent({
    ...base,
    type: 'interaction.requested',
    interaction: { id: 'int-live', kind: 'permission', resumePolicy: 'live-operation', toolName: 'Shell' },
  }).interaction;
  assert.equal(liveInteraction.resumePolicy, 'live-operation');
  assert.throws(
    () =>
      validateAgentEvent({
        ...base,
        type: 'interaction.requested',
        interaction: { id: 'int-invalid', kind: 'permission', resumePolicy: 'provider-specific', toolName: 'Shell' },
      }),
    { name: 'AiValidationError' },
  );

  const confirmation = { id: 'int-3', kind: 'confirmation', title: 'Confirm', message: 'Sure?' };
  assert.deepEqual(validateInteractionResponse(confirmation, { confirmed: true }), {
    confirmed: true,
    decision: 'confirm',
  });
  assert.deepEqual(validateInteractionResponse(confirmation, { decision: 'deny' }), {
    confirmed: false,
    decision: 'cancel',
  });
});

test('multi-provider registry supports multiple registered providers (claude, antigravity, mock)', async () => {
  function fake(id) {
    return {
      descriptor: { id, label: id.toUpperCase(), capabilities },
      async startTurn() {},
      async cancelTurn() {},
    };
  }
  const registry = createAgentProviderRegistry([fake('claude'), fake('antigravity'), fake('mock')]);
  assert.deepEqual(registry.list(), ['claude', 'antigravity', 'mock']);
  assert.equal(registry.has('claude'), true);
  assert.equal(registry.has('antigravity'), true);
  assert.equal(registry.has('mock'), true);
});

test('AgentSessionService uses binding service for listings and transcript cache for messages', async () => {
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
      return {
        provider,
        providerSessionId,
        turns: [
          {
            ...createCanonicalTurn({
              id: 'turn-1',
              provider,
              providerSessionId,
              status: createTurnStatus('terminal', { outcome: 'completed' }),
            }),
            userMessage: { text: 'hi', createdAt: '2026-08-18T10:00:00.000Z' },
          },
        ],
        updatedAt: '2026-08-18T10:00:00.000Z',
      };
    },
  };
  const provider = {
    descriptor: { id: 'claude', label: 'Claude', capabilities },
    async startTurn() {},
    async cancelTurn() {},
  };
  const registry = createAgentProviderRegistry([provider]);
  const service = createAgentSessionService({ registry, bindingService, transcriptCache });

  const sessions = await service.listSessions({ specId: 'spec-123' });
  assert.deepEqual(sessions, [
    {
      provider: 'claude',
      providerSessionId: 'sess-1',
      sessionId: 'sess-1',
      specId: 'spec-123',
      taskId: undefined,
      taskIds: [],
      lastActivityAt: '2026-08-18T10:00:00.000Z',
      status: 'idle',
      activeTurn: null,
      pendingInteraction: null,
    },
  ]);

  const session = await service.getSession('claude', 'sess-1');
  assert.deepEqual(session, { provider: 'claude', providerSessionId: 'sess-1', specId: 'my-spec' });

  const untouchedBindingService = {
    async listBindings() {
      return [
        {
          provider: 'claude',
          providerSessionId: 'sess-untouched',
          specId: 'spec-123',
          lastSeenAt: '2026-08-01T00:00:00.000Z',
        },
      ];
    },
  };
  const untouchedTranscriptCache = {
    // Mirrors SessionTranscriptCacheService.getTranscript's real fallback: a synthetic,
    // empty transcript timestamped "now" for a session that never had a turn.
    async getTranscript() {
      return {
        provider: 'claude',
        providerSessionId: 'sess-untouched',
        turns: [],
        lastEventSeq: 0,
        updatedAt: new Date().toISOString(),
      };
    },
  };
  const untouchedService = createAgentSessionService({
    registry,
    bindingService: untouchedBindingService,
    transcriptCache: untouchedTranscriptCache,
  });
  const untouchedSessions = await untouchedService.listSessions();
  assert.equal(untouchedSessions[0].lastActivityAt, '2026-08-01T00:00:00.000Z');

  const details = await service.getSessionDetails('claude', 'sess-1');
  assert.equal(details.turns[0].userMessage.text, 'hi');
});

test('AgentSessionService binds a provider-created session identity only after creation succeeds', async () => {
  const bindings = [];
  const bindingService = {
    async bindSession(binding) {
      bindings.push(binding);
      return binding;
    },
  };
  const provider = {
    descriptor: { id: 'owned', label: 'Owned', capabilities },
    async createSession({ mode, purpose }) {
      assert.equal(mode, 'edit');
      assert.equal(purpose, 'task:task-1');
      return { providerSessionId: 'provider-thread-1' };
    },
    async startTurn() {},
    async cancelTurn() {},
  };
  const registry = createAgentProviderRegistry([provider]);
  const service = createAgentSessionService({ registry, bindingService });

  const session = await service.createSession('owned', { specId: 'spec-1', taskId: 'task-1' });
  assert.equal(session.providerSessionId, 'provider-thread-1');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].providerSessionId, 'provider-thread-1');

  let failedBindingCalled = false;
  const failingProvider = {
    descriptor: { id: 'failing-owned', label: 'Failing owned', capabilities },
    async createSession() {
      throw new Error('provider creation failed');
    },
    async startTurn() {},
    async cancelTurn() {},
  };
  const failingService = createAgentSessionService({
    registry: createAgentProviderRegistry([failingProvider]),
    bindingService: {
      async bindSession() {
        failedBindingCalled = true;
      },
    },
  });
  await assert.rejects(
    () => failingService.createSession('failing-owned', { specId: 'spec-1' }),
    /provider creation failed/,
  );
  assert.equal(failedBindingCalled, false);
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
  const provider = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId, message, emitFinalAnswerDelta }) {
      if (!providerSessionId) {
        const newId = 'fake-allocated-uuid-999';
        setProviderSessionId(newId);
        emitFinalAnswerDelta('first turn response');
        return { providerSessionId: newId };
      } else {
        resumeCalledWith = providerSessionId;
        emitFinalAnswerDelta('second turn response');
        return { providerSessionId };
      }
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry });
  const service = createAgentSessionService({ registry, turnRuntime, bindingService });

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
    await new Promise((r) => setTimeout(r, 5));
  }

  // 2. Second prompt resumes using the established providerSessionId
  const turn2 = await service.startTurn('fake', 'fake-allocated-uuid-999', {
    message: 'Follow-up prompt',
  });

  assert.equal(turn2.providerSessionId, 'fake-allocated-uuid-999');

  for (let i = 0; i < 50; i++) {
    const snap = service.getTurn(turn2.turnId);
    if (snap?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 5));
  }

  assert.equal(resumeCalledWith, 'fake-allocated-uuid-999');
});

test('first-turn binding failure causes startTurn rejection and turn failure', async () => {
  const bindingService = {
    async bindSession() {
      throw new Error('Database/disk binding error simulation');
    },
  };

  const provider = {
    descriptor: { id: 'fake', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId }) {
      if (!providerSessionId) {
        await setProviderSessionId('new-fail-uuid');
      }
    },
    async cancelTurn() {},
  };

  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry });
  const service = createAgentSessionService({ registry, turnRuntime, bindingService });

  await assert.rejects(() => service.startTurn('fake', null, { message: 'hi', specId: 'spec-1' }), {
    message: 'Database/disk binding error simulation',
  });
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
  const provider = {
    descriptor: {
      id: 'prec',
      label: 'Precedence',
      capabilities,
      defaultMode: 'edit',
      supportedModes: ['ask', 'edit', 'agent'],
    },
    async startTurn({ mode }) {
      executedMode = mode;
    },
    async cancelTurn() {},
  };

  const fakeBindings = new Map();
  const bindingService = {
    async getBinding(p, sid) {
      return fakeBindings.get(sid) || null;
    },
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

  const registry = createAgentProviderRegistry([provider]);
  const turnRuntime = createAgentTurnRuntime({ registry });
  const service = createAgentSessionService({ registry, turnRuntime, bindingService });

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

test('canonical TurnStatus validates all discriminated union variants and rejects invalid shapes', () => {
  // 1. active
  const activeStatus = validateTurnStatus({ status: 'active', detail: 'tool_execution', subjectId: 'tool-1' });
  assert.equal(activeStatus.status, 'active');
  assert.equal(activeStatus.detail, 'tool_execution');
  assert.equal(activeStatus.subjectId, 'tool-1');
  assert.ok(activeStatus.since);

  // 2. waiting
  const waitingStatus = validateTurnStatus({ status: 'waiting', reason: 'provider_response' });
  assert.equal(waitingStatus.status, 'waiting');
  assert.equal(waitingStatus.reason, 'provider_response');

  // 3. requiresAttention (requires interactionId)
  const attentionStatus = validateTurnStatus({
    status: 'requiresAttention',
    reason: 'permission',
    interactionId: 'int-1',
  });
  assert.equal(attentionStatus.status, 'requiresAttention');
  assert.equal(attentionStatus.interactionId, 'int-1');
  assert.throws(() => validateTurnStatus({ status: 'requiresAttention', reason: 'permission' }), {
    name: 'AiValidationError',
  });

  // 4. cancelling
  const cancellingStatus = validateTurnStatus({ status: 'cancelling', initiator: 'user' });
  assert.equal(cancellingStatus.status, 'cancelling');
  assert.equal(cancellingStatus.initiator, 'user');

  // 5. terminal
  const terminalStatus = validateTurnStatus({
    status: 'terminal',
    outcome: 'completed',
    initiator: 'provider',
    finishReason: 'stop',
  });
  assert.equal(terminalStatus.status, 'terminal');
  assert.equal(terminalStatus.outcome, 'completed');
  assert.throws(() => validateTurnStatus({ status: 'terminal', outcome: 'invalid_outcome' }), {
    name: 'AiValidationError',
  });

  // 6. unknown
  const unknownStatus = validateTurnStatus({ status: 'unknown', reason: 'unproven_state' });
  assert.equal(unknownStatus.status, 'unknown');
  assert.equal(unknownStatus.reason, 'unproven_state');

  // Invalid status
  assert.throws(() => validateTurnStatus({ status: 'inactive' }), { name: 'AiValidationError' });
  assert.throws(() => validateTurnStatus({ status: 'idle' }), { name: 'AiValidationError' });
  assert.throws(() => validateTurnStatus(null), { name: 'AiValidationError' });
});

test('canonical WorkItem types validate correctly and enforce semantic separation', () => {
  // Commentary
  const commentary = validateWorkItem({
    id: 'work-1',
    type: 'commentary',
    seq: 1,
    text: 'Analyzing codebase...',
    status: 'completed',
  });
  assert.equal(commentary.type, 'commentary');
  assert.equal(commentary.text, 'Analyzing codebase...');
  assert.equal(commentary.seq, 1);

  // Reasoning with representation
  const reasoning = validateWorkItem({
    id: 'work-2',
    type: 'reasoning',
    seq: 2,
    representation: 'raw_text',
    text: 'Checking directory paths.',
    status: 'completed',
  });
  assert.equal(reasoning.type, 'reasoning');
  assert.equal(reasoning.representation, 'raw_text');
  assert.equal(reasoning.seq, 2);

  // Tool invocation
  const tool = validateWorkItem({
    id: 'work-3',
    type: 'tool',
    seq: 3,
    toolName: 'readFile',
    kind: 'read',
    title: 'Read specification',
    status: 'completed',
    input: { path: 'specs/active/test.md' },
    output: 'content',
  });
  assert.equal(tool.type, 'tool');
  assert.equal(tool.kind, 'read');
  assert.equal(tool.seq, 3);

  // Interaction
  const interaction = validateWorkItem({
    id: 'work-4',
    type: 'interaction',
    seq: 4,
    interaction: {
      id: 'int-1',
      kind: 'permission',
      toolName: 'shell',
      input: { command: 'git status' },
    },
    status: 'pending',
  });
  assert.equal(interaction.type, 'interaction');
  assert.equal(interaction.status, 'pending');
  assert.equal(interaction.seq, 4);

  // Rejection of invalid types and missing required fields
  assert.throws(() => validateWorkItem({ id: 'work-x', type: 'unknown_type', seq: 1 }), { name: 'AiValidationError' });
  assert.throws(() => validateWorkItem({ id: 'work-x', type: 'commentary', seq: 0 }), { name: 'AiValidationError' });
});

test('FinalAnswer has independent lifecycle and cannot alias Commentary or Reasoning', () => {
  const finalAnswer = createFinalAnswer({
    id: 'final-answer',
    text: 'Here is the summary of the work.',
    status: 'completed',
    confidence: 'authoritative',
  });
  assert.equal(finalAnswer.id, 'final-answer');
  assert.equal(finalAnswer.text, 'Here is the summary of the work.');
  assert.equal(finalAnswer.status, 'completed');
  assert.equal(finalAnswer.confidence, 'authoritative');

  // Rejects invalid status
  assert.throws(() => validateFinalAnswer({ status: 'invalid_status' }), { name: 'AiValidationError' });
});

test('ordered Work sequence: monotonic sequence assignment and in-place delta updates', () => {
  const turn = createCanonicalTurn({
    id: 'turn-test-1',
    sessionId: 'sess-1',
    provider: 'codex',
    providerSessionId: 'thread-1',
  });

  assert.equal(turn.work.length, 0);
  assert.equal(turn.activityCount, 0);

  // Append items
  const item1 = appendWorkItem(turn, {
    id: 'w-1',
    type: 'commentary',
    text: 'Starting work',
    status: 'streaming',
  });
  assert.equal(item1.seq, 1);
  assert.equal(turn.activityCount, 1);

  const item2 = appendWorkItem(turn, {
    id: 'w-2',
    type: 'tool',
    toolName: 'exec',
    kind: 'command',
    title: 'Run build',
    status: 'active',
  });
  assert.equal(item2.seq, 2);
  assert.equal(turn.activityCount, 2);

  // In-place update: delta text update does not alter sequence or position
  const updated1 = updateWorkItem(turn, 'w-1', {
    text: 'Starting work now completed',
    status: 'completed',
  });
  assert.equal(updated1.seq, 1);
  assert.equal(turn.work[0].text, 'Starting work now completed');
  assert.equal(turn.work[0].status, 'completed');

  // Invariant C3: updating seq or type is rejected
  assert.throws(() => updateWorkItem(turn, 'w-1', { seq: 5 }), { name: 'AiValidationError' });
  assert.throws(() => updateWorkItem(turn, 'w-1', { type: 'tool' }), { name: 'AiValidationError' });

  // Invariant: completed items cannot return to streaming/active
  assert.throws(() => updateWorkItem(turn, 'w-1', { status: 'streaming' }), { name: 'AiValidationError' });

  assertValidCanonicalTurn(turn);
});

test('compound operation: multiple ToolActions remain nested and do not increase top-level activityCount', () => {
  const turn = createCanonicalTurn({
    id: 'turn-test-compound',
    sessionId: 'sess-1',
    provider: 'codex',
    providerSessionId: 'thread-1',
  });

  const toolItem = appendWorkItem(turn, {
    id: 'w-compound',
    type: 'tool',
    toolName: 'commandExecution',
    kind: 'command',
    title: 'Execute test suite and checks',
    status: 'active',
  });

  assert.equal(turn.activityCount, 1);

  // Add 3 nested actions
  const act1 = addToolAction(toolItem, { id: 'act-1', kind: 'list', title: 'List files in tests/' });
  assert.equal(act1.seq, 1);
  assert.equal(toolItem.actions.length, 1);
  assert.equal(turn.activityCount, 1); // Remains 1!

  const act2 = addToolAction(toolItem, { id: 'act-2', kind: 'read', title: 'Read config' });
  assert.equal(act2.seq, 2);
  assert.equal(toolItem.actions.length, 2);
  assert.equal(turn.activityCount, 1); // Remains 1!

  const act3 = addToolAction(toolItem, { id: 'act-3', kind: 'execute', title: 'Run tests' });
  assert.equal(act3.seq, 3);
  assert.equal(toolItem.actions.length, 3);
  assert.equal(turn.activityCount, 1); // Remains 1!

  assertToolActionHierarchy(toolItem);
  assertValidCanonicalTurn(turn);
});

test('requiresAttention invariant: cannot set requiresAttention without matching pending interaction', () => {
  const turn = createCanonicalTurn({
    id: 'turn-attention-test',
    sessionId: 'sess-1',
    provider: 'claude',
    providerSessionId: 'claude-1',
  });

  // Attempting to set requiresAttention without any interaction throws
  assert.throws(
    () => setTurnStatus(turn, { status: 'requiresAttention', reason: 'permission', interactionId: 'int-missing' }),
    { name: 'AiValidationError' },
  );

  // Add interaction
  appendWorkItem(turn, {
    id: 'int-valid',
    type: 'interaction',
    status: 'pending',
    interaction: {
      id: 'int-valid',
      kind: 'permission',
      toolName: 'shell',
    },
  });

  // Now setting status with matching interactionId succeeds
  setTurnStatus(turn, { status: 'requiresAttention', reason: 'permission', interactionId: 'int-valid' });
  assert.equal(turn.status.status, 'requiresAttention');
  assert.equal(turn.status.interactionId, 'int-valid');

  assertValidCanonicalTurn(turn);
});

test('computeCurrentActivity resolves semantic activity and titles for all turn phases', () => {
  const turn = createCanonicalTurn({
    id: 'turn-activity-test',
    sessionId: 'sess-1',
    provider: 'claude',
    providerSessionId: 'claude-1',
  });

  // 1. Startup -> waiting for model
  let act = computeCurrentActivity(turn);
  assert.equal(act.status, 'running');
  assert.equal(act.kind, 'waiting_for_model');
  assert.equal(act.title, 'Waiting for model response');

  // 2. Active Tool
  const tool = appendWorkItem(turn, {
    id: 'tool-act',
    type: 'tool',
    toolName: 'searchRepo',
    kind: 'search',
    title: 'Search repository',
    status: 'active',
  });
  act = computeCurrentActivity(turn);
  assert.equal(act.kind, 'tool');
  assert.equal(act.toolKind, 'search');
  assert.equal(act.title, 'Search repository');
  assert.equal(act.status, 'active');
  assert.equal(act.subjectId, 'tool-act');

  // 3. Tool completed -> Waiting for model response (never fake thinking)
  updateWorkItem(turn, 'tool-act', { status: 'completed' });
  setTurnStatus(turn, { status: 'waiting', reason: 'provider_response' });
  act = computeCurrentActivity(turn);
  assert.equal(act.kind, 'waiting_for_model');
  assert.equal(act.title, 'Waiting for model response');

  // 4. Requires attention
  appendWorkItem(turn, {
    id: 'int-q',
    type: 'interaction',
    status: 'pending',
    interaction: {
      id: 'int-q',
      kind: 'question',
      questions: [{ id: 'q1', question: 'Select mode' }],
    },
  });
  setTurnStatus(turn, { status: 'requiresAttention', reason: 'question', interactionId: 'int-q' });
  act = computeCurrentActivity(turn);
  assert.equal(act.kind, 'requires_attention');
  assert.equal(act.status, 'requiresAttention');
  assert.equal(act.subjectId, 'int-q');

  // 5. Terminal completed -> CurrentActivity disappears (null)
  updateWorkItem(turn, 'int-q', { status: 'resolved', response: { answers: [{ questionId: 'q1', value: 'auto' }] } });
  setTurnStatus(turn, { status: 'terminal', outcome: 'completed', initiator: 'provider', finishReason: 'stop' });
  act = computeCurrentActivity(turn);
  assert.equal(act, null);
});

test('representative provider fixture builders conform to canonical invariants', () => {
  // Claude scenario
  const claudeTurn = buildClaudeScenarioTurn();
  assertValidCanonicalTurn(claudeTurn);
  assert.equal(claudeTurn.provider, 'claude');
  assert.equal(claudeTurn.work.length, 3); // commentary, tool, reasoning
  assert.ok(claudeTurn.finalAnswer);

  // Codex scenario (with nested actions)
  const codexTurn = buildCodexScenarioTurn();
  assertValidCanonicalTurn(codexTurn);
  assert.equal(codexTurn.provider, 'codex');
  assert.equal(codexTurn.work.length, 2); // commentary, tool (with 3 nested actions)
  assert.equal(codexTurn.work[1].actions.length, 3);
  assert.ok(codexTurn.finalAnswer);

  // Antigravity scenario (with interaction)
  const agTurn = buildAntigravityScenarioTurn();
  assertValidCanonicalTurn(agTurn);
  assert.equal(agTurn.provider, 'antigravity');
  assert.equal(agTurn.work.length, 2); // reasoning, interaction
  assert.ok(agTurn.finalAnswer);
});

test('public serialization strips provider-private fields and enforces clean DTO shape', () => {
  const turn = createCanonicalTurn({
    id: 'turn-strip-test',
    sessionId: 'sess-1',
    provider: 'codex',
    providerSessionId: 'thread-private-123',
  });

  appendWorkItem(turn, {
    id: 'w-1',
    type: 'tool',
    toolName: 'exec',
    kind: 'command',
    title: 'Run cmd',
    status: 'completed',
    input: { command: 'echo hello' },
  });

  // Serialization succeeds
  const pub = serializePublicTurn(turn);
  assert.equal(pub.id, 'turn-strip-test');
  assert.equal(pub.provider, 'codex');
  assert.equal(pub.activityCount, 1);
  assert.equal('providerRequestId' in pub, false);
  assert.equal('rawPayload' in pub, false);

  // Validating turn containing private fields directly throws
  assert.throws(() => validateCanonicalTurn({ ...turn, providerRequestId: 'secret-123' }), {
    name: 'AiValidationError',
  });
  assert.throws(() => validateCanonicalTurn({ ...turn, work: [{ ...turn.work[0], rawPayload: {} }] }), {
    name: 'AiValidationError',
  });
});

test('AgentModelDescriptor and AgentModelTraits validate sources and advisory traits', () => {
  // 1. Full descriptor with all trait metadata
  const full = validateAgentModelDescriptor({
    id: 'claude-3-7-sonnet-20250219',
    label: 'Claude 3.7 Sonnet',
    isDefault: true,
    source: 'discovered',
    traits: {
      supportsReasoning: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
      inputModalities: ['text', 'image'],
      supportsVision: true,
      maxContextTokens: 200_000,
    },
  });
  assert.equal(full.id, 'claude-3-7-sonnet-20250219');
  assert.equal(full.label, 'Claude 3.7 Sonnet');
  assert.equal(full.isDefault, true);
  assert.equal(full.source, 'discovered');
  assert.equal(full.traits.supportsReasoning, true);
  assert.deepEqual(full.traits.supportedReasoningEfforts, ['low', 'medium', 'high']);
  assert.equal(full.traits.defaultReasoningEffort, 'medium');
  assert.deepEqual(full.traits.inputModalities, ['text', 'image']);
  assert.equal(full.traits.supportsVision, true);
  assert.equal(full.traits.maxContextTokens, 200_000);

  // 2. Validate all sources
  for (const source of MODEL_SOURCES) {
    const desc = validateAgentModelDescriptor({ id: 'm1', label: 'Model 1', source });
    assert.equal(desc.source, source);
    // Undefined traits are not fabricated
    assert.equal(desc.traits, undefined);
  }

  // 3. Rejects invalid source
  assert.throws(
    () => validateAgentModelDescriptor({ id: 'm1', label: 'Model 1', source: 'invented' }),
    { name: 'AiValidationError' },
  );

  // 4. Undefined traits mean UNKNOWN, not false
  const minimalTraits = validateAgentModelTraits({});
  assert.equal(minimalTraits, undefined);

  const partialTraits = validateAgentModelTraits({ supportsReasoning: true });
  assert.equal(partialTraits.supportsReasoning, true);
  assert.equal(partialTraits.supportsVision, undefined);
  assert.equal(partialTraits.supportedReasoningEfforts, undefined);

  // 5. Invalid trait types throw
  assert.throws(() => validateAgentModelTraits({ supportsReasoning: 'yes' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentModelTraits({ supportedReasoningEfforts: 'high' }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentModelTraits({ maxContextTokens: -100 }), { name: 'AiValidationError' });
  assert.throws(() => validateAgentModelTraits({ maxContextTokens: 'lots' }), { name: 'AiValidationError' });

  // 6. Factory helper
  const created = createAgentModelDescriptor({
    id: 'gpt-4o',
    label: 'GPT-4o',
    source: 'configured',
  });
  assert.equal(created.id, 'gpt-4o');
  assert.equal(created.source, 'configured');
});

test('ProviderCapabilities includes canOverrideTurnModel, toolCalls, and reasoningEvents decoupled from traits', () => {
  // Required capability keys exist
  assert.ok(AGENT_CAPABILITIES.includes('canOverrideTurnModel'));
  assert.ok(AGENT_CAPABILITIES.includes('toolCalls'));
  assert.ok(AGENT_CAPABILITIES.includes('reasoningEvents'));

  // Default is false
  assert.equal(DEFAULT_AGENT_CAPABILITIES.canOverrideTurnModel, false);
  assert.equal(DEFAULT_AGENT_CAPABILITIES.toolCalls, false);
  assert.equal(DEFAULT_AGENT_CAPABILITIES.reasoningEvents, false);

  // Normalization properly sets them
  const normalized = normalizeCapabilities({
    canOverrideTurnModel: true,
    toolCalls: true,
    reasoningEvents: true,
  });
  assert.equal(normalized.canOverrideTurnModel, true);
  assert.equal(normalized.toolCalls, true);
  assert.equal(normalized.reasoningEvents, true);
  assert.equal(normalized.steerTurn, false);

  // Provider descriptor carries capabilities and models separately
  const desc = validateProviderDescriptor({
    id: 'test-prov',
    label: 'Test Provider',
    capabilities: { canOverrideTurnModel: true, toolCalls: true, reasoningEvents: true },
    models: [
      { id: 'm-1', label: 'Model 1', source: 'discovered', traits: { supportsReasoning: true } },
    ],
  });
  assert.equal(desc.capabilities.canOverrideTurnModel, true);
  assert.equal(desc.capabilities.toolCalls, true);
  assert.equal(desc.capabilities.reasoningEvents, true);
  assert.equal(desc.models.length, 1);
  assert.equal(desc.models[0].traits.supportsReasoning, true);
  // Model does NOT carry transport capabilities
  assert.equal('toolCalls' in desc.models[0], false);
  assert.equal('canOverrideTurnModel' in desc.models[0], false);
});

test('ProviderHealth validates decoupled configuration and operational health status', () => {
  // 1. Valid healthy provider
  const healthy = validateProviderHealth({
    enabled: true,
    installed: true,
    version: '0.149.0',
    status: 'healthy',
    authenticated: true,
  });
  assert.deepEqual(healthy, {
    enabled: true,
    installed: true,
    version: '0.149.0',
    status: 'healthy',
    authenticated: true,
  });

  // 2. Degraded provider with reason
  const degraded = validateProviderHealth({
    enabled: true,
    installed: true,
    status: 'degraded',
    unavailableReason: 'Rate limit threshold approaching.',
  });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.unavailableReason, 'Rate limit threshold approaching.');
  assert.equal(degraded.authenticated, undefined);

  // 3. Unavailable provider
  const unavailable = validateProviderHealth({
    enabled: true,
    installed: false,
    status: 'unavailable',
    unavailableReason: 'Binary not found in PATH.',
  });
  assert.equal(unavailable.status, 'unavailable');

  // 4. Invalid status throws
  assert.throws(
    () => validateProviderHealth({ enabled: true, installed: true, status: 'offline' }),
    { name: 'AiValidationError' },
  );

  // 5. Integration with validateProviderDescriptor
  const desc = validateProviderDescriptor({
    id: 'prov-with-health',
    label: 'Provider With Health',
    capabilities: {},
    health: {
      enabled: true,
      installed: true,
      version: '1.0.0',
      status: 'healthy',
    },
  });
  assert.equal(desc.health.status, 'healthy');
  assert.equal(desc.health.version, '1.0.0');
});

test('12 normalized failure codes, HTTP status mapping, and 6 recovery hints', () => {
  // Exactly 12 failure codes
  assert.equal(AI_FAILURE_CODES.length, 12);
  const expectedCodes = [
    'AI_AUTH_FAILED',
    'AI_POLICY_DENIED',
    'AI_RATE_LIMITED',
    'AI_QUOTA_EXHAUSTED',
    'AI_PROVIDER_UNAVAILABLE',
    'AI_TRANSPORT_ERROR',
    'AI_PROVIDER_TIMEOUT',
    'AI_RUNTIME_TIMEOUT',
    'AI_PROTOCOL_ERROR',
    'AI_UNSUPPORTED_OPERATION',
    'AI_OPERATION_LOST',
    'AI_PROVIDER_EXECUTION_ERROR',
  ];
  assert.deepEqual([...AI_FAILURE_CODES], expectedCodes);

  // Exactly 6 recovery hints
  assert.equal(AI_RECOVERY_HINTS.length, 6);
  const expectedHints = [
    'none',
    'retry-after-delay',
    'new-turn',
    'new-session',
    'operator-action',
    'alternate-provider',
  ];
  assert.deepEqual([...AI_RECOVERY_HINTS], expectedHints);

  // HTTP status mapping
  assert.equal(AI_ERROR_HTTP_STATUS.AI_AUTH_FAILED, 401);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_POLICY_DENIED, 403);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_RATE_LIMITED, 429);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_QUOTA_EXHAUSTED, 429);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_PROVIDER_UNAVAILABLE, 503);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_TRANSPORT_ERROR, 502);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_PROVIDER_TIMEOUT, 504);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_RUNTIME_TIMEOUT, 504);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_PROTOCOL_ERROR, 502);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_UNSUPPORTED_OPERATION, 409);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_OPERATION_LOST, 500);
  assert.equal(AI_ERROR_HTTP_STATUS.AI_PROVIDER_EXECUTION_ERROR, 502);

  // Code & hint validators
  for (const code of AI_FAILURE_CODES) {
    assert.equal(validateAiFailureCode(code), code);
    assert.ok(AI_ERROR_HTTP_STATUS[code] !== undefined);
    assert.ok(AI_RECOVERY_HINTS.includes(DEFAULT_RECOVERY_HINTS[code]));
  }
  for (const hint of AI_RECOVERY_HINTS) {
    assert.equal(validateAiRecoveryHint(hint), hint);
  }
  assert.throws(() => validateAiFailureCode('UNKNOWN_CODE'), { name: 'AiValidationError' });
  assert.throws(() => validateAiRecoveryHint('reboot-machine'), { name: 'AiValidationError' });

  // AiError builds structured JSON with recovery hints
  const rateLimitErr = new AiError('AI_RATE_LIMITED', 'Rate limit exceeded.', {
    suggestedDelayMs: 3000,
  });
  assert.equal(rateLimitErr.status, 429);
  assert.equal(rateLimitErr.recoveryHint, 'retry-after-delay');
  assert.equal(rateLimitErr.suggestedDelayMs, 3000);
  assert.deepEqual(rateLimitErr.toJSON(), {
    error: {
      code: 'AI_RATE_LIMITED',
      message: 'Rate limit exceeded.',
      recoveryHint: 'retry-after-delay',
      suggestedDelayMs: 3000,
    },
  });
});

test('Permissive model passthrough normalizer accepts unlisted model identifiers without validation failure', () => {
  const catalog = [
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', source: 'known' },
    { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', source: 'discovered' },
  ];

  const warnings = [];
  const warnCapture = (msg) => warnings.push(msg);

  // Known model passes through without warning
  const known = normalizeModelIdentifier('claude-3-7-sonnet', catalog, { onWarning: warnCapture });
  assert.equal(known, 'claude-3-7-sonnet');
  assert.equal(warnings.length, 0);

  // Unlisted model passes through WITH warning, NO error thrown
  const unlisted = normalizeModelIdentifier('claude-4-future-unlisted', catalog, { onWarning: warnCapture });
  assert.equal(unlisted, 'claude-4-future-unlisted');
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('claude-4-future-unlisted'));

  // Empty catalog does not warn
  const emptyWarnings = [];
  const anyModel = normalizeModelIdentifier('any-model-id', [], { onWarning: (m) => emptyWarnings.push(m) });
  assert.equal(anyModel, 'any-model-id');
  assert.equal(emptyWarnings.length, 0);

  // Missing / undefined model returns undefined
  assert.equal(normalizeModelIdentifier(undefined), undefined);
  assert.equal(normalizeModelIdentifier(null), undefined);
  assert.equal(normalizeModelIdentifier(''), undefined);

  // Non-string or oversized string throws validation error
  assert.throws(() => normalizeModelIdentifier(123), { name: 'AiValidationError' });
  assert.throws(() => normalizeModelIdentifier('a'.repeat(300)), { name: 'AiValidationError' });
});

test('Terminal outcomes remain decoupled from failure codes and recovery hints', () => {
  // Completed lifecycle outcome: no error code
  const completed = createTurnStatus('terminal', { outcome: 'completed', initiator: 'provider' });
  assert.equal(completed.outcome, 'completed');
  assert.equal(completed.error, undefined);

  // User cancellation: lifecycle outcome, not an error
  const cancelled = createTurnStatus('terminal', { outcome: 'cancelled', initiator: 'user' });
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(cancelled.initiator, 'user');
  assert.equal(cancelled.error, undefined);

  // Server restart interruption: lifecycle outcome, not an error
  const interrupted = createTurnStatus('terminal', { outcome: 'interrupted', initiator: 'restart' });
  assert.equal(interrupted.outcome, 'interrupted');
  assert.equal(interrupted.initiator, 'restart');
  assert.equal(interrupted.error, undefined);

  // Failed outcome carries failure code and recovery hint
  const failed = createTurnStatus('terminal', {
    outcome: 'failed',
    initiator: 'provider',
    error: {
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'Service is down.',
      recoveryHint: 'retry-after-delay',
      suggestedDelayMs: 5000,
    },
  });
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.error.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(failed.error.recoveryHint, 'retry-after-delay');
  assert.equal(failed.error.suggestedDelayMs, 5000);
});

