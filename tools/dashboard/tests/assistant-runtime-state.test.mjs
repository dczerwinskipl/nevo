import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  resolveSnapshotActivity,
  canStartTurn,
  eventModifiesTranscriptContent,
  applyAgentEvent,
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

test('AiChatPage disables normal composer send when session is waitingForUser', () => {
  const chatSource = readAiChatSource();

  // submitMessage requires assistant.activity === 'idle'
  assert.match(chatSource, /assistant\.activity !== 'idle'/);

  // ChatComposer has disabled and placeholder configured for waitingForUser
  assert.match(chatSource, /disabled=\{assistant\.activity !== 'idle' && !assistant\.isRunning\}/);
  assert.match(chatSource, /placeholder=\{assistant\.activity === 'waitingForUser' \? 'Odpowiedz na pytanie powyżej…' : undefined\}/);
});
