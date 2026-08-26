import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForOperationTerminal } from '../src/hooks/wait-for-operation-terminal.ts';

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    MockEventSource.instances.push(this);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, data) {
    const event = { type, data: JSON.stringify(data) };
    if (type === 'message') this.onmessage?.(event);
    this.listeners.get(type)?.forEach((l) => l(event));
  }
  close() { this.closed = true; }
}
MockEventSource.instances = [];

test.beforeEach(() => {
  MockEventSource.instances = [];
  globalThis.EventSource = MockEventSource;
});

test('resolves immediately from the initial fetch when the operation is already terminal — no SSE connection opened', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-1', status: 'completed', lastEventId: 3, steps: [] }),
  });

  const snapshot = await waitForOperationTerminal('op-1');
  assert.equal(snapshot.status, 'completed');
  assert.equal(MockEventSource.instances.length, 0);
});

test('resolves once a terminal SSE event arrives, and closes the stream', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-2', status: 'running', lastEventId: 0, steps: [] }),
  });

  const promise = waitForOperationTerminal('op-2');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const source = MockEventSource.instances[0];
  assert.ok(source, 'an SSE connection was opened for the non-terminal initial snapshot');
  assert.ok(source.url.includes('op-2'));

  source.emit('operation.completed', { id: 1, type: 'operation.completed', operationId: 'op-2', timestamp: 't', result: { ok: true } });

  const snapshot = await promise;
  assert.equal(snapshot.status, 'completed');
  assert.equal(source.closed, true);
});

test('stops waiting (does not treat it as failure) once the timeout elapses without a terminal event', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-3', status: 'running', lastEventId: 0, steps: [] }),
  });

  const snapshot = await waitForOperationTerminal('op-3', { timeoutMs: 5 });
  assert.equal(snapshot.status, 'running', 'resolves with the last-known non-terminal snapshot rather than rejecting');
});

test('falls back to a snapshot poll on stream error and resolves once that poll reports terminal', async () => {
  let pollCount = 0;
  globalThis.fetch = async () => {
    pollCount += 1;
    if (pollCount === 1) {
      return { ok: true, json: async () => ({ id: 'op-4', status: 'running', lastEventId: 0, steps: [] }) };
    }
    return { ok: true, json: async () => ({ id: 'op-4', status: 'failed', lastEventId: 1, steps: [], error: { message: 'boom' } }) };
  };

  const promise = waitForOperationTerminal('op-4');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const source = MockEventSource.instances[0];
  source.onerror?.(new Event('error'));

  const snapshot = await promise;
  assert.equal(snapshot.status, 'failed');
});

test('resolves null when the initial fetch itself fails', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const snapshot = await waitForOperationTerminal('op-5');
  assert.equal(snapshot, null);
});
