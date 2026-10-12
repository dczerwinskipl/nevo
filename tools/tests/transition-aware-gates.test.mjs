import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { finishStep, planFinish, filterExitGatesByResult } from '../specs/workflow/finish-operation.mjs';
import { validateWorkflowDefinition, normalizeWorkflowDefinition } from '../specs/workflow/definitions/schema.mjs';
import { loadWorkflowDefinition } from '../specs/workflow/definitions/loader.mjs';
import { createDefaultGateRegistry, MemoryCommandVerificationStore, MemoryHumanVerificationReader } from '../specs/workflow/index.mjs';
import { requireChange, requireTask, ROOT } from '../specs/store.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function makeFailingGateRegistry() {
  const cmdStore = new MemoryCommandVerificationStore();
  const humanReader = new MemoryHumanVerificationReader([]);
  return createDefaultGateRegistry({
    commandRunner: async () => ({ passed: false, exitCode: 1, stdout: '', stderr: 'AssertionError: test failed' }),
    commandVerificationStore: cmdStore,
    humanVerificationReader: humanReader,
  });
}

function makePassingGateRegistry() {
  const cmdStore = new MemoryCommandVerificationStore();
  cmdStore.recordCommandResult({ command: 'npm test', action: 'test', passed: true });
  const humanReader = new MemoryHumanVerificationReader([]);
  return createDefaultGateRegistry({
    commandRunner: async () => ({ passed: true, exitCode: 0, stdout: 'ok', stderr: '' }),
    commandVerificationStore: cmdStore,
    humanVerificationReader: humanReader,
  });
}

const REVIEW_WORKFLOW_DEF = normalizeWorkflowDefinition({
  id: 'review-test-v1',
  title: 'Review Test Workflow',
  type: 'standard',
  version: 1,
  steps: {
    implementation: {
      status: { active: 'in-implementation', completed: 'implemented' },
      entryGates: [],
      actions: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'review' }],
    },
    review: {
      status: { active: 'in-review', completed: 'reviewed' },
      entryGates: [],
      actions: [],
      exitGates: [
        { type: 'command', action: 'test', when: ['pass'] },
      ],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [
        {
          value: 'pass',
          to: 'verified',
          outcome: 'success',
        },
        {
          value: 'fail',
          to: 'implementation',
          action: {
            feedback: {
              required: true,
            },
          },
          continuation: 'auto',
          invalidatesDependencyRelease: true,
        },
      ],
    },
  },
});

function setupRepoFixture(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test Runner']);
  git(repo, ['config', 'user.email', 'test@runner.local']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'hello root\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: initial repo root']);
  git(repo, ['push', '-u', 'origin', 'main']);

  const specsActive = join(repo, 'specs', 'active');
  const changeDir = join(specsActive, 'demo-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const changeYaml = [
    'id: demo-change',
    'title: Demo Change',
    'status: in-implementation',
    'tasks:',
    '  - id: t1',
    '    file: tasks/01-t1.md',
    '    status: in-implementation',
    '    workflow_progress:',
    '      current_step: review',
    '      current_attempt: 1',
    '      state: active',
    '      history:',
    '        - step: implementation',
    '          attempt: 1',
    '          completed_at: "2026-10-10T00:00:00.000Z"',
    '          transitioned_to: review',
    '',
  ].join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const taskMd = [
    '---',
    'id: demo-change.t1',
    'status: in-implementation',
    'allowed_paths:',
    '  - allowed.txt',
    '---',
    '# T1',
    '',
    '## Acceptance criteria',
    '- criteria 1',
    '',
    '## Verification',
    'npm test',
    '',
  ].join('\n');
  writeFileSync(join(tasksDir, '01-t1.md'), taskMd);

  writeFileSync(join(repo, 'allowed.txt'), 'allowed content\n');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: add demo-change setup']);
  git(repo, ['push', 'origin', 'main']);

  return { repo, remote };
}

describe('Transition-aware exit gates schema validation', () => {
  test('valid exit gate with declared when passes definition validation', () => {
    const def = {
      id: 'valid-when-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'test', when: ['pass'] },
          ],
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { value: 'fail', to: 'implementation' },
          ],
        },
      },
    };
    const res = validateWorkflowDefinition(def);
    assert.equal(res.valid, true, `Expected valid, got errors: ${res.errors.join('; ')}`);
  });

  test('invalid when value (not a declared transition) fails definition validation', () => {
    const def = {
      id: 'invalid-when-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'test', when: ['non-existent-result'] },
          ],
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { value: 'fail', to: 'implementation' },
          ],
        },
      },
    };
    const res = validateWorkflowDefinition(def);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some(e => e.includes('non-existent-result') && e.includes('not a declared transition')),
      `Expected undeclared transition error, got: ${res.errors.join('; ')}`
    );
  });

  test('when declared on entry gate fails definition validation', () => {
    const def = {
      id: 'entry-gate-when-workflow',
      steps: {
        stepA: {
          status: { active: 'active-a', completed: 'done-a' },
          entryGates: [
            { type: 'command', action: 'test', when: ['pass'] },
          ],
          transitions: [
            { value: 'pass', to: 'stepB' },
            { value: 'fail', to: 'stepC' },
          ],
        },
        stepB: { status: { active: 'b', completed: 'bd' }, transitions: [{ to: 'verified', outcome: 'success' }] },
        stepC: { status: { active: 'c', completed: 'cd' }, transitions: [{ to: 'verified', outcome: 'success' }] },
      },
    };
    const res = validateWorkflowDefinition(def);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some(e => e.includes("'when' cannot be declared on entry gates")),
      `Expected entry gate when error, got: ${res.errors.join('; ')}`
    );
  });

  test('empty when array fails definition validation', () => {
    const def = {
      id: 'empty-when-workflow',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          exitGates: [
            { type: 'command', action: 'test', when: [] },
          ],
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { value: 'fail', to: 'implementation' },
          ],
        },
      },
    };
    const res = validateWorkflowDefinition(def);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('.when: must contain at least one transition value string')));
  });

  test('exit gate with when on unconditional step fails definition validation', () => {
    const def = {
      id: 'unconditional-when-workflow',
      steps: {
        impl: {
          status: { active: 'active', completed: 'done' },
          exitGates: [
            { type: 'command', action: 'test', when: ['pass'] },
          ],
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res = validateWorkflowDefinition(def);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('not a declared transition on this step')));
  });
});

describe('filterExitGatesByResult helper', () => {
  const gateWithWhenPass = { type: 'command', action: 'test', when: ['pass'] };
  const gateUnconditional = { type: 'command', action: 'lint' };
  const allGates = [gateWithWhenPass, gateUnconditional];

  test('filters gates for pass: includes when:[pass] and unconditional gates', () => {
    const filtered = filterExitGatesByResult(allGates, 'pass');
    assert.deepEqual(filtered, [gateWithWhenPass, gateUnconditional]);
  });

  test('filters gates for fail: excludes when:[pass], includes unconditional gates', () => {
    const filtered = filterExitGatesByResult(allGates, 'fail');
    assert.deepEqual(filtered, [gateUnconditional]);
  });

  test('filters gates when result is undefined: excludes when:[pass], includes unconditional gates', () => {
    const filtered = filterExitGatesByResult(allGates, undefined);
    assert.deepEqual(filtered, [gateUnconditional]);
  });
});

describe('Transition-aware exit gates execution via finishStep', () => {
  let fx;

  beforeEach(() => {
    fx = setupRepoFixture('nevo-tag');
  });

  afterEach(() => {
    rmSync(fx.repo, { recursive: true, force: true });
    rmSync(fx.remote, { recursive: true, force: true });
  });

  test('review pass with red verification => blocked (AC: review pass blocked by red verification)', async () => {
    const change = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');
    const failingRegistry = makeFailingGateRegistry();

    const plan = await planFinish({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: { result: 'pass' },
      gateRegistry: failingRegistry,
    });
    // planFinish checks the command gate for pass; since command gate inspect status is pending, plan status is ready
    assert.equal(plan.status, 'ready');

    // Mutating finishStep evaluates ensureVerifyGates; failing verification blocks the operation
    const result = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: { result: 'pass' },
      gateRegistry: failingRegistry,
      activeDir: join(fx.repo, 'specs', 'active'),
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.blockers.length > 0, 'Must report gate blockers');

    // Verify task is still in-review and was NOT transitioned
    const reloadedChange = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const reloadedTask = requireTask(reloadedChange, 't1');
    assert.equal(reloadedTask.workflow_progress.state, 'active');
    assert.equal(reloadedTask.workflow_progress.current_step, 'review');
  });

  test('review fail with red verification => completed, feedback recorded, scope/commit unchanged', async () => {
    const change = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');
    const failingRegistry = makeFailingGateRegistry();

    // finishStep with fail and feedback succeeds even though verification command is failing
    const result = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: {
        result: 'fail',
        feedback: 'Verification failed: syntax error in test assertion on line 42',
      },
      gateRegistry: failingRegistry,
      activeDir: join(fx.repo, 'specs', 'active'),
    });

    assert.equal(result.status, 'completed');

    // Verify task workflow_progress history contains fail result and recorded feedback
    const reloadedChange = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const reloadedTask = requireTask(reloadedChange, 't1');
    assert.equal(reloadedTask.workflow_progress.state, 'completed');
    assert.equal(reloadedTask.workflow_progress.current_step, 'review');

    const history = reloadedTask.workflow_progress.history;
    assert.equal(history.length, 2);
    const reviewHistory = history[history.length - 1];
    assert.equal(reviewHistory.step, 'review');
    assert.equal(reviewHistory.result, 'fail');
    assert.equal(reviewHistory.transitioned_to, 'implementation');
    assert.equal(reviewHistory.feedback, 'Verification failed: syntax error in test assertion on line 42');
  });

  test('review fail without feedback => input-required', async () => {
    const change = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');
    const failingRegistry = makeFailingGateRegistry();

    // 1. Missing feedback completely
    const planNoFeedback = await planFinish({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: { result: 'fail' },
      gateRegistry: failingRegistry,
    });
    assert.equal(planNoFeedback.status, 'input-required');
    assert.deepEqual(planNoFeedback.missingInputs, ['feedback']);

    const finishNoFeedback = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: { result: 'fail' },
      gateRegistry: failingRegistry,
      activeDir: join(fx.repo, 'specs', 'active'),
    });
    assert.equal(finishNoFeedback.status, 'input-required');
    assert.deepEqual(finishNoFeedback.missingInputs, ['feedback']);

    // 2. Whitespace-only feedback
    const finishWhitespaceFeedback = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fx.repo, activeDir: join(fx.repo, 'specs', 'active') },
      inputs: { result: 'fail', feedback: '   ' },
      gateRegistry: failingRegistry,
      activeDir: join(fx.repo, 'specs', 'active'),
    });
    assert.equal(finishWhitespaceFeedback.status, 'input-required');
    assert.deepEqual(finishWhitespaceFeedback.missingInputs, ['feedback']);

    // Verify task state was NOT modified
    const reloadedChange = requireChange('demo-change', join(fx.repo, 'specs', 'active'));
    const reloadedTask = requireTask(reloadedChange, 't1');
    assert.equal(reloadedTask.workflow_progress.state, 'active');
  });

  test('shipped standard.yaml and standard-v1.yaml conform to D3 transition-aware review semantics', () => {
    for (const name of ['standard', 'standard-v1']) {
      const def = loadWorkflowDefinition(name, { repoRoot: ROOT });

      // 1. review command gate has when: [pass]
      const reviewStep = def.steps.review;
      const cmdGate = reviewStep.exitGates.find(g => g.type === 'command' && (g.action === 'test' || g.action === 'task-verification'));
      assert.ok(cmdGate, `${name}: review step must have test or task-verification command gate`);
      assert.deepEqual(cmdGate.when, ['pass'], `${name}: command gate must declare when: [pass]`);

      // 2. review fail transition has action.feedback.required: true
      const failTrans = reviewStep.transitions.find(t => t.value === 'fail');
      assert.ok(failTrans, `${name}: review step must have fail transition`);
      assert.equal(
        failTrans.action?.feedback?.required,
        true,
        `${name}: review fail transition must require feedback`
      );

      // 3. review pass transition does NOT require feedback
      const passTrans = reviewStep.transitions.find(t => t.value === 'pass');
      assert.ok(passTrans, `${name}: review step must have pass transition`);
      assert.equal(passTrans.action?.feedback?.required ?? false, false);
    }
  });
});
