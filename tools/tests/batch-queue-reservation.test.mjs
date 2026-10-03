// Test suite for Batch Queue Reservation (Task 02, D5, D6, D18, D19, D20, D36, D38).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateBatchCompatibility,
  createGroupReservation,
  releaseGroupReservation,
  rollbackReservationSynchronously,
  listGroupReservations,
  getGroupReservation,
  isTaskBarriered,
  assessBatchReservationSettlement,
  reconcileCrashedReservation,
  evaluateTaskQueue,
  saveTaskQueue,
  loadTaskQueue,
} from '../specs/workflow/queue/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('AC1: validateBatchCompatibility accepts compatible review tasks and rejects mixed tasks, naming the incompatible member', () => {
  const definition = {
    entryStep: 'implementation',
    steps: {
      implementation: {
        id: 'implementation',
        executor: 'agent',
        transitions: [
          { to: 'review', execution: { session: 'fresh', role: 'reviewer' } },
        ],
      },
      review: {
        id: 'review',
        executor: 'agent',
        transitions: [
          { value: 'pass', to: 'human-verification' },
        ],
      },
    },
  };

  const change = {
    id: 'test-spec',
    _slug: 'test-spec',
    workflow: { definition: 'standard.yaml' },
    tasks: [
      {
        id: 'task-1',
        order: 1,
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'completed',
          history: [{ step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' }],
        },
      },
      {
        id: 'task-2',
        order: 2,
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'completed',
          history: [{ step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' }],
        },
      },
      {
        id: 'task-3',
        order: 3,
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'completed',
          history: [{ step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' }],
        },
      },
      {
        id: 'task-impl',
        order: 4,
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'active',
          history: [],
        },
      },
    ],
  };

  // 1. Three eligible review/reviewer tasks are compatible
  const resultOk = validateBatchCompatibility({
    change,
    taskIds: ['task-1', 'task-2', 'task-3'],
    definition,
  });

  assert.equal(resultOk.compatible, true);
  assert.equal(resultOk.targetStepId, 'review');
  assert.equal(resultOk.role, 'reviewer');
  assert.equal(resultOk.session, 'fresh');
  assert.deepEqual(resultOk.taskIds, ['task-1', 'task-2', 'task-3']);

  // 2. Reject mixed set naming the incompatible member
  const resultMixed = validateBatchCompatibility({
    change,
    taskIds: ['task-1', 'task-2', 'task-impl'],
    definition,
  });

  assert.equal(resultMixed.compatible, false);
  assert.equal(resultMixed.incompatibleTaskId, 'task-impl');
  assert.match(resultMixed.reason, /task-impl/);

  // 3. Reject set size < 2
  const resultSingle = validateBatchCompatibility({
    change,
    taskIds: ['task-1'],
    definition,
  });
  assert.equal(resultSingle.compatible, false);
  assert.match(resultSingle.reason, /at least 2 tasks/);
});

test('AC2: While a group is reserved, nextRunnable never returns a reserved member but does return an eligible non-member item unchanged', async () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-queue-res-' + Date.now());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const change = {
      id: 'batch-spec',
      _slug: 'batch-spec',
      tasks: [
        { id: 'task-res-1', order: 1 },
        { id: 'task-res-2', order: 2 },
        { id: 'task-free', order: 3 },
      ],
    };

    const readinessByTaskId = {
      'task-res-1': { ready: true, targetStep: { id: 'review', schedulingPriority: 0 } },
      'task-res-2': { ready: true, targetStep: { id: 'review', schedulingPriority: 0 } },
      'task-free': { ready: true, targetStep: { id: 'review', schedulingPriority: 0 } },
    };

    // 1. Before reservation, task-res-1 is nextRunnable
    let queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: ['task-res-1', 'task-res-2', 'task-free'],
      readinessByTaskId,
      repoRoot: tmpRoot,
    });
    assert.equal(queueState.eligible.length, 3);
    assert.equal(queueState.nextRunnable.taskId, 'task-res-1');

    // 2. Create durable group reservation for task-res-1 and task-res-2
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'batch-spec',
      taskIds: ['task-res-1', 'task-res-2'],
      executionConfigSnapshot: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        mode: 'edit',
        contextCapacity: { status: 'known', maxContextTokens: 200000, source: 'model-card' },
      },
    });

    assert.ok(reservation);
    assert.ok(reservation.batchExecutionId);
    assert.equal(reservation.status, 'reserved');

    // Barrier check
    assert.equal(isTaskBarriered(change, 'task-res-1', { repoRoot: tmpRoot }), true);
    assert.equal(isTaskBarriered(change, 'task-res-2', { repoRoot: tmpRoot }), true);
    assert.equal(isTaskBarriered(change, 'task-free', { repoRoot: tmpRoot }), false);

    // 3. Evaluate queue with reservation present: task-free is now nextRunnable, reserved members excluded
    queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: ['task-res-1', 'task-res-2', 'task-free'],
      readinessByTaskId,
      repoRoot: tmpRoot,
    });
    assert.equal(queueState.eligible.length, 1);
    assert.equal(queueState.eligible[0].taskId, 'task-free');
    assert.equal(queueState.nextRunnable.taskId, 'task-free');

    // 4. Release reservation: members become eligible again
    await releaseGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'batch-spec',
      batchExecutionId: reservation.batchExecutionId,
    });

    assert.equal(isTaskBarriered(change, 'task-res-1', { repoRoot: tmpRoot }), false);

    queueState = evaluateTaskQueue({
      change,
      selectedTaskIds: ['task-res-1', 'task-res-2', 'task-free'],
      readinessByTaskId,
      repoRoot: tmpRoot,
    });
    assert.equal(queueState.eligible.length, 3);
    assert.equal(queueState.nextRunnable.taskId, 'task-res-1');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC3: A crashed reservation is reconciled via the scope-aware settlement check, never clearing without proof', async () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-queue-crash-' + Date.now());
  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, 'crashed-spec');
  fs.mkdirSync(changeDir, { recursive: true });

  try {
    // Write change.yaml
    const changeYaml = `id: crashed-spec
status: in-implementation
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: member-1
    order: 1
    status: in-implementation
    workflow_progress:
      current_step: review
      state: active
      history: []
  - id: member-2
    order: 2
    status: in-implementation
    workflow_progress:
      current_step: review
      state: completed
      history: []
`;
    fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');

    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'crashed-spec',
      taskIds: ['member-1', 'member-2'],
      executionConfigSnapshot: {
        provider: 'openai',
        model: 'gpt-4o',
        mode: 'edit',
      },
    });

    // 1. member-1 is active -> settlement check must fail, reconciliation must refuse release
    const unsettledCheck = await assessBatchReservationSettlement({
      repoRoot: tmpRoot,
      changeSlug: 'crashed-spec',
      batchExecutionId: reservation.batchExecutionId,
      activeDir,
    });
    assert.equal(unsettledCheck.settled, false);
    assert.equal(unsettledCheck.reason, 'task-active');
    assert.equal(unsettledCheck.details.taskId, 'member-1');

    const reconFail = await reconcileCrashedReservation({
      repoRoot: tmpRoot,
      changeSlug: 'crashed-spec',
      batchExecutionId: reservation.batchExecutionId,
      activeDir,
    });
    assert.equal(reconFail.reconciled, false);
    assert.equal(reconFail.released, false);

    // Group reservation must remain reserved
    const curRes = getGroupReservation(tmpRoot, 'crashed-spec', reservation.batchExecutionId);
    assert.equal(curRes.status, 'reserved');

    // 2. Now settle member-1 by updating state to completed
    const settledYaml = changeYaml.replace('state: active', 'state: completed');
    fs.writeFileSync(path.join(changeDir, 'change.yaml'), settledYaml, 'utf8');

    const settledCheck = await assessBatchReservationSettlement({
      repoRoot: tmpRoot,
      changeSlug: 'crashed-spec',
      batchExecutionId: reservation.batchExecutionId,
      activeDir,
    });
    assert.equal(settledCheck.settled, true);

    const reconSuccess = await reconcileCrashedReservation({
      repoRoot: tmpRoot,
      changeSlug: 'crashed-spec',
      batchExecutionId: reservation.batchExecutionId,
      activeDir,
    });
    assert.equal(reconSuccess.reconciled, true);
    assert.equal(reconSuccess.released, true);

    const releasedRes = getGroupReservation(tmpRoot, 'crashed-spec', reservation.batchExecutionId);
    assert.equal(releasedRes.status, 'released');
    assert.equal(releasedRes.releaseReason, 'crashed-execution-settled-reconciliation');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC4: Synchronous rollback releases reservation in the same call if admission fails', async () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-queue-rollback-' + Date.now());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'rollback-spec',
      taskIds: ['roll-1', 'roll-2'],
      executionConfigSnapshot: { provider: 'test', model: 'test' },
    });

    assert.equal(isTaskBarriered('rollback-spec', 'roll-1', { repoRoot: tmpRoot }), true);

    // Simulate admission failure and synchronous rollback
    const rollback = await rollbackReservationSynchronously({
      repoRoot: tmpRoot,
      changeSlug: 'rollback-spec',
      batchExecutionId: reservation.batchExecutionId,
      error: new Error('Simulated admission failure: quota exceeded'),
    });

    assert.equal(rollback.released, true);
    assert.equal(isTaskBarriered('rollback-spec', 'roll-1', { repoRoot: tmpRoot }), false);

    const record = getGroupReservation(tmpRoot, 'rollback-spec', reservation.batchExecutionId);
    assert.equal(record.status, 'released');
    assert.match(record.releaseReason, /quota exceeded/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC5: Canonical batchExecutionId and frozen executionConfigSnapshot are persisted and contention is rejected', async () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-queue-snapshot-' + Date.now());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'snapshot-spec',
      taskIds: ['snap-1', 'snap-2'],
      executionConfigSnapshot: {
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        mode: 'edit',
        contextCapacity: {
          status: 'known',
          maxContextTokens: 200000,
          source: 'catalog',
        },
      },
    });

    assert.ok(reservation.batchExecutionId);
    assert.equal(reservation.executionConfigSnapshot.provider, 'anthropic');
    assert.equal(reservation.executionConfigSnapshot.model, 'claude-3-7-sonnet');
    assert.equal(reservation.executionConfigSnapshot.contextCapacity.status, 'known');
    assert.equal(reservation.executionConfigSnapshot.contextCapacity.maxContextTokens, 200000);

    // Contention check: attempting to reserve snap-1 again while active throws TASK_ALREADY_RESERVED
    await assert.rejects(
      async () => {
        await createGroupReservation({
          repoRoot: tmpRoot,
          changeSlug: 'snapshot-spec',
          taskIds: ['snap-1', 'snap-3'],
          executionConfigSnapshot: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
        });
      },
      { code: 'TASK_ALREADY_RESERVED' }
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
