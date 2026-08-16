import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOperationRuntime, OperationNotFoundError } from '../server/operations.mjs';
import { executeSpecificationAction } from '../server/actions.mjs';
import { createDashboardServer, listen } from '../server/index.mjs';

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
  mkdirSync(changeDir, { recursive: true });
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

test('executeSpecificationAction — spawn-based single process runner', async (t) => {
  await t.test('AC1 & AC10: returns operationId immediately and spawns exactly one process with no preflight spawn', () => {
    const sample = fixture();
    try {
      const spawns = [];
      let childProcess = null;

      const mockSpawner = (root, args) => {
        spawns.push({ root, args });
        childProcess = createMockChildProcess();
        return childProcess;
      };

      const runtime = createOperationRuntime({ idFactory: () => 'op-123' });

      const result = executeSpecificationAction({
        slug: 'sample-change',
        action: 'verify',
        taskId: 'design-it',
        activeDir: sample.activeDir,
        root: sample.root,
        spawnSpecs: mockSpawner,
        operationRuntime: runtime,
      });

      assert.equal(result.ok, true);
      assert.equal(result.operationId, 'op-op-123');
      assert.equal(result.action, 'verify');
      assert.equal(result.taskId, 'design-it');

      // Exactly one spawn (no pre-flight gate check)
      assert.equal(spawns.length, 1);
      assert.deepEqual(spawns[0].args, ['verify', 'sample-change', 'design-it']);

      // Operation is currently running (AC1)
      let snapshot = runtime.getSnapshot('op-op-123');
      assert.equal(snapshot.status, 'running');

      // Child process writes progress event then closes
      childProcess.stdout.write('@@nevo:progress@@ {"type":"operation.step.started","id":"verify-trans","label":"Check status"}\n');
      childProcess.stdout.write('@@nevo:progress@@ {"type":"operation.step.completed","id":"verify-trans"}\n');
      childProcess.stdout.write('{"ok":true,"action":"verify"}\n');
      childProcess.emit('close', 0, null);

      snapshot = runtime.getSnapshot('op-op-123');
      assert.equal(snapshot.status, 'completed');
      assert.equal(snapshot.steps[0].id, 'verify-trans');
      assert.equal(snapshot.steps[0].status, 'completed');
    } finally {
      sample.cleanup();
    }
  });

  await t.test('AC7: existing uninstrumented command output completes successfully via spawn runner', () => {
    const sample = fixture();
    try {
      let childProcess = null;
      const mockSpawner = () => {
        childProcess = createMockChildProcess();
        return childProcess;
      };

      const runtime = createOperationRuntime({ idFactory: () => 'op-uninstrumented' });

      executeSpecificationAction({
        slug: 'sample-change',
        action: 'approve',
        taskId: 'design-it',
        activeDir: sample.activeDir,
        root: sample.root,
        spawnSpecs: mockSpawner,
        operationRuntime: runtime,
      });

      childProcess.stdout.write('plain stdout from older specs.mjs\n');
      childProcess.stdout.write('{"result":{"ok":true}}\n');
      childProcess.emit('close', 0, null);

      const snapshot = runtime.getSnapshot('op-op-uninstrumented');
      assert.equal(snapshot.status, 'completed');
      assert.deepEqual(snapshot.result, { result: { ok: true } });
    } finally {
      sample.cleanup();
    }
  });
});

test('Dashboard server — /api/operations routes', async (t) => {
  const runtime = createOperationRuntime({ idFactory: () => 'srv-op-1' });
  const server = createDashboardServer({
    operationRuntime: runtime,
  });
  const baseUrl = await listen(server, { port: 0 });

  t.after(() => server.close());

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
    assert.equal(eventsRes.headers.get('content-type'), 'text/event-stream; charset=utf-8');

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
});
