// Tests for step executor invariant guard (Task 08, D5, D6, D16).
// Run: node --test tools/tests/step-executor-guard.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertStepExecutor,
  deriveAvailableActions,
  WorkflowStepExecutorMismatchError,
} from '../specs/workflow/executor-guard.mjs';
import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
} from '../specs/workflow/cli.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({
  prefix = 'nevo-executor-guard',
  changeId = 'guard-change',
  taskId = 'guard-task',
  workflowId = 'guard-workflow',
  workflowYaml,
} = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture ExecutorGuard']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYamlContent = [
    `id: ${changeId}`,
    `title: "${changeId}"`,
    `type: standard`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  definition: ${workflowId}`,
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

  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${workflowId}.yaml`), workflowYaml);

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-executor-guard-pkg',
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

describe('Step-executor guard unit tests', () => {
  test('deriveAvailableActions extracts label, result, and feedback requirements from transitions', () => {
    const conditionalStep = {
      transitions: [
        {
          value: 'pass',
          to: 'verified',
          action: { label: 'Approve' },
          outcome: 'success',
        },
        {
          value: 'fail',
          to: 'implementation',
          action: { label: 'Request changes', feedback: { required: true } },
        },
      ],
    };

    const actions = deriveAvailableActions(conditionalStep);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].label, 'Approve');
    assert.equal(actions[0].result, 'pass');
    assert.equal(actions[0].feedbackRequired, false);

    assert.equal(actions[1].label, 'Request changes');
    assert.equal(actions[1].result, 'fail');
    assert.equal(actions[1].feedbackRequired, true);

    const unconditionalStep = {
      transitions: [
        {
          to: 'review',
          action: { label: 'Submit for review' },
        },
      ],
    };
    const uncondActions = deriveAvailableActions(unconditionalStep);
    assert.equal(uncondActions.length, 1);
    assert.equal(uncondActions[0].label, 'Submit for review');
    assert.equal(uncondActions[0].result, undefined, 'Unconditional transition must not fabricate a result');
  });

  test('assertStepExecutor passes when executor matches caller kind', () => {
    assert.doesNotThrow(() => {
      assertStepExecutor({ executor: 'agent' }, 'agent');
    });
    assert.doesNotThrow(() => {
      assertStepExecutor({ executor: 'human' }, 'human');
    });
    assert.doesNotThrow(() => {
      // Default executor is agent
      assertStepExecutor({}, 'agent');
    });
  });

  test('assertStepExecutor throws WorkflowStepExecutorMismatchError when caller is agent and step is human', () => {
    const humanStep = {
      purpose: 'Owner sign-off',
      expectedWork: { summary: 'Confirm acceptance' },
      executor: 'human',
      transitions: [
        {
          value: 'pass',
          to: 'verified',
          action: { label: 'Approve' },
          outcome: 'success',
        },
      ],
    };

    assert.throws(
      () => assertStepExecutor(humanStep, 'agent', { stepId: 'human-verification' }),
      (err) => {
        assert.ok(err instanceof WorkflowStepExecutorMismatchError);
        assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
        assert.equal(err.stepId, 'human-verification');
        assert.equal(err.executor, 'human');
        assert.equal(err.callerKind, 'agent');
        assert.equal(err.purpose, 'Owner sign-off');
        assert.deepEqual(err.expectedWork, { summary: 'Confirm acceptance' });
        assert.equal(err.availableActions.length, 1);
        assert.equal(err.availableActions[0].label, 'Approve');
        assert.ok(err.message.includes("Step 'human-verification' is owned by a human and cannot be started by an agent"));
        assert.ok(err.message.includes('Do not execute, simulate, or complete this step'));
        return true;
      }
    );
  });

  test('assertStepExecutor throws WorkflowStepExecutorMismatchError for reverse direction (human caller on agent step)', () => {
    const agentStep = {
      purpose: 'Implement task',
      executor: 'agent',
      transitions: [{ to: 'review' }],
    };

    assert.throws(
      () => assertStepExecutor(agentStep, 'human', { stepId: 'implementation' }),
      (err) => {
        assert.ok(err instanceof WorkflowStepExecutorMismatchError);
        assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
        assert.equal(err.stepId, 'implementation');
        assert.equal(err.executor, 'agent');
        assert.equal(err.callerKind, 'human');
        assert.ok(err.message.includes("Step 'implementation' is owned by an agent and cannot be started or executed by a human"));
        return true;
      }
    );
  });
});

describe('Step-executor guard CLI integration (AC1, AC2, AC3)', () => {
  const HUMAN_ENTRY_WORKFLOW_YAML = `id: human-entry-workflow
title: "Human Entry Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: human-approval
steps:
  human-approval:
    executor: human
    status:
      active: awaiting-approval
      completed: approved
    purpose: "Human operator manual approval"
    expectedWork:
      summary: "Owner inspects and confirms"
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
        to: abandoned
        action:
          label: Reject
          feedback:
            required: true
        outcome: failure
`;

  const AGENT_ENTRY_WORKFLOW_YAML = `id: agent-entry-workflow
title: "Agent Entry Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: agent-work
steps:
  agent-work:
    status:
      active: working
      completed: done
    purpose: "Automated work"
    expectedWork:
      summary: "Write code"
    hints: []
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        outcome: success
`;

  test('AC1: workflow step start against a step with executor: human fails with structured error and change.yaml is unchanged', async () => {
    const fx = makeFixtureRepo({
      prefix: 'nevo-guard-start',
      changeId: 'human-start-change',
      taskId: 'human-start-task',
      workflowId: 'human-entry-workflow',
      workflowYaml: HUMAN_ENTRY_WORKFLOW_YAML,
    });

    try {
      const changeYamlBefore = readFileSync(fx.changeYamlPath, 'utf8');

      await assert.rejects(
        () => handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root }),
        (err) => {
          assert.ok(err instanceof WorkflowStepExecutorMismatchError);
          assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
          assert.equal(err.stepId, 'human-approval');
          assert.equal(err.executor, 'human');
          assert.equal(err.purpose, 'Human operator manual approval');
          assert.deepEqual(err.expectedWork, { summary: 'Owner inspects and confirms' });
          assert.equal(err.availableActions.length, 2);
          assert.equal(err.availableActions[0].label, 'Approve');
          assert.equal(err.availableActions[0].result, 'pass');
          assert.equal(err.availableActions[1].label, 'Reject');
          assert.equal(err.availableActions[1].result, 'fail');
          assert.equal(err.availableActions[1].feedbackRequired, true);
          return true;
        }
      );

      const changeYamlAfter = readFileSync(fx.changeYamlPath, 'utf8');
      assert.equal(changeYamlAfter, changeYamlBefore, 'change.yaml must be byte-for-byte unchanged');
    } finally {
      cleanup(fx);
    }
  });

  test('AC2: workflow step finish against a step with executor: human fails identically (defense in depth) and change.yaml is unchanged', async () => {
    const fx = makeFixtureRepo({
      prefix: 'nevo-guard-finish',
      changeId: 'human-finish-change',
      taskId: 'human-finish-task',
      workflowId: 'human-entry-workflow',
      workflowYaml: HUMAN_ENTRY_WORKFLOW_YAML,
    });

    try {
      const changeYamlBefore = readFileSync(fx.changeYamlPath, 'utf8');

      await assert.rejects(
        () => handleWorkflowStepFinish(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root }),
        (err) => {
          assert.ok(err instanceof WorkflowStepExecutorMismatchError);
          assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
          assert.equal(err.stepId, 'human-approval');
          assert.equal(err.executor, 'human');
          assert.equal(err.purpose, 'Human operator manual approval');
          assert.deepEqual(err.expectedWork, { summary: 'Owner inspects and confirms' });
          assert.equal(err.availableActions.length, 2);
          assert.equal(err.availableActions[0].label, 'Approve');
          assert.equal(err.availableActions[1].label, 'Reject');
          return true;
        }
      );

      const changeYamlAfter = readFileSync(fx.changeYamlPath, 'utf8');
      assert.equal(changeYamlAfter, changeYamlBefore, 'change.yaml must be byte-for-byte unchanged');
    } finally {
      cleanup(fx);
    }
  });

  test('AC3: workflow step start against an executor: agent step is unaffected', async () => {
    const fx = makeFixtureRepo({
      prefix: 'nevo-guard-agent',
      changeId: 'agent-start-change',
      taskId: 'agent-start-task',
      workflowId: 'agent-entry-workflow',
      workflowYaml: AGENT_ENTRY_WORKFLOW_YAML,
    });

    try {
      const stepContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
      assert.ok(stepContext);
      assert.equal(stepContext.currentStep, 'agent-work');
      assert.equal(stepContext.attempt, 1);
    } finally {
      cleanup(fx);
    }
  });
});
