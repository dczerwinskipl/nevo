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

test('browser EventSource dispatches named SSE events only to addEventListener, not onmessage', async () => {
  const { subscribeAgentEventSource, SUPPORTED_AGENT_EVENT_TYPES, applyAgentEvent } = await import('../src/lib/nevo-assistant-runtime.ts');

  // Minimal standard-compliant EventTarget mock for browser EventSource
  class MockEventSource {
    constructor() {
      this.listeners = new Map();
      this.onmessage = null;
      this.closed = false;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(type, data) {
      const event = { type, data: JSON.stringify(data) };
      // Browser EventSource semantics: named events invoke addEventListener(type), NOT onmessage
      if (type === 'message') {
        this.onmessage?.(event);
      }
      const set = this.listeners.get(type);
      if (set) {
        for (const listener of set) listener(event);
      }
    }

    close() {
      this.closed = true;
    }
  }

  // 1. Verify that onmessage-only does NOT catch named SSE events (proving the regression)
  const buggySource = new MockEventSource();
  let buggyReceived = false;
  buggySource.onmessage = () => { buggyReceived = true; };
  buggySource.dispatchEvent('text.delta', { type: 'text.delta', seq: 1, text: 'hello' });
  assert.equal(buggyReceived, false, 'onmessage must not receive named SSE event text.delta');

  // 2. Verify subscribeAgentEventSource listens to all SUPPORTED_AGENT_EVENT_TYPES
  const source = new MockEventSource();
  const receivedEvents = [];
  const unsubscribe = subscribeAgentEventSource(source, (event) => {
    receivedEvents.push(event);
  });

  for (const eventType of SUPPORTED_AGENT_EVENT_TYPES) {
    source.dispatchEvent(eventType, { type: eventType, seq: receivedEvents.length + 1, text: `data for ${eventType}` });
  }

  assert.equal(receivedEvents.length, SUPPORTED_AGENT_EVENT_TYPES.length);
  assert.deepEqual(receivedEvents.map(e => e.type), Array.from(SUPPORTED_AGENT_EVENT_TYPES));

  // 3. Verify applyAgentEvent state reduction
  let messages = [];
  messages = applyAgentEvent(messages, { id: 1, seq: 1, type: 'text.delta', messageId: 'msg-1', text: 'Hello ' });
  messages = applyAgentEvent(messages, { id: 2, seq: 2, type: 'text.delta', messageId: 'msg-1', text: 'World' });
  messages = applyAgentEvent(messages, { id: 3, seq: 3, type: 'reasoning.delta', messageId: 'msg-1', text: 'Deep thought' });
  messages = applyAgentEvent(messages, { id: 4, seq: 4, type: 'tool.started', turnId: '1', toolId: 'tool-a', toolName: 'test_tool', input: { a: 1 } });
  messages = applyAgentEvent(messages, { id: 5, seq: 5, type: 'tool.completed', turnId: '1', toolId: 'tool-a', output: { success: true } });

  assert.equal(messages[0].text, 'Hello World');
  assert.equal(messages[0].reasoning, 'Deep thought');
  assert.equal(messages[0].toolCalls?.length, 1);
  assert.equal(messages[0].toolCalls[0].status, 'completed');
  assert.deepEqual(messages[0].toolCalls[0].output, { success: true });

  // 4. Verify unsubscribe cleans up listeners and closes EventSource
  unsubscribe();
  assert.equal(source.closed, true);
});
