import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildDashboardApp } from '../server/index.mjs';
import { computeTaskAvailableActions, computeTaskWorkflowProjection, loadSpecificationActions } from '../server/specs/actions.mjs';
import { requireChange, requireTask } from '../../specs/store.mjs';

const STANDARD_V1_YAML = `id: standard-v1
title: "Standard Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: in-implementation
      completed: implemented
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    status:
      active: in-review
      completed: reviewed
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: human-verification
      - value: fail
        to: implementation
  human-verification:
    status:
      active: awaiting-human-verification
      completed: completed
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
      - value: fail
        to: implementation
`;

function createGitFixture(prefix = 'nevo-specs-actions-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });

  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'standard-v1.yaml'), STANDARD_V1_YAML);

  const activeDir = join(repo, 'specs', 'active');
  const archiveDir = join(repo, 'specs', 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'initial\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);

  return {
    base,
    repo,
    activeDir,
    archiveDir,
    git,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe('AC 9: Task read models project availableActions matching state-action matrix', () => {
  test('computeTaskAvailableActions correctly evaluates matrix states', () => {
    // 1. New task: approved (isTaskReady) with no unmet dependencies, no workflow progress
    assert.deepEqual(
      computeTaskAvailableActions({ id: 't1', status: 'approved', depends_on: [] }, { tasks: [{ id: 't1', status: 'approved', depends_on: [] }] }),
      ['start-implementation'],
    );

    // 2. Task with status in-implementation but no workflow progress yet
    assert.deepEqual(computeTaskAvailableActions({ id: 't1', status: 'in-implementation' }), []);

    // 3. Task in active phase on human-verification
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'awaiting-human-verification',
        workflow_progress: { current_step: 'human-verification', state: 'active' },
      }),
      ['approve', 'request-changes'],
    );

    // 4. Task in active phase on other steps
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'in-implementation',
        workflow_progress: { current_step: 'implementation', state: 'active' },
      }),
      [],
    );
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'in-review',
        workflow_progress: { current_step: 'review', state: 'active' },
      }),
      [],
    );

    // 5. Task in completed phase transitioning to human-verification
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'in-implementation',
        workflow_progress: {
          current_step: 'review',
          state: 'completed',
          history: [{ step: 'review', result: 'pass', transitioned_to: 'human-verification' }],
        },
      }),
      ['approve', 'request-changes'],
    );

    // 6. Task in completed phase transitioning to review
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'in-implementation',
        workflow_progress: {
          current_step: 'implementation',
          state: 'completed',
          history: [{ step: 'implementation', transitioned_to: 'review' }],
        },
      }),
      ['start-review'],
    );

    // 7. Task in completed phase transitioning to implementation
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'in-implementation',
        workflow_progress: {
          current_step: 'review',
          state: 'completed',
          history: [{ step: 'review', result: 'fail', transitioned_to: 'implementation' }],
        },
      }),
      ['start-implementation'],
    );

    // 8. Task in reconciliation-required state
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'reconciliation-required',
        workflow_progress: { current_step: 'implementation', state: 'reconciliation-required' },
      }),
      ['operator-reconciliation'],
    );

    // 9. Verified task
    assert.deepEqual(computeTaskAvailableActions({ id: 't1', status: 'verified' }), []);
    assert.deepEqual(
      computeTaskAvailableActions({
        id: 't1',
        status: 'verified',
        workflow_progress: {
          current_step: 'human-verification',
          state: 'completed',
          history: [{ step: 'human-verification', result: 'pass', transitioned_to: 'verified' }],
        },
      }),
      [],
    );
  });

  test('computeTaskAvailableActions never projects start-implementation for a not-yet-ready task (Task 03 corrective: blocked/draft tasks)', () => {
    // Not yet approved by the owner (draft) — must not expose an executable action even
    // though it superficially resembles a "new" task with no workflow_progress.
    assert.deepEqual(computeTaskAvailableActions({ id: 't1', status: 'draft', depends_on: [] }), []);

    // Approved, but still blocked by an unmet dependency — isTaskReady's depsSatisfied
    // check must gate start-implementation exactly the same way the status-board's own
    // `blockedBy` projection does, so the two can never disagree about readiness.
    const blockedChange = {
      tasks: [
        { id: '01', status: 'in-implementation', depends_on: [] },
        { id: '02', status: 'approved', depends_on: ['01'] },
      ],
    };
    assert.deepEqual(
      computeTaskAvailableActions(blockedChange.tasks[1], blockedChange),
      [],
      'a task blocked by an unmet dependency must not project an executable start action',
    );

    // Once the dependency reaches a satisfying status, the same task becomes executable.
    const unblockedChange = {
      tasks: [
        { id: '01', status: 'verified', depends_on: [] },
        { id: '02', status: 'approved', depends_on: ['01'] },
      ],
    };
    assert.deepEqual(computeTaskAvailableActions(unblockedChange.tasks[1], unblockedChange), ['start-implementation']);
  });

  test('loadSpecificationActions attaches availableActions to all tasks in read model', async () => {
    const fx = createGitFixture('nevo-actions-load-');
    try {
      const changeDir = join(fx.activeDir, 'test-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: test-change
title: "Test Change"
status: in-progress
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: 01-task
    title: "First Task"
    status: awaiting-human-verification
    file: tasks/01-task.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
      history: []
  - id: 02-task
    title: "Second Task"
    status: approved
    file: tasks/02-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');
      writeFileSync(join(tasksDir, '02-task.md'), '# Task 2\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add spec']);

      const readModel = await loadSpecificationActions({
        slug: 'test-change',
        activeDir: fx.activeDir,
        root: fx.repo,
      });

      assert.ok(readModel.tasks['01-task']);
      assert.deepEqual(readModel.tasks['01-task'].availableActions, ['approve', 'request-changes']);
      // Authoritative workflow projection: the UI renders these fields directly instead
      // of fabricating `status || 'in-implementation'` / `attempt || 1`.
      assert.equal(readModel.tasks['01-task'].status, 'awaiting-human-verification');
      assert.equal(readModel.tasks['01-task'].currentStep, 'human-verification');
      assert.equal(readModel.tasks['01-task'].attempt, 1);
      assert.equal(readModel.tasks['01-task'].workflowState, 'active');

      assert.ok(readModel.tasks['02-task']);
      assert.deepEqual(readModel.tasks['02-task'].availableActions, ['start-implementation']);
      assert.equal(readModel.tasks['02-task'].status, 'approved');
      // No workflow_progress recorded yet — never fabricated as 'implementation'/attempt 1.
      assert.equal(readModel.tasks['02-task'].currentStep, null);
      assert.equal(readModel.tasks['02-task'].attempt, null);
    } finally {
      fx.cleanup();
    }
  });
});

describe('computeTaskWorkflowProjection: authoritative read model, never fabricated', () => {
  test('reports null fields for a task with no workflow_progress, real fields when present', () => {
    assert.deepEqual(computeTaskWorkflowProjection({ id: 't1', status: 'approved' }), {
      status: 'approved',
      currentStep: null,
      attempt: null,
      workflowState: null,
    });

    assert.deepEqual(
      computeTaskWorkflowProjection({
        id: 't1',
        status: 'in-review',
        workflow_progress: { current_step: 'review', current_attempt: 2, state: 'active' },
      }),
      {
        status: 'in-review',
        currentStep: 'review',
        attempt: 2,
        workflowState: 'active',
      },
    );
  });
});

describe('AC 7: POST /api/specs/:slug/tasks/:taskId/workflow/human-decision with approve', () => {
  test('executes clean-tree noop commit and transitions task to verified', async () => {
    const fx = createGitFixture('nevo-hd-approve-');
    try {
      const changeDir = join(fx.activeDir, 'demo-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-approve
    title: "Task to approve"
    status: in-implementation
    file: tasks/01-demo-task.md
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Demo Change\n');
      writeFileSync(join(tasksDir, '01-demo-task.md'), '---\nid: demo-task-approve\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task awaiting human verification']);

      const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/demo-task-approve/workflow/human-decision',
        payload: {
          decision: 'approve',
        },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.ok, true);
      assert.equal(data.decision, 'approve');
      assert.equal(data.taskId, 'demo-task-approve');
      assert.equal(data.result.status, 'completed');

      // Verify task in change.yaml transitioned to verified
      const change = requireChange('demo-change', fx.activeDir);
      const task = requireTask(change, 'demo-task-approve');
      assert.equal(task.status, 'verified');
      assert.equal(task.workflow_progress.current_step, 'human-verification');
      assert.equal(task.workflow_progress.state, 'completed');

      const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
      assert.equal(lastHistory.step, 'human-verification');
      assert.equal(lastHistory.result, 'pass');
      assert.equal(lastHistory.transitioned_to, 'verified');

      // Verify clean-tree commit was created
      const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
      assert.notEqual(headAfter, headBefore, 'A new commit must be created');

      const commitSubject = fx.git(['log', '-1', '--pretty=%s']).trim();
      assert.match(commitSubject, /verify\(demo-task-approve\): approve human verification/);

      await app.close();
    } finally {
      fx.cleanup();
    }
  });
});

describe('AC 8: POST /api/specs/:slug/tasks/:taskId/workflow/human-decision with request-changes', () => {
  test('requires feedback and transitions task to implementation attempt N+1 with feedback recorded', async () => {
    const fx = createGitFixture('nevo-hd-reject-');
    try {
      const changeDir = join(fx.activeDir, 'demo-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-reject
    title: "Task to reject"
    status: in-implementation
    file: tasks/01-demo-task.md
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Demo Change\n');
      writeFileSync(join(tasksDir, '01-demo-task.md'), '---\nid: demo-task-reject\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task awaiting human verification']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // 1. Missing feedback -> 400 Bad Request
      const resMissing = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/demo-task-reject/workflow/human-decision',
        payload: {
          decision: 'request-changes',
        },
      });
      assert.equal(resMissing.statusCode, 400);
      assert.match(resMissing.json().error, /Feedback is required/i);

      // 2. Empty whitespace feedback -> 400 Bad Request
      const resEmpty = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/demo-task-reject/workflow/human-decision',
        payload: {
          decision: 'request-changes',
          feedback: '    ',
        },
      });
      assert.equal(resEmpty.statusCode, 400);
      assert.match(resEmpty.json().error, /Feedback is required/i);

      // 3. Valid feedback -> 200 OK and transition
      const resValid = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/demo-task-reject/workflow/human-decision',
        payload: {
          decision: 'request-changes',
          feedback: 'Please fix performance regression in algorithm',
        },
      });

      assert.equal(resValid.statusCode, 200);
      const data = resValid.json();
      assert.equal(data.ok, true);
      assert.equal(data.decision, 'request-changes');
      assert.equal(data.taskId, 'demo-task-reject');

      // Verify task in change.yaml transitioned to implementation attempt 2
      const change = requireChange('demo-change', fx.activeDir);
      const task = requireTask(change, 'demo-task-reject');
      assert.equal(task.workflow_progress.current_step, 'human-verification');
      assert.equal(task.workflow_progress.state, 'completed');

      const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
      assert.equal(lastHistory.step, 'human-verification');
      assert.equal(lastHistory.result, 'fail');
      assert.equal(lastHistory.feedback, 'Please fix performance regression in algorithm');
      assert.equal(lastHistory.transitioned_to, 'implementation');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });
});
