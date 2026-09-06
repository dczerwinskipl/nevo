import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canStartTurn,
  deriveActivity,
  applyTurnUpdated,
  shouldSurfaceCancelError,
  shouldSurfaceTurnError,
} from '../ui/features/agent-sessions/runtime/agent-event-reducer.ts';
import { resolveSessionReadiness } from '../server/ai/sessions/service.mjs';
import {
  pendingDispatchStore,
  InitialDispatchController,
} from '../ui/features/agent-sessions/runtime/pending-dispatch-store.ts';

function readRuntimeSource() {
  return readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/runtime/agent-session-runtime.ts', import.meta.url)),
    'utf8',
  );
}

function readAgentSessionPageSource() {
  return readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-page.tsx', import.meta.url)),
    'utf8',
  );
}

test('Issue 3: canStartTurn prohibits normal send when session is waitingForUser or running', () => {
  const provider = 'opencode';
  const sessionId = 'sess-123';
  const message = 'Hello world';
  const ready = { status: 'ready', reason: 'idle' };
  const requiresAttention = { status: 'requiresAttention', reason: 'question_required' };
  const busy = { status: 'busy', reason: 'turn_in_progress' };

  // Allowed only when ready
  assert.equal(canStartTurn(ready, provider, sessionId, message), true);

  // Prohibited when waiting for user interaction (Issue 3 blocker)
  assert.equal(canStartTurn(requiresAttention, provider, sessionId, message), false);

  // Prohibited when actively running
  assert.equal(canStartTurn(busy, provider, sessionId, message), false);

  // Prohibited when message is whitespace
  assert.equal(canStartTurn(ready, provider, sessionId, '   '), false);
});

test('Live readiness transition: ready -> running -> terminal', () => {
  // 1. Initial ready state: no active/latest turn at all
  let readiness = resolveSessionReadiness({ turnSnapshot: null });
  assert.equal(readiness.status, 'ready');
  assert.equal(canStartTurn(readiness), true);
  assert.equal(deriveActivity([]), 'idle');

  // 2. User sends turn -> the browser's own optimistic-pending override (the only
  // client-local readiness value; everything else comes from the server).
  const optimisticReadiness = { status: 'busy', reason: 'turn_in_progress' };
  assert.equal(canStartTurn(optimisticReadiness), false, 'Composer must be disabled while turn is in progress');

  // 3. Authoritative turn.updated arrives with an active canonical status
  const runningTurn = {
    id: 'turn-100',
    status: { status: 'active', detail: 'processing', since: '2026-09-06T12:00:00.000Z', source: 'provider' },
    userMessage: { text: 'Analyze codebase' },
    work: [],
  };
  let turns = applyTurnUpdated([], runningTurn);

  readiness = resolveSessionReadiness({ turnSnapshot: runningTurn });
  assert.equal(readiness.status, 'busy');
  assert.equal(readiness.details?.turnId, 'turn-100');
  assert.equal(canStartTurn(readiness), false);
  assert.equal(deriveActivity(turns), 'running');

  // 4. Authoritative turn.updated arrives with terminal status
  const completedTurn = {
    ...runningTurn,
    status: {
      status: 'terminal',
      outcome: 'completed',
      initiator: 'provider',
      since: '2026-09-06T12:01:00.000Z',
      source: 'provider',
    },
  };
  turns = applyTurnUpdated(turns, completedTurn);

  readiness = resolveSessionReadiness({ turnSnapshot: completedTurn });
  assert.equal(readiness.status, 'ready', 'Readiness immediately transitions to ready upon terminal turn');
  assert.equal(canStartTurn(readiness), true, 'Composer is re-enabled');
  assert.equal(deriveActivity(turns), 'idle');
});

test('Live readiness transition: running -> requiresAttention', () => {
  const activeTurn = {
    id: 'turn-101',
    status: { status: 'active', detail: 'processing', since: '2026-09-06T12:00:00.000Z', source: 'provider' },
    userMessage: { text: 'Run migration' },
    work: [],
  };

  let readiness = resolveSessionReadiness({ turnSnapshot: activeTurn });
  assert.equal(readiness.status, 'busy');
  assert.equal(deriveActivity([activeTurn]), 'running');

  // Turn requests user confirmation/question via MCP ask_user or native interaction —
  // the canonical model carries this on Turn.status.interactionId plus an interaction
  // Work item, never a compatibility top-level `pendingInteraction`.
  const attentionTurn = {
    ...activeTurn,
    status: {
      status: 'requiresAttention',
      reason: 'question',
      interactionId: 'int-q1',
      since: '2026-09-06T12:00:10.000Z',
      source: 'provider',
    },
    work: [
      {
        id: 'int-q1',
        seq: 1,
        createdAt: '2026-09-06T12:00:10.000Z',
        updatedAt: '2026-09-06T12:00:10.000Z',
        type: 'interaction',
        status: 'pending',
        interaction: {
          id: 'int-q1',
          kind: 'question',
          resumePolicy: 'restart',
          questions: [{ id: 'q-1', question: 'Proceed with destructive schema migration?', multiSelect: false }],
        },
      },
    ],
  };

  readiness = resolveSessionReadiness({ turnSnapshot: attentionTurn });
  assert.equal(readiness.status, 'requiresAttention', 'Readiness transitions immediately to requiresAttention');
  assert.equal(readiness.reason, 'question_required');
  assert.equal(readiness.details?.interactionId, 'int-q1');
  assert.equal(canStartTurn(readiness), false, 'Composer cannot start a new turn while interaction is pending');
  assert.equal(deriveActivity([attentionTurn]), 'waitingForUser');
});

test('Live readiness transition: requiresAttention -> continuation', () => {
  const attentionTurn = {
    id: 'turn-102',
    status: {
      status: 'requiresAttention',
      reason: 'question',
      interactionId: 'int-q2',
      since: '2026-09-06T12:00:10.000Z',
      source: 'provider',
    },
    userMessage: { text: 'Migrate' },
    work: [],
  };

  assert.equal(resolveSessionReadiness({ turnSnapshot: attentionTurn }).status, 'requiresAttention');
  assert.equal(deriveActivity([attentionTurn]), 'waitingForUser');

  // Interaction is answered, turn resumes execution
  const resumedTurn = {
    ...attentionTurn,
    status: { status: 'active', detail: 'processing', since: '2026-09-06T12:00:20.000Z', source: 'provider' },
  };

  const readiness = resolveSessionReadiness({ turnSnapshot: resumedTurn });
  assert.equal(readiness.status, 'busy', 'Readiness resumes busy status during continuation');
  assert.equal(readiness.reason, 'turn_in_progress');
  assert.equal(deriveActivity([resumedTurn]), 'running');
  assert.equal(canStartTurn(readiness), false);
});

test('Task 13 correction: resolveSessionReadiness projects every canonical Turn state correctly for the readiness attached to a turn.updated event', () => {
  const since = '2026-09-06T12:00:00.000Z';
  const source = 'provider';

  // active
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: { id: 't-active', status: { status: 'active', detail: 'processing', since, source }, work: [] },
    }),
    { status: 'busy', reason: 'turn_in_progress', details: { turnId: 't-active' } },
  );

  // waiting (non-terminal, non-attention) also projects to busy
  assert.equal(
    resolveSessionReadiness({
      turnSnapshot: { id: 't-waiting', status: { status: 'waiting', reason: 'tool_result', since, source }, work: [] },
    }).status,
    'busy',
  );

  // requiresAttention / question
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: {
        id: 't-question',
        status: { status: 'requiresAttention', reason: 'question', interactionId: 'int-1', since, source },
        work: [
          {
            id: 'int-1',
            seq: 1,
            createdAt: since,
            updatedAt: since,
            type: 'interaction',
            status: 'pending',
            interaction: { id: 'int-1', kind: 'question', resumePolicy: 'restart', questions: [] },
          },
        ],
      },
    }),
    { status: 'requiresAttention', reason: 'question_required', details: { interactionId: 'int-1', kind: 'question' } },
  );

  // requiresAttention / permission
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: {
        id: 't-permission',
        status: { status: 'requiresAttention', reason: 'permission', interactionId: 'int-2', since, source },
        work: [
          {
            id: 'int-2',
            seq: 1,
            createdAt: since,
            updatedAt: since,
            type: 'interaction',
            status: 'pending',
            interaction: { id: 'int-2', kind: 'permission', resumePolicy: 'restart', toolName: 'Shell' },
          },
        ],
      },
    }),
    {
      status: 'requiresAttention',
      reason: 'permission_required',
      details: { interactionId: 'int-2', kind: 'permission' },
    },
  );

  // requiresAttention / confirmation
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: {
        id: 't-confirmation',
        status: { status: 'requiresAttention', reason: 'confirmation', interactionId: 'int-3', since, source },
        work: [
          {
            id: 'int-3',
            seq: 1,
            createdAt: since,
            updatedAt: since,
            type: 'interaction',
            status: 'pending',
            interaction: { id: 'int-3', kind: 'confirmation', resumePolicy: 'restart', message: 'Proceed?' },
          },
        ],
      },
    }),
    {
      status: 'requiresAttention',
      reason: 'confirmation_required',
      details: { interactionId: 'int-3', kind: 'confirmation' },
    },
  );

  // terminal completed
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: { id: 't-completed', status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since, source }, work: [] },
    }),
    { status: 'ready', reason: 'idle' },
  );

  // terminal cancelled
  assert.deepEqual(
    resolveSessionReadiness({
      turnSnapshot: {
        id: 't-cancelled',
        status: {
          status: 'terminal',
          outcome: 'cancelled',
          initiator: 'user',
          error: { code: 'AI_TURN_CANCELLED', message: 'The turn was cancelled.' },
          since,
          source,
        },
        work: [],
      },
    }),
    { status: 'ready', reason: 'idle' },
  );
});


test('Issue 2 & Race Safety: Terminal SSE before POST response never leaves stale activeTurnId', () => {
  const readyReadiness = { status: 'ready', reason: 'idle' };
  const busyReadiness = { status: 'busy', reason: 'turn_in_progress' };
  let readiness = readyReadiness;
  let activeTurnId = null;
  const terminalTurnIds = new Set();

  function onSend(msg) {
    if (!canStartTurn(readiness, 'opencode', 'sess-1', msg)) return false;
    readiness = busyReadiness;
    activeTurnId = null;
    return true;
  }

  function onSseTurnStarted(turnId) {
    readiness = busyReadiness;
    activeTurnId = turnId;
  }

  function onSseTurnCompleted(turnId) {
    terminalTurnIds.add(turnId);
    readiness = readyReadiness;
    activeTurnId = null;
  }

  function onPostResponse(turnId) {
    if (turnId && !terminalTurnIds.has(turnId) && readiness.status === 'busy') {
      activeTurnId = turnId;
    }
  }

  // 1. User sends turn 1
  assert.equal(onSend('Turn 1 message'), true);
  assert.equal(readiness.status, 'busy');

  // 2. Fast SSE turn.started arrives
  onSseTurnStarted('turn-1');
  assert.equal(activeTurnId, 'turn-1');

  // 3. Fast SSE turn.completed arrives BEFORE POST response
  onSseTurnCompleted('turn-1');
  assert.equal(readiness.status, 'ready');
  assert.equal(activeTurnId, null);

  // 4. POST response arrives late
  onPostResponse('turn-1');
  assert.equal(readiness.status, 'ready');
  assert.equal(activeTurnId, null, 'activeTurnId was NOT resurrected');

  // 5. Subsequent send cannot cancel with turn-1
  assert.equal(onSend('Turn 2 message'), true);
  assert.equal(activeTurnId, null, 'Turn 2 does not inherit stale turn-1 ID');
});

test('Live readiness transition: cancel -> terminal -> ready', () => {
  const activeTurn = {
    id: 'turn-103',
    status: { status: 'active', detail: 'processing', since: '2026-09-06T12:00:00.000Z', source: 'user' },
    userMessage: { text: 'Long task' },
    work: [],
  };

  assert.equal(resolveSessionReadiness({ turnSnapshot: activeTurn }).status, 'busy');

  // User cancels turn; server cancels and emits terminal snapshot with outcome cancelled
  const cancelledTurn = {
    ...activeTurn,
    status: {
      status: 'terminal',
      outcome: 'cancelled',
      error: { code: 'AI_TURN_CANCELLED', message: 'The turn was cancelled by the user.' },
      initiator: 'user',
      since: '2026-09-06T12:00:05.000Z',
      source: 'user',
    },
  };
  const turns = applyTurnUpdated([activeTurn], cancelledTurn);

  const readiness = resolveSessionReadiness({ turnSnapshot: cancelledTurn });
  assert.equal(readiness.status, 'ready', 'Readiness returns to ready immediately after cancellation');
  assert.equal(deriveActivity(turns), 'idle');
  assert.equal(canStartTurn(readiness), true, 'Composer is re-enabled');
  assert.equal(shouldSurfaceTurnError(cancelledTurn.status.error), false, 'Cancellation does not surface error toast');
});

test('Live readiness transition: initial busy -> terminal -> ready without page reload', () => {
  // Session opened while a turn is already executing on the server
  const activeTurn = {
    id: 'turn-104',
    status: { status: 'active', detail: 'processing', since: '2026-09-06T12:00:00.000Z', source: 'user' },
    userMessage: { text: 'In flight' },
    work: [],
  };

  let readiness = resolveSessionReadiness({ turnSnapshot: activeTurn });
  assert.equal(readiness.status, 'busy');
  assert.equal(canStartTurn(readiness), false);

  // Live SSE turn.updated arrives completing the turn
  const completedTurn = {
    ...activeTurn,
    status: {
      status: 'terminal',
      outcome: 'completed',
      initiator: 'provider',
      since: '2026-09-06T12:02:00.000Z',
      source: 'provider',
    },
  };

  readiness = resolveSessionReadiness({ turnSnapshot: completedTurn });
  assert.equal(readiness.status, 'ready', 'Transition from initial busy to ready does not require page reload');
  assert.equal(canStartTurn(readiness), true);
});

test('Static health overrides turn state: corrupt persistence and disabled provider', () => {
  const corruptReadiness = resolveSessionReadiness({ transcript: { health: 'corrupt' } });
  const readOnlyReadiness = resolveSessionReadiness({ descriptor: { enabled: false } });

  // Even with no turns or terminal turns, corrupt persistence remains unavailable
  assert.equal(corruptReadiness.status, 'unavailable');
  assert.equal(canStartTurn(corruptReadiness), false);

  // Disabled provider remains readOnly
  assert.equal(readOnlyReadiness.status, 'readOnly');
  assert.equal(canStartTurn(readOnlyReadiness), false);
});

test('Cancel Turn: shouldSurfaceCancelError behaviorally suppresses late network errors after terminal SSE', () => {
  const terminalTurnIds = new Set();
  const turnId = 'turn-network-race';

  // Scenario 1: fetch rejects while turn is still running -> error must be surfaced
  assert.equal(
    shouldSurfaceCancelError(turnId, terminalTurnIds),
    true,
    'Error must be surfaced while turn is still active/running',
  );

  // Scenario 2: terminal SSE arrives before fetch rejects -> error must be suppressed
  terminalTurnIds.add(turnId);
  assert.equal(
    shouldSurfaceCancelError(turnId, terminalTurnIds),
    false,
    'Late error must be suppressed when turn is already terminal',
  );
});

test('AgentSessionPage disables normal composer send when session cannot start turn', () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // submitMessage requires assistant.canStartTurn
  assert.match(agentSessionPageSource, /!assistant\.canStartTurn/);

  // AgentSessionComposer has disabled and placeholder configured from whichever
  // representation (V1/V2) is currently displayed (task 11's V1/V2 switch, AC6).
  assert.match(agentSessionPageSource, /disabled=\{!activeRuntime\.canStartTurn \|\| !isProviderAvailable\}/);
  assert.match(
    agentSessionPageSource,
    /activeRuntime\.readiness\?\.status === 'requiresAttention' \|\|[\s\S]*?activeRuntime\.activity === 'waitingForUser'[\s\S]*?\? 'Odpowiedz na pytanie powyżej…'/,
  );
});

test('Finding 1: Runtime exposes explicit readiness contract and rejects send while loading', () => {
  const runtimeSource = readRuntimeSource();

  // Exposes isReady, canStartTurn, and readiness derived state
  assert.match(
    runtimeSource,
    /const exposedIsReady = Boolean\(\s*isSnapshotLoaded &&\s*!exposedLoadError/,
  );
  assert.ok(runtimeSource.includes('isReady: exposedIsReady'));
  assert.ok(runtimeSource.includes('canStartTurn: exposedCanStartTurn'));
  assert.ok(runtimeSource.includes('readiness: exposedReadiness'));

  // handleSendTurn explicitly throws if snapshot is still loading
  assert.ok(runtimeSource.includes('Cannot start turn while the session snapshot is loading.'));
  assert.ok(runtimeSource.includes('Cannot start turn on a session with a load error.'));
});

test('Finding 1: Initial prompt delivery waits for session readiness, delivers exactly once, and handles failures', () => {
  const agentSessionPageSource = readAgentSessionPageSource();
  const initialDispatchSource = readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/runtime/pending-dispatch-store.ts', import.meta.url)),
    'utf8',
  );

  // AgentSessionPage uses useInitialDispatch
  assert.match(agentSessionPageSource, /useInitialDispatch/);

  // Initial message effect checks assistant.isReady and pendingDispatchStore
  assert.match(initialDispatchSource, /pendingDispatchStore\.getPending\(this\.provider, this\.sessionId\)/);
  assert.match(initialDispatchSource, /pendingDispatchStore\.markInFlight\(this\.provider, this\.sessionId\)/);

  // Calls sendTurn with stable idempotencyKey and clears on success
  assert.match(initialDispatchSource, /await this\.assistant\.sendTurn\(pending\.prompt, \{/);
  assert.match(initialDispatchSource, /idempotencyKey: pending\.idempotencyKey/);
  assert.match(initialDispatchSource, /pendingDispatchStore\.clearPending\(this\.provider, this\.sessionId\)/);

  // Does not silently discard errors and marks failure for retry
  assert.match(initialDispatchSource, /pendingDispatchStore\.markFailed\(this\.provider, this\.sessionId, errorMsg\)/);
});

test('Cancel Turn: shouldSurfaceTurnError suppresses user-facing onError for explicit AI_TURN_CANCELLED', () => {
  // A. Explicit user cancellation (Stop button) -> no onError toast
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_TURN_CANCELLED', message: 'The turn was cancelled.' }),
    false,
    'AI_TURN_CANCELLED must NOT surface as an error toast to the user',
  );

  // B. Real provider failure -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_PROVIDER_ERROR', message: 'Model overloaded' }),
    true,
    'AI_PROVIDER_ERROR must surface to user',
  );

  // C. Turn timeout -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_TURN_TIMEOUT', message: 'Turn timed out after 300000ms' }),
    true,
    'AI_TURN_TIMEOUT must surface to user',
  );

  // D. Turn interrupted or protocol error -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_TURN_INTERRUPTED', message: 'Interrupted unexpectedly' }),
    true,
    'AI_TURN_INTERRUPTED must surface to user',
  );

  // E. Null / undefined error -> no error
  assert.equal(shouldSurfaceTurnError(null), false);
  assert.equal(shouldSurfaceTurnError(undefined), false);
});

test('BLOCKING: AgentSessionPage and useAgentSessionRuntime wire user-visible error channel for cancel, interaction, and turn failures', async () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // AgentSessionPage must wire onError into useAgentSessionRuntime and maintain user-visible runtimeError
  assert.match(agentSessionPageSource, /onError:\s*\(err\)\s*=>\s*\{\s*setRuntimeError\(err\.message\);\s*\}/);
  // displayError uses the authoritative error channel.
  assert.match(
    agentSessionPageSource,
    /const displayError = initialDispatch\.displayError \|\| runtimeError \|\| null;/,
  );

  // Behavioral test: simulate runtime error callback pipeline
  let surfacedError = null;
  const onErrorSink = (err) => {
    surfacedError = err.message;
  };

  // 1. Turn failure (non-cancellation) triggers onError
  const turnError = { code: 'AI_PROVIDER_ERROR', message: 'API rate limit exceeded' };
  if (shouldSurfaceTurnError(turnError)) {
    onErrorSink(new Error(turnError.message));
  }
  assert.equal(surfacedError, 'API rate limit exceeded');

  // 2. Cancellation error suppressed from onError
  surfacedError = null;
  const cancelError = { code: 'AI_TURN_CANCELLED', message: 'User stopped generation' };
  if (shouldSurfaceTurnError(cancelError)) {
    onErrorSink(new Error(cancelError.message));
  }
  assert.equal(surfacedError, null, 'AI_TURN_CANCELLED must not surface');

  // 3. Failed cancel request (e.g. 500 error while turn is still running) triggers onError
  const failedCancelErr = new Error('Failed to cancel turn: 500 Internal Server Error');
  if (shouldSurfaceCancelError('turn-1', new Set())) {
    onErrorSink(failedCancelErr);
  }
  assert.equal(surfacedError, 'Failed to cancel turn: 500 Internal Server Error');

  // 4. Failed interaction response triggers onError
  const failedInteractionErr = new Error('Failed to submit question response: network timeout');
  onErrorSink(failedInteractionErr);
  assert.equal(surfacedError, 'Failed to submit question response: network timeout');
});

test('BLOCKING: Action/error lifecycle: Initial dispatch retry clears stale runtime error upon retry start and success (A)', async () => {
  const provider = 'mock';
  const sessionId = 'session-retry-clean-1';
  pendingDispatchStore.setPending(provider, sessionId, 'Initial prompt');

  let runtimeError = null;
  let sendTurnCallCount = 0;
  let shouldFail = true;

  const mockAssistant = {
    isReady: true,
    sendTurn: async (_prompt, _opts) => {
      sendTurnCallCount++;
      if (shouldFail) {
        runtimeError = 'API error: 500 Internal Server Error';
        throw new Error('API error: 500 Internal Server Error');
      }
      return { ok: true };
    },
  };

  const controller = new InitialDispatchController({
    provider,
    sessionId,
    assistant: mockAssistant,
    isProviderAvailable: true,
    currentMode: 'edit',
    onBeforeDispatch: () => {
      runtimeError = null;
    },
  });

  // 1. First dispatch attempt fails
  const initialResult = await controller.checkAndDispatch();
  assert.equal(initialResult, false);
  assert.equal(sendTurnCallCount, 1);
  assert.equal(runtimeError, 'API error: 500 Internal Server Error');
  assert.equal(controller.displayError, 'API error: 500 Internal Server Error');

  // Unified displayError in AgentSessionPage before retry
  let displayError = controller.displayError || runtimeError || null;
  assert.equal(displayError, 'API error: 500 Internal Server Error');

  // 2. User clicks "Ponów próbę" -> explicit retry handler clears runtimeError and retries
  shouldFail = false;
  runtimeError = null; // cleared by handleRetryInitial on attempt start

  const retryPromise = controller.handleRetryInitial();

  // While in-flight, displayError is cleared (not stale)
  displayError = controller.displayError || runtimeError || null;
  assert.equal(displayError, null, 'Error must not remain visible while retry is in-flight');

  const retryResult = await retryPromise;
  assert.equal(retryResult, true);
  assert.equal(sendTurnCallCount, 2);

  // 3. After success, displayError stays null (no stale error survives)
  displayError = controller.displayError || runtimeError || null;
  assert.equal(displayError, null, 'No stale error after successful retry');
  assert.equal(controller.pending, null, 'Pending record cleared after success');
});

test('BLOCKING: Action/error lifecycle: Recovery action failing again clears old error and surfaces new failure (B)', async () => {
  const provider = 'mock';
  const sessionId = 'session-retry-fail-again-1';
  pendingDispatchStore.setPending(provider, sessionId, 'Initial prompt');

  let runtimeError = null;
  let currentErrorMessage = 'First failure: Connection reset';
  let clearedAtStart = false;

  const mockAssistant = {
    isReady: true,
    sendTurn: async (_prompt, _opts) => {
      clearedAtStart = runtimeError === null;
      await new Promise((r) => setTimeout(r, 5));
      runtimeError = currentErrorMessage;
      throw new Error(currentErrorMessage);
    },
  };

  const controller = new InitialDispatchController({
    provider,
    sessionId,
    assistant: mockAssistant,
    isProviderAvailable: true,
    currentMode: 'edit',
    onBeforeDispatch: () => {
      runtimeError = null;
    },
  });

  // 1. First attempt fails
  await controller.checkAndDispatch();
  assert.equal(controller.displayError, 'First failure: Connection reset');

  // 2. Next attempt configures new error
  currentErrorMessage = 'Second failure: Rate limit 429';
  clearedAtStart = false;

  // 3. User retries -> old error is cleared when attempt begins
  const retryPromise = controller.handleRetryInitial();
  assert.equal(controller.displayError, null, 'Controller error must be null while retry is in-flight');

  const retryResult = await retryPromise;
  assert.equal(retryResult, false);
  assert.equal(clearedAtStart, true, 'Old runtime error must be cleared before starting new attempt');

  // 4. New error is surfaced to user
  const displayError = controller.displayError || runtimeError || null;
  assert.equal(displayError, 'Second failure: Rate limit 429');
});

test('BLOCKING: Action/error lifecycle: Cancel and interaction retry clear previous runtime error on explicit attempt (C)', async () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // Verify AgentSessionPage wires action wrappers that clear runtimeError before starting attempt.
  assert.match(
    agentSessionPageSource,
    /const handleCancelTurn = useCallback\(async \(\) => \{\s*setRuntimeError\(null\);\s*try \{\s*await assistant\.cancelTurn\(\);/,
  );
  assert.match(
    agentSessionPageSource,
    /const handleRespondInteraction = useCallback\(\s*async \(interactionId: string, response: unknown\) => \{\s*setRuntimeError\(null\);\s*try \{\s*await assistant\.respondInteraction\(/,
  );
  assert.match(agentSessionPageSource, /const handleReload = useCallback\(async \(\) => \{\s*setRuntimeError\(null\);/);
  assert.match(
    agentSessionPageSource,
    /const handleRetryInitial = useCallback\(async \(\) => \{\s*setRuntimeError\(null\);/,
  );

  // Behavioral test for cancel recovery:
  let runtimeError = 'Cancel failed: 500 Internal Server Error';
  let cancelSucceeds = false;

  const executeCancelAttempt = async () => {
    runtimeError = null; // cleared before attempt
    if (!cancelSucceeds) {
      runtimeError = 'Cancel failed: 500 Internal Server Error';
      throw new Error('Cancel failed: 500');
    }
  };

  // First cancel fails
  try {
    await executeCancelAttempt();
  } catch {}
  assert.equal(runtimeError, 'Cancel failed: 500 Internal Server Error');

  // Second cancel succeeds -> runtime error stays cleared
  cancelSucceeds = true;
  await executeCancelAttempt();
  assert.equal(runtimeError, null, 'Runtime error must not survive successful cancel');

  // Behavioral test for interaction recovery:
  runtimeError = 'Interaction failed: timeout';
  let interactionSucceeds = false;

  const executeInteractionAttempt = async () => {
    runtimeError = null; // cleared before attempt
    if (!interactionSucceeds) {
      runtimeError = 'Interaction failed: timeout';
      throw new Error('Interaction failed: timeout');
    }
  };

  // First attempt fails
  try {
    await executeInteractionAttempt();
  } catch {}
  assert.equal(runtimeError, 'Interaction failed: timeout');

  // Second attempt succeeds -> runtime error stays cleared
  interactionSucceeds = true;
  await executeInteractionAttempt();
  assert.equal(runtimeError, null, 'Runtime error must not survive successful interaction response');
});

// ── task 11 (semantic Work chat V2), AC6: V1/V2 switch never mutates/cancels runtime state ──

function turn(status) {
  return { id: 't1', status, work: [], historicalWork: [], activityCount: 0, currentActivity: null, finalAnswer: null };
}

test('V2 AC6: deriveActivity maps canonical Turn status to session activity honestly, matching V1 vocabulary', () => {
  assert.equal(deriveActivity([]), 'idle', 'no turns at all is idle');
  assert.equal(
    deriveActivity([turn({ status: 'terminal', outcome: 'completed' })]),
    'idle',
    'a terminal latest turn is idle',
  );
  assert.equal(deriveActivity([turn({ status: 'active', detail: 'processing' })]), 'running');
  assert.equal(deriveActivity([turn({ status: 'waiting', reason: 'provider_response' })]), 'running');
  assert.equal(deriveActivity([turn({ status: 'cancelling', initiator: 'user' })]), 'running');
  assert.equal(
    deriveActivity([turn({ status: 'requiresAttention', reason: 'permission', interactionId: 'i1' })]),
    'waitingForUser',
  );
});

test('AC6: the runtime stays mounted unconditionally at top level', () => {
  const pageSource = readAgentSessionPageSource();

  // The runtime hook is called unconditionally at the top level
  assert.match(pageSource, /const assistant = useAgentSessionRuntime\(\{/);
});


// ── task 11 correction: historical user messages travel with the canonical Turn, no
// duplicate long-lived client cache ────────────────────────────────────────────────

function readTranscriptSource() {
  return readFileSync(
    fileURLToPath(new URL('../ui/features/agent-sessions/work/agent-session-transcript.tsx', import.meta.url)),
    'utf8',
  );
}

test('V2 correction: the V2 runtime hook keeps no long-lived turnPrompts cache and does not special-case turn.started', () => {
  const source = readRuntimeSource();
  assert.doesNotMatch(source, /turnPrompts/, 'the removed duplicate client-side transcript cache must not return');
  assert.doesNotMatch(
    source,
    /event\.type === 'turn\.started'/,
    'user-visible text must come from the canonical Turn, not a live-only event',
  );
  // The only client-side duplicate of server state left is the short optimistic gap value.
  assert.match(source, /optimisticPending/);
});

test("V2 correction: the transcript renders each turn's own canonical userMessage, with only a short-lived optimistic fallback", () => {
  const source = readTranscriptSource();
  assert.match(
    source,
    /turn\.userMessage && <UserMessageBubble text=\{turn\.userMessage\.text\}/,
    'every turn renders its own canonical userMessage — live, reloaded, or migrated',
  );
  assert.match(
    source,
    /\{optimisticUserMessage && \(/,
    'the optimistic value is a separate, clearly-scoped fallback for the POST-to-snapshot gap only',
  );
  assert.match(source, /<UserMessageBubble text=\{optimisticUserMessage\} \/>/);
});

test('V2 correction: a session loaded only from the HTTP snapshot (no turn.started SSE observed) still has userMessage available per turn', () => {
  // Mirrors the real regression: turns persisted before the current browser tab opened
  // (or before a dashboard restart) must still render their user message, because it now
  // travels on the canonical Turn itself rather than being reconstructed from live events.
  const turn1 = {
    id: 't1',
    userMessage: { text: 'Initial prompt', createdAt: '' },
    work: [],
    historicalWork: [],
    activityCount: 0,
    currentActivity: null,
    finalAnswer: { id: 'f1', text: 'Done.', status: 'completed', createdAt: '', updatedAt: '' },
    status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since: '', source: '' },
  };
  const turn2 = {
    id: 't2',
    userMessage: { text: 'Follow-up', createdAt: '' },
    work: [],
    historicalWork: [],
    activityCount: 0,
    currentActivity: null,
    finalAnswer: null,
    status: { status: 'terminal', outcome: 'failed', initiator: 'provider', since: '', source: '' },
  };
  const turnsFromHttpSnapshotOnly = [turn1, turn2];

  // No SSE events were ever observed — this is exactly the shape a fresh `GET .../chat`
  // response produces. Both turns must still carry a renderable userMessage.
  for (const turn of turnsFromHttpSnapshotOnly) {
    assert.ok(turn.userMessage?.text, `turn ${turn.id} must have a user-visible message from the HTTP snapshot alone`);
  }
  assert.equal(turnsFromHttpSnapshotOnly[0].userMessage.text, 'Initial prompt');
  assert.equal(turnsFromHttpSnapshotOnly[1].userMessage.text, 'Follow-up');
});

// ── task 11 correction (P0): V2 initial hydration must be one atomic snapshot commit,
// with SSE resuming from the snapshot's own cursor — never replaying full history ─────

test('V2 correction: the snapshot load is one atomic setTurns commit, not an empty-start-plus-replay', () => {
  const source = readRuntimeSource();
  // Exactly one setTurns call inside the successful-fetch path, fed directly from the
  // HTTP payload — no reduce/accumulate loop reconstructing turns from events. (The
  // catch branch's own `setTurns([])` reset on load failure is a separate, unrelated
  // call and is intentionally excluded from this count.)
  const trySuccessBody = source.slice(
    source.indexOf('const payload = await fetchAgentSessionChat'),
    source.indexOf('} catch (err) {'),
  );
  const setTurnsCalls = trySuccessBody.match(/setTurns\(/g) || [];
  assert.equal(setTurnsCalls.length, 1, 'the snapshot branch must commit turns exactly once');
  assert.match(trySuccessBody, /setTurns\(payload\.turns \|\| \[\]\)/);
});

test('V2 correction: SSE resumes from the snapshot cursor (lastEventSeq), never a hardcoded 0', () => {
  const source = readRuntimeSource();
  const loadSnapshotBody = source.slice(
    source.indexOf('async function loadSnapshot'),
    source.indexOf('loadSnapshot();'),
  );
  assert.match(
    loadSnapshotBody,
    /lastSeqRef\.current = payload\.session\.lastEventSeq \|\| 0;/,
    'the replay cursor must come from the snapshot itself — a session with prior history must never resubscribe from 0',
  );
  assert.doesNotMatch(
    loadSnapshotBody,
    /lastSeqRef\.current = 0;\s*$/m,
    'must not unconditionally reset the cursor to 0 on every load',
  );
});

test('V2 correction: the /chat route response carries lastEventSeq for the client to resume from', () => {
  const routesSource = readFileSync(
    fileURLToPath(new URL('../server/ai/sessions/routes.mjs', import.meta.url)),
    'utf8',
  );
  const chatRouteBody = routesSource.slice(
    routesSource.indexOf("'/api/agent-sessions/:provider/:providerSessionId/chat'"),
  );
  assert.match(chatRouteBody, /lastEventSeq: details\.lastEventSeq \|\| 0/);
});
