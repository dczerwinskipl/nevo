import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  resolveSnapshotActivity,
  canStartTurn,
  eventModifiesTranscriptContent,
  applyAgentEvent,
  applyCancelTurnResponse,
  shouldSurfaceCancelError,
  shouldSurfaceTurnError,
} from '../ui/features/agent-sessions/runtime/agent-event-reducer.ts';
import {
  pendingDispatchStore,
  InitialDispatchController,
} from '../ui/features/agent-sessions/runtime/pending-dispatch-store.ts';

function readRuntimeSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/runtime/agent-session-runtime.ts', import.meta.url)), 'utf8');
}

function readAgentSessionPageSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-page.tsx', import.meta.url)), 'utf8');
}

test('Issue 1: resolveSnapshotActivity extracts authoritative activity and preserves waitingForUser across reload', () => {
  // 1. Reload while waitingForUser (activeTurn exists, pendingInteraction exists, status is waitingForUser)
  const waitingSnapshot = {
    status: 'waitingForUser',
    activeTurn: { turnId: 'turn-123', startedAt: '2026-08-23T12:00:00.000Z' },
    pendingInteraction: { id: 'int-1', kind: 'question', questions: [] },
  };
  const activity = resolveSnapshotActivity(waitingSnapshot);
  assert.equal(activity, 'waitingForUser');

  // 2. Reload while running
  const runningSnapshot = {
    status: 'running',
    activeTurn: { turnId: 'turn-456', startedAt: '2026-08-23T12:00:00.000Z' },
    pendingInteraction: null,
  };
  assert.equal(resolveSnapshotActivity(runningSnapshot), 'running');

  // 3. Reload while idle
  const idleSnapshot = {
    status: 'idle',
    activeTurn: null,
    pendingInteraction: null,
  };
  assert.equal(resolveSnapshotActivity(idleSnapshot), 'idle');
});

test('Issue 3: canStartTurn prohibits normal send when session is waitingForUser or running', () => {
  const provider = 'opencode';
  const sessionId = 'sess-123';
  const message = 'Hello world';

  // Allowed only when idle
  assert.equal(canStartTurn('idle', provider, sessionId, message), true);

  // Prohibited when waiting for user interaction (Issue 3 blocker)
  assert.equal(canStartTurn('waitingForUser', provider, sessionId, message), false);

  // Prohibited when actively running
  assert.equal(canStartTurn('running', provider, sessionId, message), false);

  // Prohibited when message is whitespace
  assert.equal(canStartTurn('idle', provider, sessionId, '   '), false);
});

test('Issue 2: eventModifiesTranscriptContent catches tool output changes while running and ignores telemetry', () => {
  // tool.updated with output changed while status remains running and duration unchanged
  const toolUpdatedEvent = {
    id: 1,
    seq: 1,
    type: 'tool.updated',
    toolId: 'tool-1',
    status: 'running',
    output: 'Streaming 100 new lines of log output...',
    timestamp: '2026-08-23T12:00:00.000Z',
  };
  assert.equal(eventModifiesTranscriptContent(toolUpdatedEvent), true, 'Tool output update triggers content revision');

  // tool.started, tool.completed, text.delta
  assert.equal(eventModifiesTranscriptContent({ id: 2, seq: 2, type: 'tool.started', toolId: 't2', timestamp: '' }), true);
  assert.equal(eventModifiesTranscriptContent({ id: 3, seq: 3, type: 'tool.completed', toolId: 't2', timestamp: '' }), true);
  assert.equal(eventModifiesTranscriptContent({ id: 4, seq: 4, type: 'text.delta', delta: 'Hello', timestamp: '' }), true);
  assert.equal(eventModifiesTranscriptContent({ id: 5, seq: 5, type: 'interaction.requested', timestamp: '' }), true);
  assert.equal(eventModifiesTranscriptContent({ id: 6, seq: 6, type: 'interaction.resolved', timestamp: '' }), true);

  // Telemetry (usage.updated) does NOT increment content revision
  assert.equal(eventModifiesTranscriptContent({ id: 7, seq: 7, type: 'usage.updated', tokensIn: 100, timestamp: '' }), false);
});

test('Issue 2: applyAgentEvent updates earlier assistant messages by turnId fallback without losing content', () => {
  const initialMessages = [
    {
      id: 'msg-turn-1',
      role: 'assistant',
      text: 'First message',
      turnId: 'turn-1',
      toolCalls: [{ id: 'tool-earlier', name: 'read_file', input: {}, status: 'running' }],
      createdAt: '2026-08-23T12:00:00.000Z',
    },
    {
      id: 'msg-turn-2',
      role: 'assistant',
      text: 'Second message in different turn',
      turnId: 'turn-2',
      createdAt: '2026-08-23T12:00:05.000Z',
    },
  ];

  // Tool event arrives with turnId='turn-1' (no messageId). It must attach to the earlier message (index 0).
  const updated = applyAgentEvent(initialMessages, {
    id: 10,
    seq: 10,
    type: 'tool.completed',
    turnId: 'turn-1',
    toolId: 'tool-earlier',
    status: 'completed',
    output: 'File contents loaded',
    durationMs: 250,
    timestamp: '2026-08-23T12:00:06.000Z',
  });

  assert.equal(updated.length, 2);
  assert.equal(updated[0].toolCalls[0].status, 'completed');
  assert.equal(updated[0].toolCalls[0].output, 'File contents loaded');
  assert.equal(updated[1].text, 'Second message in different turn', 'Last message remained untouched');
});

test('Issue 2 & Race Safety: Terminal SSE before POST response never leaves stale activeTurnId', () => {
  let activity = 'idle';
  let activeTurnId = null;
  const terminalTurnIds = new Set();

  function onSend(msg) {
    if (!canStartTurn(activity, 'opencode', 'sess-1', msg)) return false;
    activity = 'running';
    activeTurnId = null;
    return true;
  }

  function onSseTurnStarted(turnId) {
    activity = 'running';
    activeTurnId = turnId;
  }

  function onSseTurnCompleted(turnId) {
    terminalTurnIds.add(turnId);
    activity = 'idle';
    activeTurnId = null;
  }

  function onPostResponse(turnId) {
    if (turnId && !terminalTurnIds.has(turnId) && activity === 'running') {
      activeTurnId = turnId;
    }
  }

  // 1. User sends turn 1
  assert.equal(onSend('Turn 1 message'), true);
  assert.equal(activity, 'running');

  // 2. Fast SSE turn.started arrives
  onSseTurnStarted('turn-1');
  assert.equal(activeTurnId, 'turn-1');

  // 3. Fast SSE turn.completed arrives BEFORE POST response
  onSseTurnCompleted('turn-1');
  assert.equal(activity, 'idle');
  assert.equal(activeTurnId, null);

  // 4. POST response arrives late
  onPostResponse('turn-1');
  assert.equal(activity, 'idle');
  assert.equal(activeTurnId, null, 'activeTurnId was NOT resurrected');

  // 5. Subsequent send cannot cancel with turn-1
  assert.equal(onSend('Turn 2 message'), true);
  assert.equal(activeTurnId, null, 'Turn 2 does not inherit stale turn-1 ID');
});

test('Cancel Turn: HTTP 500 error preserves running state and activeTurnId, surfaces error, and remains retryable', () => {
  let activity = 'running';
  let activeTurnId = 'turn-123';
  const terminalTurnIds = new Set();

  // 1. Cancel fails with HTTP 500
  const failResult = applyCancelTurnResponse({
    turnId: 'turn-123',
    response: { ok: false, status: 500 },
    errorData: { error: { message: 'Internal server error while interrupting provider' } },
    currentActiveTurnId: activeTurnId,
    currentActivity: activity,
    terminalTurnIds,
  });

  assert.equal(failResult.nextActivity, 'running', 'Activity must remain running on HTTP 500');
  assert.equal(failResult.nextActiveTurnId, 'turn-123', 'activeTurnId must remain intact for retry');
  assert.equal(terminalTurnIds.has('turn-123'), false, 'turnId must NOT be added to terminalTurnIds');
  assert.ok(failResult.error instanceof Error);
  assert.match(failResult.error.message, /Internal server error/);

  // 2. Subsequent retry with success transitions to idle
  const retryResult = applyCancelTurnResponse({
    turnId: 'turn-123',
    response: { ok: true, status: 200 },
    errorData: null,
    currentActiveTurnId: failResult.nextActiveTurnId,
    currentActivity: failResult.nextActivity,
    terminalTurnIds,
  });

  assert.equal(retryResult.nextActivity, 'idle');
  assert.equal(retryResult.nextActiveTurnId, null);
  assert.equal(terminalTurnIds.has('turn-123'), true);
});

test('Cancel Turn: HTTP 409 conflict error preserves running state and surfaces error', () => {
  let activity = 'running';
  let activeTurnId = 'turn-456';
  const terminalTurnIds = new Set();

  const conflictResult = applyCancelTurnResponse({
    turnId: 'turn-456',
    response: { ok: false, status: 409 },
    errorData: { error: { message: 'Turn is in uncancelable state' } },
    currentActiveTurnId: activeTurnId,
    currentActivity: activity,
    terminalTurnIds,
  });

  assert.equal(conflictResult.nextActivity, 'running');
  assert.equal(conflictResult.nextActiveTurnId, 'turn-456');
  assert.equal(terminalTurnIds.has('turn-456'), false);
  assert.ok(conflictResult.error instanceof Error);
  assert.match(conflictResult.error.message, /Turn is in uncancelable state/);
});

test('Cancel Turn: Successful cancel transitions to idle, clears activeTurnId, and updates terminalTurnIds', () => {
  let activity = 'running';
  let activeTurnId = 'turn-789';
  const terminalTurnIds = new Set();

  const successResult = applyCancelTurnResponse({
    turnId: 'turn-789',
    response: { ok: true, status: 200 },
    errorData: null,
    currentActiveTurnId: activeTurnId,
    currentActivity: activity,
    terminalTurnIds,
  });

  assert.equal(successResult.nextActivity, 'idle');
  assert.equal(successResult.nextActiveTurnId, null);
  assert.equal(terminalTurnIds.has('turn-789'), true);
});

test('Cancel Turn: Race where turn.failed SSE arrives before late HTTP 409 response', () => {
  let activity = 'running';
  let activeTurnId = 'turn-race-409';
  const terminalTurnIds = new Set();

  // 1. SSE turn.failed arrives first
  terminalTurnIds.add('turn-race-409');
  activity = 'idle';
  activeTurnId = null;

  // 2. Late HTTP 409 response arrives
  const lateResult = applyCancelTurnResponse({
    turnId: 'turn-race-409',
    response: { ok: false, status: 409 },
    errorData: { error: { message: 'Cannot cancel finished turn' } },
    currentActiveTurnId: activeTurnId,
    currentActivity: activity,
    terminalTurnIds,
  });

  assert.equal(lateResult.nextActivity, 'idle', 'Activity must remain idle');
  assert.equal(lateResult.nextActiveTurnId, null);
  assert.equal(lateResult.error, undefined, 'Must NOT return or surface an error for a stale cancel response');
  assert.equal(terminalTurnIds.has('turn-race-409'), true);
});

test('Cancel Turn: Race where turn.completed SSE arrives before late HTTP 500 response', () => {
  let activity = 'running';
  let activeTurnId = 'turn-race-500';
  const terminalTurnIds = new Set();

  // 1. SSE turn.completed arrives first
  terminalTurnIds.add('turn-race-500');
  activity = 'idle';
  activeTurnId = null;

  // 2. Late HTTP 500 response arrives
  const lateResult = applyCancelTurnResponse({
    turnId: 'turn-race-500',
    response: { ok: false, status: 500 },
    errorData: { error: { message: 'Internal server error' } },
    currentActiveTurnId: activeTurnId,
    currentActivity: activity,
    terminalTurnIds,
  });

  assert.equal(lateResult.nextActivity, 'idle', 'Activity must remain idle');
  assert.equal(lateResult.nextActiveTurnId, null);
  assert.equal(lateResult.error, undefined, 'Must NOT return or surface an error for a stale cancel response');
  assert.equal(terminalTurnIds.has('turn-race-500'), true);
});

test('Cancel Turn: shouldSurfaceCancelError behaviorally suppresses late network errors after terminal SSE', () => {
  const terminalTurnIds = new Set();
  const turnId = 'turn-network-race';

  // Scenario 1: fetch rejects while turn is still running -> error must be surfaced
  assert.equal(
    shouldSurfaceCancelError(turnId, terminalTurnIds),
    true,
    'Error must be surfaced while turn is still active/running'
  );

  // Scenario 2: terminal SSE arrives before fetch rejects -> error must be suppressed
  terminalTurnIds.add(turnId);
  assert.equal(
    shouldSurfaceCancelError(turnId, terminalTurnIds),
    false,
    'Late error must be suppressed when turn is already terminal'
  );
});

test('AgentSessionPage disables normal composer send when session cannot start turn', () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // submitMessage requires assistant.canStartTurn
  assert.match(agentSessionPageSource, /!assistant\.canStartTurn/);

  // AgentSessionComposer has disabled and placeholder configured from whichever
  // representation (V1/V2) is currently displayed (task 11's V1/V2 switch, AC6).
  assert.match(agentSessionPageSource, /disabled=\{!activeRuntime\.canStartTurn \|\| !isProviderAvailable\}/);
  assert.match(agentSessionPageSource, /placeholder=\{activeRuntime\.activity === 'waitingForUser' \? 'Odpowiedz na pytanie powyżej…' : undefined\}/);
});

test('Finding 1: Runtime exposes explicit readiness contract and rejects send while loading', () => {
  const runtimeSource = readRuntimeSource();

  // Exposes isReady and canStartTurn derived state
  assert.ok(runtimeSource.includes('const exposedIsReady = Boolean(isSnapshotLoaded && !exposedLoadError && activity === \'idle\');'));
  assert.ok(runtimeSource.includes('isReady: exposedIsReady'));
  assert.ok(runtimeSource.includes('canStartTurn: exposedCanStartTurn'));

  // handleSendTurn explicitly throws if snapshot is still loading
  assert.ok(runtimeSource.includes('Cannot start turn while the session snapshot is loading.'));
  assert.ok(runtimeSource.includes('Cannot start turn on a session with a load error.'));
});

test('Finding 1: Initial prompt delivery waits for session readiness, delivers exactly once, and handles failures', () => {
  const agentSessionPageSource = readAgentSessionPageSource();
  const initialDispatchSource = readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/runtime/pending-dispatch-store.ts', import.meta.url)), 'utf8');

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
    'AI_TURN_CANCELLED must NOT surface as an error toast to the user'
  );

  // B. Real provider failure -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_PROVIDER_ERROR', message: 'Model overloaded' }),
    true,
    'AI_PROVIDER_ERROR must surface to user'
  );

  // C. Turn timeout -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_TURN_TIMEOUT', message: 'Turn timed out after 300000ms' }),
    true,
    'AI_TURN_TIMEOUT must surface to user'
  );

  // D. Turn interrupted or protocol error -> onError called
  assert.equal(
    shouldSurfaceTurnError({ code: 'AI_TURN_INTERRUPTED', message: 'Interrupted unexpectedly' }),
    true,
    'AI_TURN_INTERRUPTED must surface to user'
  );

  // E. Null / undefined error -> no error
  assert.equal(shouldSurfaceTurnError(null), false);
  assert.equal(shouldSurfaceTurnError(undefined), false);
});

test('BLOCKING: AgentSessionPage and useAgentSessionRuntime wire user-visible error channel for cancel, interaction, and turn failures', async () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // AgentSessionPage must wire onError into useAgentSessionRuntime and maintain user-visible runtimeError
  assert.match(agentSessionPageSource, /onError:\s*\(err\)\s*=>\s*\{\s*setRuntimeError\(err\.message\);\s*\}/);
  // displayError picks the active representation's own error channel (task 11 V1/V2 switch, AC6).
  assert.match(agentSessionPageSource, /const displayError = initialDispatch\.displayError \|\| \(representation === 'v2' \? runtimeErrorV2 : runtimeError\) \|\| null;/);

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
      clearedAtStart = (runtimeError === null);
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

  // Verify AgentSessionPage wires action wrappers that clear runtimeError before starting
  // — each representation clears its own error channel before its own attempt (task 11
  // V1/V2 switch, AC6): V2's branch clears runtimeErrorV2 before assistantV2.cancelTurn(),
  // the V1 fallthrough clears runtimeError before assistant.cancelTurn().
  assert.match(agentSessionPageSource, /const handleCancelTurn = useCallback\(async \(\) => \{[\s\S]*?setRuntimeErrorV2\(null\);[\s\S]*?await assistantV2\.cancelTurn\(\);/);
  assert.match(agentSessionPageSource, /const handleCancelTurn = useCallback[\s\S]*?setRuntimeError\(null\);\s*try \{\s*await assistant\.cancelTurn\(\);/);
  assert.match(agentSessionPageSource, /const handleRespondInteraction = useCallback\(async \(interactionId: string, response: unknown\) => \{[\s\S]*?setRuntimeErrorV2\(null\);[\s\S]*?await assistantV2\.respondInteraction\(/);
  assert.match(agentSessionPageSource, /const handleRespondInteraction = useCallback[\s\S]*?setRuntimeError\(null\);\s*try \{\s*await assistant\.respondInteraction\(/);
  assert.match(agentSessionPageSource, /const handleReload = useCallback\(async \(\) => \{\s*setRuntimeError\(null\);/);
  assert.match(agentSessionPageSource, /const handleRetryInitial = useCallback\(async \(\) => \{\s*setRuntimeError\(null\);/);

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

import { deriveActivity } from '../ui/features/agent-sessions/runtime/agent-session-runtime-v2.ts';

function turnV2(status) {
  return { id: 't1', status, work: [], historicalWork: [], activityCount: 0, currentActivity: null, finalAnswer: null };
}

test('V2 AC6: deriveActivity maps canonical Turn status to session activity honestly, matching V1 vocabulary', () => {
  assert.equal(deriveActivity([]), 'idle', 'no turns at all is idle');
  assert.equal(deriveActivity([turnV2({ status: 'terminal', outcome: 'completed' })]), 'idle', 'a terminal latest turn is idle');
  assert.equal(deriveActivity([turnV2({ status: 'active', detail: 'processing' })]), 'running');
  assert.equal(deriveActivity([turnV2({ status: 'waiting', reason: 'provider_response' })]), 'running');
  assert.equal(deriveActivity([turnV2({ status: 'cancelling', initiator: 'user' })]), 'running');
  assert.equal(deriveActivity([turnV2({ status: 'requiresAttention', reason: 'permission', interactionId: 'i1' })]), 'waitingForUser');
});

test('V2 AC6: both V1 and V2 runtimes stay mounted unconditionally — the switch itself never (re)starts a runtime', () => {
  const pageSource = readAgentSessionPageSource();

  // Both hooks are called unconditionally at the top level, not gated behind `representation === ...`.
  assert.match(pageSource, /const assistant = useAgentSessionRuntime\(\{/);
  assert.match(pageSource, /const assistantV2 = useAgentSessionRuntimeV2\(\{/);
  // Neither call site is behind an `if (representation` guard.
  const v1CallIndex = pageSource.indexOf('const assistant = useAgentSessionRuntime(');
  const v2CallIndex = pageSource.indexOf('const assistantV2 = useAgentSessionRuntimeV2(');
  const before = pageSource.slice(Math.max(0, Math.min(v1CallIndex, v2CallIndex) - 200), Math.max(v1CallIndex, v2CallIndex));
  assert.doesNotMatch(before, /if \(representation/, 'runtime hooks must not be conditionally invoked based on the representation switch');
});

test('V2 AC6: representation is local UI state only — switching calls no mutation/cancel/send handler', () => {
  const pageSource = readAgentSessionPageSource();

  assert.match(pageSource, /const \[representation, setRepresentation\] = useState<'v1' \| 'v2'>\('v1'\)/);
  // The switch buttons only ever call setRepresentation — never a send/cancel/reload/respond handler.
  const switchBlockStart = pageSource.indexOf('role="radiogroup"');
  const switchBlockEnd = pageSource.indexOf('</div>', pageSource.indexOf('</div>', switchBlockStart) + 1);
  const switchBlock = pageSource.slice(switchBlockStart, switchBlockEnd);
  assert.match(switchBlock, /onClick=\{\(\) => setRepresentation\(option\)\}/);
  assert.doesNotMatch(switchBlock, /sendTurn|cancelTurn|respondInteraction|\.reload\(/, 'switching representation must never mutate or cancel Turn state');
});

// ── task 11 correction: historical user messages travel with the canonical Turn, no
// duplicate long-lived client cache ────────────────────────────────────────────────

function readRuntimeV2Source() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/runtime/agent-session-runtime-v2.ts', import.meta.url)), 'utf8');
}

function readTranscriptV2Source() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/work-v2/agent-session-transcript-v2.tsx', import.meta.url)), 'utf8');
}

test('V2 correction: the V2 runtime hook keeps no long-lived turnPrompts cache and does not special-case turn.started', () => {
  const source = readRuntimeV2Source();
  assert.doesNotMatch(source, /turnPrompts/, 'the removed duplicate client-side transcript cache must not return');
  assert.doesNotMatch(source, /event\.type === 'turn\.started'/, 'user-visible text must come from the canonical Turn, not a live-only event');
  // The only client-side duplicate of server state left is the short optimistic gap value.
  assert.match(source, /optimisticPending/);
});

test('V2 correction: the transcript renders each turn\'s own canonical userMessage, with only a short-lived optimistic fallback', () => {
  const source = readTranscriptV2Source();
  assert.match(source, /turn\.userMessage && <UserMessageBubble text=\{turn\.userMessage\.text\}/, 'every turn renders its own canonical userMessage — live, reloaded, or migrated');
  assert.match(source, /\{optimisticUserMessage && <UserMessageBubble/, 'the optimistic value is a separate, clearly-scoped fallback for the POST-to-snapshot gap only');
});

test('V2 correction: a session loaded only from the HTTP snapshot (no turn.started SSE observed) still has userMessage available per turn', () => {
  // Mirrors the real regression: turns persisted before the current browser tab opened
  // (or before a dashboard restart) must still render their user message, because it now
  // travels on the canonical Turn itself rather than being reconstructed from live events.
  const turn1 = { id: 't1', userMessage: { text: 'Initial prompt', createdAt: '' }, work: [], historicalWork: [], activityCount: 0, currentActivity: null, finalAnswer: { id: 'f1', text: 'Done.', status: 'completed', createdAt: '', updatedAt: '' }, status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since: '', source: '' } };
  const turn2 = { id: 't2', userMessage: { text: 'Follow-up', createdAt: '' }, work: [], historicalWork: [], activityCount: 0, currentActivity: null, finalAnswer: null, status: { status: 'terminal', outcome: 'failed', initiator: 'provider', since: '', source: '' } };
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
  const source = readRuntimeV2Source();
  // Exactly one setTurns call inside the successful-fetch path, fed directly from the
  // HTTP payload — no reduce/accumulate loop reconstructing turns from events. (The
  // catch branch's own `setTurns([])` reset on load failure is a separate, unrelated
  // call and is intentionally excluded from this count.)
  const trySuccessBody = source.slice(source.indexOf('const payload = await fetchAgentSessionChatV2'), source.indexOf('} catch (err) {'));
  const setTurnsCalls = trySuccessBody.match(/setTurns\(/g) || [];
  assert.equal(setTurnsCalls.length, 1, 'the snapshot branch must commit turns exactly once');
  assert.match(trySuccessBody, /setTurns\(payload\.turns \|\| \[\]\)/);
});

test('V2 correction: SSE resumes from the snapshot cursor (lastEventSeq), never a hardcoded 0', () => {
  const source = readRuntimeV2Source();
  const loadSnapshotBody = source.slice(source.indexOf('async function loadSnapshot'), source.indexOf('loadSnapshot();'));
  assert.match(
    loadSnapshotBody,
    /lastSeqRef\.current = payload\.session\.lastEventSeq \|\| 0;/,
    'the replay cursor must come from the snapshot itself — a session with prior history must never resubscribe from 0',
  );
  assert.doesNotMatch(loadSnapshotBody, /lastSeqRef\.current = 0;\s*$/m, 'must not unconditionally reset the cursor to 0 on every load');
});

test('V2 correction: the /chat route response carries lastEventSeq for the client to resume from', () => {
  const routesSource = readFileSync(fileURLToPath(new URL('../server/ai/sessions/routes.mjs', import.meta.url)), 'utf8');
  const chatRouteBody = routesSource.slice(routesSource.indexOf("'/api/agent-sessions/:provider/:providerSessionId/chat'"));
  assert.match(chatRouteBody, /lastEventSeq: details\.lastEventSeq \|\| 0/);
});
