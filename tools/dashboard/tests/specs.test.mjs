import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardApp, listen } from '../server/index.mjs';
function fakeHub() { return { subscribe: () => () => {}, close: () => {} }; }
test('serves read-only dashboard data and rejects unknown or mutating routes', async () => {
  const server = await buildDashboardApp({ config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });
  try {
    const dashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.ok(data.counts.active >= 1);
    assert.ok(Array.isArray(data.active));
    const mutation = await fetch(`${baseUrl}/api/dashboard`, { method: 'POST' });
   assert.equal(mutation.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
test('serves exact specification manifest routes without leaking lookup failures', async () => {
  const server = await buildDashboardApp({ config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });
  try {
    const active = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content`);
    assert.equal(active.status, 200);
    const manifest = await active.json();
    assert.equal(manifest.slug, 'refaktoring-tooli');
    assert.equal(manifest.source, 'active');
    const missing = await fetch(`${baseUrl}/api/specs/active/missing-nonexistent-slug/content`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification content not found' });
    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content`, { method: 'POST' });
    assert.equal(mutation.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
test('serves exact per-document content routes without leaking lookup failures', async () => {
  const server = await buildDashboardApp({ config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });
  try {
    const doc = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/overview`);
    assert.equal(doc.status, 200);
    const payload = await doc.json();
    assert.equal(payload.docId, 'overview');
    assert.ok(payload.markdown.length > 0);
    const missing = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/task%3Amissing-task-id`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification document not found' });
    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/overview`, { method: 'POST' });
    assert.equal(mutation.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
test('serves a small, fast task-statuses route without leaking lookup failures', async () => {
  const server = await buildDashboardApp({ config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });
  try {
    const response = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/task-statuses`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.slug, 'refaktoring-tooli');
    assert.equal(payload.source, 'active');
    assert.ok(Array.isArray(payload.tasks));
    const missing = await fetch(`${baseUrl}/api/specs/active/missing-nonexistent-slug/task-statuses`);
    assert.equal(missing.status, 404);
    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/task-statuses`, { method: 'POST' });
    assert.equal(mutation.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
test('serves active-only lifecycle gates and executes explicit validated actions', async () => {
  const server = await buildDashboardApp({ config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });
  try {
    const gates = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`);
    assert.equal(gates.status, 200);
    const actionsPayload = await gates.json();
    assert.equal(actionsPayload.slug, 'refaktoring-tooli');
    assert.ok(actionsPayload.tasks);
    const invalid = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    const missingActionHeader = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify', taskId: 'shared-specs-workflow-operations' }),
    });
    assert.equal(missingActionHeader.status, 403);
    const invalidShape = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: 'null',
    });
    assert.equal(invalidShape.status, 400);
    const unknownAction = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ action: 'nonexistent-action' }),
    });
    assert.equal(unknownAction.status, 400);
    const archived = await fetch(`${baseUrl}/api/specs/archive/refaktoring-tooli/actions`, { method: 'POST' });
    assert.equal(archived.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('specs route adapter manages AbortController and completion settlement during shutdown', async () => {
  let capturedSignal = null;
  let settleActionPromise;
  const actionDone = new Promise((resolve) => { settleActionPromise = resolve; });
  let actionSettled = false;
  let runtimeShutdownCalled = false;
  const eventsOrder = [];

  const fakeOperationRuntime = {
    createOperation: () => 'op-test-1',
    recordEvent: () => {},
    completeOperation: () => {},
    failOperation: () => {},
    getSnapshot: () => ({ status: 'running', steps: [], events: [] }),
    shutdown: () => {
      runtimeShutdownCalled = true;
      eventsOrder.push({ type: 'runtime-shutdown', afterActionSettled: actionSettled });
    },
  };

  const server = await buildDashboardApp({
    config: {
      events: { eventHub: fakeHub() },
      distDir: 'Z:/does-not-exist',
      operations: { operationRuntime: fakeOperationRuntime },
      specs: {
        actionExecutor: ({ slug, action, taskId, signal, onFinished }) => {
          capturedSignal = signal;
          const wrappedCompletion = (async () => {
            await actionDone;
            actionSettled = true;
            eventsOrder.push({ type: 'action-settled' });
          })();

          return {
            ok: true,
            operationId: 'op-abort-test',
            action,
            taskId,
            message: 'Started',
            completion: wrappedCompletion,
          };
        },
      },
    },
  });

  const baseUrl = await listen(server, { port: 0 });

  try {
    const res = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ action: 'approve', taskId: 'shared-specs-workflow-operations' }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.operationId, 'op-abort-test');
    assert.equal(json.completion, undefined, 'completion promise is not exposed in public JSON');

    assert.ok(capturedSignal, 'AbortSignal was passed to actionExecutor');
    assert.equal(capturedSignal.aborted, false);

    // Concurrency lock is active while action is running
    const conflictRes = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ action: 'approve', taskId: 'shared-specs-workflow-operations' }),
    });
    assert.equal(conflictRes.status, 409);

    // Trigger server shutdown — the real production close path: specs'
    // preClose hook (abort/await in-flight actions) is registered before
    // operations' preClose hook (operationRuntime.shutdown), so Fastify's
    // sequential preClose execution gives the same ordering guarantee the
    // old hand-rolled shutdown chain gave explicitly.
    let shutdownSettled = false;
    const shutdownPromise = server.close().then(() => {
      shutdownSettled = true;
    });

    // Fastify's own close() sequencing (avvio) invokes the first preClose
    // hook via a macrotask, not synchronously or even within a microtask —
    // unlike the old hand-rolled `server.close` override, which ran the
    // abort() call synchronously within the same tick. A single
    // `setImmediate` tick is enough to observe it having started.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(capturedSignal.aborted, true, 'AbortSignal was aborted on server shutdown');

    // Give microtasks a cycle to prove shutdown is STILL waiting for the action to settle
    await Promise.resolve();
    assert.equal(shutdownSettled, false, 'Shutdown did not complete while action was still settling');
    assert.equal(runtimeShutdownCalled, false, 'OperationRuntime.shutdown was not called prematurely');

    // Now settle the deferred action promise
    settleActionPromise();

    // Now await the shutdown promise
    await shutdownPromise;
    assert.equal(shutdownSettled, true, 'Shutdown completed after action settled');
    assert.equal(runtimeShutdownCalled, true, 'OperationRuntime was shut down');

    // Check strict execution order: action settled before runtime shutdown
    assert.deepEqual(eventsOrder, [
      { type: 'action-settled' },
      { type: 'runtime-shutdown', afterActionSettled: true },
    ]);
  } finally {
    try { await server.close(); } catch {}
  }
});
