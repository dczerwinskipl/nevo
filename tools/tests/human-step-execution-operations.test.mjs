// Comprehensive unit & integration tests for startHumanStep and submitHumanStepResult (Task 09, D11, D12, D13, D16).
// Run: node --test tools/tests/human-step-execution-operations.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startHumanStep,
  submitHumanStepResult,
} from '../specs/workflow/human-step/operations.mjs';
import {
  handleWorkflowVerifyHuman,
  resolveWorkflowRuntime,
} from '../specs/workflow/cli.mjs';
import { WorkflowStepExecutorMismatchError } from '../specs/workflow/executor-guard.mjs';
import { WorkflowError, PreconditionError } from '../specs/workflow/errors.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({
  prefix = 'nevo-human-ops',
  changeId = 'fixture-change',
  taskId = 'fixture-task',
  workflowId = 'fixture-workflow',
  workflowYaml,
  workflowMode = 'deterministic',
} = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture HumanOps']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const workflowConfig = workflowMode === 'deterministic'
    ? `workflow:\n  mode: deterministic\n  definition: ${workflowId}`
    : `workflow:\n  mode: legacy`;

  const changeYamlContent = [
    `id: ${changeId}`,
    `title: "${changeId}"`,
    `type: standard`,
    `status: draft`,
    workflowConfig,
    `tasks:`,
    `  - id: ${taskId}`,
    `    order: 1`,
    `    file: tasks/01-task.md`,
    `    status: in-implementation`,
    '',
  ].join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent);

  writeFileSync(join(changeDir, 'tasks', '01-task.md'), [
    '---',
    `id: ${changeId}.${taskId}`,
    'status: draft',
    `change: ${changeId}`,
    'allowed_paths:',
    '  - "*"',
    'forbidden_paths: []',
    '---',
    `# Task: ${taskId}`,
    '',
  ].join('\n'));

  if (workflowYaml) {
    const workflowsDir = join(root, '.nevo-ai', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, `${workflowId}.yaml`), workflowYaml);
  }

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-human-ops-pkg',
    version: '1.0.0',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);

  return { root, remote, activeDir, changeId, taskId, workflowId, changeYamlPath: join(changeDir, 'change.yaml') };
}

function cleanup(fx) {
  if (fx?.root) rmSync(fx.root, { recursive: true, force: true });
  if (fx?.remote) rmSync(fx.remote, { recursive: true, force: true });
}

const RT = { silent: true };

const CONDITIONAL_HUMAN_WORKFLOW_YAML = `id: conditional-human-wf
title: "Conditional Human Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: signoff
steps:
  signoff:
    executor: human
    status:
      active: awaiting-signoff
      completed: signed-off
    purpose: "Human operator review"
    expectedWork:
      summary: "Manual evaluation"
    hints: []
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        action:
          label: Approve
        outcome: success
      - value: fail
        to: rejected
        action:
          label: Request changes
          feedback:
            required: true
  rejected:
    status:
      active: rejected-active
      completed: rejected
    purpose: "Rejected state"
    expectedWork:
      summary: "Terminal rejection"
    entryGates: []
    exitGates: []
    transitions:
      - to: abandoned
        outcome: failure
`;

const UNCONDITIONAL_HUMAN_WORKFLOW_YAML = `id: unconditional-human-wf
title: "Unconditional Human Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: ack
steps:
  ack:
    executor: human
    status:
      active: acknowledging
      completed: acknowledged
    purpose: "Human acknowledgement"
    expectedWork:
      summary: "Acknowledge completion"
    hints: []
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        action:
          label: Acknowledge
        outcome: success
`;

const AGENT_WORKFLOW_YAML = `id: agent-only-wf
title: "Agent Only Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: dev
steps:
  dev:
    status:
      active: implementing
      completed: implemented
    purpose: "Implement code"
    expectedWork:
      summary: "Automated coding"
    hints: []
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        outcome: success
`;

describe('Human-step execution operations (Task 09, AC1 - AC11)', () => {
  test('AC1: startHumanStep and submitHumanStepResult fail against legacy specifications before any mutation', async () => {
    const fx = makeFixtureRepo({
      prefix: 'legacy-human-test',
      workflowMode: 'legacy',
    });
    try {
      const changeBefore = readFileSync(fx.changeYamlPath, 'utf8');
      const change = requireChange(fx.changeId, fx.activeDir);
      const task = requireTask(change, fx.taskId);
      const context = { repoRoot: fx.root, activeDir: fx.activeDir };

      assert.throws(
        () => startHumanStep(change, task, {}, context),
        (err) => err instanceof CliError && err.message.includes("Cannot run deterministic command 'startHumanStep'")
      );

      await assert.rejects(
        () => submitHumanStepResult(change, task, {}, context, { result: 'pass' }),
        (err) => err instanceof CliError && err.message.includes("Cannot run deterministic command 'submitHumanStepResult'")
      );

      const changeAfter = readFileSync(fx.changeYamlPath, 'utf8');
      assert.equal(changeAfter, changeBefore, 'change.yaml must be unchanged');
    } finally {
      cleanup(fx);
    }
  });

  test('AC2: startHumanStep against executor: human succeeds and activates without agent session binding', async () => {
    const fx = makeFixtureRepo({
      prefix: 'start-human-success',
      workflowYaml: CONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'conditional-human-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      const activation = startHumanStep(change, task, definition, context);
      assert.ok(activation);
      assert.equal(activation.position.phase, 'active');
      assert.equal(activation.position.step, 'signoff');
      assert.equal(activation.position.attempt, 1);

      // Verify persisted workflow_progress in change manifest
      const updatedChange = requireChange(fx.changeId, fx.activeDir);
      const updatedTask = requireTask(updatedChange, fx.taskId);
      assert.equal(updatedTask.workflow_progress.current_step, 'signoff');
      assert.equal(updatedTask.workflow_progress.state, 'active');
      assert.equal(updatedTask.workflow_progress.current_attempt, 1);
    } finally {
      cleanup(fx);
    }
  });

  test('AC3: startHumanStep against executor: agent step fails with structured executor-mismatch error before mutation', async () => {
    const fx = makeFixtureRepo({
      prefix: 'start-human-agent-step',
      workflowYaml: AGENT_WORKFLOW_YAML,
      workflowId: 'agent-only-wf',
    });
    try {
      const changeBefore = readFileSync(fx.changeYamlPath, 'utf8');
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });

      assert.throws(
        () => startHumanStep(change, task, definition, context),
        (err) => {
          assert.ok(err instanceof WorkflowStepExecutorMismatchError);
          assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
          assert.equal(err.stepId, 'dev');
          assert.equal(err.executor, 'agent');
          assert.equal(err.callerKind, 'human');
          return true;
        }
      );

      const changeAfter = readFileSync(fx.changeYamlPath, 'utf8');
      assert.equal(changeAfter, changeBefore, 'change.yaml must be unchanged');
    } finally {
      cleanup(fx);
    }
  });

  test('AC4: submitHumanStepResult matching transition succeeds and writes history', async () => {
    const fx = makeFixtureRepo({
      prefix: 'submit-human-success',
      workflowYaml: CONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'conditional-human-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      const activation = startHumanStep(change, task, definition, context);

      const result = await submitHumanStepResult(change, activation.task, definition, context, {
        result: 'pass',
      });
      assert.equal(result.status, 'completed');

      const updatedChange = requireChange(fx.changeId, fx.activeDir);
      const updatedTask = requireTask(updatedChange, fx.taskId);
      assert.equal(updatedTask.workflow_progress.state, 'completed');
      const lastHistory = updatedTask.workflow_progress.history.at(-1);
      assert.equal(lastHistory.step, 'signoff');
      assert.equal(lastHistory.transitioned_to, 'verified');
      assert.equal(lastHistory.result, 'pass');
    } finally {
      cleanup(fx);
    }
  });

  test('AC5: submitHumanStepResult with invalid result fails via finishStep existing INVALID_TRANSITION_RESULT error', async () => {
    const fx = makeFixtureRepo({
      prefix: 'submit-human-invalid-res',
      workflowYaml: CONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'conditional-human-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      const activation = startHumanStep(change, task, definition, context);

      await assert.rejects(
        () => submitHumanStepResult(change, activation.task, definition, context, { result: 'non-existent' }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'INVALID_TRANSITION_RESULT');
          return true;
        }
      );
    } finally {
      cleanup(fx);
    }
  });

  test('AC6: submitHumanStepResult against executor: agent step fails with executor-mismatch error before mutation', async () => {
    const fx = makeFixtureRepo({
      prefix: 'submit-human-agent-step',
      workflowYaml: AGENT_WORKFLOW_YAML,
      workflowId: 'agent-only-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      // Manually set task as active on agent step to test submitHumanStepResult against active agent step
      const taskActive = {
        ...task,
        workflow_progress: { current_step: 'dev', current_attempt: 1, state: 'active', history: [] },
      };

      await assert.rejects(
        () => submitHumanStepResult(change, taskActive, definition, context, { result: 'pass' }),
        (err) => {
          assert.ok(err instanceof WorkflowStepExecutorMismatchError);
          assert.equal(err.stepId, 'dev');
          assert.equal(err.executor, 'agent');
          assert.equal(err.callerKind, 'human');
          return true;
        }
      );
    } finally {
      cleanup(fx);
    }
  });

  test('AC7: submitHumanStepResult requires feedback when transition declares action.feedback.required: true', async () => {
    const fx = makeFixtureRepo({
      prefix: 'submit-human-feedback-req',
      workflowYaml: CONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'conditional-human-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      const activation = startHumanStep(change, task, definition, context);

      const changeBeforeFail = readFileSync(fx.changeYamlPath, 'utf8');

      // 1. Fails when feedback is omitted
      await assert.rejects(
        () => submitHumanStepResult(change, activation.task, definition, context, { result: 'fail' }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'REQUIRED_FEEDBACK_MISSING');
          return true;
        }
      );

      // 2. Fails when feedback is whitespace
      await assert.rejects(
        () => submitHumanStepResult(change, activation.task, definition, context, { result: 'fail', feedback: '   ' }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'REQUIRED_FEEDBACK_MISSING');
          return true;
        }
      );

      // Ensure no mutation occurred during failures
      const changeAfterFail = readFileSync(fx.changeYamlPath, 'utf8');
      assert.equal(changeAfterFail, changeBeforeFail, 'change.yaml must be unchanged after feedback failure');

      // 3. Succeeds with non-blank feedback
      const successResult = await submitHumanStepResult(change, activation.task, definition, context, {
        result: 'fail',
        feedback: 'Please fix the edge cases',
      });
      assert.equal(successResult.status, 'completed');
    } finally {
      cleanup(fx);
    }
  });

  test('AC8: submitHumanStepResult for unconditional human step accepts omitted result and rejects supplied result', async () => {
    const fx = makeFixtureRepo({
      prefix: 'submit-human-uncond',
      workflowYaml: UNCONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'unconditional-human-wf',
    });
    try {
      const { change, task, definition, context } = resolveWorkflowRuntime(fx.changeId, fx.taskId, { activeDir: fx.activeDir, repoRoot: fx.root });
      const activation = startHumanStep(change, task, definition, context);

      // 1. Rejects when result is supplied
      await assert.rejects(
        () => submitHumanStepResult(change, activation.task, definition, context, { result: 'continue' }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'UNEXPECTED_TRANSITION_RESULT');
          return true;
        }
      );

      // 2. Succeeds when result is omitted
      const result = await submitHumanStepResult(change, activation.task, definition, context, {});
      assert.equal(result.status, 'completed');

      const updatedChange = requireChange(fx.changeId, fx.activeDir);
      const updatedTask = requireTask(updatedChange, fx.taskId);
      const lastHistory = updatedTask.workflow_progress.history.at(-1);
      assert.equal(lastHistory.step, 'ack');
      assert.equal(lastHistory.transitioned_to, 'verified');
      assert.equal(lastHistory.result, undefined, 'No fabricated result should be stored in history');
    } finally {
      cleanup(fx);
    }
  });

  test('AC9: workflow verify-human --approve/--request-changes auto-activates and submits in one call', async () => {
    const fx = makeFixtureRepo({
      prefix: 'verify-human-auto-activate',
      workflowYaml: CONDITIONAL_HUMAN_WORKFLOW_YAML,
      workflowId: 'conditional-human-wf',
    });
    try {
      // Step is 'signoff' (human-owned), currently in phase 'new' (not active)
      const res = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
        approve: true,
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
      });

      assert.equal(res.status, 'completed');
      const updatedChange = requireChange(fx.changeId, fx.activeDir);
      const updatedTask = requireTask(updatedChange, fx.taskId);
      assert.equal(updatedTask.workflow_progress.state, 'completed');
      assert.equal(updatedTask.workflow_progress.history.at(-1).transitioned_to, 'verified');
    } finally {
      cleanup(fx);
    }
  });
});
