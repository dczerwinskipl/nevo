import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyAgentEvent } from '../src/lib/nevo-assistant-runtime.ts';
import { projectChat } from '../src/lib/chat-projection.ts';
import { createTranscriptCacheService } from '../../ai/transcript-cache.mjs';

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

  const { workByTurn } = projectChat(messages, { activeTurnId: null });
  assert.equal(workByTurn.length, 1, 'exactly one Work summary must be rendered for this turn');
  assert.equal(workByTurn[0].items.length, 2, 'expanding the one Work group exposes all actions for the turn');
});

// Required coverage J (follow-up review, Finding 9): a current-schema turn survives
// reload/reprojection through the real persistence path — backend transcript-cache
// applyEvent, then a fresh read (simulating reload), then projectChat on the result.
test('J: a current-schema turn with multiple actions survives reload/reprojection', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-work-reload-test-'));
  try {
    const cache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });

    await cache.applyEvent('fake', 'sess-reload', { id: 1, seq: 1, type: 'turn.started', turnId: 'turn-1', timestamp: '2026-08-22T10:00:00Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 2, seq: 2, type: 'tool.started', turnId: 'turn-1', toolId: 't1', toolName: 'Read', input: { path: 'a.ts' }, timestamp: '2026-08-22T10:00:01Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 3, seq: 3, type: 'tool.completed', turnId: 'turn-1', toolId: 't1', output: 'ok', status: 'completed', timestamp: '2026-08-22T10:00:02Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 4, seq: 4, type: 'tool.started', turnId: 'turn-1', toolId: 't2', toolName: 'Bash', input: { command: 'ls' }, timestamp: '2026-08-22T10:00:03Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 5, seq: 5, type: 'tool.completed', turnId: 'turn-1', toolId: 't2', output: 'ok', status: 'failed', timestamp: '2026-08-22T10:00:04Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 6, seq: 6, type: 'text.delta', turnId: 'turn-1', text: 'Done.', timestamp: '2026-08-22T10:00:05Z' });
    await cache.applyEvent('fake', 'sess-reload', { id: 7, seq: 7, type: 'turn.completed', turnId: 'turn-1', timestamp: '2026-08-22T10:00:06Z' });

    await cache.flush('fake', 'sess-reload');

    // A fresh cache instance reading from disk simulates a reload — nothing carries
    // over from the in-memory state above.
    const reloadedCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const reloaded = await reloadedCache.getTranscript('fake', 'sess-reload');

    const assistantMessages = reloaded.messages.filter(m => m.role === 'assistant');
    assert.equal(assistantMessages.length, 1, 'Work survives as exactly one assistant message after reload');

    const { workByTurn } = projectChat(reloaded.messages, { activeTurnId: null });
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
