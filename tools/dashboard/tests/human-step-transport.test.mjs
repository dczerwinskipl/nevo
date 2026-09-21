import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildDashboardApp } from '../server/index.mjs';
import { executeHumanStepAction } from '../server/specs/human-step-transport.mjs';
import { loadChange } from '../../specs/store.mjs';

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
    purpose: "Human Verification"
    expectedWork:
      summary: "Verify work"
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

const UNCONDITIONAL_WF_YAML = `id: unconditional-v1
title: "Unconditional Workflow"
type: standard
version: 1
sourceControl:
  enabled: false
steps:
  manual-check:
    executor: human
    status:
      active: in-manual-check
      completed: checked
    purpose: "Manual verification"
    expectedWork:
      summary: "Verify manually"
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: verified
        outcome: success
        action:
          label: Complete check
`;

function createGitFixture(prefix = 'nevo-hst-') {
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
  writeFileSync(join(workflowsDir, 'unconditional-v1.yaml'), UNCONDITIONAL_WF_YAML);

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

describe('Dashboard human-step transport (Task 16, D14, D16, D17)', () => {
  test('AC 1: POST .../workflow/human-step with action: start activates ready human step without creating AI session', async () => {
    const fx = createGitFixture('nevo-hst-start-');
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
  - id: task-waiting-human
    title: "Task waiting for human verification"
    status: in-implementation
    file: tasks/01-task.md
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
      writeFileSync(join(tasksDir, '01-task.md'), '---\nid: task-waiting-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task waiting for human step']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-waiting-human/workflow/human-step',
        payload: { action: 'start' },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(body.action, 'start');
      assert.equal(body.taskId, 'task-waiting-human');
      assert.equal(body.result?.task?.workflow_progress?.state, 'active');
      assert.equal(body.result?.task?.workflow_progress?.current_step, 'human-verification');

      // Verify variant with /api/specs/:source/:slug/...
      const changeReloaded = readFileSync(join(changeDir, 'change.yaml'), 'utf8');
      assert.match(changeReloaded, /state:\s*active/);

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('AC 2: POST .../workflow/human-step with action: submit succeeds when result and feedback match transitions', async () => {
    const fx = createGitFixture('nevo-hst-submit-');
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
  - id: task-active-human
    title: "Active human verification task"
    status: in-implementation
    file: tasks/01-task.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
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
      writeFileSync(join(tasksDir, '01-task.md'), '---\nid: task-active-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task active in human-verification']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // Submit 'pass' (Approve) — feedback not required
      const resPass = await app.inject({
        method: 'POST',
        url: '/api/specs/active/demo-change/tasks/task-active-human/workflow/human-step',
        payload: {
          action: 'submit',
          result: 'pass',
        },
      });

      assert.equal(resPass.statusCode, 200);
      const bodyPass = resPass.json();
      assert.equal(bodyPass.ok, true);
      assert.equal(bodyPass.action, 'submit');
      assert.equal(bodyPass.taskId, 'task-active-human');
      assert.equal(bodyPass.result?.status, 'completed');

      const reloadedChange = loadChange('demo-change', fx.activeDir);
      const reloadedTask = reloadedChange.tasks.find((t) => t.id === 'task-active-human');
      assert.equal(reloadedTask.workflow_progress?.state, 'completed');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('AC 2b: POST .../workflow/human-step with action: submit requiring feedback transitions with feedback', async () => {
    const fx = createGitFixture('nevo-hst-submit-feedback-');
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
  - id: task-active-human
    title: "Active human verification task"
    status: in-implementation
    file: tasks/01-task.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
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
      writeFileSync(join(tasksDir, '01-task.md'), '---\nid: task-active-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task active in human-verification']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // Submit 'fail' without feedback -> fails with REQUIRED_FEEDBACK_MISSING
      const resNoFeedback = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-active-human/workflow/human-step',
        payload: {
          action: 'submit',
          result: 'fail',
        },
      });

      assert.equal(resNoFeedback.statusCode, 400);
      const errBody = resNoFeedback.json();
      assert.equal(errBody.code, 'REQUIRED_FEEDBACK_MISSING');
      assert.equal(errBody.stepId, 'human-verification');
      assert.ok(errBody.error);

      // Submit 'fail' with valid feedback -> succeeds and transitions to implementation attempt 2
      const resWithFeedback = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-active-human/workflow/human-step',
        payload: {
          action: 'submit',
          result: 'fail',
          feedback: 'Please fix edge cases in error handling.',
        },
      });

      assert.equal(resWithFeedback.statusCode, 200);
      const passData = resWithFeedback.json();
      assert.equal(passData.ok, true);
      assert.equal(passData.action, 'submit');
      assert.equal(passData.result?.status, 'completed');

      const reloadedChange = loadChange('demo-change', fx.activeDir);
      const reloadedTask = reloadedChange.tasks.find((t) => t.id === 'task-active-human');
      assert.equal(reloadedTask.workflow_progress?.state, 'completed');
      const lastHistory = reloadedTask.workflow_progress.history[reloadedTask.workflow_progress.history.length - 1];
      assert.equal(lastHistory.step, 'human-verification');
      assert.equal(lastHistory.result, 'fail');
      assert.equal(lastHistory.feedback, 'Please fix edge cases in error handling.');
      assert.equal(lastHistory.transitioned_to, 'implementation');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('AC 3: POST .../workflow/human-step with action: submit on unconditional human step succeeds with no result passed', async () => {
    const fx = createGitFixture('nevo-hst-unconditional-');
    try {
      const changeDir = join(fx.activeDir, 'demo-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: unconditional-v1
tasks:
  - id: task-unconditional
    title: "Unconditional human check"
    status: in-implementation
    file: tasks/01-task.md
    workflow_progress:
      current_step: manual-check
      current_attempt: 1
      state: active
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Demo Change\n');
      writeFileSync(join(tasksDir, '01-task.md'), '---\nid: task-unconditional\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'task active in unconditional human step']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-unconditional/workflow/human-step',
        payload: { action: 'submit' },
      });

      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data.ok, true);
      assert.equal(data.action, 'submit');
      assert.equal(data.result?.status, 'completed');

      const reloadedChange = loadChange('demo-change', fx.activeDir);
      const reloadedTask = reloadedChange.tasks.find((t) => t.id === 'task-unconditional');
      assert.equal(reloadedTask.workflow_progress?.state, 'completed');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('AC 4: structured errors for agent-owned step, unready task, or invalid transition result', async () => {
    const fx = createGitFixture('nevo-hst-errors-');
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
  - id: task-agent-owned
    title: "Task at agent step"
    status: in-implementation
    file: tasks/01-agent.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
  - id: task-draft
    title: "Draft task"
    status: draft
    file: tasks/02-draft.md
  - id: task-active-human
    title: "Active human verification task"
    status: in-implementation
    file: tasks/03-human.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
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
      writeFileSync(join(tasksDir, '01-agent.md'), '---\nid: task-agent-owned\nstatus: in-implementation\n---\n# Task\n');
      writeFileSync(join(tasksDir, '02-draft.md'), '---\nid: task-draft\nstatus: draft\n---\n# Task\n');
      writeFileSync(join(tasksDir, '03-human.md'), '---\nid: task-active-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'error test fixture']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // 1. Agent-owned step -> WORKFLOW_STEP_EXECUTOR_MISMATCH
      const resAgent = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-agent-owned/workflow/human-step',
        payload: { action: 'start' },
      });
      assert.equal(resAgent.statusCode, 400);
      const errAgent = resAgent.json();
      assert.equal(errAgent.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
      assert.equal(errAgent.stepId, 'implementation');
      assert.equal(errAgent.executor, 'agent');
      assert.ok(errAgent.error);

      // 2. Not-ready task (draft) -> TASK_UNPUBLISHED
      const resDraft = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-draft/workflow/human-step',
        payload: { action: 'start' },
      });
      assert.equal(resDraft.statusCode, 400);
      const errDraft = resDraft.json();
      assert.equal(errDraft.code, 'TASK_UNPUBLISHED');
      assert.ok(errDraft.error);

      // 3. Invalid transition result (e.g. 'bogus-result' on human-verification) -> INVALID_TRANSITION_RESULT
      const resInvalidResult = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/task-active-human/workflow/human-step',
        payload: {
          action: 'submit',
          result: 'invalid-nonexistent-result',
        },
      });
      assert.equal(resInvalidResult.statusCode, 400);
      const errResult = resInvalidResult.json();
      assert.equal(errResult.code, 'INVALID_TRANSITION_RESULT');
      assert.equal(errResult.stepId, 'human-verification');
      assert.deepEqual(errResult.allowedResults, ['pass', 'fail']);
      assert.ok(errResult.error);

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('AC 5: Transport module does not import handleWorkflowVerifyHuman', () => {
    const transportSrc = readFileSync(
      new URL('../server/specs/human-step-transport.mjs', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(transportSrc, /handleWorkflowVerifyHuman/);
    assert.match(transportSrc, /startHumanStep/);
    assert.match(transportSrc, /submitHumanStepResult/);
  });

  test('AC 6: Source filtering rejects non-active sources with 404', async () => {
    const fx = createGitFixture('nevo-hst-source-');
    try {
      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/archive/demo-change/tasks/task-1/workflow/human-step',
        payload: { action: 'start' },
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, 'API route not found');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });
});
