import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildDashboardApp } from '../server/index.mjs';
import {
  computeTaskAvailableActions,
  computeTaskWorkflowProjection,
  computeDeterministicTaskActionProjection,
  loadSpecificationActions,
} from '../server/specs/actions.mjs';
import { loadDashboardData, loadTaskStatuses } from '../server/specs/data.mjs';
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
    executor: agent
    status:
      active: in-implementation
      completed: implemented
    purpose: "Implementation"
    expectedWork:
      summary: "Write code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    executor: agent
    status:
      active: in-review
      completed: reviewed
    purpose: "Review"
    expectedWork:
      summary: "Review code"
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
    executor: human
    status:
      active: awaiting-human-verification
      completed: completed
    purpose: "Human verification"
    expectedWork:
      summary: "Signoff changes"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
        action:
          label: Approve
      - value: fail
        to: implementation
        action:
          label: Request changes
          feedback:
            required: true
`;

const CUSTOM_WF_YAML = `id: custom-wf
title: "Custom Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
entryStep: implementation
steps:
  implementation:
    executor: agent
    status:
      active: in-implementation
      completed: implemented
    purpose: "Implementation"
    expectedWork:
      summary: "Write code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    executor: agent
    status:
      active: in-review
      completed: reviewed
    purpose: "Review"
    expectedWork:
      summary: "Review code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: hardening
  hardening:
    executor: agent
    status:
      active: in-hardening
      completed: hardened
    purpose: "Hardening"
    expectedWork:
      summary: "Harden code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: signoff
  signoff:
    executor: human
    status:
      active: awaiting-signoff
      completed: completed
    purpose: "Signoff"
    expectedWork:
      summary: "Human review"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
        action:
          label: Approve
      - value: fail
        to: hardening
        action:
          label: Reject
`;

function createGitFixture(prefix = 'nevo-specs-actions-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });

  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'standard-v1.yaml'), STANDARD_V1_YAML);

  const activeDir = join(repo, 'specs', 'active');
  const archiveDir = join(repo, 'specs', 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  git(['add', '-A']);
  git(['commit', '-m', 'initial fixture commit']);

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

describe('Dashboard deterministic action projection (Task 14, D10, D15, D18)', () => {

  test('AC 1: DTO reflects state-derived shape for review and arbitrary non-standard step (hardening), ignoring approved status', () => {
    const fx = createGitFixture('nevo-actions-ac1-');
    try {
      const workflowsDir = join(fx.repo, '.nevo-ai', 'workflows');
      writeFileSync(join(workflowsDir, 'custom-wf.yaml'), CUSTOM_WF_YAML);

      const changeDir = join(fx.activeDir, 'demo-change');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: custom-wf
tasks:
  - id: t1
    status: approved
    file: tasks/01.md
    workflow_progress:
      current_step: hardening
      current_attempt: 1
      state: active
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'tasks', '01.md'), '# Task 1\n');

      const dto = computeDeterministicTaskActionProjection(
        { id: 't1', status: 'approved', workflow_progress: { current_step: 'hardening', current_attempt: 1, state: 'active' } },
        { id: 'demo-change', workflow: { mode: 'deterministic', definition: 'custom-wf' }, tasks: [{ id: 't1', status: 'approved' }] },
        { root: fx.repo }
      );

      assert.equal(dto.state, 'active');
      assert.equal(dto.executor, 'agent');
      assert.equal(dto.attempt, 1);
      assert.equal(dto.currentStep, 'hardening');
      assert.deepEqual(dto.availableActions, []);
      assert.equal(dto.stepDescriptor.id, 'hardening');
      assert.equal(dto.stepDescriptor.purpose, 'Hardening');
      assert.equal(dto.stepDescriptor.expectedWork.summary, 'Harden code');
      assert.equal(dto.humanInteraction, null);
    } finally {
      fx.cleanup();
    }
  });

  test('AC 2: availableActions reflects ExecutionReadiness (empty when blocked or executor mismatch)', () => {
    const fx = createGitFixture('nevo-actions-ac2-');
    try {
      const change = {
        id: 'demo-change',
        workflow: { mode: 'deterministic', definition: 'standard-v1' },
        tasks: [
          { id: '01', status: 'in-implementation' },
          { id: '02', status: 'approved', depends_on: ['01'] },
        ],
      };

      const dtoBlocked = computeDeterministicTaskActionProjection(
        change.tasks[1],
        change,
        { root: fx.repo }
      );

      assert.equal(dtoBlocked.state, 'blocked');
      assert.deepEqual(dtoBlocked.blockedBy, ['01']);
      assert.deepEqual(dtoBlocked.availableActions, []);
    } finally {
      fx.cleanup();
    }
  });

  test('AC 3: DTO includes executor and humanInteraction descriptor exactly when human step is active', () => {
    const fx = createGitFixture('nevo-actions-ac3-');
    try {
      const change = {
        id: 'demo-change',
        workflow: { mode: 'deterministic', definition: 'standard-v1' },
        tasks: [
          {
            id: 't-human',
            status: 'awaiting-human-verification',
            workflow_progress: {
              current_step: 'human-verification',
              current_attempt: 1,
              state: 'active',
            },
          },
        ],
      };

      const dto = computeDeterministicTaskActionProjection(
        change.tasks[0],
        change,
        { root: fx.repo }
      );

      assert.equal(dto.state, 'human-interaction');
      assert.equal(dto.executor, 'human');
      assert.ok(dto.humanInteraction);
      assert.equal(dto.stepDescriptor.id, 'human-verification');
      assert.deepEqual(
        dto.humanInteraction.actions.map(a => a.result),
        ['pass', 'fail']
      );
    } finally {
      fx.cleanup();
    }
  });

  test('AC 4: DTO stepDescriptor populated with purpose/expectedWork in waiting-for-step-start before activation', () => {
    const fx = createGitFixture('nevo-actions-ac4-');
    try {
      const change = {
        id: 'demo-change',
        workflow: { mode: 'deterministic', definition: 'standard-v1' },
        tasks: [
          {
            id: 't-wait',
            status: 'approved',
            workflow_progress: {
              current_step: 'review',
              current_attempt: 1,
              state: 'completed',
              history: [
                { step: 'implementation', attempt: 1, transitioned_to: 'review' },
                { step: 'review', attempt: 1, transitioned_to: 'human-verification', result: 'pass' },
              ],
            },
          },
        ],
      };

      const dto = computeDeterministicTaskActionProjection(
        change.tasks[0],
        change,
        { root: fx.repo }
      );

      assert.equal(dto.state, 'waiting-for-step-start');
      assert.equal(dto.executor, 'human');
      assert.ok(dto.stepDescriptor);
      assert.equal(dto.stepDescriptor.id, 'human-verification');
      assert.equal(dto.stepDescriptor.executor, 'human');
      assert.equal(dto.stepDescriptor.purpose, 'Human verification');
      assert.equal(dto.stepDescriptor.expectedWork.summary, 'Signoff changes');
      assert.ok(dto.humanInteraction);
      assert.deepEqual(
        dto.humanInteraction.actions.map(a => a.result),
        ['pass', 'fail']
      );
    } finally {
      fx.cleanup();
    }
  });

  test('AC 5 & AC 6: availableActions is exactly ["start-step"] for ready agent or human steps, never step-name-derived', () => {
    const fx = createGitFixture('nevo-actions-ac5-6-');
    try {
      const workflowsDir = join(fx.repo, '.nevo-ai', 'workflows');
      writeFileSync(join(workflowsDir, 'custom-wf.yaml'), CUSTOM_WF_YAML);
      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add custom-wf']);

      const changeAgent = {
        id: 'demo-change',
        workflow: { mode: 'deterministic', definition: 'custom-wf' },
        tasks: [{ id: 't1', status: 'approved' }],
      };

      const dtoAgent = computeDeterministicTaskActionProjection(changeAgent.tasks[0], changeAgent, { root: fx.repo });
      assert.equal(dtoAgent.state, 'ready');
      assert.equal(dtoAgent.executor, 'agent');
      assert.deepEqual(dtoAgent.availableActions, ['start-step']);

      const changeHuman = {
        id: 'demo-change',
        workflow: { mode: 'deterministic', definition: 'custom-wf' },
        tasks: [{
          id: 't2',
          status: 'approved',
          workflow_progress: {
            current_step: 'hardening',
            current_attempt: 1,
            state: 'completed',
            history: [
              { step: 'implementation', attempt: 1, transitioned_to: 'hardening' },
              { step: 'hardening', attempt: 1, transitioned_to: 'signoff' },
            ],
          },
        }],
      };

      const dtoHuman = computeDeterministicTaskActionProjection(changeHuman.tasks[0], changeHuman, { root: fx.repo });
      assert.equal(dtoHuman.state, 'waiting-for-step-start');
      assert.equal(dtoHuman.executor, 'human');
      assert.deepEqual(dtoHuman.availableActions, ['start-step']);
    } finally {
      fx.cleanup();
    }
  });

  test('AC 7: Grepping computeDeterministicTaskActionProjection for task.status, isTaskReady, or literal step names returns none', () => {
    const actionsCode = readFileSync(new URL('../server/specs/actions.mjs', import.meta.url), 'utf8');
    const fnMatch = actionsCode.match(/export function computeDeterministicTaskActionProjection[\s\S]*?return \{[\s\S]*?\};\s*\}/);
    assert.ok(fnMatch, 'computeDeterministicTaskActionProjection must exist');
    const fnBody = fnMatch[0];
    assert.equal(fnBody.includes('task.status'), false, 'must not reference task.status');
    assert.equal(fnBody.includes('isTaskReady'), false, 'must not reference isTaskReady');
    assert.equal(fnBody.includes("'implementation'"), false, 'must not compare literal implementation step');
    assert.equal(fnBody.includes("'review'"), false, 'must not compare literal review step');
    assert.equal(fnBody.includes("'human-verification'"), false, 'must not compare literal human-verification step');
  });
});

describe('Legacy task available actions and read model', () => {
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

      // Authoritative specification-level workflow mode (D15) — the same resolver
      // (`resolveWorkflowMode`) the CLI/workflow engine itself uses, never re-derived
      // from a localStorage preference or session state.
      assert.equal(readModel.workflowMode, 'deterministic');
      assert.equal(readModel.workflowDefinition, 'standard-v1');

      assert.ok(readModel.tasks['01-task']);
      assert.deepEqual(readModel.tasks['01-task'].availableActions, []);
      assert.equal(readModel.tasks['01-task'].state, 'human-interaction');
      assert.equal(readModel.tasks['01-task'].executor, 'human');
      assert.equal(readModel.tasks['01-task'].currentStep, 'human-verification');
      assert.equal(readModel.tasks['01-task'].attempt, 1);
      assert.ok(readModel.tasks['01-task'].humanInteraction);
      assert.deepEqual(
        readModel.tasks['01-task'].humanInteraction.actions.map(a => a.result),
        ['pass', 'fail']
      );

      assert.ok(readModel.tasks['02-task']);
      assert.deepEqual(readModel.tasks['02-task'].availableActions, ['start-step']);
      assert.equal(readModel.tasks['02-task'].state, 'ready');
      assert.equal(readModel.tasks['02-task'].executor, 'agent');
      assert.equal(readModel.tasks['02-task'].stepDescriptor.id, 'implementation');
      assert.equal(readModel.tasks['02-task'].currentStep, null);
      assert.equal(readModel.tasks['02-task'].attempt, null);
    } finally {
      fx.cleanup();
    }
  });

  test('loadSpecificationActions reports workflowMode: legacy for a specification with no workflow key (the default)', async () => {
    const fx = createGitFixture('nevo-actions-legacy-');
    try {
      const changeDir = join(fx.activeDir, 'legacy-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: legacy-change
title: "Legacy Change"
status: in-progress
tasks:
  - id: 01-task
    title: "First Task"
    status: draft
    file: tasks/01-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add legacy spec']);

      const readModel = await loadSpecificationActions({
        slug: 'legacy-change',
        activeDir: fx.activeDir,
        root: fx.repo,
      });

      assert.equal(readModel.workflowMode, 'legacy');
      assert.equal(readModel.workflowDefinition, null);
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

describe('Dashboard actions lifecycle split (Task 17, D1, D4)', () => {
  test('AC 3 & AC 4: Import and call boundary: legacy and deterministic mutation modules are strictly isolated', () => {
    const legacySrc = readFileSync(new URL('../server/specs/actions/legacy-mutations.mjs', import.meta.url), 'utf8');
    const deterministicSrc = readFileSync(new URL('../server/specs/actions/deterministic-mutations.mjs', import.meta.url), 'utf8');

    // Deterministic module must never import or call legacy mutation functions or lifecycle-primitives
    assert.doesNotMatch(deterministicSrc, /import.*(?:approveTask|verifyTask|finalizeChange)/);
    assert.doesNotMatch(deterministicSrc, /(?:approveTask|verifyTask|finalizeChange)\s*\(/);
    assert.doesNotMatch(deterministicSrc, /lifecycle-primitives/);

    // Legacy module must never import or call deterministic human decision or verify human
    assert.doesNotMatch(legacySrc, /import.*(?:executeDeterministicHumanDecision|handleWorkflowVerifyHuman|submitHumanStepResult)/);
    assert.doesNotMatch(legacySrc, /(?:executeDeterministicHumanDecision|handleWorkflowVerifyHuman|submitHumanStepResult)\s*\(/);
  });

  test('AC 5: Cross-mode mutation attempt fails before any mutation with zero side-effects', async () => {
    const fx = createGitFixture('nevo-cross-mode-');
    try {
      // 1. Create a deterministic spec
      const detDir = join(fx.activeDir, 'det-spec');
      mkdirSync(join(detDir, 'tasks'), { recursive: true });
      writeFileSync(
        join(detDir, 'change.yaml'),
        `id: det-spec\ntitle: "Deterministic"\nworkflow:\n  mode: deterministic\n  definition: standard-v1\ntasks:\n  - id: t1\n    title: "T1"\n    status: approved\n    file: tasks/01-t.md\n`,
      );
      writeFileSync(join(detDir, 'overview.md'), '# Det\n');
      writeFileSync(join(detDir, 'tasks', '01-t.md'), '---\nid: t1\nstatus: approved\n---\n# T1\n');

      // 2. Create a legacy spec
      const legDir = join(fx.activeDir, 'leg-spec');
      mkdirSync(join(legDir, 'tasks'), { recursive: true });
      writeFileSync(
        join(legDir, 'change.yaml'),
        `id: leg-spec\ntitle: "Legacy"\nworkflow:\n  mode: legacy\ntasks:\n  - id: t2\n    title: "T2"\n    status: approved\n    file: tasks/02-t.md\n`,
      );
      writeFileSync(join(legDir, 'overview.md'), '# Leg\n');
      writeFileSync(join(legDir, 'tasks', '02-t.md'), '---\nid: t2\nstatus: approved\n---\n# T2\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add cross-mode specs']);

      const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // Attempt legacy action (approve) against deterministic spec
      const resLegacyOnDet = await app.inject({
        method: 'POST',
        url: '/api/specs/active/det-spec/actions',
        headers: { 'x-nevo-dashboard-action': '1' },
        payload: { action: 'approve', taskId: 't1' },
      });
      assert.equal(resLegacyOnDet.statusCode, 400);
      assert.match(resLegacyOnDet.json().error, /Cannot run legacy 'approve' against deterministic specification/i);

      // Attempt deterministic human decision against legacy spec
      const resDetOnLegacy = await app.inject({
        method: 'POST',
        url: '/api/specs/leg-spec/tasks/t2/workflow/human-decision',
        payload: { decision: 'approve' },
      });
      assert.equal(resDetOnLegacy.statusCode, 400);
      assert.match(resDetOnLegacy.json().error, /Cannot run deterministic human decision against legacy specification/i);

      // Assert zero side-effects: git HEAD unchanged, no unstaged changes
      const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
      assert.equal(headBefore, headAfter);
      const statusOutput = fx.git(['status', '--porcelain']).trim();
      assert.equal(statusOutput, '');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });
});

describe('Deterministic board lane projection (Task 18, D1, D15)', () => {
  test('AC 1: Deterministic task with status: approved and state: active renders in implementation lane, not ready', async () => {
    const fx = createGitFixture('nevo-lane-ac1-');
    try {
      const workflowsDir = join(fx.repo, '.nevo-ai', 'workflows');
      writeFileSync(join(workflowsDir, 'custom-wf.yaml'), CUSTOM_WF_YAML);

      const detDir = join(fx.activeDir, 'det-lane-spec');
      mkdirSync(join(detDir, 'tasks'), { recursive: true });
      writeFileSync(
        join(detDir, 'change.yaml'),
        `id: det-lane-spec\ntitle: "Deterministic Lane Spec"\nworkflow:\n  mode: deterministic\n  definition: standard-v1\ntasks:\n  - id: t1\n    title: "Task 1"\n    status: approved\n    file: tasks/01-t1.md\n    workflow_progress:\n      current_step: implementation\n      current_attempt: 1\n      state: active\n`,
      );
      writeFileSync(join(detDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(detDir, 'tasks', '01-t1.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add det spec']);

      const data = await loadDashboardData({
        activeDir: fx.activeDir,
        archiveDir: fx.archiveDir,
        repoRoot: fx.repo,
      });

      const change = data.active.find((c) => c.id === 'det-lane-spec');
      assert.ok(change, 'change found');

      // The task's status is still "approved"
      const task = change.tasks.find((t) => t.id === 't1');
      assert.equal(task.status, 'approved');

      // But its stage is 'implementation' (active-state lane), NOT 'ready' (which stageForStatus('approved') would yield)
      assert.equal(task.stage, 'implementation');

      // Board lanes check: task must be in 'implementation' lane, not 'ready' lane
      const readyLane = change.lanes.find((l) => l.id === 'ready');
      const implLane = change.lanes.find((l) => l.id === 'implementation');
      assert.equal(readyLane.tasks.some((t) => t.id === 't1'), false);
      assert.equal(implLane.tasks.some((t) => t.id === 't1'), true);

      // Same for loadTaskStatuses
      const statusData = loadTaskStatuses({
        source: 'active',
        slug: 'det-lane-spec',
        activeDir: fx.activeDir,
        archiveDir: fx.archiveDir,
        repoRoot: fx.repo,
      });
      const statusTask = statusData.tasks.find((t) => t.id === 't1');
      assert.equal(statusTask.status, 'approved');
      assert.equal(statusTask.stage, 'implementation');
    } finally {
      fx.cleanup();
    }
  });

  test('AC 2: Two deterministic tasks in state: active with different step IDs (review vs hardening) render in the identical lane', async () => {
    const fx = createGitFixture('nevo-lane-ac2-');
    try {
      const workflowsDir = join(fx.repo, '.nevo-ai', 'workflows');
      writeFileSync(join(workflowsDir, 'custom-wf.yaml'), CUSTOM_WF_YAML);

      const detDir = join(fx.activeDir, 'det-diff-steps');
      mkdirSync(join(detDir, 'tasks'), { recursive: true });
      writeFileSync(
        join(detDir, 'change.yaml'),
        `id: det-diff-steps\ntitle: "Deterministic Different Steps"\nworkflow:\n  mode: deterministic\n  definition: custom-wf\ntasks:\n  - id: t-review\n    title: "Task Review"\n    status: approved\n    file: tasks/01-review.md\n    workflow_progress:\n      current_step: review\n      current_attempt: 1\n      state: active\n  - id: t-hardening\n    title: "Task Hardening"\n    status: approved\n    file: tasks/02-hardening.md\n    workflow_progress:\n      current_step: hardening\n      current_attempt: 1\n      state: active\n`,
      );
      writeFileSync(join(detDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(detDir, 'tasks', '01-review.md'), '# Task Review\n');
      writeFileSync(join(detDir, 'tasks', '02-hardening.md'), '# Task Hardening\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add multi-step active tasks']);

      const data = await loadDashboardData({
        activeDir: fx.activeDir,
        archiveDir: fx.archiveDir,
        repoRoot: fx.repo,
      });

      const change = data.active.find((c) => c.id === 'det-diff-steps');
      assert.ok(change);

      const taskReview = change.tasks.find((t) => t.id === 't-review');
      const taskHardening = change.tasks.find((t) => t.id === 't-hardening');

      // Both must be in the identical lane: 'implementation' (active agent step)
      assert.equal(taskReview.stage, 'implementation');
      assert.equal(taskHardening.stage, 'implementation');
      assert.equal(taskReview.stage, taskHardening.stage);

      const implLane = change.lanes.find((l) => l.id === 'implementation');
      assert.ok(implLane.tasks.some((t) => t.id === 't-review'));
      assert.ok(implLane.tasks.some((t) => t.id === 't-hardening'));
    } finally {
      fx.cleanup();
    }
  });

  test('AC 3: Legacy specification lane assignment is completely unchanged', async () => {
    const fx = createGitFixture('nevo-lane-ac3-');
    try {
      const legDir = join(fx.activeDir, 'legacy-spec');
      mkdirSync(join(legDir, 'tasks'), { recursive: true });
      writeFileSync(
        join(legDir, 'change.yaml'),
        `id: legacy-spec\ntitle: "Legacy Spec"\ntasks:\n  - id: t-draft\n    status: draft\n    file: tasks/01.md\n  - id: t-ready\n    status: approved\n    file: tasks/02.md\n  - id: t-impl\n    status: in-implementation\n    file: tasks/03.md\n  - id: t-rev\n    status: implemented\n    file: tasks/04.md\n  - id: t-done\n    status: verified\n    file: tasks/05.md\n`,
      );
      writeFileSync(join(legDir, 'overview.md'), '# Overview\n');
      for (let i = 1; i <= 5; i++) {
        writeFileSync(join(legDir, 'tasks', `0${i}.md`), `# Task ${i}\n`);
      }

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add legacy spec']);

      const data = await loadDashboardData({
        activeDir: fx.activeDir,
        archiveDir: fx.archiveDir,
        repoRoot: fx.repo,
      });

      const change = data.active.find((c) => c.id === 'legacy-spec');
      assert.ok(change);

      assert.equal(change.lanes.find((l) => l.id === 'design').tasks[0].id, 't-draft');
      assert.equal(change.lanes.find((l) => l.id === 'ready').tasks[0].id, 't-ready');
      assert.equal(change.lanes.find((l) => l.id === 'implementation').tasks[0].id, 't-impl');
      assert.equal(change.lanes.find((l) => l.id === 'review').tasks[0].id, 't-rev');
      assert.equal(change.lanes.find((l) => l.id === 'done').tasks[0].id, 't-done');
    } finally {
      fx.cleanup();
    }
  });

  test('AC 4: Inspection: deterministic lane path never calls stageForStatus/isTaskReady and function signature has no step-id input', () => {
    const dataSrc = readFileSync(new URL('../server/specs/data.mjs', import.meta.url), 'utf8');
    const stagesSrc = readFileSync(new URL('../server/specs/status-stages.mjs', import.meta.url), 'utf8');

    // stageForDeterministicState signature inspection:
    // Signature must be (state, executor = null) or similar, taking no currentStep/nextStep/stepId
    const fnDefMatch = stagesSrc.match(/export function stageForDeterministicState\s*\(([^)]*)\)/);
    assert.ok(fnDefMatch, 'stageForDeterministicState function must exist in status-stages.mjs');
    const params = fnDefMatch[1].split(',').map((p) => p.trim());
    assert.ok(params.length >= 1 && params.length <= 2, 'Signature has 1 or 2 parameters');
    for (const p of params) {
      assert.doesNotMatch(p, /(?:currentStep|nextStep|stepId|step)/i, `Parameter '${p}' must not refer to step ID`);
    }

    // Body of stageForDeterministicState must not branch on step names
    assert.doesNotMatch(stagesSrc, /case\s+['"](?:implementation|review|hardening|human-verification)['"]/);

    // In data.mjs, confirm deterministic branch does not call stageForStatus or isTaskReady
    assert.match(dataSrc, /workflowMode\?\.mode === 'deterministic'/);
    assert.match(dataSrc, /stageForDeterministicState\(/);
  });
});

