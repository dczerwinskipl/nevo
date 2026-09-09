// Tests for step lifecycle orchestration (Task 06, step-orchestration-and-next-step-service):
// `StepContext` compilation (`step-context.mjs`) and non-mutating finish planning
// (`finish-operation.mjs`'s `planFinish`, the `--check` code path). Covers AC1, AC2, AC3,
// AC4, AC15. Durable/resumable finish *execution* is covered separately in
// tools/tests/workflow-finish-operation.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDefaultGateRegistry,
  MemoryCommandVerificationStore,
  MemoryHumanVerificationReader,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  compileStepContext,
  planFinish,
  resolveCurrentStepName,
  inspectGates,
  verifyGates,
} from '../specs/workflow/index.mjs';

const RAW_DEFINITION = {
  id: 'standard-v1',
  title: 'Standard',
  type: 'standard',
  version: 1,
  steps: {
    implementation: {
      entryGates: [],
      actions: [{ id: 'implement-task' }],
      exitGates: [
        { type: 'command', action: 'test' },
        { type: 'human', required: true },
      ],
      // Mirrors .nevo-ai/workflows/standard.yaml: `verify-task-output` has no registered
      // ActionContract implementation in this foundation and must be tolerated, not
      // hard-fail the aggregation (see step-context.mjs's `registeredFinalizeActions`).
      finalize: [{ id: 'verify-task-output' }, { id: 'commit-and-push' }],
      transitions: [{ to: 'verified' }],
    },
  },
};

function buildDefinition(overrides = {}) {
  const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, ...overrides } } };
  const { valid, errors } = validateWorkflowDefinition(raw);
  assert.ok(valid, `fixture definition must be schema-valid: ${errors.join('; ')}`);
  return normalizeWorkflowDefinition(raw);
}

function makeGateRegistry({ testPassed = true, humanConfirmed = true, taskId = 'demo-task' } = {}) {
  const cmdStore = new MemoryCommandVerificationStore();
  cmdStore.recordCommandResult({ command: 'npm test', action: 'test', passed: testPassed });
  const humanReader = new MemoryHumanVerificationReader(
    humanConfirmed ? [{ scope: 'task', targetId: taskId, role: 'owner', confirmed: true, confirmedBy: 'owner' }] : []
  );
  return createDefaultGateRegistry({
    commandRunner: async () => ({ passed: testPassed, exitCode: testPassed ? 0 : 1 }),
    commandVerificationStore: cmdStore,
    humanVerificationReader: humanReader,
  });
}

function makeRepoPair(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'root.txt'), 'root\n');
  git(['add', 'root.txt']);
  git(['commit', '-m', 'initial']);
  git(['push', '-u', 'origin', 'main']);

  return { repo, remote, git };
}

function cleanupRepoPair({ repo, remote }) {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
}

const change = { id: 'demo-change', _slug: 'demo-change' };
const task = { id: 'demo-task', status: 'in-implementation' };

describe('resolveCurrentStepName (AC15)', () => {
  test('resolves the single declared step when the task has not yet reached its transition target', () => {
    const definition = buildDefinition();
    assert.equal(resolveCurrentStepName(definition, { status: 'in-implementation' }), 'implementation');
  });

  test('resolves null once the task has already reached the transition target', () => {
    const definition = buildDefinition();
    assert.equal(resolveCurrentStepName(definition, { status: 'verified' }), null);
  });

  test('resolves the step for a definition with a different transition target name', () => {
    const definition = buildDefinition({ transitions: [{ to: 'archived' }] });
    assert.equal(resolveCurrentStepName(definition, { status: 'in-implementation' }), 'implementation');
    assert.equal(resolveCurrentStepName(definition, { status: 'archived' }), null);
  });

  test('inspectGates never invokes verify() (read-only calls must not run verification commands, C7/C8)', async () => {
    const registry = createDefaultGateRegistry({
      commandRunner: async () => { throw new Error('verify() must never be called by inspectGates'); },
      commandVerificationStore: new MemoryCommandVerificationStore(),
      humanVerificationReader: new MemoryHumanVerificationReader(),
    });
    const results = await inspectGates([{ type: 'command', action: 'test' }], {}, { gateRegistry: registry });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'pending');
  });
});

describe('compileStepContext — StepContext at `workflow step start` (AC1)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-step-context');
  });

  after(() => cleanupRepoPair(ctx));

  test('aggregates current step, entry state, finish contract, and next-step guidance', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };

    const stepContext = await compileStepContext({ change, task, definition, context, gateRegistry });

    assert.equal(stepContext.change, 'demo-change');
    assert.equal(stepContext.task, 'demo-task');
    assert.equal(stepContext.workflowMode, 'deterministic');
    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.stepStatus, 'in-progress');
    assert.deepEqual(stepContext.entryState.blockers, []);
    assert.deepEqual(stepContext.nextStepGuidance, { onSuccess: 'verified' });

    const requiredInputs = stepContext.finishContract.requiredInputs;
    assert.equal(requiredInputs['commit.title'].required, true);
    assert.equal(requiredInputs['commit.message'].required, false);
    assert.equal(requiredInputs['include'].required, true);
    assert.equal(requiredInputs['exclude'].required, false);

    // finishContract.gates is enriched with inspected status, not a bare descriptor —
    // both the command and human exit gate report 'passed' given the seeded gate registry.
    const gateStatuses = Object.fromEntries(stepContext.finishContract.gates.map(g => [g.gateType, g.status]));
    assert.equal(gateStatuses.command, 'passed');
    assert.equal(gateStatuses.human, 'passed');

    assert.ok(stepContext.context.sourceControl, 'factual source-control context must be present when enabled');
    assert.equal(stepContext.context.sourceControl.currentBranch, 'main');
  });

  test('is non-mutating against the Git worktree', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };
    const statusBefore = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });

    await compileStepContext({ change, task, definition, context, gateRegistry });

    const statusAfter = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(statusBefore, statusAfter);
  });

  test('reports entry-gate blockers when an entry gate is unmet', async () => {
    const definition = buildDefinition({
      entryGates: [{ type: 'human', required: true, id: 'entry-review' }],
      exitGates: [{ type: 'command', action: 'test' }, { type: 'human', required: true, id: 'exit-review' }],
    });
    const gateRegistry = makeGateRegistry({ humanConfirmed: false });
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: false } };

    const stepContext = await compileStepContext({ change, task, definition, context, gateRegistry });

    assert.equal(stepContext.stepStatus, 'blocked');
    assert.equal(stepContext.entryState.blockers.length, 1);
    assert.equal(stepContext.entryState.blockers[0].status, 'blocked');
  });

  test('returns a terminal StepContext once the task has already completed the step', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: false } };

    const stepContext = await compileStepContext({ change, task: { id: 'demo-task', status: 'verified' }, definition, context, gateRegistry });

    assert.equal(stepContext.currentStep, null);
    assert.equal(stepContext.stepStatus, 'complete');
  });
});

describe('planFinish — non-mutating finish planning and input-required (AC2, AC3)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-plan-finish');
  });

  after(() => cleanupRepoPair(ctx));

  test('reports input-required with the missing-inputs set when no inputs are supplied', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };

    const plan = await planFinish({ change, task, definition, context, gateRegistry });

    assert.equal(plan.status, 'input-required');
    assert.ok(plan.missingInputs.includes('commit.title'));
    assert.ok(plan.missingInputs.includes('include'));
    assert.ok(!plan.missingInputs.includes('commit.message'));
    assert.deepEqual(plan.plannedOperations, ['verify-gates', 'update-task', 'commit', 'push', 'transition']);
    assert.deepEqual(plan.blockers, []);
  });

  test('reports changed files, staged state, branch/HEAD, and existing commits', async () => {
    writeFileSync(join(ctx.repo, 'dirty.txt'), 'dirty\n');
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };

    const plan = await planFinish({ change, task, definition, context, gateRegistry });

    assert.ok(plan.sourceControl.changedFiles.includes('dirty.txt'));
    assert.equal(plan.sourceControl.currentBranch, 'main');
    assert.equal(typeof plan.sourceControl.head, 'string');
    assert.ok(Array.isArray(plan.sourceControl.existingCommits));
  });

  test('reports push status (unpushedCommits) when push is enabled', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: true, remote: { enabled: false } } };

    const plan = await planFinish({ change, task, definition, context, gateRegistry });

    assert.ok(Array.isArray(plan.sourceControl.unpushedCommits));
  });

  test('is non-mutating: never stages, commits, or pushes regardless of supplied inputs', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };
    const statusBefore = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const headBefore = execFileSync('git', ['-C', ctx.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    await planFinish({
      change, task, definition, context, gateRegistry,
      inputs: { 'commit.title': 'Would-be commit', include: ['*'] },
    });

    const statusAfter = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const headAfter = execFileSync('git', ['-C', ctx.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(statusBefore, statusAfter);
    assert.equal(headBefore, headAfter);
  });

  test('reports ready (zero missing inputs) once every required input is supplied', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry();
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };

    const plan = await planFinish({
      change, task, definition, context, gateRegistry,
      inputs: { 'commit.title': 'Ready commit', include: ['*'] },
    });

    assert.equal(plan.status, 'ready');
    assert.deepEqual(plan.missingInputs, []);
  });
});

describe('Blocking human-verification state is reported, never self-satisfied (AC4)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-human-block');
  });

  after(() => cleanupRepoPair(ctx));

  test('StepContext.finishContract.gates reports the unmet human gate as blocked', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry({ humanConfirmed: false });
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };

    const stepContext = await compileStepContext({ change, task, definition, context, gateRegistry });

    const humanGate = stepContext.finishContract.gates.find(g => g.gateType === 'human');
    assert.equal(humanGate.status, 'blocked');
  });

  test('a step finish attempt reports the same blocking state and performs zero mutation', async () => {
    const definition = buildDefinition();
    const gateRegistry = makeGateRegistry({ humanConfirmed: false });
    const context = { repoRoot: ctx.repo, taskId: task.id, sourceControl: { enabled: true, push: false } };
    const statusBefore = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });

    const plan = await planFinish({
      change, task, definition, context, gateRegistry,
      inputs: { 'commit.title': 'Blocked commit', include: ['*'] },
    });

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.blockers.length, 1);
    assert.equal(plan.blockers[0].gateType, 'human');

    const statusAfter = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(statusBefore, statusAfter);
  });
});
