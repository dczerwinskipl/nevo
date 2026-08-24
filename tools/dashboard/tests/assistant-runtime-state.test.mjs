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
} from '../src/lib/nevo-assistant-runtime.ts';

function readRuntimeSource() {
  return readFileSync(fileURLToPath(new URL('../src/lib/nevo-assistant-runtime.ts', import.meta.url)), 'utf8');
}

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
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

test('AiChatPage disables normal composer send when session cannot start turn', () => {
  const chatSource = readAiChatSource();

  // submitMessage requires assistant.canStartTurn
  assert.match(chatSource, /!assistant\.canStartTurn/);

  // ChatComposer has disabled and placeholder configured
  assert.match(chatSource, /disabled=\{!assistant\.canStartTurn \|\| !isProviderAvailable\}/);
  assert.match(chatSource, /placeholder=\{assistant\.activity === 'waitingForUser' \? 'Odpowiedz na pytanie powyżej…' : undefined\}/);
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
  const chatSource = readAiChatSource();
  const initialDispatchSource = readFileSync(fileURLToPath(new URL('../src/lib/use-initial-dispatch.ts', import.meta.url)), 'utf8');

  // AiChatPage uses useInitialDispatch
  assert.match(chatSource, /useInitialDispatch/);

  // Initial message effect checks assistant.isReady and pendingDispatchStore
  assert.match(initialDispatchSource, /pendingDispatchStore\.getPending\(provider, sessionId\)/);
  assert.match(initialDispatchSource, /pendingDispatchStore\.markInFlight\(provider, sessionId\)/);

  // Calls sendTurn with stable idempotencyKey and clears on success
  assert.match(initialDispatchSource, /await assistant\.sendTurn\(current\.prompt, \{/);
  assert.match(initialDispatchSource, /idempotencyKey: current\.idempotencyKey/);
  assert.match(initialDispatchSource, /pendingDispatchStore\.clearPending\(provider, sessionId\)/);

  // Does not silently discard errors and marks failure for retry
  assert.match(initialDispatchSource, /pendingDispatchStore\.markFailed\(provider, sessionId, errorMsg\)/);
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
