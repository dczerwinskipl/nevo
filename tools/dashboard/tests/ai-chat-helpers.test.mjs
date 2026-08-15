import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeChatMessages,
  createTurnIdempotencyKey,
  initialPromptWithTaskContext,
} from '../src/lib/ai-chat-helpers.ts';

test('turn idempotency keys work when randomUUID is unavailable on an HTTP VPN origin', () => {
  assert.equal(createTurnIdempotencyKey({
    cryptoSource: {},
    now: () => 1234,
    random: () => 0.5,
  }), 'ui-ya-i');

  assert.equal(createTurnIdempotencyKey({
    cryptoSource: { randomUUID: () => 'stable-uuid' },
  }), 'ui-stable-uuid');
});

test('selected stable task IDs are prepended to the initial prompt', () => {
  assert.equal(initialPromptWithTaskContext(' Review these tasks. ', ['task-a', 'task-b']),
    'Context: tasks task-a, task-b\n\nReview these tasks.');
  assert.equal(initialPromptWithTaskContext(' General review. ', []), 'General review.');
  assert.equal(initialPromptWithTaskContext('   ', ['task-a']), null);
});

test('persisted assistant messages replace their streamed version by stable message ID', () => {
  assert.deepEqual(composeChatMessages(
    [{ id: 'assistant-1', role: 'assistant', text: 'Complete response.' }],
    'Pending question',
    {
      'assistant-1': 'Complete response',
      'assistant-2': 'Still streaming',
    },
  ), [
    { id: 'assistant-1', role: 'assistant', text: 'Complete response.' },
    { id: 'optimistic-user', role: 'user', text: 'Pending question' },
    { id: 'assistant-2', role: 'assistant', text: 'Still streaming' },
  ]);
});
