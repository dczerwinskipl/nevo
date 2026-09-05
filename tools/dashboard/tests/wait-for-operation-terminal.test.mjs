import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForOperationTerminal } from '../ui/features/operations/wait-for-operation-terminal.ts';

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
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, data) {
    const event = { type, data: JSON.stringify(data) };
    if (type === 'message') this.onmessage?.(event);
    this.listeners.get(type)?.forEach((l) => l(event));
  }
  close() {
    this.closed = true;
  }
}
MockEventSource.instances = [];

test.beforeEach(() => {
  MockEventSource.instances = [];
  globalThis.EventSource = MockEventSource;
});

test('resolves { kind: "completed" } immediately from the initial fetch when already terminal — no SSE connection opened', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-1', status: 'completed', lastEventId: 3, steps: [] }),
  });

  const outcome = await waitForOperationTerminal('op-1');
  assert.equal(outcome.kind, 'completed');
  assert.equal(outcome.snapshot.status, 'completed');
  assert.equal(MockEventSource.instances.length, 0);
});

test('resolves { kind: "failed" } once a failed SSE event arrives, and closes the stream', async () => {
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

  source.emit('operation.failed', {
    id: 1,
    type: 'operation.failed',
    operationId: 'op-2',
    timestamp: 't',
    error: { message: 'boom' },
  });

  const outcome = await promise;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.snapshot.status, 'failed');
  assert.equal(source.closed, true);
});

test('resolves { kind: "completed" } once a completed SSE event arrives', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-2b', status: 'running', lastEventId: 0, steps: [] }),
  });

  const promise = waitForOperationTerminal('op-2b');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const source = MockEventSource.instances[0];
  source.emit('operation.completed', {
    id: 1,
    type: 'operation.completed',
    operationId: 'op-2b',
    timestamp: 't',
    result: { ok: true },
  });

  const outcome = await promise;
  assert.equal(outcome.kind, 'completed');
});

test('resolves { kind: "timeout" } with the last-known (non-terminal) snapshot once the bounded wait elapses', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-3', status: 'running', lastEventId: 0, steps: [] }),
  });

  const outcome = await waitForOperationTerminal('op-3', { timeoutMs: 5 });
  assert.equal(outcome.kind, 'timeout');
  assert.equal(
    outcome.snapshot.status,
    'running',
    'the last-observed snapshot is carried for diagnostics, but never treated as completion',
  );
});

test('falls back to a snapshot poll on stream error and resolves { kind: "failed" } once that poll reports terminal', async () => {
  let pollCount = 0;
  globalThis.fetch = async () => {
    pollCount += 1;
    if (pollCount === 1) {
      return { ok: true, json: async () => ({ id: 'op-4', status: 'running', lastEventId: 0, steps: [] }) };
    }
    return {
      ok: true,
      json: async () => ({ id: 'op-4', status: 'failed', lastEventId: 1, steps: [], error: { message: 'boom' } }),
    };
  };

  const promise = waitForOperationTerminal('op-4');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const source = MockEventSource.instances[0];
  source.onerror?.(new Event('error'));

  const outcome = await promise;
  assert.equal(outcome.kind, 'failed');
});

test('resolves { kind: "error" } (status could not be established) when the initial fetch itself fails', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const outcome = await waitForOperationTerminal('op-5');
  assert.equal(outcome.kind, 'error');
  assert.match(outcome.message, /500/);
});

test('a timeout firing after settlement is a no-op — cannot retroactively override an already-resolved completed/failed outcome', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 'op-6', status: 'completed', lastEventId: 0, steps: [] }),
  });

  // Timeout is set to fire almost immediately, but resolution should win since it's synchronous.
  const outcome = await waitForOperationTerminal('op-6', { timeoutMs: 1 });
  assert.equal(outcome.kind, 'completed');
});
