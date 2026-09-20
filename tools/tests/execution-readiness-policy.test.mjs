// Comprehensive unit and integration tests for execution readiness policy (Task 13, D10, D13, D15, D18, D19).
// Run: node --test tools/tests/execution-readiness-policy.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateExecutionReadiness,
  assertExecutionReadiness,
} from '../specs/workflow/readiness-policy.mjs';
import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import { startHumanStep } from '../specs/workflow/human-step/operations.mjs';
import { WorkflowStepExecutorMismatchError } from '../specs/workflow/executor-guard.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';
import { AgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';
import { AiDeterministicWorkflowUnavailableError } from '../dashboard/server/ai/contracts.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({ prefix = 'readiness-test' } = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'readiness@example.com']);
  git(root, ['config', 'user.name', 'Readiness Fixture']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });

  const workflowYaml = `id: readiness-wf
title: "Readiness Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: dev
steps:
  dev:
    executor: agent
    status:
      active: in-dev
      completed: dev-complete
    purpose: "Implementation"
    expectedWork:
      summary: "Write code"
    transitions:
      - to: signoff
  signoff:
    executor: human
    status:
      active: in-signoff
      completed: signoff-complete
    purpose: "Human review"
    expectedWork:
      summary: "Evaluate code"
    transitions:
      - to: verified
        action:
          label: Approve
        outcome: success
`;

  writeFileSync(join(workflowsDir, 'readiness-wf.yaml'), workflowYaml);

  const changeYaml = `id: demo-change
title: "Demo Change"
spec_id: "00000000-0000-4000-8000-000000000001"
workflow:
  mode: deterministic
  definition: readiness-wf
tasks:
  - id: t-draft
    status: draft
    file: tasks/01-draft.md
  - id: t-dep
    status: approved
    file: tasks/02-dep.md
  - id: t-blocked
    status: approved
    file: tasks/03-blocked.md
    depends_on:
      - t-dep
  - id: t-ready
    status: approved
    file: tasks/04-ready.md
  - id: t-human
    status: in-signoff
    file: tasks/05-human.md
    workflow_progress:
      current_step: signoff
      current_attempt: 1
      state: active
      history:
        - step: dev
          attempt: 1
          transitioned_to: signoff
  - id: t-terminal
    status: verified
    file: tasks/06-terminal.md
    workflow_progress:
      current_step: signoff
      current_attempt: 1
      state: completed
      history:
        - step: dev
          attempt: 1
          transitioned_to: signoff
        - step: signoff
          attempt: 1
          transitioned_to: verified
          outcome: success
`;

  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const makeTaskFile = (id) => `---
id: demo-change.${id}
status: draft
change: demo-change
allowed_paths:
  - "*"
forbidden_paths: []
---
# Task ${id}
`;

  writeFileSync(join(changeDir, 'tasks', '01-draft.md'), makeTaskFile('t-draft'));
  writeFileSync(join(changeDir, 'tasks', '02-dep.md'), makeTaskFile('t-dep'));
  writeFileSync(join(changeDir, 'tasks', '03-blocked.md'), makeTaskFile('t-blocked'));
  writeFileSync(join(changeDir, 'tasks', '04-ready.md'), makeTaskFile('t-ready'));
  writeFileSync(join(changeDir, 'tasks', '05-human.md'), makeTaskFile('t-human'));
  writeFileSync(join(changeDir, 'tasks', '06-terminal.md'), makeTaskFile('t-terminal'));

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'readiness-pkg', version: '1.0.0' }, null, 2));
  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'clean\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);

  return { root, remote, activeDir, changeDir };
}

function cleanup(fx) {
  if (fx?.root) rmSync(fx.root, { recursive: true, force: true });
  if (fx?.remote) rmSync(fx.remote, { recursive: true, force: true });
}

describe('Execution Readiness Policy (Task 13, D10, D13, D15, D18)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo();
  });
  after(() => {
    cleanup(fx);
  });

  test('AC1: workflow step start against draft/unpublished task fails closed', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart('demo-change', 't-draft', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
      }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'TASK_UNPUBLISHED');
        return true;
      }
    );
  });

  test('AC2: workflow step start against task with unsatisfied dependency fails closed naming dependency', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart('demo-change', 't-blocked', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
      }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'DEPENDENCY_UNSATISFIED');
        assert.ok(err.message.includes('t-dep'));
        return true;
      }
    );
  });

  test('AC3: workflow step start against human-owned current step fails closed via executor guard', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart('demo-change', 't-human', {
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        silent: true,
      }),
      (err) => {
        assert.ok(err instanceof WorkflowStepExecutorMismatchError);
        assert.equal(err.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
        assert.equal(err.stepId, 'signoff');
        assert.equal(err.executor, 'human');
        assert.equal(err.callerKind, 'agent');
        return true;
      }
    );
  });

  function makeMockRegistry() {
    return {
      get: () => ({
        descriptor: { id: 'mock-provider', defaultMode: 'edit' },
        provider: {
          createSession: async () => ({ id: 'mock-p-id' }),
        },
      }),
    };
  }

  test('AC4: Server-side createSession with unready execution taskId is refused', async () => {
    const service = new AgentSessionService({
      registry: makeMockRegistry(),
      repoRoot: fx.root,
    });

    // 1. Refuses draft task
    await assert.rejects(
      () => service.createSession('mock-provider', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-draft',
      }),
      (err) => {
        assert.ok(err instanceof AiDeterministicWorkflowUnavailableError);
        assert.ok(err.message.includes('not ready for execution'));
        assert.ok(err.message.includes('draft'));
        return true;
      }
    );

    // 2. Refuses blocked task
    await assert.rejects(
      () => service.createSession('mock-provider', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-blocked',
      }),
      (err) => {
        assert.ok(err instanceof AiDeterministicWorkflowUnavailableError);
        assert.ok(err.message.includes('not ready for execution'));
        assert.ok(err.message.includes('unsatisfied dependencies'));
        return true;
      }
    );

    // 3. Refuses human step task
    await assert.rejects(
      () => service.createSession('mock-provider', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-human',
      }),
      (err) => {
        assert.ok(err instanceof AiDeterministicWorkflowUnavailableError);
        assert.ok(err.message.includes('not ready for execution'));
        assert.ok(err.message.includes('owned by a human') || err.readiness?.code === 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
        return true;
      }
    );
  });

  test('AC5: startHumanStep against unready task (draft, blocked, terminal) is refused', async () => {
    const change = {
      id: 'demo-change',
      _slug: 'demo-change',
      workflow: { mode: 'deterministic', definition: 'readiness-wf' },
    };
    const definition = {
      id: 'readiness-wf',
      entryStep: 'dev',
      steps: {
        dev: { executor: 'agent', transitions: [{ to: 'signoff' }] },
        signoff: { executor: 'human', transitions: [{ to: 'verified', outcome: 'success' }] },
      },
    };

    // 1. Draft task
    const draftTask = { id: 't-draft', status: 'draft' };
    assert.throws(
      () => startHumanStep(change, draftTask, definition, { repoRoot: fx.root, activeDir: fx.activeDir }),
      (err) => err instanceof WorkflowError && err.code === 'TASK_UNPUBLISHED'
    );

    // 2. Blocked task
    const blockedTask = { id: 't-blocked', status: 'approved', depends_on: ['t-dep'] };
    assert.throws(
      () => startHumanStep(change, blockedTask, definition, { repoRoot: fx.root, activeDir: fx.activeDir }),
      (err) => err instanceof WorkflowError && err.code === 'DEPENDENCY_UNSATISFIED'
    );

    // 3. Terminal task
    const terminalTask = {
      id: 't-terminal',
      status: 'verified',
      workflow_progress: {
        current_step: 'signoff',
        current_attempt: 1,
        state: 'completed',
        history: [{ step: 'signoff', attempt: 1, transitioned_to: 'verified' }],
      },
    };
    assert.throws(
      () => startHumanStep(change, terminalTask, definition, { repoRoot: fx.root, activeDir: fx.activeDir }),
      (err) => err instanceof WorkflowError && err.code === 'WORKFLOW_TERMINAL'
    );
  });

  test('AC6 & AC9: Request carrying only contextual taskIds succeeds even if unready and does not bind active task', async () => {
    const service = new AgentSessionService({
      registry: makeMockRegistry(),
      repoRoot: fx.root,
    });

    // Exactly one contextual task (draft-task) with NO authoritative taskId
    const session = await service.createSession('mock-provider', {
      specId: '00000000-0000-4000-8000-000000000001',
      taskIds: ['t-draft'],
    });

    assert.ok(session);
    assert.equal(session.taskId, undefined, 'taskId must be undefined when only contextual taskIds provided');
    assert.equal(session.activeTaskId, undefined, 'activeTaskId must be undefined when only contextual taskIds provided');
  });

  test('AC7: New attempt against dirty baseline worktree fails closed; resume active attempt succeeds', async () => {
    // 1. Ready task starting new attempt fails when worktree is dirty
    writeFileSync(join(fx.root, 'dirty.txt'), 'dirty content');
    try {
      await assert.rejects(
        () => handleWorkflowStepStart('demo-change', 't-ready', {
          activeDir: fx.activeDir,
          repoRoot: fx.root,
          silent: true,
        }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT');
          return true;
        }
      );
    } finally {
      git(fx.root, ['clean', '-fd']);
      git(fx.root, ['checkout', '--', '.']);
    }
  });

  test('AC8: workflow step start and session creation succeed against ready task', async () => {
    // 1. CLI step start succeeds on ready task
    const res = await handleWorkflowStepStart('demo-change', 't-ready', {
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      silent: true,
    });
    assert.ok(res);
    assert.equal(res.currentStep, 'dev');
    assert.equal(res.attempt, 1);

    // 2. Server createSession succeeds on ready task
    const service = new AgentSessionService({
      registry: makeMockRegistry(),
      repoRoot: fx.root,
    });

    const session = await service.createSession('mock-provider', {
      specId: '00000000-0000-4000-8000-000000000001',
      taskId: 't-ready',
    });
    assert.ok(session);
    assert.equal(session.taskId, 't-ready');
  });
});
