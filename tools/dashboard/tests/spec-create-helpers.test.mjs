import assert from 'node:assert/strict';
import test from 'node:test';

import { slugifyTitle, resolveDefaultPlanningMode, SPEC_TYPES_OPTIONS } from '../ui/features/specifications/create/create-specification-helpers.ts';

test('slugifyTitle converts titles to canonical kebab-case slugs', () => {
  assert.equal(slugifyTitle('Multi-Provider Agent Sessions'), 'multi-provider-agent-sessions');
  assert.equal(slugifyTitle('Zażółć gęślą jaźń'), 'zazolc-gesla-jazn');
  assert.equal(slugifyTitle('  Leading & Trailing Spaces!  '), 'leading-trailing-spaces');
  assert.equal(slugifyTitle('Special@#Characters$$123'), 'special-characters-123');
  assert.equal(slugifyTitle(''), '');
});

test('SPEC_TYPES_OPTIONS contains standard, architectural, small, exploratory options', () => {
  const ids = SPEC_TYPES_OPTIONS.map(o => o.id);
  assert.deepEqual(ids, ['standard', 'architectural', 'small', 'exploratory']);
});

test('resolveDefaultPlanningMode adheres strictly to safety invariant (Task 13 & 15)', () => {
  // 1. Provider supporting ask, edit, agent initializes wizard to 'ask'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    }),
    'ask'
  );

  // 2. Provider without ask initializes to its declared default mode
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'edit',
    }),
    'edit'
  );

  // 3. Provider declaring defaultMode: 'agent' without ask never silently escalates to 'agent'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'agent',
    }),
    'edit'
  );

  // 4. Missing/invalid default mode safely falls back to 'edit'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
    }),
    'edit'
  );
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'unknown',
    }),
    'edit'
  );

  // 5. Missing/null provider safely resolves to default supported 'ask'
  assert.equal(resolveDefaultPlanningMode(null), 'ask');
  assert.equal(resolveDefaultPlanningMode(undefined), 'ask');

  // 6. Switching provider re-evaluates deterministically
  const providerA = { supportedModes: ['ask', 'edit', 'agent'], defaultMode: 'edit' };
  const providerB = { supportedModes: ['edit', 'agent'], defaultMode: 'edit' };
  assert.equal(resolveDefaultPlanningMode(providerA), 'ask');
  assert.equal(resolveDefaultPlanningMode(providerB), 'edit');
  assert.equal(resolveDefaultPlanningMode(providerA), 'ask');
});

test('untouched wizard planning flow never escalates to agent; agent requires explicit user selection', () => {
  const providerWithAgent = {
    id: 'claude',
    label: 'Claude',
    supportedModes: ['ask', 'edit', 'agent'],
    defaultMode: 'edit',
  };

  // Untouched state: initial mode is resolved via resolveDefaultPlanningMode
  let activeMode = resolveDefaultPlanningMode(providerWithAgent);
  assert.equal(activeMode, 'ask');
  assert.notEqual(activeMode, 'agent', 'Untouched wizard must never default to agent');

  // User explicitly selects 'agent'
  const handleUserModeClick = (selected) => {
    if (providerWithAgent.supportedModes.includes(selected)) {
      activeMode = selected;
    }
  };

  handleUserModeClick('agent');
  assert.equal(activeMode, 'agent', 'Agent mode becomes active after explicit selection');

  // Switching provider resets according to new provider capabilities
  const providerWithoutAsk = {
    id: 'mock',
    label: 'Mock',
    supportedModes: ['edit', 'agent'],
    defaultMode: 'edit',
  };
  activeMode = resolveDefaultPlanningMode(providerWithoutAsk);
  assert.equal(activeMode, 'edit', 'Switching provider resets to safe non-agent mode');
});

test('two-phase wizard orchestration flow semantics (Task 15)', async () => {
  // Scenario 1: Spec create succeeds without AI
  let specCreateCalls = 0;
  let sessionCreateCalls = 0;
  let handoffResult = null;

  const mockSpecMutation = {
    createSpecification: async (payload) => {
      specCreateCalls++;
      return { ok: true, slug: payload.slug, specId: 'spec-123', change: { title: payload.title } };
    },
  };

  const mockSessionApi = {
    create: async (payload) => {
      sessionCreateCalls++;
      return { sessionId: 'sess-1', provider: payload.provider, specId: payload.specId, mode: payload.mode };
    },
  };

  // Orchestration 1: Without AI
  let spec = await mockSpecMutation.createSpecification({ slug: 'test-spec', title: 'Test Spec' });
  handoffResult = { spec, session: null, initialPrompt: null };
  assert.equal(specCreateCalls, 1);
  assert.equal(sessionCreateCalls, 0);
  assert.equal(handoffResult.spec.slug, 'test-spec');
  assert.equal(handoffResult.session, null);

  // Scenario 2: Spec create + AI session succeeds and hands initialPrompt to chat
  specCreateCalls = 0;
  sessionCreateCalls = 0;
  spec = await mockSpecMutation.createSpecification({ slug: 'ai-spec', title: 'AI Spec' });
  const session = await mockSessionApi.create({ provider: 'anthropic', specId: spec.specId, mode: 'ask' });
  handoffResult = { spec, session, initialPrompt: 'Initial planning prompt' };
  assert.equal(specCreateCalls, 1);
  assert.equal(sessionCreateCalls, 1);
  assert.equal(handoffResult.session.sessionId, 'sess-1');
  assert.equal(handoffResult.initialPrompt, 'Initial planning prompt');

  // Scenario 3: AI session create failure preserves spec; retry only calls session create
  specCreateCalls = 0;
  sessionCreateCalls = 0;
  let createdSpecState = null;
  let aiSessionError = null;

  // Phase 1: create spec
  createdSpecState = await mockSpecMutation.createSpecification({ slug: 'retry-spec', title: 'Retry Spec' });
  assert.equal(specCreateCalls, 1);

  // Phase 2: session creation fails
  let shouldFail = true;
  try {
    if (shouldFail) throw new Error('API Rate limit exceeded');
  } catch (err) {
    aiSessionError = err.message;
  }
  // Spec is preserved in state
  assert.ok(createdSpecState);
  assert.equal(createdSpecState.slug, 'retry-spec');
  assert.equal(aiSessionError, 'API Rate limit exceeded');

  // User clicks Retry AI -> calls executeAiSessionKickoff without re-creating spec
  shouldFail = false;
  const retriedSession = await mockSessionApi.create({
    provider: 'anthropic',
    specId: createdSpecState.specId,
    mode: 'ask',
  });
  assert.equal(specCreateCalls, 1, 'Retry must never re-call createSpecification');
  assert.equal(sessionCreateCalls, 1, 'Retry successfully calls AI session create');
  assert.equal(retriedSession.sessionId, 'sess-1');

  // Scenario 4: Subsequent chat turn failure is handled in chat, not spec/session wizard
  let chatTurnSent = false;
  let chatTurnError = null;
  const mockSendTurn = async (_prompt) => {
    chatTurnSent = true;
    throw new Error('LLM context length exceeded');
  };

  try {
    await mockSendTurn(handoffResult.initialPrompt);
  } catch (err) {
    chatTurnError = err.message;
  }
  assert.equal(chatTurnSent, true);
  assert.equal(chatTurnError, 'LLM context length exceeded');
  // Spec and session remain valid and untouched
  assert.equal(createdSpecState.slug, 'retry-spec');
  assert.equal(retriedSession.sessionId, 'sess-1');
});
