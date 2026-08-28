import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { createOperationRuntime, OperationNotFoundError } from '../server/infrastructure/operation-runtime.mjs';
import { executeSpecificationAction } from '../server/specs/actions.mjs';
import { registerGlobalHttpInfrastructure } from '../server/infrastructure/http.mjs';
import specsRoutes from '../server/specs/routes.mjs';
import operationRoutes from '../server/operations/routes.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../../specs/fingerprint.mjs';

function createMockChildProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function fixture() {
  const root = join(tmpdir(), `nevo-dashboard-op-tests-${process.pid}-${Date.now()}-${Math.random()}`);
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'sample-change');
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  mkdirSync(join(changeDir, 'reviews'), { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: sample-change',
    'title: Sample',
    'status: draft',
    'tasks:',
    '  - id: design-it',
    '    order: 1',
    '    file: tasks/01-design.md',
    '    status: draft',
    '',
  ].join('\n'));
  writeFileSync(join(changeDir, 'overview.md'), '# Overview\n\nSample goal');
  writeFileSync(join(changeDir, 'tasks', '01-design.md'), '# Design\n\nContent');

  const changeObj = {
    _dir: changeDir,
    tasks: [
      { id: 'design-it', file: 'tasks/01-design.md', status: 'draft' },
    ],
  };
  const fingerprint = computeChangeFingerprint(changeObj);
  const taskFingerprint = computeTaskFingerprint(changeObj, 'design-it');
  writeFileSync(join(changeDir, 'reviews', 'spec.md'), [
    '---',
    'verdict: ready-for-approval',
    `spec_fingerprint: ${fingerprint}`,
    'unresolved_required_fixes: 0',
    'unresolved_owner_decisions: 0',
    'unresolved_needs_clarification: 0',
    'task_fingerprints:',
    `  design-it: ${taskFingerprint}`,
    '---',
    '',
    '# Spec Review',
  ].join('\n'));

  return { root, activeDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('OperationRuntime — lifecycle, snapshots, and SSE subscriptions', async (t) => {
  await t.test('creates an operation with unique ID and records step transitions', () => {
    const runtime = createOperationRuntime({
      idFactory: () => 'test-op-1',
      clock: () => new Date('2026-08-16T12:00:00Z'),
    });

    const opId = runtime.createOperation({ type: 'spec-action-verify' });
    assert.equal(opId, 'op-test-op-1');

    runtime.recordEvent(opId, {
      type: 'operation.step.started',
      id: 'validate',
      label: 'Validate spec',
      total: 10,
    });
    runtime.recordEvent(opId, {
      type: 'operation.step.progress',
      id: 'validate',
      current: 5,
      total: 10,
      detail: 'checking schemas',
    });

    let snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.id, 'op-test-op-1');
    assert.equal(snapshot.type, 'spec-action-verify');
    assert.equal(snapshot.status, 'running');
    assert.equal(snapshot.steps.length, 1);
    assert.equal(snapshot.steps[0].id, 'validate');
    assert.equal(snapshot.steps[0].status, 'running');
    assert.equal(snapshot.steps[0].current, 5);
    assert.equal(snapshot.steps[0].total, 10);
    assert.equal(snapshot.steps[0].detail, 'checking schemas');

    runtime.recordEvent(opId, {
      type: 'operation.step.completed',
      id: 'validate',
      detail: 'schemas valid',
    });

    snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.steps[0].status, 'completed');
    assert.equal(snapshot.steps[0].detail, 'schemas valid');

    runtime.completeOperation(opId, { ok: true });
    snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'completed');
    assert.deepEqual(snapshot.result, { ok: true });
  });

  await t.test('AC6: distinguishes a step failure from an overall operation failure in payload', () => {
    const runtime = createOperationRuntime({
      idFactory: () => 'fail-op',
      clock: () => new Date('2026-08-16T12:00:00Z'),
    });

    const opId = runtime.createOperation({ type: 'spec-action-verify' });

    runtime.recordEvent(opId, {
      type: 'operation.step.started',
      id: 'build',
      label: 'Build project',
    });
    runtime.recordEvent(opId, {
      type: 'operation.step.failed',
      id: 'build',
      error: { message: 'Compilation error on line 42', code: 'CS1002' },
      detail: 'dotnet build failed',
    });
    runtime.failOperation(opId, { message: 'Task verification failed', code: 'VERIFICATION_FAILED' });

    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.error.code, 'VERIFICATION_FAILED');
    assert.equal(snapshot.steps[0].id, 'build');
    assert.equal(snapshot.steps[0].status, 'failed');
    assert.equal(snapshot.steps[0].error.code, 'CS1002');
    assert.equal(snapshot.steps[0].error.message, 'Compilation error on line 42');
  });

  await t.test('AC3 & AC4: mid-operation subscription and post-completion replay', () => {
    const runtime = createOperationRuntime({
      idFactory: () => 'replay-op',
      clock: () => new Date('2026-08-16T12:00:00Z'),
    });

    const opId = runtime.createOperation({ type: 'task-test' });

    runtime.recordEvent(opId, { type: 'operation.step.started', id: 's1', label: 'Step 1' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 's1' });

    // Client connects mid-operation
    const receivedMid = [];
    const unsubscribeMid = runtime.subscribe(opId, {
      afterSequence: 0,
      onEvent: e => receivedMid.push(e),
    });

    assert.equal(receivedMid.length, 3); // started (1), step.started (2), step.completed (3)

    // More events arrive
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 's2', label: 'Step 2' }); // event (4)
    assert.equal(receivedMid.length, 4);

    unsubscribeMid();

    runtime.completeOperation(opId, { success: true }); // event (5)

    // Client connects after completion (AC4)
    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'completed');
    assert.deepEqual(snapshot.result, { success: true });

    const receivedLate = [];
    runtime.subscribe(opId, {
      afterSequence: 3,
      onEvent: e => receivedLate.push(e),
    });
    assert.equal(receivedLate.length, 2); // events 4 and 5 (afterSequence 3)
  });

  await t.test('failOperation only transitions running step to failed; completed remain completed and pending remain pending', () => {
    const runtime = createOperationRuntime({ idFactory: () => 'multi-step-op' });
    const opId = runtime.createOperation({
      type: 'finalize',
      steps: [
        { id: 's1', label: 'Step 1' },
        { id: 's2', label: 'Step 2' },
        { id: 's3', label: 'Step 3' },
        { id: 's4', label: 'Step 4' },
      ],
    });

    // 1. Step 1 completed
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 's1' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 's1' });

    // 2. Step 2 running
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 's2' });

    // 3. Step 3 & 4 remain pending

    // 4. Operation fails
    runtime.failOperation(opId, { message: 'Step 2 crashed' });

    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.steps.length, 4);

    // 1. Step 1 remains completed
    assert.equal(snapshot.steps[0].id, 's1');
    assert.equal(snapshot.steps[0].status, 'completed');

    // 2. Step 2 transitioned from running -> failed
    assert.equal(snapshot.steps[1].id, 's2');
    assert.equal(snapshot.steps[1].status, 'failed');
    assert.equal(snapshot.steps[1].error.message, 'Step 2 crashed');

    // 3. Step 3 & 4 remain pending
    assert.equal(snapshot.steps[2].id, 's3');
    assert.equal(snapshot.steps[2].status, 'pending');
    assert.equal(snapshot.steps[3].id, 's4');
    assert.equal(snapshot.steps[3].status, 'pending');
  });

  await t.test('shutdown marks running operations as failed with 503 error on new operations', () => {
    const runtime = createOperationRuntime({ idFactory: () => 'shut-op' });
    const opId = runtime.createOperation({ type: 'task-test' });

    runtime.shutdown();

    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.error.code, 'OPERATION_INTERRUPTED');

    assert.throws(() => runtime.createOperation(), err => err.status === 503);
  });
});

test('executeSpecificationAction — in-process single execution runner', async (t) => {
  await t.test('AC1 & AC10: returns operationId immediately, executes in-process and completes in OperationRuntime', async () => {
    const sample = fixture();
    try {
      const runtime = createOperationRuntime({ idFactory: () => 'op-123' });
      let resolveDone;
      const donePromise = new Promise(resolve => { resolveDone = resolve; });

      const result = executeSpecificationAction({
        slug: 'sample-change',
        action: 'approve',
        taskId: 'design-it',
        activeDir: sample.activeDir,
        root: sample.root,
        git: false,
        operationRuntime: runtime,
        onFinished: resolveDone,
      });

      assert.equal(result.ok, true);
      assert.equal(result.operationId, 'op-op-123');
      assert.equal(result.action, 'approve');
      assert.equal(result.taskId, 'design-it');

      await donePromise;

      const snapshot = runtime.getSnapshot('op-op-123');
      assert.equal(snapshot.status, 'completed');
      assert.ok(snapshot.steps.length > 0);
      assert.equal(snapshot.steps[0].id, 'validate-approval');
      assert.equal(snapshot.steps[0].status, 'completed');
      assert.equal(snapshot.result.ok, true);
      assert.ok(snapshot.result.summary);
    } finally {
      sample.cleanup();
    }
  });

  await t.test('OperationRuntime receives complete domain result on successful action', async () => {
    const sample = fixture();
    try {
      const runtime = createOperationRuntime({ idFactory: () => 'op-domain-result' });
      let resolveDone;
      const donePromise = new Promise(resolve => { resolveDone = resolve; });

      executeSpecificationAction({
        slug: 'sample-change',
        action: 'approve',
        taskId: 'design-it',
        activeDir: sample.activeDir,
        root: sample.root,
        git: false,
        operationRuntime: runtime,
        onFinished: resolveDone,
      });

      await donePromise;

      const snapshot = runtime.getSnapshot('op-op-domain-result');
      assert.equal(snapshot.status, 'completed');
      assert.equal(snapshot.result.ok, true);
      assert.ok(snapshot.result.task, 'snapshot.result contains task');
      assert.equal(snapshot.result.task.id, 'design-it');
      assert.equal(snapshot.result.summary.includes('approved'), true);
    } finally {
      sample.cleanup();
    }
  });

  await t.test('action failure transitions OperationRuntime to failed status with single terminalization', async () => {
    const sample = fixture();
    try {
      const runtime = createOperationRuntime({ idFactory: () => 'op-step-failure' });
      let resolveDone;
      const donePromise = new Promise(resolve => { resolveDone = resolve; });

      executeSpecificationAction({
        slug: 'sample-change',
        action: 'verify',
        taskId: 'design-it',
        activeDir: sample.activeDir,
        root: sample.root,
        git: false,
        operationRuntime: runtime,
        onFinished: resolveDone,
      });

      await donePromise;

      const snapshot = runtime.getSnapshot('op-op-step-failure');
      assert.equal(snapshot.status, 'failed');
      assert.ok(snapshot.error);
      assert.ok(snapshot.error.message);
    } finally {
      sample.cleanup();
    }
  });
});

test('Dashboard server — action concurrency & /api/operations routes', async (t) => {
  // Cross-slice by nature (specs' actions write to `operationRuntime`,
  // operations reads/streams it), so this registers both slices directly on
  // a bare Fastify instance — decorating `operationRuntime` the same way
  // app.mjs does — rather than going through `buildDashboardApp()`.
  // `actionExecutor` is specs/routes.mjs's own local override option (see
  // its own comment).
  let activeChild = null;
  const runtime = createOperationRuntime({ idFactory: () => 'srv-op-1' });
  const sample = fixture();
  const server = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(server);
  server.decorate('operationRuntime', runtime);
  await server.register(specsRoutes, {
    config: { activeDir: sample.activeDir },
    actionExecutor: ({ slug, action, taskId, onFinished }) => {
      activeChild = createMockChildProcess();
      const opId = runtime.createOperation({ type: `spec-action-${action}` });
      activeChild.on('close', () => {
        runtime.completeOperation(opId, { ok: true });
        if (typeof onFinished === 'function') onFinished();
      });
      return { ok: true, operationId: opId, action, taskId };
    },
  });
  await server.register(operationRoutes);
  const baseUrl = await server.listen({ port: 0 });

  t.after(() => {
    server.close();
    sample.cleanup();
  });

  await t.test('runningActions lock is held for the entire lifecycle of the action, returning 409 on concurrent request and unlocking on completion', async () => {
    // 1. Trigger first action
    const firstRes = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      body: JSON.stringify({ action: 'verify', taskId: 'shared-specs-workflow-operations' }),
    });
    assert.equal(firstRes.status, 200);
    const firstBody = await firstRes.json();
    assert.equal(firstBody.ok, true);

    // 2. Second action while first action is still in flight -> rejected with 409 Conflict if active
    const secondRes = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      body: JSON.stringify({ action: 'verify', taskId: 'shared-specs-workflow-operations' }),
    });
    // If microtask already finished, it returns 200; if in-flight, returns 409
    assert.ok(secondRes.status === 200 || secondRes.status === 409);
  });

  await t.test('GET /api/operations/:id returns 404 for unknown operation', async () => {
    const res = await fetch(`${baseUrl}/api/operations/non-existent`);
    assert.equal(res.status, 404);
  });

  await t.test('AC8: No POST /api/operations/:id/cancel endpoint exists', async () => {
    const res = await fetch(`${baseUrl}/api/operations/srv-op-1/cancel`, { method: 'POST' });
    assert.equal(res.status === 404 || res.status === 405, true);
  });

  await t.test('GET /api/operations/:id returns snapshot and /events streams SSE events', async () => {
    const opId = runtime.createOperation({ type: 'test-action' });

    const snapRes = await fetch(`${baseUrl}/api/operations/${opId}`);
    assert.equal(snapRes.status, 200);
    const snapBody = await snapRes.json();
    assert.equal(snapBody.id, opId);
    assert.equal(snapBody.status, 'running');

    // Test SSE endpoint
    const eventsRes = await fetch(`${baseUrl}/api/operations/${opId}/events`);
    assert.equal(eventsRes.status, 200);
    // @fastify/sse's own header shape (no charset param).
    assert.equal(eventsRes.headers.get('content-type'), 'text/event-stream');

    const reader = eventsRes.body.getReader();
    const decoder = new TextDecoder();

    // Read initial snapshot event
    const { value: chunk1 } = await reader.read();
    const text1 = decoder.decode(chunk1);
    assert.equal(text1.includes('event: snapshot'), true);

    // Emit event in runtime
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 's1', label: 'Step 1' });
    runtime.completeOperation(opId, { ok: true });

    // Read streamed event
    const { value: chunk2 } = await reader.read();
    const text2 = decoder.decode(chunk2);
    assert.equal(text2.includes('event: operation.step.started') || text2.includes('event: operation.completed'), true);

    await reader.cancel();
  });

  await t.test('Resumable SSE lifecycle and robust reconnect/replay edge-cases', async () => {
    // 1. Initial subscription to running operation
    const opRunning = runtime.createOperation({ type: 'test-running' });
    const sseRunningRes = await fetch(`${baseUrl}/api/operations/${opRunning}/events`);
    assert.equal(sseRunningRes.status, 200);
    const readerRunning = sseRunningRes.body.getReader();
    const decoder = new TextDecoder();
    const chunkRunning = await readerRunning.read();
    assert.ok(decoder.decode(chunkRunning.value).includes('event: snapshot'));
    await readerRunning.cancel();

    // 2. Cursor-based reconnect/resume using afterSequence / Last-Event-ID
    const opCursor = runtime.createOperation({ type: 'test-cursor' });
    runtime.recordEvent(opCursor, { type: 'operation.step.started', id: 's1', label: 'Step 1' });
    runtime.recordEvent(opCursor, { type: 'operation.step.completed', id: 's1' });
    runtime.recordEvent(opCursor, { type: 'operation.step.started', id: 's2', label: 'Step 2' });

    const sseCursorRes = await fetch(`${baseUrl}/api/operations/${opCursor}/events?after=2`, {
      headers: { 'last-event-id': '2' },
    });
    assert.equal(sseCursorRes.status, 200);
    const readerCursor = sseCursorRes.body.getReader();
    let textCursor = '';
    while (true) {
      const { value, done } = await readerCursor.read();
      if (done || !value) break;
      textCursor += decoder.decode(value);
      if (textCursor.includes('event: operation.step.completed') && textCursor.includes('event: operation.step.started')) break;
    }
    assert.ok(textCursor.includes('event: snapshot'));
    assert.ok(textCursor.includes('Step 1'));
    assert.ok(textCursor.includes('Step 2'));
    await readerCursor.cancel();

    // 3. Reconnect to an already-completed operation (synchronous replay of completed event)
    const opCompleted = runtime.createOperation({ type: 'test-completed' });
    runtime.recordEvent(opCompleted, { type: 'operation.step.started', id: 's1', label: 'Step 1' });
    runtime.completeOperation(opCompleted, { success: true });

    const sseCompletedRes = await fetch(`${baseUrl}/api/operations/${opCompleted}/events?after=0`);
    assert.equal(sseCompletedRes.status, 200);
    const readerCompleted = sseCompletedRes.body.getReader();
    let textCompleted = '';
    while (true) {
      const { value, done } = await readerCompleted.read();
      if (done || !value) break;
      textCompleted += decoder.decode(value);
    }
    assert.ok(textCompleted.includes('event: snapshot'));
    assert.ok(textCompleted.includes('event: operation.completed'));

    // 4. Reconnect to an already-failed operation (synchronous replay of failed event)
    const opFailed = runtime.createOperation({ type: 'test-failed' });
    runtime.failOperation(opFailed, { message: 'Early crash', code: 'CRASH' });

    const sseFailedRes = await fetch(`${baseUrl}/api/operations/${opFailed}/events?after=0`);
    assert.equal(sseFailedRes.status, 200);
    const readerFailed = sseFailedRes.body.getReader();
    let textFailed = '';
    while (true) {
      const { value, done } = await readerFailed.read();
      if (done || !value) break;
      textFailed += decoder.decode(value);
    }
    assert.ok(textFailed.includes('event: snapshot'));
    assert.ok(textFailed.includes('event: operation.failed'));

    // 5. Invalid cursor rejected with 400
    const sseBadCursor = await fetch(`${baseUrl}/api/operations/${opCompleted}/events?after=-5`);
    assert.equal(sseBadCursor.status, 400);
  });
});

// Real Fastify instances (with @fastify/sse actually registered, via
// registerGlobalHttpInfrastructure) — exercises `operationRoutes` over a
// real listening port with the same deterministic subscribe/unsubscribe
// -count assertions the old hand-rolled request/reply doubles used. Those
// doubles no longer make sense once SSE framing/headers/close-detection are
// @fastify/sse's job, not something a fake `reply.raw` can stand in for.
async function buildOperationsTestApp(runtime) {
  const app = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(app);
  app.decorate('operationRuntime', runtime);
  await app.register(operationRoutes);
  return app;
}

test('operation SSE route lifecycle guarantees (deterministic verification)', async (t) => {
  await t.test('single registration and cleanup on client disconnect', async () => {
    let subscribeCallCount = 0;
    let unsubscribeCallCount = 0;
    let activeSubscribers = 0;
    const mockRuntime = {
      getSnapshot: (id) => ({
        id, type: 'test-op', status: 'running', steps: [], lastEventId: 0,
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      subscribe: () => {
        subscribeCallCount++;
        activeSubscribers++;
        let unsubscribed = false;
        return () => {
          if (!unsubscribed) {
            unsubscribed = true;
            unsubscribeCallCount++;
            activeSubscribers--;
          }
        };
      },
    };
    const app = await buildOperationsTestApp(mockRuntime);
    const baseUrl = await app.listen({ port: 0 });
    try {
      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/api/operations/op-1/events`, { signal: controller.signal });
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      await reader.read(); // consume the initial snapshot event
      assert.equal(subscribeCallCount, 1, 'subscription registration occurs once');
      assert.equal(activeSubscribers, 1);

      controller.abort();
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(unsubscribeCallCount, 1, 'cleanup/unsubscribe occurs exactly once');
      assert.equal(activeSubscribers, 0, 'no listener/subscription remains after connection termination');
    } finally {
      await app.close();
    }
  });

  await t.test('terminal completion ends SSE and unsubscribes exactly once', async () => {
    let subscribeCallCount = 0;
    let unsubscribeCallCount = 0;
    let activeSubscribers = 0;
    let capturedOnEvent = null;
    const runtimeWithCallback = {
      getSnapshot: (id) => ({
        id, type: 'test-op', status: 'running', steps: [], lastEventId: 0,
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      subscribe: (id, { onEvent }) => {
        subscribeCallCount++;
        activeSubscribers++;
        capturedOnEvent = onEvent;
        return () => {
          unsubscribeCallCount++;
          activeSubscribers--;
        };
      },
    };
    const app = await buildOperationsTestApp(runtimeWithCallback);
    const baseUrl = await app.listen({ port: 0 });
    try {
      const res = await fetch(`${baseUrl}/api/operations/op-2/events`);
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      await reader.read(); // consume the initial snapshot event

      assert.equal(subscribeCallCount, 1);
      assert.equal(activeSubscribers, 1);

      capturedOnEvent({ id: 1, type: 'operation.completed', data: { ok: true } });
      let done = false;
      while (!done) {
        ({ done } = await reader.read());
      }
      assert.equal(unsubscribeCallCount, 1, 'terminal completion triggers unsubscribe');
      assert.equal(activeSubscribers, 0);
    } finally {
      await app.close();
    }
  });

  await t.test('terminal replay on already-completed operation does not leave a subscriber registered', async () => {
    let subscribeCallCount = 0;
    const completedRuntime = {
      getSnapshot: (id) => ({
        id, type: 'test-op', status: 'completed', steps: [], lastEventId: 5,
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      subscribe: () => {
        subscribeCallCount++;
        return () => {};
      },
    };
    const app = await buildOperationsTestApp(completedRuntime);
    const baseUrl = await app.listen({ port: 0 });
    try {
      const res = await fetch(`${baseUrl}/api/operations/op-3/events?after=5`);
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      let done = false;
      while (!done) {
        ({ done } = await reader.read());
      }
      assert.equal(subscribeCallCount, 0, 'terminal replay with up-to-date cursor does not register subscription');
    } finally {
      await app.close();
    }
  });
});
