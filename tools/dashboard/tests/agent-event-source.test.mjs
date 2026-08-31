import assert from 'node:assert/strict';
import test from 'node:test';

import { connectAgentEventStream, resolveEventSeq } from '../ui/features/agent-sessions/runtime/agent-event-source.ts';

// Minimal standard-compliant EventTarget mock — same shape as the browser EventSource
// contract this stream connects to. Nothing here touches React or @assistant-ui/react,
// demonstrating the live-stream lifecycle is testable independently of the full runtime
// hook (area ai-assistant-chat-and-runtime-feature-slice, task 07).
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.onmessage = null;
    this.onopen = null;
    this.onerror = null;
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
    const set = this.listeners.get(type);
    if (set) for (const listener of set) listener(event);
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  error() {
    this.onerror?.(new Event('error'));
  }

  close() {
    this.closed = true;
  }
}

test('connectAgentEventStream wires onOpen/onError and forwards named events to onEvent', () => {
  let created = null;
  const events = [];
  let openCount = 0;
  let errorCount = 0;

  const disconnect = connectAgentEventStream(
    '/api/agent-sessions/claude/sess-1/events?after=0',
    {
      onEvent: (event) => events.push(event),
      onOpen: () => { openCount += 1; },
      onError: () => { errorCount += 1; },
    },
    (url) => { created = new MockEventSource(url); return created; },
  );

  assert.equal(created.url, '/api/agent-sessions/claude/sess-1/events?after=0');

  created.open();
  assert.equal(openCount, 1);

  created.dispatchEvent('text.delta', { type: 'text.delta', seq: 1, text: 'hi' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'text.delta');

  created.error();
  assert.equal(errorCount, 1);

  disconnect();
  assert.equal(created.closed, true, 'disconnect() closes the underlying event source');
});

test('connectAgentEventStream cleanup detaches listeners so a stale source cannot deliver further events', () => {
  let created = null;
  const events = [];

  const disconnect = connectAgentEventStream(
    '/api/agent-sessions/claude/sess-1/events?after=0',
    { onEvent: (event) => events.push(event) },
    (url) => { created = new MockEventSource(url); return created; },
  );

  created.dispatchEvent('turn.started', { type: 'turn.started', seq: 1 });
  assert.equal(events.length, 1);

  disconnect();

  // Listeners were removed by disconnect(); a late dispatch on the (now-closed) mock
  // must not reach onEvent again.
  created.dispatchEvent('turn.started', { type: 'turn.started', seq: 2 });
  assert.equal(events.length, 1, 'no further events are delivered after disconnect');
});

test('resolveEventSeq prefers seq, falls back to id, defaults to 0', () => {
  assert.equal(resolveEventSeq({ seq: 5, id: 9 }), 5);
  assert.equal(resolveEventSeq({ seq: undefined, id: 3 }), 3);
  assert.equal(resolveEventSeq({}), 0);
});
