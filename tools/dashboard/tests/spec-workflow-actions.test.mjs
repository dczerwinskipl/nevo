import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeBatchStopReason,
  runBatchTaskAction,
  runDirectTaskAction,
  runFinalizeAction,
} from '../ui/screens/specification-detail/spec-workflow-actions.ts';

function task(id) {
  return { id, title: id, status: 'ready', order: 1, dependsOn: [], blockedBy: [] };
}

function completed(snapshot = { status: 'completed' }) {
  return { kind: 'completed', snapshot };
}
function failed(snapshot = { status: 'failed' }) {
  return { kind: 'failed', snapshot };
}
function timeout(snapshot = { status: 'running' }) {
  return { kind: 'timeout', snapshot };
}
function error(message = 'boom') {
  return { kind: 'error', message };
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
    {
      execute: async () => ({ ok: true, operationId: 'op-2' }),
      onOperationStarted: (id, title) => started.push({ id, title }),
    },
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
  await assert.doesNotReject(() =>
    runDirectTaskAction(
      {
        execute: async () => {
          throw new Error('boom');
        },
        onOperationStarted: (id, title) => started.push({ id, title }),
      },
      task('t4'),
      'approve',
    ),
  );
  assert.deepEqual(started, []);
});

// ── runBatchTaskAction: fail-closed sequential execution ─────────────────────────────

test('1. completed operation -> next task starts', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => completed(),
    },
    [task('a'), task('b'), task('c')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b', 'c']);
});

test('2. failed operation -> next task does not start', async () => {
  const executed = [];
  const stopped = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async (id) => (id === 'op-a' ? failed() : completed()),
      onBatchStopped: (info) => stopped.push(info),
    },
    [task('a'), task('b'), task('c')],
    'approve',
  );
  assert.deepEqual(executed, ['a'], 'only the failing task ran — the batch stopped there');
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].taskId, 'a');
  assert.equal(stopped[0].outcome.kind, 'failed');
});

test('3. operation remains running until timeout -> next task does not start', async () => {
  const executed = [];
  const stopped = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => timeout(),
      onBatchStopped: (info) => stopped.push(info),
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a'], 'a timeout is a safety stop, not evidence of completion — task b must never start');
  assert.equal(stopped[0].outcome.kind, 'timeout');
});

test('4. initial operation-status fetch fails -> next task does not start', async () => {
  const executed = [];
  const stopped = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => error('status unavailable'),
      onBatchStopped: (info) => stopped.push(info),
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a']);
  assert.equal(stopped[0].outcome.kind, 'error');
  assert.equal(stopped[0].outcome.message, 'status unavailable');
});

test('5. SSE failure followed by a terminal snapshot behaves according to that terminal state (completed case)', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      // Simulates waitForOperationTerminal's own SSE-error-then-poll fallback already
      // having resolved a genuine terminal state — the batch must treat it exactly like
      // any other completed outcome, no separate "SSE failed" branch.
      waitForTerminal: async () => completed({ status: 'completed' }),
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b']);
});

test('5b. SSE failure followed by a terminal failed snapshot stops the batch', async () => {
  const executed = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        executed.push(taskId);
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => failed({ status: 'failed' }),
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a']);
});

test('6. no two batch task operations can become concurrently active through the timeout/error path', async () => {
  // A batch of 3 tasks where task "a" times out: execute() must never be called for
  // "b"/"c" while "a"'s own operation is unresolved server-side — i.e. exactly one
  // execute() call happens, ever, for this batch.
  let concurrentExecuteCalls = 0;
  let maxConcurrentExecuteCalls = 0;
  const executeCalls = [];

  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => {
        concurrentExecuteCalls += 1;
        maxConcurrentExecuteCalls = Math.max(maxConcurrentExecuteCalls, concurrentExecuteCalls);
        executeCalls.push(taskId);
        await new Promise((r) => setTimeout(r, 1));
        concurrentExecuteCalls -= 1;
        return { ok: true, operationId: `op-${taskId}` };
      },
      onOperationStarted: () => {},
      waitForTerminal: async () => timeout(),
    },
    [task('a'), task('b'), task('c')],
    'approve',
  );

  assert.equal(
    maxConcurrentExecuteCalls,
    1,
    'execute() is never called for a later task while an earlier one is still unresolved',
  );
  assert.deepEqual(executeCalls, ['a'], 'the timeout on "a" prevents "b" and "c" from ever being dispatched');
});

test('runBatchTaskAction numbers per-task titles with the batch position and total', async () => {
  const started = [];
  await runBatchTaskAction(
    {
      execute: async ({ taskId }) => ({ ok: true, operationId: `op-${taskId}` }),
      onOperationStarted: (id, title) => started.push(title),
      waitForTerminal: async () => completed(),
    },
    [task('a'), task('b')],
    'verify',
  );
  assert.deepEqual(started, ['Weryfikacja zadania (1/2): a', 'Weryfikacja zadania (2/2): b']);
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
      waitForTerminal: async () => completed(),
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
      waitForTerminal: async (id) => {
        waited.push(id);
        return completed();
      },
    },
    [task('a'), task('b')],
    'approve',
  );
  assert.deepEqual(executed, ['a', 'b']);
  assert.deepEqual(waited, ['op-b'], 'no wait was attempted for the task that spawned no operation');
});

test('describeBatchStopReason produces a distinct, non-empty explanation for each non-completed outcome kind', () => {
  const failedText = describeBatchStopReason(failed());
  const timeoutText = describeBatchStopReason(timeout());
  const errorText = describeBatchStopReason(error('disk full'));

  assert.ok(failedText.length > 0);
  assert.ok(timeoutText.length > 0);
  assert.ok(errorText.includes('disk full'));
  assert.notEqual(failedText, timeoutText);
  assert.notEqual(timeoutText, errorText);
});

// ── runFinalizeAction ─────────────────────────────────────────────────────────────────

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
    () => {
      closed = true;
    },
  );
  assert.equal(closed, true);
  assert.deepEqual(started, [{ id: 'op-final', title: 'Finalizacja specyfikacji' }]);
});

test('runFinalizeAction leaves the dialog open (does not call onClosed) when execute rejects', async () => {
  let closed = false;
  await runFinalizeAction(
    {
      execute: async () => {
        throw new Error('gate failed');
      },
      onOperationStarted: () => {},
    },
    () => {
      closed = true;
    },
  );
  assert.equal(closed, false, 'dialog stays open so its own error state can display the failure');
});
