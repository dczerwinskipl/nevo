// Comprehensive unit and integration tests for execution readiness policy (Task 13, D10, D13, D15, D18, D19).
// Run: node --test tools/tests/execution-readiness-policy.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateExecutionReadiness,
  assertExecutionReadiness,
  isActivationOnlyBlocker,
  classifyReadinessFailure,
  ACTIVATION_ONLY_READINESS_CODES,
  ADMISSION_BLOCKING_READINESS_CODES,
  ALL_READINESS_FAILURE_CODES,
} from '../specs/workflow/readiness-policy.mjs';
import { isFinishOperationReplayable, saveOperationRecord } from '../specs/workflow/operation-record.mjs';

import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import { startHumanStep } from '../specs/workflow/human-step/operations.mjs';
import { WorkflowStepExecutorMismatchError } from '../specs/workflow/executor-guard.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';
import { requireChange } from '../specs/store.mjs';
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
      - to: dev2
  dev2:
    executor: agent
    status:
      active: in-dev2
      completed: dev2-complete
    purpose: "Implementation part 2"
    expectedWork:
      summary: "Write more code"
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
  - id: t-finish-rep
    status: in-progress
    file: tasks/07-finish-rep.md
    workflow_progress:
      current_step: dev
      current_attempt: 1
      state: completed
      history:
        - step: dev
          attempt: 1
          transitioned_to: dev2
  - id: t-finish-block
    status: in-progress
    file: tasks/08-finish-block.md
    workflow_progress:
      current_step: dev
      current_attempt: 1
      state: completed
      history:
        - step: dev
          attempt: 1
          transitioned_to: dev2
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
  writeFileSync(join(changeDir, 'tasks', '07-finish-rep.md'), makeTaskFile('t-finish-rep'));
  writeFileSync(join(changeDir, 'tasks', '08-finish-block.md'), makeTaskFile('t-finish-block'));

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

  test('AC3: workflow step start against human-owned current step fails closed via executor guard with full metadata', async () => {
    // 1. Direct evaluateExecutionReadiness verification
    const change = requireChange('demo-change', fx.activeDir);
    const taskHuman = change.tasks.find((t) => t.id === 't-human');
    const directReadiness = evaluateExecutionReadiness(taskHuman, change, 'agent', { repoRoot: fx.root });
    assert.equal(directReadiness.ready, false);
    assert.equal(directReadiness.code, 'WORKFLOW_STEP_EXECUTOR_MISMATCH');
    assert.equal(directReadiness.stepId, 'signoff');
    assert.equal(directReadiness.executor, 'human');
    assert.equal(directReadiness.purpose, 'Human review');
    assert.deepEqual(directReadiness.expectedWork, { summary: 'Evaluate code' });
    assert.deepEqual(directReadiness.availableActions, [
      { label: 'Approve', feedbackRequired: false, to: 'verified' },
    ]);

    // 2. CLI handleWorkflowStepStart throws WorkflowStepExecutorMismatchError with identical metadata
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
        assert.equal(err.purpose, 'Human review');
        assert.deepEqual(err.expectedWork, { summary: 'Evaluate code' });
        assert.deepEqual(err.availableActions, [
          { label: 'Approve', feedbackRequired: false, to: 'verified' },
        ]);
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

  test('attachSession with explicit taskId checks readiness and rejects unready task without creating binding', async () => {
    const service = new AgentSessionService({
      registry: makeMockRegistry(),
      repoRoot: fx.root,
    });

    // 1. attachSession with unready taskId (t-draft) is rejected
    await assert.rejects(
      () => service.attachSession('mock-provider', {
        providerSessionId: 'mock-p-session-1',
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

    // 2. attachSession with taskIds only (contextual association) succeeds without readiness check and activeTaskId remains absent
    const attached = await service.attachSession('mock-provider', {
      providerSessionId: 'mock-p-session-2',
      specId: '00000000-0000-4000-8000-000000000001',
      taskIds: ['t-draft', 't-blocked'],
    });

    assert.ok(attached);
    assert.deepEqual(attached.taskIds, ['t-draft', 't-blocked']);
    assert.equal(attached.taskId, undefined);
    assert.equal(attached.activeTaskId, undefined);
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

describe('Readiness failure classification split (Task 02, D2)', () => {
  test('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT is unconditionally activation-only', () => {
    assert.equal(isActivationOnlyBlocker('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'), true);
    assert.equal(classifyReadinessFailure('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'), 'activation-only');
    assert.ok(ACTIVATION_ONLY_READINESS_CODES.has('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'));
  });

  test('Existing readiness failure codes are unconditionally admission-blocking', () => {
    const admissionBlockingCodes = [
      'TASK_UNPUBLISHED',
      'DEPENDENCY_UNSATISFIED',
      'WORKFLOW_TERMINAL',
      'TASK_SUSPENDED',
      'WORKFLOW_STEP_EXECUTOR_MISMATCH',
      'TASK_BARRIERED',
      'WORKTREE_STATE_UNAVAILABLE',
    ];

    for (const code of admissionBlockingCodes) {
      assert.equal(isActivationOnlyBlocker(code), false, `${code} must not be activation-only`);
      assert.equal(classifyReadinessFailure(code), 'admission-blocking', `${code} must be admission-blocking`);
      assert.ok(ADMISSION_BLOCKING_READINESS_CODES.has(code), `${code} must be in ADMISSION_BLOCKING_READINESS_CODES`);
    }
  });

  test('FINISH_OPERATION_UNRESOLVED is activation-only iff prior record is proven replayable via isFinishOperationReplayable', () => {
    const replayableRecord = {
      operationId: 'op-replayable',
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running' },
      ],
    };
    assert.equal(isFinishOperationReplayable(replayableRecord), true);
    assert.equal(isActivationOnlyBlocker('FINISH_OPERATION_UNRESOLVED', { record: replayableRecord }), true);
    assert.equal(classifyReadinessFailure('FINISH_OPERATION_UNRESOLVED', { record: replayableRecord }), 'activation-only');
    assert.equal(isActivationOnlyBlocker({ code: 'FINISH_OPERATION_UNRESOLVED', priorRecord: replayableRecord }), true);

    const nonReplayableRecordBlocked = {
      operationId: 'op-blocked',
      status: 'blocked',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'unknown' },
      ],
    };
    assert.equal(isFinishOperationReplayable(nonReplayableRecordBlocked), false);
    assert.equal(isActivationOnlyBlocker('FINISH_OPERATION_UNRESOLVED', { record: nonReplayableRecordBlocked }), false);
    assert.equal(classifyReadinessFailure('FINISH_OPERATION_UNRESOLVED', { record: nonReplayableRecordBlocked }), 'admission-blocking');

    const nonReplayableRecordUnknown = {
      operationId: 'op-unknown',
      status: 'unknown',
    };
    assert.equal(isFinishOperationReplayable(nonReplayableRecordUnknown), false);
    assert.equal(isActivationOnlyBlocker('FINISH_OPERATION_UNRESOLVED', { record: nonReplayableRecordUnknown }), false);

    // Missing / null record fails closed to admission-blocking
    assert.equal(isActivationOnlyBlocker('FINISH_OPERATION_UNRESOLVED', { record: null }), false);
    assert.equal(isActivationOnlyBlocker('FINISH_OPERATION_UNRESOLVED'), false);
    assert.equal(classifyReadinessFailure('FINISH_OPERATION_UNRESOLVED'), 'admission-blocking');
  });

  test('Static check: readiness-policy.mjs imports isFinishOperationReplayable from operation-record.mjs without duplicate logic', () => {
    const policyFile = join(process.cwd(), 'tools', 'specs', 'workflow', 'readiness-policy.mjs');
    const source = readFileSync(policyFile, 'utf8');

    // Asserts proper import
    const importRegex = /import\s*\{[^}]*isFinishOperationReplayable[^}]*\}\s*from\s*['"]\.\/operation-record\.mjs['"]/;
    assert.ok(importRegex.test(source), 'readiness-policy.mjs must import isFinishOperationReplayable from ./operation-record.mjs');

    // Confirms no inline reimplementation of running / blocked / unknown literals in the classification logic
    const classifyFnRegex = /export\s+function\s+isActivationOnlyBlocker[\s\S]*?^}/m;
    const match = source.match(classifyFnRegex);
    assert.ok(match, 'isActivationOnlyBlocker function definition must exist');
    const fnBody = match[0];
    assert.ok(!fnBody.includes("'running'"), 'isActivationOnlyBlocker must not hardcode status === running check');
    assert.ok(!fnBody.includes("'blocked'"), 'isActivationOnlyBlocker must not hardcode status === blocked check');
    assert.ok(!fnBody.includes("'unknown'"), 'isActivationOnlyBlocker must not hardcode status === unknown check');
    assert.ok(fnBody.includes('isFinishOperationReplayable'), 'isActivationOnlyBlocker must delegate to isFinishOperationReplayable');
  });

  test('Exhaustive classification: every readiness failure code returned in evaluateBaseExecutionReadiness is classified', () => {
    const policyFile = join(process.cwd(), 'tools', 'specs', 'workflow', 'readiness-policy.mjs');
    const source = readFileSync(policyFile, 'utf8');

    const evaluateBaseStart = source.indexOf('function evaluateBaseExecutionReadiness(');
    const evaluateEnd = source.indexOf('function assertBaseExecutionReadiness(');
    assert.ok(evaluateBaseStart !== -1 && evaluateEnd !== -1);

    const evaluateSource = source.slice(evaluateBaseStart, evaluateEnd);
    const codeRegex = /code:\s*(?:err\.code\s*\|\|\s*)?['"]([A-Z_]+)['"]/g;
    const extractedCodes = new Set();
    let m;
    while ((m = codeRegex.exec(evaluateSource)) !== null) {
      extractedCodes.add(m[1]);
    }

    assert.ok(extractedCodes.size >= 7, `Expected at least 7 error codes, found: ${[...extractedCodes].join(', ')}`);

    for (const code of extractedCodes) {
      // Must be classified as either activation-only or admission-blocking (never throwing or undefined)
      const res = classifyReadinessFailure(code);
      assert.ok(
        res === 'activation-only' || res === 'admission-blocking',
        `Code '${code}' must be classified as either activation-only or admission-blocking`
      );
    }
  });
});

describe('Non-fatal admission for remediable activation blockers (Task 03, D1, D2)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({ prefix: 'non-fatal-test' });
    // Write replayable finish-operation record for t-finish-rep
    saveOperationRecord(fx.root, {
      change: 'demo-change',
      task: 't-finish-rep',
      step: 'dev',
      attempt: 1,
      operationId: 'op-replayable-1',
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running' },
      ],
    });
    // Write non-replayable finish-operation record for t-finish-block
    saveOperationRecord(fx.root, {
      change: 'demo-change',
      task: 't-finish-block',
      step: 'dev',
      attempt: 1,
      operationId: 'op-blocked-1',
      status: 'blocked',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'unknown' },
      ],
    });
  });
  after(() => {
    cleanup(fx);
  });

  function makeMockServiceWithTurnRuntime(repoRoot) {
    const turnRuntime = {
      startTurn: async (opts) => ({
        id: 'turn-mock-test',
        status: 'active',
        prompt: opts.message,
      }),
    };
    return new AgentSessionService({
      registry: {
        get: () => ({
          descriptor: { id: 'mock-provider', defaultMode: 'edit' },
          provider: {
            createSession: async () => ({ id: 'mock-p-id' }),
          },
        }),
      },
      turnRuntime,
      repoRoot,
    });
  }

  test('createSession and startTurn do not throw for DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT and expose structured blocker', async () => {
    const service = makeMockServiceWithTurnRuntime(fx.root);
    writeFileSync(join(fx.root, 'dirty-turn.txt'), 'dirty content');
    try {
      // 1. createSession does not throw
      const session = await service.createSession('mock-provider', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-ready',
      });
      assert.ok(session);
      assert.equal(session.taskId, 't-ready');
      assert.equal(session.attemptNotYetActivated, true);
      assert.ok(session.activationBlocker);
      assert.equal(session.activationBlocker.code, 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT');
      assert.ok(Array.isArray(session.activationBlocker.dirtyFiles));
      assert.ok(session.activationBlocker.dirtyFiles.includes('dirty-turn.txt'));

      // 2. startTurn does not throw
      const turn = await service.startTurn('mock-provider', session.sessionId, {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-ready',
        message: 'Implement the feature',
      });
      assert.ok(turn);
      assert.equal(turn.attemptNotYetActivated, true);
      assert.equal(turn.activationBlocker.code, 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT');
      assert.ok(turn.prompt.includes('[Activation Precondition Open]'));
      assert.ok(turn.prompt.includes('Status: workflow attempt not yet activated'));
      assert.ok(turn.prompt.includes('Code: DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'));
      assert.ok(turn.prompt.includes('Dirty Files: dirty-turn.txt'));
    } finally {
      git(fx.root, ['clean', '-fd']);
      git(fx.root, ['checkout', '--', '.']);
    }
  });

  test('createSession and startTurn do not throw for safely-replayable FINISH_OPERATION_UNRESOLVED and expose retry signal', async () => {
    const service = makeMockServiceWithTurnRuntime(fx.root);

    // 1. createSession does not throw
    const session = await service.createSession('mock-provider', {
      specId: '00000000-0000-4000-8000-000000000001',
      taskId: 't-finish-rep',
    });
    assert.ok(session);
    assert.equal(session.taskId, 't-finish-rep');
    assert.equal(session.attemptNotYetActivated, true);
    assert.ok(session.activationBlocker);
    assert.equal(session.activationBlocker.code, 'FINISH_OPERATION_UNRESOLVED');
    assert.equal(session.activationBlocker.replayableFinish, true);
    assert.ok(session.activationBlocker.replaySignal.includes("retry 'workflow step finish'"));

    // 2. startTurn does not throw
    const turn = await service.startTurn('mock-provider', session.sessionId, {
      specId: '00000000-0000-4000-8000-000000000001',
      taskId: 't-finish-rep',
      message: 'Resume step finish',
    });
    assert.ok(turn);
    assert.equal(turn.attemptNotYetActivated, true);
    assert.equal(turn.activationBlocker.code, 'FINISH_OPERATION_UNRESOLVED');
    assert.equal(turn.activationBlocker.replayableFinish, true);
    assert.ok(turn.prompt.includes('[Activation Precondition Open]'));
    assert.ok(turn.prompt.includes('Code: FINISH_OPERATION_UNRESOLVED'));
    assert.ok(turn.prompt.includes("retry 'workflow step finish'"));
  });

  test('createSession and startTurn throw unchanged for non-replayable FINISH_OPERATION_UNRESOLVED', async () => {
    const service = makeMockServiceWithTurnRuntime(fx.root);

    // 1. createSession throws
    await assert.rejects(
      () => service.createSession('mock-provider', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-finish-block',
      }),
      (err) => {
        assert.ok(err instanceof AiDeterministicWorkflowUnavailableError);
        assert.ok(err.message.includes('not ready for execution'));
        assert.equal(err.readiness?.code, 'FINISH_OPERATION_UNRESOLVED');
        return true;
      }
    );

    // 2. startTurn throws
    await assert.rejects(
      () => service.startTurn('mock-provider', 'sess-arbitrary', {
        specId: '00000000-0000-4000-8000-000000000001',
        taskId: 't-finish-block',
        message: 'Try executing',
      }),
      (err) => {
        assert.ok(err instanceof AiDeterministicWorkflowUnavailableError);
        assert.ok(err.message.includes('not ready for execution'));
        assert.equal(err.readiness?.code, 'FINISH_OPERATION_UNRESOLVED');
        return true;
      }
    );
  });
});


