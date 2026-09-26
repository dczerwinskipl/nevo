// Test suite for Deterministic Sequential Queue (Task 28, D32, D33, D34, D38, D45).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateTaskQueue,
  computeQueueState,
  normalizeTaskSelection,
  saveTaskQueue,
  loadTaskQueue,
  enqueueTasks,
  dequeueTask,
  clearTaskQueue,
  listTaskQueues,
} from '../specs/workflow/queue/index.mjs';
import { createRemediationRecord } from '../specs/workflow/remediation-record.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('AC1: Given a selection containing a task blocked by an unselected, unsatisfied dependency, the queue function returns a warning naming that dependency without refusing the selection', () => {
  const change = {
    id: 'demo-change',
    tasks: [
      { id: 'task-a', order: 1 },
      { id: 'task-b', order: 2, depends_on: ['task-a'] },
    ],
  };

  // Readiness map where task-b is blocked by unsatisfied task-a
  const readinessByTaskId = {
    'task-b': {
      ready: false,
      code: 'DEPENDENCY_UNSATISFIED',
      blockedBy: ['task-a'],
      reason: "Task 'task-b' is blocked by unsatisfied dependencies: task-a",
    },
  };

  // Selection only includes task-b (task-a is unselected)
  const result = evaluateTaskQueue({
    change,
    selectedTaskIds: ['task-b'],
    readinessByTaskId,
  });

  assert.ok(result);
  assert.equal(result.eligible.length, 0);
  assert.equal(result.nextRunnable, null);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.warnings[0], {
    taskId: 'task-b',
    blockedByTaskId: 'task-a',
  });

  // If task-a is also in the selection, it's not "unselected", so no unselected warning is issued for task-a
  const readinessWithBoth = {
    'task-a': {
      ready: true,
      targetStep: { id: 'implementation', schedulingPriority: 0 },
    },
    'task-b': {
      ready: false,
      code: 'DEPENDENCY_UNSATISFIED',
      blockedBy: ['task-a'],
    },
  };

  const resultWithBoth = evaluateTaskQueue({
    change,
    selectedTaskIds: ['task-a', 'task-b'],
    readinessByTaskId: readinessWithBoth,
  });

  assert.equal(resultWithBoth.warnings.length, 0);
  assert.equal(resultWithBoth.eligible.length, 1);
  assert.equal(resultWithBoth.nextRunnable.taskId, 'task-a');
});

test("AC2: Given a selection containing a suspended task, the queue function excludes it from eligible (via ExecutionReadiness's own refusal) — proven directly, not inferred", () => {
  const change = {
    id: 'demo-change',
    tasks: [
      { id: 'task-normal', order: 1 },
      { id: 'task-suspended', order: 2 },
    ],
  };

  const readinessByTaskId = {
    'task-normal': {
      ready: true,
      targetStep: { id: 'implementation', schedulingPriority: 0 },
    },
    'task-suspended': {
      ready: false,
      code: 'TASK_SUSPENDED',
      reason: "Task 'task-suspended' is suspended: regression found",
      suspensions: [{ groupId: 'rem-1', reason: 'regression found', advisory: false }],
    },
  };

  const result = evaluateTaskQueue({
    change,
    selectedTaskIds: ['task-normal', 'task-suspended'],
    readinessByTaskId,
  });

  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].taskId, 'task-normal');
  assert.equal(result.nextRunnable?.taskId, 'task-normal');

  // Suspended task alone produces no nextRunnable and is excluded from eligible
  const resultSuspendedOnly = evaluateTaskQueue({
    change,
    selectedTaskIds: ['task-suspended'],
    readinessByTaskId,
  });

  assert.equal(resultSuspendedOnly.eligible.length, 0);
  assert.equal(resultSuspendedOnly.nextRunnable, null);
});

test('AC3: Given a task with no suspension of its own, but a different task in the same spec has a pending human interaction, the first task eligibility is unaffected', () => {
  const change = {
    id: 'demo-change',
    tasks: [
      { id: 'task-awaiting-human', order: 1 },
      { id: 'task-independent', order: 2 },
    ],
  };

  const readinessByTaskId = {
    'task-awaiting-human': {
      ready: false,
      code: 'EXECUTOR_MISMATCH',
      targetStep: { id: 'human-verification', executor: 'human' },
      reason: 'Step is owned by human',
    },
    'task-independent': {
      ready: true,
      targetStep: { id: 'implementation', schedulingPriority: 0, executor: 'agent' },
    },
  };

  const result = evaluateTaskQueue({
    change,
    selectedTaskIds: ['task-awaiting-human', 'task-independent'],
    readinessByTaskId,
  });

  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].taskId, 'task-independent');
  assert.equal(result.nextRunnable?.taskId, 'task-independent');
});

test('AC4: Given three eligible items (T1 review at schedulingPriority: 10, T2/T3 implementation at the default 0), nextRunnable is always one of T2/T3 until neither remains eligible, only then T1 review', () => {
  const change = {
    id: 'demo-change',
    tasks: [
      { id: 'T1', order: 1 },
      { id: 'T2', order: 2 },
      { id: 'T3', order: 3 },
    ],
  };

  // State 1: All three are eligible. T1 has priority 10 (e.g. review step), T2/T3 have default 0 (implementation step)
  const readinessState1 = {
    T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    T2: { ready: true, targetStep: { id: 'implementation', schedulingPriority: 0 } },
    T3: { ready: true, targetStep: { id: 'implementation', schedulingPriority: 0 } },
  };

  const res1 = evaluateTaskQueue({
    change,
    selectedTaskIds: ['T1', 'T2', 'T3'],
    readinessByTaskId: readinessState1,
  });

  assert.equal(res1.eligible.length, 3);
  // T2 and T3 both have priority 0. T2 has order 2, T3 has order 3.
  assert.equal(res1.nextRunnable.taskId, 'T2');
  assert.equal(res1.eligible[0].taskId, 'T2');
  assert.equal(res1.eligible[1].taskId, 'T3');
  assert.equal(res1.eligible[2].taskId, 'T1');

  // State 2: T2 has completed and is no longer eligible. T3 and T1 remain eligible.
  const readinessState2 = {
    T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    T2: { ready: false, code: 'WORKFLOW_TERMINAL' },
    T3: { ready: true, targetStep: { id: 'implementation', schedulingPriority: 0 } },
  };

  const res2 = evaluateTaskQueue({
    change,
    selectedTaskIds: ['T1', 'T2', 'T3'],
    readinessByTaskId: readinessState2,
  });

  assert.equal(res2.eligible.length, 2);
  assert.equal(res2.nextRunnable.taskId, 'T3');
  assert.equal(res2.eligible[0].taskId, 'T3');
  assert.equal(res2.eligible[1].taskId, 'T1');

  // State 3: T3 has also completed. Only T1 remains eligible.
  const readinessState3 = {
    T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    T2: { ready: false, code: 'WORKFLOW_TERMINAL' },
    T3: { ready: false, code: 'WORKFLOW_TERMINAL' },
  };

  const res3 = evaluateTaskQueue({
    change,
    selectedTaskIds: ['T1', 'T2', 'T3'],
    readinessByTaskId: readinessState3,
  });

  assert.equal(res3.eligible.length, 1);
  assert.equal(res3.nextRunnable.taskId, 'T1');
  assert.equal(res3.eligible[0].taskId, 'T1');

  // State 4: T1 completes. None remaining.
  const readinessState4 = {
    T1: { ready: false, code: 'WORKFLOW_TERMINAL' },
    T2: { ready: false, code: 'WORKFLOW_TERMINAL' },
    T3: { ready: false, code: 'WORKFLOW_TERMINAL' },
  };

  const res4 = evaluateTaskQueue({
    change,
    selectedTaskIds: ['T1', 'T2', 'T3'],
    readinessByTaskId: readinessState4,
  });

  assert.equal(res4.eligible.length, 0);
  assert.equal(res4.nextRunnable, null);
});

test('AC5: Invariant test: across a realistic multi-task, multi-transition fixture run to completion, nextRunnable is never an array/set of more than one item at any inspected point', () => {
  const change = {
    id: 'invariant-spec',
    tasks: [
      { id: 'T1', order: 10 },
      { id: 'T2', order: 20 },
      { id: 'T3', order: 30 },
    ],
  };

  const steps = [
    // Step 0: Initial state - T1 and T2 ready for implementation, T3 blocked
    {
      T1: { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
      T2: { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
      T3: { ready: false, code: 'DEPENDENCY_UNSATISFIED', blockedBy: ['T1'] },
    },
    // Step 1: T1 finishes impl, enters review (prio 10); T3 unblocks (prio 0)
    {
      T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T2: { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
      T3: { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
    },
    // Step 2: T2 finishes impl, enters review (prio 10)
    {
      T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T2: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T3: { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
    },
    // Step 3: T3 finishes impl, enters review (prio 10)
    {
      T1: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T2: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T3: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    },
    // Step 4: T1 finishes review, waiting for human
    {
      T1: { ready: false, code: 'EXECUTOR_MISMATCH' },
      T2: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
      T3: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    },
    // Step 5: T2 finishes review, waiting for human
    {
      T1: { ready: false, code: 'EXECUTOR_MISMATCH' },
      T2: { ready: false, code: 'EXECUTOR_MISMATCH' },
      T3: { ready: true, targetStep: { id: 'review', schedulingPriority: 10 } },
    },
    // Step 6: T3 finishes review, waiting for human
    {
      T1: { ready: false, code: 'EXECUTOR_MISMATCH' },
      T2: { ready: false, code: 'EXECUTOR_MISMATCH' },
      T3: { ready: false, code: 'EXECUTOR_MISMATCH' },
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    const res = evaluateTaskQueue({
      change,
      selectedTaskIds: ['T1', 'T2', 'T3'],
      readinessByTaskId: steps[i],
    });

    // Invariant assertion: nextRunnable must ALWAYS be exactly one object or null — never an Array or Set
    assert.ok(
      res.nextRunnable === null || (typeof res.nextRunnable === 'object' && !Array.isArray(res.nextRunnable) && !(res.nextRunnable instanceof Set)),
      `Step ${i} nextRunnable violated single-item invariant: ${JSON.stringify(res.nextRunnable)}`
    );

    if (res.eligible.length > 0) {
      assert.notEqual(res.nextRunnable, null);
      assert.equal(res.nextRunnable.taskId, res.eligible[0].taskId);
    } else {
      assert.equal(res.nextRunnable, null);
    }
  }
});

test('AC6: Passing a remediation group task-id set through this same queue behaves identically to a manual selection of the same ids', () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-queue-' + Date.now());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const change = {
      id: 'rem-spec',
      tasks: [
        { id: 'rem-task-1', order: 1 },
        { id: 'rem-task-2', order: 2 },
        { id: 'other-task', order: 3 },
      ],
    };

    const remediationRecord = createRemediationRecord({
      repoRoot: tmpRoot,
      change: 'rem-spec',
      invalidatedDependency: { taskId: 'dep-root', releaseEpoch: { step: 'impl', attempt: 1 } },
      members: [
        { taskId: 'rem-task-1', role: 'releasing-task' },
        { taskId: 'rem-task-2', role: 'consumer' },
      ],
    });

    const readinessByTaskId = {
      'rem-task-1': { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
      'rem-task-2': { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
      'other-task': { ready: true, targetStep: { id: 'impl', schedulingPriority: 0 } },
    };

    // 1. Evaluate with remediation record object directly
    const resFromRemediation = evaluateTaskQueue({
      change,
      selectedTaskIds: remediationRecord,
      readinessByTaskId,
    });

    // 2. Evaluate with manual array of identical task IDs
    const resFromManual = evaluateTaskQueue({
      change,
      selectedTaskIds: ['rem-task-1', 'rem-task-2'],
      readinessByTaskId,
    });

    // Must behave identically
    assert.deepEqual(resFromRemediation.eligible, resFromManual.eligible);
    assert.deepEqual(resFromRemediation.nextRunnable, resFromManual.nextRunnable);
    assert.deepEqual(resFromRemediation.warnings, resFromManual.warnings);
    assert.equal(resFromRemediation.eligible.length, 2);
    assert.equal(resFromRemediation.nextRunnable.taskId, 'rem-task-1');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC7: tools/specs/workflow/queue/** contains zero imports of tools/dashboard/** — an explicit automated boundary check', () => {
  const queueDir = path.join(REPO_ROOT, 'tools', 'specs', 'workflow', 'queue');
  assert.ok(fs.existsSync(queueDir), `Queue directory must exist: ${queueDir}`);

  const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.mjs'));
  assert.ok(files.length > 0, 'Must have at least one queue file');

  const dashboardImportRegex = /(from\s+['"][^'"]*dashboard[^'"]*['"]|import\s+['"][^'"]*dashboard[^'"]*['"])/i;

  for (const file of files) {
    const fullPath = path.join(queueDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const match = content.match(dashboardImportRegex);
    assert.equal(
      match,
      null,
      `Violation: file ${file} imports from dashboard: ${match?.[0]}`
    );
  }
});

test('Durable queue store (saveTaskQueue, loadTaskQueue, enqueueTasks, dequeueTask, clearTaskQueue, listTaskQueues)', () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-store-' + Date.now());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const changeSlug = 'test-change';

    // Initial state: not found
    assert.equal(loadTaskQueue(tmpRoot, changeSlug), null);

    // Save initial queue
    const saved = saveTaskQueue(tmpRoot, changeSlug, ['t1', 't2']);
    assert.ok(saved);
    assert.deepEqual(saved.taskIds, ['t1', 't2']);
    assert.ok(saved.eligibleAt.t1);
    assert.ok(saved.eligibleAt.t2);

    // Load saved queue
    const loaded = loadTaskQueue(tmpRoot, changeSlug);
    assert.deepEqual(loaded.taskIds, ['t1', 't2']);

    // Enqueue additional task
    const afterEnqueue = enqueueTasks(tmpRoot, changeSlug, ['t3', 't1']);
    assert.deepEqual(afterEnqueue.taskIds, ['t1', 't2', 't3']); // t1 deduplicated

    // Dequeue task
    const afterDequeue = dequeueTask(tmpRoot, changeSlug, 't2');
    assert.deepEqual(afterDequeue.taskIds, ['t1', 't3']);
    assert.equal(afterDequeue.eligibleAt.t2, undefined);

    // List queues
    const list = listTaskQueues(tmpRoot);
    assert.equal(list.length, 1);
    assert.equal(list[0].changeSlug, changeSlug);

    // Clear queue
    assert.equal(clearTaskQueue(tmpRoot, changeSlug), true);
    assert.equal(loadTaskQueue(tmpRoot, changeSlug), null);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Tie-break ordering: schedulingPriority -> task.order -> eligibleAt (FIFO)', () => {
  const change = {
    id: 'tie-break-change',
    tasks: [
      { id: 'T-alpha', order: 10 },
      { id: 'T-beta', order: 10 },
    ],
  };

  const readinessByTaskId = {
    'T-alpha': { ready: true, targetStep: { id: 'step', schedulingPriority: 0 } },
    'T-beta': { ready: true, targetStep: { id: 'step', schedulingPriority: 0 } },
  };

  // Both have priority 0 and order 10. T-beta became eligible earlier (timestamp 100 vs 200).
  const eligibleAtMap = {
    'T-alpha': 200,
    'T-beta': 100,
  };

  const res = evaluateTaskQueue({
    change,
    selectedTaskIds: ['T-alpha', 'T-beta'],
    readinessByTaskId,
    eligibleAtMap,
  });

  assert.equal(res.eligible.length, 2);
  assert.equal(res.nextRunnable.taskId, 'T-beta');
  assert.equal(res.eligible[0].taskId, 'T-beta');
  assert.equal(res.eligible[1].taskId, 'T-alpha');
});
