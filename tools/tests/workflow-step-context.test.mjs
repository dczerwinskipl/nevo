import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileStepContext,
  ensureStepActivated,
  buildFinishContract,
  validateFinishInputs,
  resolveTaskDefinition,
  resolveRequiredContext,
  pickAgentFacingSourceControl,
} from '../specs/workflow/step-context.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
import '../specs/workflow/actions/index.mjs';

function makeGitFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);

  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const rootTxt = join(repo, 'root.txt');
  writeFileSync(rootTxt, 'initial\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);

  return { base, repo, activeDir, changeDir, tasksDir };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

const CONDITIONAL_WORKFLOW = {
  id: 'review-loop-v1',
  title: 'Review Loop',
  type: 'standard',
  version: 1,
  sourceControl: {
    enabled: true,
    push: false,
  },
  entryStep: 'implementation',
  steps: {
    implementation: {
      status: { active: 'in-implementation', completed: 'implemented' },
      entryGates: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'review' }],
    },
    review: {
      status: { active: 'in-review', completed: 'reviewed' },
      entryGates: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [
        { value: 'pass', to: 'verified' },
        { value: 'fail', to: 'implementation' },
      ],
    },
  },
};

describe('compileStepContext canonical finishContract.parameters (AC1)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-ac1'); });
  after(() => cleanupFixture(fx));

  test('preserves finalize action schemas and composes result and artifacts for conditional step', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-review
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-review\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.ok(stepContext.finishContract);
    const params = stepContext.finishContract.parameters;
    assert.ok(params, 'finishContract must have canonical parameters');

    // Preserves finalize action schemas
    assert.equal(params['commit.title'].type, 'string');
    assert.equal(params['commit.title'].required, true);
    assert.equal(params['commit.title'].constraints?.minLength, 5);

    assert.equal(params['commit.message'].type, 'string');
    assert.equal(params['commit.message'].required, false);

    assert.equal(params['include'].type, 'array');
    assert.equal(params['include'].required, false);
    assert.deepEqual(params['include'].items, { type: 'string' });

    assert.equal(params['exclude'].type, 'array');
    assert.equal(params['exclude'].required, false);
    assert.deepEqual(params['exclude'].items, { type: 'string' });

    // Composes result enum for conditional step
    assert.equal(params['result'].type, 'enum');
    assert.equal(params['result'].required, true);
    assert.deepEqual(params['result'].allowedValues, ['pass', 'fail']);

    // Composes artifacts
    assert.equal(params['artifacts'].type, 'array');
    assert.equal(params['artifacts'].required, false);
    assert.deepEqual(params['artifacts'].items, { type: 'string' });

    // Composes feedback
    assert.equal(params['feedback'].type, 'string');
    assert.equal(params['feedback'].required, false);

    // Attempt identity is exposed
    assert.equal(stepContext.attempt, 1);
  });

  test('omits result parameter on unconditional steps', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    const params = stepContext.finishContract.parameters;
    assert.equal(params['result'], undefined, 'result must be omitted for unconditional steps');
    assert.ok(params['artifacts'], 'artifacts parameter is still composed');
    assert.ok(params['commit.title'], 'finalize action schemas are preserved');
  });
});

describe('compileStepContext hides destination routing from AI (AC2)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-ac2'); });
  after(() => cleanupFixture(fx));

  test('does not expose destination step routing (to) or availableTransitions', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-review
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-review\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    // Destination routing must not be exposed to agent
    assert.equal('availableTransitions' in stepContext, false, 'availableTransitions must not exist on stepContext');
    assert.equal('nextStepGuidance' in stepContext, false, 'nextStepGuidance must not exist on stepContext');

    const resultParam = stepContext.finishContract.parameters.result;
    assert.deepEqual(resultParam.allowedValues, ['pass', 'fail']);
    assert.equal('to' in resultParam, false, 'destination step (to) must not be in parameters.result');
  });
});

describe('compileStepContext protocol block (AC3)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-ac3'); });
  after(() => cleanupFixture(fx));

  test('emits the authoritative protocol block on active step context', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.deepEqual(stepContext.protocol, {
      authoritative: true,
      noDirectStateMutation: true,
      doNotInferNextStep: true,
      logicalCompletionPerAttempt: true,
      resumableFinish: true,
      stopOnHumanGate: true,
    });
  });

  test('emits protocol block on terminal step context', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: verified
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
          transitioned_to: verified
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: verified\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.equal(stepContext.stepStatus, 'complete');
    assert.deepEqual(stepContext.protocol, {
      authoritative: true,
      noDirectStateMutation: true,
      doNotInferNextStep: true,
      logicalCompletionPerAttempt: true,
      resumableFinish: true,
      stopOnHumanGate: true,
    });
  });
});

describe('ensureStepActivated clean baseline vs resume (AC2)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-ac2-clean'); });
  after(() => cleanupFixture(fx));

  test('throws DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT when starting new attempt with uncommitted files outside .nevo-ai-local/', () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    // Create an uncommitted dirty file
    writeFileSync(join(fx.repo, 'dirty.txt'), 'dirty content\n');

    assert.throws(
      () => ensureStepActivated(change, task, CONDITIONAL_WORKFLOW, { repoRoot: fx.repo }),
      (err) => err instanceof WorkflowError && err.code === 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'
    );

    // Clean up dirty file
    rmSync(join(fx.repo, 'dirty.txt'));
  });

  test('allows files inside .nevo-ai-local/ when starting new attempt', () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

    // Commit specs so baseline working tree is clean
    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'specs baseline']);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const localDir = join(fx.repo, '.nevo-ai-local');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'session.json'), '{"id":"test"}\n');

    const result = ensureStepActivated(change, task, CONDITIONAL_WORKFLOW, { repoRoot: fx.repo });
    assert.equal(result.position.phase, 'active');
    assert.equal(result.position.attempt, 1);
  });

  test('allows dirty working tree when resuming an already active attempt', () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    // Dirty file in repo
    writeFileSync(join(fx.repo, 'wip.txt'), 'work in progress\n');

    const result = ensureStepActivated(change, task, CONDITIONAL_WORKFLOW, { repoRoot: fx.repo });
    assert.equal(result.position.phase, 'active');
    assert.equal(result.position.step, 'implementation');
    assert.equal(result.position.attempt, 1);

    // Clean up wip file
    rmSync(join(fx.repo, 'wip.txt'));
  });

  test('throws WORKTREE_STATE_UNAVAILABLE when starting new attempt and Git inspection fails (Finding 4)', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'nevo-nongit-'));
    try {
      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
`;
      const changeDir = join(nonGitDir, 'specs', 'active', 'demo-change');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'tasks', '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

      const change = requireChange('demo-change', join(nonGitDir, 'specs', 'active'));
      const task = requireTask(change, 'demo-task');

      assert.throws(
        () => ensureStepActivated(change, task, CONDITIONAL_WORKFLOW, { repoRoot: nonGitDir }),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'WORKTREE_STATE_UNAVAILABLE');
          return true;
        }
      );
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  test('allows resuming an already active attempt even if Git inspection fails (Finding 4)', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'nevo-nongit-resume-'));
    try {
      const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
      const changeDir = join(nonGitDir, 'specs', 'active', 'demo-change');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'tasks', '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

      const change = requireChange('demo-change', join(nonGitDir, 'specs', 'active'));
      const task = requireTask(change, 'demo-task');

      const result = ensureStepActivated(change, task, CONDITIONAL_WORKFLOW, { repoRoot: nonGitDir });
      assert.equal(result.position.phase, 'active');
      assert.equal(result.position.step, 'implementation');
      assert.equal(result.position.attempt, 1);
      assert.equal(Boolean(result.activated), false);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe('compileStepContext previousTransition enrichment (AC6)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-ac6-prev'); });
  after(() => cleanupFixture(fx));

  test('projects previousTransition for attempt 2 following review failure', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 2
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: fail
          feedback: "Add crash recovery test for dirty tree during finalize."
          artifacts:
            - "specs/active/demo-change/reviews/task-01-attempt-1.md"
          transitioned_to: implementation
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: in-implementation\n---\n# Task\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.equal(stepContext.attempt, 2);
    assert.ok(stepContext.previousTransition, 'previousTransition must be populated');
    assert.equal(stepContext.previousTransition.from, 'review');
    assert.equal(stepContext.previousTransition.attempt, 1);
    assert.equal(stepContext.previousTransition.result, 'fail');
    assert.equal(stepContext.previousTransition.requestedChanges, 'Add crash recovery test for dirty tree during finalize.');
    assert.deepEqual(stepContext.previousTransition.artifacts, ['specs/active/demo-change/reviews/task-01-attempt-1.md']);
  });

  test('projects previousTransition following human-verification request-changes', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 3
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
        - step: human-verification
          attempt: 1
          completed_at: "2026-01-01T02:00:00.000Z"
          result: fail
          feedback: "Operator requested additional test coverage"
          transitioned_to: implementation
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.equal(stepContext.attempt, 3);
    assert.ok(stepContext.previousTransition);
    assert.equal(stepContext.previousTransition.from, 'human-verification');
    assert.equal(stepContext.previousTransition.attempt, 1);
    assert.equal(stepContext.previousTransition.result, 'fail');
    assert.equal(stepContext.previousTransition.requestedChanges, 'Operator requested additional test coverage');
  });

  test('omits previousTransition when no failure or changes exist in history', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    const stepContext = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.equal(stepContext.previousTransition, undefined);
  });
});

describe('Task 24: Agent step bootstrap and context (taskDefinition, requiredContext, sourceControl projection)', () => {
  let fx;
  before(() => { fx = makeGitFixture('nevo-step-ctx-task24'); });
  after(() => cleanupFixture(fx));

  test('pickAgentFacingSourceControl drops existingCommits and unpushedCommits while keeping factual fields', () => {
    assert.equal(pickAgentFacingSourceControl(null), null);
    const facts = {
      currentBranch: 'feature/demo',
      baseBranch: 'main',
      changedFiles: ['file1.txt'],
      stagedFiles: [],
      taskAffectedFiles: ['file1.txt'],
      generatedFiles: [],
      existingCommits: ['abc1234 initial'],
      unpushedCommits: ['def5678 wip'],
      extraProp: 'hello',
    };
    const projected = pickAgentFacingSourceControl(facts);
    assert.deepEqual(projected, {
      currentBranch: 'feature/demo',
      baseBranch: 'main',
      changedFiles: ['file1.txt'],
      stagedFiles: [],
      taskAffectedFiles: ['file1.txt'],
      generatedFiles: [],
      extraProp: 'hello',
    });
    assert.equal('existingCommits' in projected, false);
    assert.equal('unpushedCommits' in projected, false);
  });

  test('compileStepContext returns taskDefinition with byte-identical content for active and terminal phases', async () => {
    const rawTaskMd = '---\nid: demo-task\nstatus: in-implementation\ncontext:\n  required:\n    - docs/sample.md\n---\n# Task 01: Build feature\n\nDetailed content here.\n';
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), rawTaskMd);
    const docPath = join(fx.repo, 'docs', 'sample.md');
    mkdirSync(join(fx.repo, 'docs'), { recursive: true });
    writeFileSync(docPath, '# Sample Doc Content\n');

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'demo-task');

    // 1. Active phase
    const activeCtx = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.ok(activeCtx.taskDefinition);
    assert.equal(activeCtx.taskDefinition.id, 'demo-task');
    assert.equal(activeCtx.taskDefinition.path, 'specs/active/demo-change/tasks/01-demo-task.md');
    assert.equal(activeCtx.taskDefinition.content, rawTaskMd);

    // requiredContext inline bundling
    assert.ok(Array.isArray(activeCtx.requiredContext));
    assert.equal(activeCtx.requiredContext.length, 1);
    assert.equal(activeCtx.requiredContext[0].path, 'docs/sample.md');
    assert.equal(activeCtx.requiredContext[0].content, '# Sample Doc Content\n');

    // Source control projection: existingCommits dropped
    if (activeCtx.context?.sourceControl) {
      assert.equal('existingCommits' in activeCtx.context.sourceControl, false);
      assert.equal('unpushedCommits' in activeCtx.context.sourceControl, false);
      assert.ok('currentBranch' in activeCtx.context.sourceControl);
      assert.ok('changedFiles' in activeCtx.context.sourceControl);
    }

    // 2. Terminal phase
    const terminalChangeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: demo-task
    file: tasks/01-demo-task.md
    status: verified
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
          transitioned_to: verified
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), terminalChangeYaml);
    const termChange = requireChange('demo-change', fx.activeDir);
    const termTask = requireTask(termChange, 'demo-task');

    const termCtx = await compileStepContext({
      change: termChange,
      task: termTask,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.equal(termCtx.stepStatus, 'complete');
    assert.ok(termCtx.taskDefinition);
    assert.equal(termCtx.taskDefinition.id, 'demo-task');
    assert.equal(termCtx.taskDefinition.path, 'specs/active/demo-change/tasks/01-demo-task.md');
    assert.equal(termCtx.taskDefinition.content, rawTaskMd);
    assert.deepEqual(termCtx.requiredContext, [
      { path: 'docs/sample.md', content: '# Sample Doc Content\n' }
    ]);
  });

  test('requiredContext returns empty array when task declares no context.required', async () => {
    const rawTaskMd = '---\nid: bare-task\nstatus: in-implementation\n---\n# Bare Task\n';
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: bare-task
    file: tasks/02-bare-task.md
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '02-bare-task.md'), rawTaskMd);

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'bare-task');

    const ctx = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir },
    });

    assert.deepEqual(ctx.requiredContext, []);
  });

  test('relevantDocs and requiredContext can both be non-empty without deduplication', async () => {
    const rawTaskMd = '---\nid: multi-ctx-task\nstatus: in-implementation\nallowed_paths:\n  - src/feature/**\ncontext:\n  required:\n    - docs/api.md\n---\n# Multi Context Task\n';
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: review-loop-v1
tasks:
  - id: multi-ctx-task
    file: tasks/03-multi-ctx-task.md
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '03-multi-ctx-task.md'), rawTaskMd);
    writeFileSync(join(fx.repo, 'docs', 'api.md'), '# API Doc\n');

    // Fake routing index with a rule matching src/feature/**
    const fakeRoutingIndex = {
      rules: [
        { rule_id: 'RT-01', doc_ref: 'docs/routing-guide.md', path_glob: 'src/feature/**' },
      ],
    };

    const change = requireChange('demo-change', fx.activeDir);
    const task = requireTask(change, 'multi-ctx-task');

    const ctx = await compileStepContext({
      change,
      task,
      definition: CONDITIONAL_WORKFLOW,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, routingIndex: fakeRoutingIndex },
    });

    assert.equal(ctx.relevantDocs.length, 1);
    assert.equal(ctx.relevantDocs[0].docRef, 'docs/routing-guide.md');
    assert.equal(ctx.requiredContext.length, 1);
    assert.equal(ctx.requiredContext[0].path, 'docs/api.md');
    assert.equal(ctx.requiredContext[0].content, '# API Doc\n');
  });
});
