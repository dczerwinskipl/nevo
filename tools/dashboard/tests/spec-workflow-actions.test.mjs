import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runBatchTaskAction,
  runDirectTaskAction,
  runFinalizeAction,
} from '../src/components/spec-detail/spec-workflow-actions.ts';

function task(id) {
  return { id, title: id, status: 'ready', order: 1, dependsOn: [], blockedBy: [] };
}

test('runDirectTaskAction starts the returned operation with an approve-specific title', async () => {
  const started = [];
  await runDirectTaskAction(
    {
      execute: async (input) => {
        assert.deepEqual(input, { action: 'approve', taskId: 't1' });
        return { ok: true, operationId: 'op-1' };
      },
      onOperationStarted: (id, title) => started.push({ id, title }),
    },
    task('t1'),
    'approve',
  );

  assert.deepEqual(started, [{ id: 'op-1', title: 'Zatwierdzanie zadania: t1' }]);
});

test('runDirectTaskAction uses a verify-specific title for any non-approve action', async () => {
  const started = [];
  await runDirectTaskAction(
    { execute: async () => ({ ok: true, operationId: 'op-2' }), onOperationStarted: (id, title) => started.push({ id, title }) },
    task('t2'),
    'verify',
  );
  assert.deepEqual(started, [{ id: 'op-2', title: 'Weryfikacja zadania: t2' }]);
});

test('runDirectTaskAction does nothing when the action completes without spawning an operation', async () => {
  const started = [];
  await runDirectTaskAction(
    { execute: async () => ({ ok: true }), onOperationStarted: (id, title) => started.push({ id, title }) },
    task('t3'),
    'approve',
  );
  assert.deepEqual(started, []);
});

test('runDirectTaskAction swallows a rejected execute() (surfaced via mutation state, not here)', async () => {
  const started = [];
  await assert.doesNotReject(() => runDirectTaskAction(
    { execute: async () => { throw new Error('boom'); }, onOperationStarted: (id, title) => started.push({ id, title }) },
    task('t4'),
    'approve',
  ));
  assert.deepEqual(started, []);
});

test('runBatchTaskAction dispatches tasks strictly in order, only starting task N+1 after task N terminates', async () => {
  const order = [];
  const tasks = [task('a'), task('b'), task('c')];

  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        order.push(`execute:${taskId}`);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: (id) => order.push(`started:${id}`),
      waitForTerminal: async (id) => {
        order.push(`wait:${id}`);
        return { status: 'completed' };
      },
    },
    tasks,
    'approve',
  );

  assert.deepEqual(order, [
    'execute:a', 'started:op-a', 'wait:op-a',
    'execute:b', 'started:op-b', 'wait:op-b',
    'execute:c', 'started:op-c', 'wait:op-c',
  ]);
});

test('runBatchTaskAction numbers per-task titles with the batch position and total', async () => {
  const started = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => ({ ok: true, operationId: `op-${taskId}` }),
      onOperationStarted: (id, title) => started.push(title),
      waitForTerminal: async () => ({ status: 'completed' }),
    },
    [task('a'), task('b')],
    'verify',
  );
  assert.deepEqual(started, [
    'Weryfikacja zadania (1/2): a',
    'Weryfikacja zadania (2/2): b',
  ]);
});

test('runBatchTaskAction stops immediately when an operation is reported failed — later tasks never run', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => { executed.push(taskId); return { ok: true, operationId: `op-${taskId}` }; },
      onOperationStarted: () => {},
      waitForTerminal: async (id) => (id === 'op-a' ? { status: 'failed' } : { status: 'completed' }),
    },
    [task('a'), task('b'), task('c')],
    'approve',
  );
  assert.deepEqual(executed, ['a'], 'only the failing task ran — the batch stopped there');
});

test('runBatchTaskAction stops when dispatching an action itself throws (no operation to wait on)', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        if (taskId === 'b') throw new Error('network error');
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => ({ status: 'completed' }),
    },
    [task('a'), task('b'), task('c')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b'], 'task c never runs once task b throws');
});

test('runBatchTaskAction continues past a task whose action completed synchronously (no operationId to wait on)', async () => {
  const executed = [];
  const waited = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        // "a" completes without spawning a trackable operation.
        return taskId === 'a' ? { ok: true } : { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async (id) => { waited.push(id); return { status: 'completed' }; },
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b']);
  assert.deepEqual(waited, ['op-b'], 'no wait was attempted for the task that spawned no operation');
});

test('runBatchTaskAction continues to the next task when waitForTerminal gives up (timeout/null) without a failed status', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => { executed.push(taskId); return { ok: true, operationId: `op-${taskId}` }; },
      onOperationStarted: () => {},
      // Simulates the best-effort timeout fallback in waitForOperationTerminal: resolves
      // null/non-terminal rather than throwing, and must not be treated as a failure.
      waitForTerminal: async () => null,
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b']);
});

test('runFinalizeAction starts the returned operation and always closes the dialog on success', async () => {
  const started = [];
  let closed = false;
  await runFinalizeAction(
    {
      execute: async (input) => {
        assert.deepEqual(input, { action: 'finalize', confirmed: true });
        return { ok: true, operationId: 'op-final' };
      },
      onOperationStarted: (id, title) => started.push({ id, title }),
    },
    () => { closed = true; },
  );
  assert.equal(closed, true);
  assert.deepEqual(started, [{ id: 'op-final', title: 'Finalizacja specyfikacji' }]);
});

test('runFinalizeAction leaves the dialog open (does not call onClosed) when execute rejects', async () => {
  let closed = false;
  await runFinalizeAction(
    { execute: async () => { throw new Error('gate failed'); }, onOperationStarted: () => {} },
    () => { closed = true; },
  );
  assert.equal(closed, false, 'dialog stays open so its own error state can display the failure');
});
