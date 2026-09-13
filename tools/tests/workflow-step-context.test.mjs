import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileStepContext,
  buildFinishContract,
  validateFinishInputs,
} from '../specs/workflow/step-context.mjs';
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
    assert.equal(params['include'].required, true);
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
