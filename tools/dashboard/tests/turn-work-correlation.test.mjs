import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyAgentEvent } from '../ui/features/agent-sessions/runtime/agent-event-reducer.ts';
import { projectTranscript } from '../ui/features/agent-sessions/transcript/projection.ts';
import { visibleWorkItemsWhileRunning } from '../ui/features/agent-sessions/turn-work/turn-work-visibility.ts';
import { applyTurnUpdatedV2 } from '../ui/features/agent-sessions/runtime/agent-session-runtime-v2.ts';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';

// Required coverage E (follow-up review, Finding 4): a terminal event for one turn must
// never mutate a still-running tool belonging to a different turn.
test('E: turn A stays unchanged when turn B terminates (frontend reducer)', () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'tool.started', turnId: 'turn-A', toolId: 'a1', toolName: 'Bash', input: {} });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-B', toolId: 'b1', toolName: 'Read', input: {} });

  // Turn B terminates while turn A's tool is still running.
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'turn.completed', turnId: 'turn-B' });

  const turnAMessage = messages.find(m => m.turnId === 'turn-A');
  const turnBMessage = messages.find(m => m.turnId === 'turn-B');
  assert.equal(turnAMessage.toolCalls[0].status, 'running', "turn A's tool must remain running, untouched by turn B's terminal event");
  assert.equal(turnBMessage.toolCalls[0].status, 'failed', "turn B's own lingering tool still resolves to failed");
});

test('E: turn A stays unchanged when turn B fails (frontend reducer)', () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'tool.started', turnId: 'turn-A', toolId: 'a1', toolName: 'Bash', input: {} });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-B', toolId: 'b1', toolName: 'Read', input: {} });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'turn.failed', turnId: 'turn-B', error: { code: 'AI_PROVIDER_EXIT_ERROR', message: 'boom' } });

  const turnAMessage = messages.find(m => m.turnId === 'turn-A');
  assert.equal(turnAMessage.toolCalls[0].status, 'running');
  assert.equal(turnAMessage.turnError, undefined, "turn B's error must not attach to turn A's message");
});

// Required coverage I (follow-up review, Finding 7): one turnId, multiple assistant
// message-producing event types (reasoning, text, and two tools) must correlate to
// exactly one assistant message and therefore exactly one Work projection — never a
// split "Work-only" message plus a separate "prose" message for the same turn.
test('I: one turn with reasoning, text, and multiple tool calls produces exactly one assistant message and one Work group', () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'reasoning.delta', turnId: 'turn-1', text: 'thinking...' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-1', toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'tool.completed', turnId: 'turn-1', toolId: 't1', output: 'ok', status: 'completed' });
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'tool.started', turnId: 'turn-1', toolId: 't2', toolName: 'Bash', input: { command: 'ls' } });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'tool.completed', turnId: 'turn-1', toolId: 't2', output: 'ok', status: 'completed' });
  messages = applyAgentEvent(messages, { id: 6, seq: 6, type: 'text.delta', turnId: 'turn-1', text: 'Here is what I found.' });
  messages = applyAgentEvent(messages, { id: 7, seq: 7, type: 'turn.completed', turnId: 'turn-1' });

  const assistantMessages = messages.filter(m => m.role === 'assistant');
  assert.equal(assistantMessages.length, 1, 'exactly one assistant message must own this turn, not a split Work-only + prose pair');
  assert.equal(assistantMessages[0].text, 'Here is what I found.');
  assert.equal(assistantMessages[0].toolCalls.length, 2);

  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1, 'exactly one Work summary must be rendered for this turn');
  assert.equal(workByTurn[0].items.length, 2, 'expanding the one Work group exposes all actions for the turn');
});

// Required coverage J (follow-up review, Finding 9): a current-schema turn survives
// reload/reprojection through the real persistence path — backend transcript-cache
// coordinator recording, then a fresh read (simulating reload), then projectTranscript on the result.
test('J: a current-schema turn with multiple actions survives reload/reprojection', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-work-reload-test-'));
  try {
    const cache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-1',
      provider: 'fake',
      providerSessionId: 'sess-reload',
      onTurnUpdated: (snapshot) => cache.recordCanonicalTurn('fake', 'sess-reload', snapshot),
    });

    coordinator.recordToolStarted({ toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } });
    coordinator.recordToolCompleted({ toolId: 't1', output: 'ok', status: 'completed' });
    coordinator.recordToolStarted({ toolId: 't2', toolName: 'Bash', input: { command: 'ls' } });
    coordinator.recordToolCompleted({ toolId: 't2', output: 'ok', status: 'failed' });
    coordinator.recordTextDelta('Done.');
    coordinator.settleTerminal({ outcome: 'completed' });

    await cache.flush('fake', 'sess-reload');

    // A fresh cache instance reading from disk simulates a reload — nothing carries
    // over from the in-memory state above.
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const reloaded = await reloadedCache.getTranscript('fake', 'sess-reload');

    const assistantMessages = reloaded.messages.filter(m => m.role === 'assistant');
    assert.equal(assistantMessages.length, 1, 'Work survives as exactly one assistant message after reload');

    const { workByTurn } = projectTranscript(reloaded.messages, { activeTurnId: null });
    assert.equal(workByTurn.length, 1, 'exactly one Work projection for the turn after reload');
    assert.equal(workByTurn[0].turnId, 'turn-1', 'turn correlation survives reload');
    assert.equal(workByTurn[0].items.length, 2, 'action count survives reload');
    assert.equal(workByTurn[0].items.find(i => i.toolId === 't1').status, 'completed', 'statuses survive reload');
    assert.equal(workByTurn[0].items.find(i => i.toolId === 't2').status, 'failed', 'statuses survive reload');
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

// ── New required scenarios (PR #35 review, Issue 1) ───────────────────────────────────

// When the provider explicitly emits distinct messageId values for two content events
// within the same turn, both messages must survive as separate NormalizedMessage records.
// (One turn = 0..N assistant messages; Work is per-turn, not per-message.)
test('K: two explicit messageId-bearing events in same turn produce two distinct messages', () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-A', text: 'First segment.' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-B', text: 'Second segment.' });

  const assistantMessages = messages.filter(m => m.role === 'assistant');
  assert.equal(assistantMessages.length, 2, 'two explicit messageIds must stay distinct — not merged');
  assert.equal(assistantMessages.find(m => m.id === 'msg-A')?.text, 'First segment.', 'message-A identity preserved');
  assert.equal(assistantMessages.find(m => m.id === 'msg-B')?.text, 'Second segment.', 'message-B identity preserved');
});

// Tools distributed across multiple messages in the same turn (each message has its own
// explicit messageId) must still produce exactly one TurnWork with all actions included.
test('K: tools distributed across two messages in the same turn aggregate into one TurnWork', () => {
  let messages = [];
  // Message A carries the first tool.
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-A', text: 'I will read.' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-1', toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'tool.completed', turnId: 'turn-1', toolId: 't1', output: 'ok', status: 'completed' });
  // Message B (separate messageId) carries the second tool.
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-B', text: 'Now editing.' });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'tool.started', turnId: 'turn-1', toolId: 't2', toolName: 'Edit', input: { path: 'b.ts' } });
  messages = applyAgentEvent(messages, { id: 6, seq: 6, type: 'tool.completed', turnId: 'turn-1', toolId: 't2', output: 'ok', status: 'completed' });
  messages = applyAgentEvent(messages, { id: 7, seq: 7, type: 'turn.completed', turnId: 'turn-1' });

  // Two distinct assistant messages survive.
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  assert.equal(assistantMessages.length, 2, 'message-A and message-B remain distinct');
  assert.equal(assistantMessages.find(m => m.id === 'msg-A')?.text, 'I will read.');
  assert.equal(assistantMessages.find(m => m.id === 'msg-B')?.text, 'Now editing.');

  // But Work aggregates into exactly one TurnWork with all actions.
  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1, 'exactly one TurnWork regardless of how many messages');
  assert.equal(workByTurn[0].items.length, 2, 'all actions included regardless of which message carried them');
  assert.ok(workByTurn[0].items.find(i => i.toolId === 't1'), 'tool from message-A included');
  assert.ok(workByTurn[0].items.find(i => i.toolId === 't2'), 'tool from message-B included');
});

// Work anchor: when a turn has two messages and the first carries tool activity, TurnWork
// anchors at the first message — the one that corresponds naturally to the tool activity.
test('K: Work anchors at the first message with tool activity for the turn', () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-A', text: 'I will read.' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-1', toolId: 't1', toolName: 'Read', input: {} });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'tool.completed', turnId: 'turn-1', toolId: 't1', output: 'ok', status: 'completed' });
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'text.delta', turnId: 'turn-1', messageId: 'msg-B', text: 'Done.' });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'turn.completed', turnId: 'turn-1' });

  const { workByTurn } = projectTranscript(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1);
  // msg-A was first; tool.started had no explicit messageId so attached to msg-A via turnId fallback.
  assert.equal(workByTurn[0].messageId, 'msg-A', 'anchor is the message that actually carries the tool calls');
});

// ── Regression tests for Findings 1, 2, 3 ───────────────────────────────────────────

// Finding 1: tool.updated with transient status (e.g. streaming_input) must not leak
// into the projected Work items or assistant messages as a valid status, and turn.failed
// must resolve lingering running tools to failed.
test('Finding 1: tool.updated with transient status followed by turn.failed resolves to failed (frontend reducer & cache)', async () => {
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'tool.started', turnId: 'turn-1', toolId: 't1', toolName: 'Read', input: {} });
  assert.equal(messages[0].toolCalls[0].status, 'running');

  // Simulate an event with transient status or input updates.
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'tool.updated', turnId: 'turn-1', toolId: 't1', status: 'streaming_input', input: { path: 'file.ts' } });
  // The tool must remain 'running' — illegal lifecycle status string must not enter AgentToolCall.status.
  assert.equal(messages[0].toolCalls[0].status, 'running');

  // Turn fails / terminates.
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'turn.failed', turnId: 'turn-1', error: { code: 'AI_PROVIDER_ERROR', message: 'Failed' } });
  assert.equal(messages[0].toolCalls[0].status, 'failed', "tool must resolve to 'failed' upon turn.failed");

  // Also verify through SessionTranscriptCacheService and markTurnInterrupted.
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-tool-transient-test-'));
  try {
    const cache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-1',
      provider: 'fake',
      providerSessionId: 'sess-transient',
      onTurnUpdated: (snapshot) => cache.recordCanonicalTurn('fake', 'sess-transient', snapshot),
    });
    coordinator.recordToolStarted({ toolId: 't1', toolName: 'Read', input: {} });
    coordinator.settleTerminal({ outcome: 'cancelled', cause: 'user_cancelled' });
    await cache.flush('fake', 'sess-transient');

    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const reloaded = await reloadedCache.getTranscript('fake', 'sess-transient');
    const tool = reloaded.messages[0].toolCalls[0];
    assert.equal(tool.status, 'failed', "tool in persisted transcript must resolve to 'failed'");
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

// Finding 2: SessionTranscriptCacheService message correlation with distinct explicit messageIds.
test('Finding 2: distinct explicit messageIds in same turn survive transcript cache persistence and reload', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-cache-distinct-msg-test-'));
  try {
    const cache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-1',
      provider: 'fake',
      providerSessionId: 'sess-multi-msg',
      onTurnUpdated: (snapshot) => cache.recordCanonicalTurn('fake', 'sess-multi-msg', snapshot),
    });
    coordinator.recordTextDelta('First message.', 'msg-A');
    coordinator.recordToolStarted({ toolId: 't1', toolName: 'Read', input: { path: 'a.ts' } });
    coordinator.recordToolCompleted({ toolId: 't1', output: 'ok', status: 'completed' });
    coordinator.recordTextDelta('Second message.', 'msg-B');
    coordinator.settleTerminal({ outcome: 'completed' });
    await cache.flush('fake', 'sess-multi-msg');

    // Reload from disk with a fresh cache service instance
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const reloaded = await reloadedCache.getTranscript('fake', 'sess-multi-msg');

    const assistantMessages = reloaded.messages.filter(m => m.role === 'assistant');
    assert.equal(assistantMessages.length, 1, 'canonical turn produces exactly one assistant message after reload');
    assert.ok(assistantMessages[0].text.includes('First message.'));
    assert.ok(assistantMessages[0].text.includes('Second message.'));

    // Verify both project into exactly one TurnWork
    const { workByTurn, entries } = projectTranscript(reloaded.messages, { activeTurnId: null });
    assert.equal(workByTurn.length, 1, 'aggregates into exactly one TurnWork for the turn');
    assert.equal(workByTurn[0].items.length, 1);
    assert.equal(workByTurn[0].items[0].toolId, 't1');
    assert.equal(entries.filter(c => c.role === 'assistant').length, 1);
  } finally {
    await new Promise(r => setTimeout(r, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

// Finding 3: With multiple running tools in one turn, the newest started is currentActivity
// and older running tools remain inspectable without duplicating the current item.
test('Finding 3: with multiple running tool calls, newest running is currentActivity and others remain visible', () => {
  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      text: '',
      turnId: 'turn-1',
      createdAt: '2026-08-22T10:00:00Z',
      toolCalls: [
        { id: 't1', name: 'Read', input: { path: 'a.ts' }, status: 'running' },
        { id: 't2', name: 'Bash', input: { command: 'ls' }, status: 'running' },
      ],
    },
  ];

  const projection = projectTranscript(messages, { activeTurnId: 'turn-1' });
  assert.equal(projection.workByTurn.length, 1);
  assert.equal(projection.workByTurn[0].status, 'current');
  assert.equal(projection.workByTurn[0].currentActivity?.toolId, 't2', 'newest running tool t2 must be currentActivity');
  assert.equal(projection.currentActivity?.toolId, 't2', 'projection currentActivity must be t2');

  const expanded = visibleWorkItemsWhileRunning(projection.workByTurn[0], true);
  assert.equal(expanded.length, 1, 'older running tool t1 must remain inspectable when expanded');
  assert.equal(expanded[0].toolId, 't1');
  const collapsed = visibleWorkItemsWhileRunning(projection.workByTurn[0], false);
  assert.deepEqual(collapsed, [], 'no items when collapsed');
});

// ── task 11 (semantic Work chat V2), AC2 & AC3: turn.updated snapshot correlation ─────

function canonicalTurnV2(id, overrides = {}) {
  return {
    id, turnId: id, sessionId: 's1', provider: 'claude', providerSessionId: 's1', mode: 'agent',
    status: { status: 'active', detail: 'processing', since: '', source: 'coordinator' },
    work: [], historicalWork: [], activityCount: 0, currentActivity: null, finalAnswer: null,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

test('V2: multiple turn.updated snapshots for the same turn.id correlate to exactly one entry, always the latest', () => {
  let turns = [];
  turns = applyTurnUpdatedV2(turns, canonicalTurnV2('turn-1', { activityCount: 0 }));
  turns = applyTurnUpdatedV2(turns, canonicalTurnV2('turn-1', { activityCount: 1 }));
  turns = applyTurnUpdatedV2(turns, canonicalTurnV2('turn-1', { activityCount: 2 }));

  assert.equal(turns.length, 1, 'one turn.id must correlate to exactly one entry, never a growing history');
  assert.equal(turns[0].activityCount, 2, 'the latest snapshot must win — this is a full replace, not a delta merge');
});

test('V2: turn A stays byte-identical when turn B receives a turn.updated snapshot', () => {
  const turnA = canonicalTurnV2('turn-A', { activityCount: 3 });
  let turns = [turnA];
  turns = applyTurnUpdatedV2(turns, canonicalTurnV2('turn-B', { activityCount: 1 }));
  turns = applyTurnUpdatedV2(turns, canonicalTurnV2('turn-B', {
    activityCount: 1,
    status: { status: 'terminal', outcome: 'completed', initiator: 'provider', since: '', source: 'coordinator' },
  }));

  assert.equal(turns.find(t => t.id === 'turn-A'), turnA, 'a terminal event for turn B must never touch turn A');
  assert.equal(turns.find(t => t.id === 'turn-B').status.status, 'terminal');
});

test('V2: replaying the same turn.updated snapshot twice (SSE reconnect replay) is idempotent, no duplication', () => {
  const snapshot = canonicalTurnV2('turn-1', { activityCount: 5 });
  let turns = [];
  turns = applyTurnUpdatedV2(turns, snapshot);
  const afterFirst = turns;
  turns = applyTurnUpdatedV2(turns, snapshot);
  assert.equal(turns, afterFirst, 'replaying an identical snapshot must not produce a new array/entry');
  assert.equal(turns.length, 1);
});

