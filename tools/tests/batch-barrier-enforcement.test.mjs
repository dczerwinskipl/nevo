// Test suite for Canonical Action Barrier Enforcement (Task 02, D31, D37).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGroupReservation,
  releaseGroupReservation,
  isTaskBarriered,
} from '../specs/workflow/queue/index.mjs';
import {
  evaluateExecutionReadiness,
  assertExecutionReadiness,
  evaluateBaseExecutionReadiness,
  assertBaseExecutionReadiness,
} from '../specs/workflow/readiness-policy.mjs';
import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import {
  startHumanStep,
  submitHumanStepResult,
  activateAndSubmitHumanStep,
} from '../specs/workflow/human-step/operations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('AC6: Action barrier blocks ordinary execution while base readiness reports underlying eligibility', async () => {
  const tmpRoot = path.join(REPO_ROOT, '.nevo-ai-local', 'test-scratch-barrier-' + Date.now());
  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, 'barrier-spec');
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );

  try {
    const definition = {
      id: 'test-def',
      entryStep: 'review',
      steps: {
        review: {
          id: 'review',
          executor: 'agent',
          transitions: [{ value: 'pass', to: 'human-signoff' }],
        },
        'human-signoff': {
          id: 'human-signoff',
          executor: 'human',
          transitions: [{ value: 'approve', to: 'completed' }],
        },
      },
    };

    const change = {
      id: 'barrier-spec',
      _slug: 'barrier-spec',
      workflow: { mode: 'deterministic', definition: 'standard.yaml' },
      tasks: [
        {
          id: 'barriered-task',
          order: 1,
          status: 'in-implementation',
          workflow_progress: {
            current_step: 'review',
            current_attempt: 1,
            state: 'active',
            history: [],
          },
        },
        {
          id: 'free-task',
          order: 2,
          status: 'in-implementation',
          workflow_progress: {
            current_step: 'review',
            current_attempt: 1,
            state: 'active',
            history: [],
          },
        },
      ],
    };

    fs.writeFileSync(path.join(changeDir, 'change.yaml'), `id: barrier-spec
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: barriered-task
    order: 1
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history: []
  - id: free-task
    order: 2
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history: []
`, 'utf8');

    fs.writeFileSync(path.join(taskDir, 'barriered-task.md'), '# Task: barriered\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'free-task.md'), '# Task: free\n', 'utf8');

    const task = change.tasks[0];
    const freeTask = change.tasks[1];

    // 1. Before reservation: ordinary readiness is ready
    const preRes = evaluateExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
    assert.equal(preRes.ready, true);

    // 2. Create reservation claiming barriered-task
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'barrier-spec',
      taskIds: ['barriered-task', 'other-member'],
      executionConfigSnapshot: { provider: 'test', model: 'test' },
    });

    assert.equal(isTaskBarriered(change, 'barriered-task', { repoRoot: tmpRoot }), true);
    assert.equal(isTaskBarriered(change, 'free-task', { repoRoot: tmpRoot }), false);

    // 3. evaluateExecutionReadiness reports TASK_BARRIERED
    const barrieredReadiness = evaluateExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
    assert.equal(barrieredReadiness.ready, false);
    assert.equal(barrieredReadiness.code, 'TASK_BARRIERED');
    assert.match(barrieredReadiness.reason, /reserved in an active batch execution/);

    // 4. assertExecutionReadiness throws TASK_BARRIERED
    assert.throws(
      () => {
        assertExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
      },
      { code: 'TASK_BARRIERED' }
    );

    // 5. evaluateBaseExecutionReadiness reports ready (underlying workflow readiness intact for batch-start, D37)
    const baseReadiness = evaluateBaseExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
    assert.equal(baseReadiness.ready, true);
    assert.equal(baseReadiness.code, null);
    assert.doesNotThrow(() => {
      assertBaseExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
    });

    // 6. Raw single-task handleWorkflowStepStart rejects barriered task
    await assert.rejects(
      async () => {
        await handleWorkflowStepStart('barrier-spec', 'barriered-task', {
          activeDir,
          repoRoot: tmpRoot,
          silent: true,
        });
      },
      { code: 'TASK_BARRIERED' }
    );

    // 7. Human execution entry points reject barriered task
    assert.throws(
      () => {
        startHumanStep(change, task, definition, { repoRoot: tmpRoot, activeDir });
      },
      { code: 'TASK_BARRIERED' }
    );

    await assert.rejects(
      async () => {
        await submitHumanStepResult(change, task, definition, { repoRoot: tmpRoot, activeDir }, { result: 'approve' });
      },
      { code: 'TASK_BARRIERED' }
    );

    await assert.rejects(
      async () => {
        await activateAndSubmitHumanStep(change, task, definition, { repoRoot: tmpRoot, activeDir }, { result: 'approve' });
      },
      { code: 'TASK_BARRIERED' }
    );

    // 8. Non-barriered free-task is completely unaffected
    const freeReadiness = evaluateExecutionReadiness(freeTask, change, 'agent', { definition, repoRoot: tmpRoot });
    assert.equal(freeReadiness.ready, true);

    // 9. Release reservation: barrier lifted
    await releaseGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'barrier-spec',
      batchExecutionId: reservation.batchExecutionId,
    });

    assert.equal(isTaskBarriered(change, 'barriered-task', { repoRoot: tmpRoot }), false);
    const postRelease = evaluateExecutionReadiness(task, change, 'agent', { definition, repoRoot: tmpRoot });
    assert.equal(postRelease.ready, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
