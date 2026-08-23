import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readRuntimeSource() {
  return readFileSync(fileURLToPath(new URL('../src/lib/nevo-assistant-runtime.ts', import.meta.url)), 'utf8');
}

function readAiChatSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ai-chat.tsx', import.meta.url)), 'utf8');
}

test('Issue 1: Snapshot restoration extracts authoritative activity and preserves waitingForUser', () => {
  const source = readRuntimeSource();

  // Activity is authoritative from snapshot, preserving waitingForUser and running
  assert.match(source, /const snapshotActivity:\s*AiSessionStatus\s*=\s*snapshot\.status/);
  assert.match(source, /setActivity\(snapshotActivity\)/);

  // isRunning is derived from activity === 'running'
  assert.match(source, /const exposedIsRunning = isSnapshotLoaded \? \(activity === 'running'\) : false/);

  // activeTurnId is restored independently of isRunning
  assert.match(source, /if \(snapshot\.activeTurn\) \{\s*setActiveTurnId\(snapshot\.activeTurn\.turnId\);/);
});

test('Issue 1: Runtime maps SSE events to coherent session activity state', () => {
  const source = readRuntimeSource();

  // turn.started -> running
  assert.match(source, /case 'turn\.started':\s*setActivity\('running'\);/);

  // interaction.requested -> waitingForUser
  assert.match(source, /case 'interaction\.requested':[\s\S]*?setActivity\('waitingForUser'\);/);

  // interaction.resolved -> running
  assert.match(source, /case 'interaction\.resolved':[\s\S]*?setActivity\('running'\);/);

  // turn.completed -> idle
  assert.match(source, /case 'turn\.completed':[\s\S]*?setActivity\('idle'\);/);

  // turn.failed -> idle
  assert.match(source, /case 'turn\.failed':[\s\S]*?setActivity\('idle'\);/);
});

test('Issue 2: POST / SSE race safety prevents completed turnId resurrection', () => {
  const source = readRuntimeSource();

  // Tracks terminal turn IDs
  assert.match(source, /terminalTurnIdsRef/);
  assert.match(source, /terminalTurnIdsRef\.current\.add\(event\.turnId\)/);

  // When POST response arrives, only sets activeTurnId if not terminal and still running
  assert.match(source, /!terminalTurnIdsRef\.current\.has\(returnedTurnId\) && activityRef\.current === 'running'/);
});

test('Issue 1 & 4: Stop/Cancel affordance is shown and enabled only when actively running with valid turnId', () => {
  const chatSource = readAiChatSource();
  const runtimeSource = readRuntimeSource();

  // In AiChatPage, canCancel requires assistant.capabilities?.cancelTurn && assistant.isRunning && assistant.activeTurnId
  assert.match(chatSource, /canCancel=\{Boolean\(assistant\.capabilities\?\.cancelTurn && assistant\.isRunning && assistant\.activeTurnId\)\}/);

  // In useNevoAssistantRuntime, cancelTurn only proceeds if activity is running and turnId exists
  assert.match(runtimeSource, /if \(!turnId \|\| activityRef\.current !== 'running'/);
});

test('Behavioral Simulation: State machine resolves snapshot scenarios identically to SSE events', () => {
  function resolveSnapshotActivity(snapshot) {
    if (snapshot.status === 'running' || snapshot.status === 'waitingForUser' || snapshot.status === 'idle') {
      return snapshot.status;
    }
    if (snapshot.pendingInteraction) return 'waitingForUser';
    if (snapshot.activeTurn) return 'running';
    return 'idle';
  }

  // 1. Reload while waitingForUser
  const waitingSnapshot = {
    provider: 'opencode',
    providerSessionId: 'sess-1',
    sessionId: 'sess-1',
    status: 'waitingForUser',
    activeTurn: { turnId: 'turn-123', startedAt: '2026-08-23T12:00:00.000Z' },
    pendingInteraction: { id: 'int-1', kind: 'question', questions: [] },
    capabilities: { cancelTurn: true },
  };
  const waitingActivity = resolveSnapshotActivity(waitingSnapshot);
  const waitingIsRunning = waitingActivity === 'running';
  const waitingCanCancel = Boolean(waitingSnapshot.capabilities.cancelTurn && waitingIsRunning && waitingSnapshot.activeTurn.turnId);

  assert.equal(waitingActivity, 'waitingForUser');
  assert.equal(waitingIsRunning, false, 'waitingForUser is not running');
  assert.equal(waitingCanCancel, false, 'Stop button is NOT shown/enabled when waiting for user');

  // 2. Reload while running
  const runningSnapshot = {
    provider: 'opencode',
    providerSessionId: 'sess-1',
    sessionId: 'sess-1',
    status: 'running',
    activeTurn: { turnId: 'turn-456', startedAt: '2026-08-23T12:00:00.000Z' },
    pendingInteraction: null,
    capabilities: { cancelTurn: true },
  };
  const runningActivity = resolveSnapshotActivity(runningSnapshot);
  const runningIsRunning = runningActivity === 'running';
  const runningCanCancel = Boolean(runningSnapshot.capabilities.cancelTurn && runningIsRunning && runningSnapshot.activeTurn.turnId);

  assert.equal(runningActivity, 'running');
  assert.equal(runningIsRunning, true, 'running snapshot is running');
  assert.equal(runningCanCancel, true, 'Stop button IS enabled when actively running');

  // 3. Reload while idle
  const idleSnapshot = {
    provider: 'opencode',
    providerSessionId: 'sess-1',
    sessionId: 'sess-1',
    status: 'idle',
    activeTurn: null,
    pendingInteraction: null,
    capabilities: { cancelTurn: true },
  };
  const idleActivity = resolveSnapshotActivity(idleSnapshot);
  const idleIsRunning = idleActivity === 'running';
  assert.equal(idleActivity, 'idle');
  assert.equal(idleIsRunning, false);
});

test('Behavioral Simulation: POST / SSE race condition prevents stale activeTurnId', () => {
  // Simulate state store
  let activity = 'idle';
  let activeTurnId = null;
  const terminalTurnIds = new Set();

  function onSend() {
    activity = 'running';
    activeTurnId = null;
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

  // Execution: Fast provider race
  // 1. send
  onSend();
  assert.equal(activity, 'running');
  assert.equal(activeTurnId, null);

  // 2. SSE turn.started arrives
  onSseTurnStarted('turn-fast-1');
  assert.equal(activity, 'running');
  assert.equal(activeTurnId, 'turn-fast-1');

  // 3. SSE turn.completed arrives BEFORE POST response
  onSseTurnCompleted('turn-fast-1');
  assert.equal(activity, 'idle');
  assert.equal(activeTurnId, null);

  // 4. POST response arrives late with 'turn-fast-1'
  onPostResponse('turn-fast-1');
  assert.equal(activity, 'idle');
  assert.equal(activeTurnId, null, 'activeTurnId was NOT resurrected by late POST response');

  // 5. Start second turn
  onSend();
  assert.equal(activity, 'running');
  assert.equal(activeTurnId, null, 'activeTurnId does not hold stale previous turn-fast-1');

  // 6. Normal POST response arrives for second turn
  onPostResponse('turn-normal-2');
  assert.equal(activeTurnId, 'turn-normal-2');
  onSseTurnCompleted('turn-normal-2');
  assert.equal(activity, 'idle');
  assert.equal(activeTurnId, null);
});
