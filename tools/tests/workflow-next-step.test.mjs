// Tests for step lifecycle orchestration (Task 06, step-orchestration-and-next-step-service):
// `StepContext` compilation (`step-context.mjs`) and non-mutating finish planning
// (`finish-operation.mjs`'s `planFinish`, the `--check` code path). Covers AC1, AC2, AC3,
// AC4, AC15. Durable/resumable finish *execution* is covered separately in
// tools/tests/workflow-finish-operation.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDefaultGateRegistry,
  MemoryCommandVerificationStore,
  MemoryHumanVerificationReader,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  compileStepContext,
  ensureStepActivated,
  planFinish,
  resolveWorkflowPosition,
  resolveSemanticStatus,
  resolveActiveStepName,
  inspectGates,
  verifyGates,
  aggregateFinalizeCheck,
  loadWorkflowDefinition,
  WorkflowError,
  WorkflowDefinitionError,
} from '../specs/workflow/index.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
// Registers CommitAndPushAction into defaultActionRegistry — required for
// loadWorkflowDefinition's knownActions default (D20/D34) to include the one real
// registered action, exactly as the real CLI's own cli.mjs import already guarantees.
import '../specs/workflow/actions/index.mjs';

const RAW_DEFINITION = {
  id: 'standard-v1',
  title: 'Standard',
  type: 'standard',
  version: 1,
  steps: {
    implementation: {
      status: { active: 'implementing', completed: 'implemented' },
      entryGates: [],
      actions: [{ id: 'implement-task' }],
      exitGates: [
        { type: 'command', action: 'test' },
        { type: 'human', required: true },
      ],
      // verify-task-output was removed from the shipped standard.yaml (Task 09, D20) —
      // fixtures no longer reference it either, since aggregateFinalizeCheck now fails
      // closed on any unregistered finalize action.
      finalize: [{ id: 'commit-and-push' }],
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

/**
 * A real, on-disk `change.yaml` (D37 activation tests, unlike the plain in-memory
 * `change`/`task` fixtures below, need a writable `change._file` — `ensureStepActivated`
 * calls `setTaskWorkflowState`, which performs a real structural YAML write).
 */
function makeChangeFixture() {
  const activeDir = mkdtempSync(join(tmpdir(), 'nevo-activation-'));
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: demo-change',
    'title: "Demo"',
    'type: standard',
    'status: draft',
    'workflow:',
    '  mode: deterministic',
    '  version: 1',
    'tasks:',
    '  - id: demo-task',
    '    order: 1',
    '    status: in-implementation',
    '',
  ].join('\n'));
  return activeDir;
}

function cleanupChangeFixture(activeDir) {
  rmSync(activeDir, { recursive: true, force: true });
}

// Plain in-memory fixtures for every test that never triggers a real mutation (i.e.
// never resolves to `resolveWorkflowPosition`'s `new`/`completed` phases) — `task`
// already carries `state: 'active'` so `ensureStepActivated`/`compileStepContext` never
// call `setTaskWorkflowState`, and `change` never needs a real `_file`.
const change = { id: 'demo-change', _slug: 'demo-change' };
const task = {
  id: 'demo-task',
  status: 'in-implementation',
  workflow_progress: { current_step: 'implementation', state: 'active', history: [] },
};

describe('resolveWorkflowPosition / resolveActiveStepName / resolveSemanticStatus (D37, task 10 AC9)', () => {
  test('no workflow_progress at all resolves phase "new" — nothing active yet', () => {
    const definition = buildDefinition();
    assert.deepEqual(resolveWorkflowPosition(definition, { status: 'in-implementation' }), { phase: 'new' });
    assert.equal(resolveActiveStepName(definition, { status: 'in-implementation' }), null);
    assert.equal(resolveSemanticStatus(definition, { status: 'in-implementation' }), 'new');
  });

  test('state: active resolves the active step and its declared status.active', () => {
    const definition = buildDefinition();
    const activeTask = { workflow_progress: { current_step: 'implementation', state: 'active', history: [] } };
    assert.deepEqual(resolveWorkflowPosition(definition, activeTask), { phase: 'active', step: 'implementation' });
    assert.equal(resolveActiveStepName(definition, activeTask), 'implementation');
    assert.equal(resolveSemanticStatus(definition, activeTask), 'implementing');
  });

  test('state: completed with a terminal transition resolves phase "terminal" and status.completed — task.status is never consulted', () => {
    const definition = buildDefinition();
    const completedTask = {
      // Deliberately a non-terminal task.status — proves resolution never reads it (D37).
      status: 'in-implementation',
      workflow_progress: { current_step: 'implementation', state: 'completed', history: [] },
    };
    assert.deepEqual(resolveWorkflowPosition(definition, completedTask), { phase: 'terminal', step: 'implementation' });
    assert.equal(resolveActiveStepName(definition, completedTask), null);
    assert.equal(resolveSemanticStatus(definition, completedTask), 'implemented');
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

describe('Multi-step position resolution (D37, task 10 AC2/AC4/AC9)', () => {
  const MULTI_STEP_RAW = {
    id: 'multi-v1',
    steps: {
      stepA: {
        status: { active: 'a-active', completed: 'a-completed' },
        actions: [{ id: 'a' }],
        transitions: [{ to: 'stepB' }],
      },
      stepB: {
        status: { active: 'b-active', completed: 'b-completed' },
        actions: [{ id: 'a' }],
        transitions: [{ to: 'verified' }],
      },
    },
  };
  const MULTI_STEP_DEFINITION = normalizeWorkflowDefinition(MULTI_STEP_RAW);

  test('a task with no workflow_progress at all resolves phase "new" — entry-step activation is `step start`\'s job, not resolution\'s (D37)', () => {
    assert.deepEqual(resolveWorkflowPosition(MULTI_STEP_DEFINITION, {}), { phase: 'new' });
  });

  test('state: active resolves exactly that step, never re-deriving entryStep', () => {
    const task = { workflow_progress: { current_step: 'stepB', state: 'active', history: [] } };
    assert.deepEqual(resolveWorkflowPosition(MULTI_STEP_DEFINITION, task), { phase: 'active', step: 'stepB' });
  });

  test('resolveSemanticStatus is step-specific, not a constant (AC9): stepA and stepB resolve to their own distinct declared status pairs', () => {
    const onStepA = { workflow_progress: { current_step: 'stepA', state: 'active', history: [] } };
    const onStepB = { workflow_progress: { current_step: 'stepB', state: 'active', history: [] } };
    assert.equal(resolveSemanticStatus(MULTI_STEP_DEFINITION, onStepA), 'a-active');
    assert.equal(resolveSemanticStatus(MULTI_STEP_DEFINITION, onStepB), 'b-active');

    const stepACompleted = { workflow_progress: { current_step: 'stepA', state: 'completed', history: [{ step: 'stepA', completed_at: 'x', transitioned_to: 'stepB' }] } };
    const stepBCompleted = { workflow_progress: { current_step: 'stepB', state: 'completed', history: [{ step: 'stepB', completed_at: 'x', transitioned_to: 'verified' }] } };
    assert.equal(resolveSemanticStatus(MULTI_STEP_DEFINITION, stepACompleted), 'a-completed');
    assert.equal(resolveSemanticStatus(MULTI_STEP_DEFINITION, stepBCompleted), 'b-completed');
  });

  test('state: completed with a transition naming another step resolves phase "completed" — awaiting the next `step start` (D37 case C)', () => {
    const task = { workflow_progress: { current_step: 'stepA', state: 'completed', history: [{ step: 'stepA', completed_at: 'x', transitioned_to: 'stepB' }] } };
    assert.deepEqual(resolveWorkflowPosition(MULTI_STEP_DEFINITION, task), { phase: 'completed', step: 'stepA', nextStep: 'stepB' });
    assert.equal(resolveActiveStepName(MULTI_STEP_DEFINITION, task), null, 'nothing is active until the next step start');
  });

  test('terminal precedence: state completed + terminal transition resolves complete even with a non-terminal task.status (AC9, corrects D28)', () => {
    const task = {
      status: 'in-implementation',
      workflow_progress: { current_step: 'stepB', state: 'completed', history: [{ step: 'stepB', completed_at: 'x', transitioned_to: 'verified' }] },
    };
    assert.deepEqual(resolveWorkflowPosition(MULTI_STEP_DEFINITION, task), { phase: 'terminal', step: 'stepB' });
  });

  test('workflow_progress.current_step naming an undeclared step throws, never silently resolved to something else', () => {
    const task = { workflow_progress: { current_step: 'no-such-step', state: 'active' } };
    assert.throws(() => resolveWorkflowPosition(MULTI_STEP_DEFINITION, task), /does not name a step declared/);
  });
});

describe('`workflow step start` activation (D37, task 10 AC1/AC2/AC4)', () => {
  let activeDir;

  before(() => { activeDir = makeChangeFixture(); });
  after(() => cleanupChangeFixture(activeDir));

  const MULTI_STEP_DEFINITION = normalizeWorkflowDefinition({
    id: 'multi-v1',
    entryStep: 'stepA',
    steps: {
      stepA: { status: { active: 'a-active', completed: 'a-completed' }, transitions: [{ to: 'stepB' }] },
      stepB: { status: { active: 'b-active', completed: 'b-completed' }, transitions: [{ to: 'verified' }] },
    },
  });

  test('fresh (case A): activates entryStep, persisting current_step/state atomically (AC1)', () => {
    const change = requireChange('demo-change', activeDir);
    const task = requireTask(change, 'demo-task');

    const { task: effectiveTask, position } = ensureStepActivated(change, task, MULTI_STEP_DEFINITION);

    assert.deepEqual(position, { phase: 'active', step: 'stepA' });
    assert.deepEqual(effectiveTask.workflow_progress, { current_step: 'stepA', state: 'active', history: [] });

    const persisted = requireTask(requireChange('demo-change', activeDir), 'demo-task');
    assert.deepEqual(persisted.workflow_progress, { current_step: 'stepA', state: 'active', history: [] });
  });

  test('resume (case B): an already-active step returns the same position, writing nothing (AC2, no duplicate mutation)', () => {
    const change = requireChange('demo-change', activeDir);
    const task = requireTask(change, 'demo-task'); // already stepA/active from the previous test
    const before = readFileSync(join(activeDir, 'demo-change', 'change.yaml'), 'utf8');

    const { position } = ensureStepActivated(change, task, MULTI_STEP_DEFINITION);

    assert.deepEqual(position, { phase: 'active', step: 'stepA' });
    const after = readFileSync(join(activeDir, 'demo-change', 'change.yaml'), 'utf8');
    assert.equal(before, after, 'resuming an already-active step must not touch change.yaml at all');
  });

  test('completed internal (case C): activates the named target step, appending no history entry (AC4)', () => {
    const change = requireChange('demo-change', activeDir);
    // Simulate `finish` having just completed stepA (D37: current_step stays stepA).
    const completedTask = {
      ...requireTask(change, 'demo-task'),
      workflow_progress: { current_step: 'stepA', state: 'completed', history: [{ step: 'stepA', completed_at: 'x', transitioned_to: 'stepB' }] },
    };

    const { task: effectiveTask, position } = ensureStepActivated(change, completedTask, MULTI_STEP_DEFINITION);

    assert.deepEqual(position, { phase: 'active', step: 'stepB' });
    assert.deepEqual(effectiveTask.workflow_progress, {
      current_step: 'stepB',
      state: 'active',
      history: [{ step: 'stepA', completed_at: 'x', transitioned_to: 'stepB' }],
    });
  });

  test('terminal (case D): no activation possible, no mutation', () => {
    const change = requireChange('demo-change', activeDir);
    const terminalTask = {
      ...requireTask(change, 'demo-task'),
      workflow_progress: { current_step: 'stepB', state: 'completed', history: [{ step: 'stepB', completed_at: 'x', transitioned_to: 'verified' }] },
    };
    const before = readFileSync(join(activeDir, 'demo-change', 'change.yaml'), 'utf8');

    const { position } = ensureStepActivated(change, terminalTask, MULTI_STEP_DEFINITION);

    assert.deepEqual(position, { phase: 'terminal', step: 'stepB' });
    const after = readFileSync(join(activeDir, 'demo-change', 'change.yaml'), 'utf8');
    assert.equal(before, after, 'a terminal workflow must never be mutated by step start');
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
    assert.equal(stepContext.runtimeState, 'active');
    assert.equal(stepContext.semanticStatus, 'implementing');
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
    const terminalTask = {
      id: 'demo-task',
      status: 'verified',
      workflow_progress: { current_step: 'implementation', state: 'completed', history: [{ step: 'implementation', completed_at: 'x', transitioned_to: 'verified' }] },
    };

    const stepContext = await compileStepContext({ change, task: terminalTask, definition, context, gateRegistry });

    assert.equal(stepContext.currentStep, null);
    assert.equal(stepContext.stepStatus, 'complete');
    assert.equal(stepContext.runtimeState, 'completed');
    assert.equal(stepContext.semanticStatus, 'implemented');
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

describe('Declarative per-step behavior contract — schema validation only (D25, AC11)', () => {
  test('a step declaring purpose/expectedWork/hints loads and validates successfully', () => {
    const definition = buildDefinition({
      purpose: 'Implement the approved task scope.',
      expectedWork: { summary: 'Write the code, then run the verification commands.' },
      hints: [{ type: 'doc', ref: 'docs/example.md' }, { type: 'skill', ref: 'nevo-ai-spec-workflow' }],
    });
    assert.equal(definition.steps.implementation.purpose, 'Implement the approved task scope.');
    assert.deepEqual(definition.steps.implementation.expectedWork, { summary: 'Write the code, then run the verification commands.' });
    assert.equal(definition.steps.implementation.hints.length, 2);
  });

  test('purpose must be a non-empty string when declared', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, purpose: '   ' } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.purpose: must be a non-empty string/.test(e)));
  });

  test('expectedWork must be an object', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, expectedWork: 'not an object' } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.expectedWork: must be an object/.test(e)));
  });

  test('expectedWork: {} fails validation — summary is required whenever expectedWork is declared at all', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, expectedWork: {} } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.expectedWork\.summary: must be a non-empty string/.test(e)));
  });

  test('expectedWork.summary must be a non-empty string, not just present', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, expectedWork: { summary: '   ' } } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.expectedWork\.summary: must be a non-empty string/.test(e)));
  });

  test('hints entries with an invalid type fail validation', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, hints: [{ type: 'video', ref: 'x' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.hints\[0\]\.type: must be one of/.test(e)));
  });

  test('hints entries missing ref fail validation', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, hints: [{ type: 'doc' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.hints\[0\]\.ref: must be a non-empty string/.test(e)));
  });

  test('hints must be an array', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, hints: 'not-an-array' } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.hints: must be an array/.test(e)));
  });
});

describe('Per-step semantic-status schema — required, safe identifiers (D37, task 10 AC10)', () => {
  test('a step missing status fails validation', () => {
    const { status, ...withoutStatus } = RAW_DEFINITION.steps.implementation;
    const raw = { ...RAW_DEFINITION, steps: { implementation: withoutStatus } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.status: must be an object with 'active' and 'completed' identifiers/.test(e)));
  });

  test('status.active/status.completed must be non-empty safe identifiers', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, status: { active: '', completed: 'implemented' } } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.status\.active: must be a non-empty identifier/.test(e)));
  });

  test('status.active/status.completed reject a value containing a path separator', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, status: { active: 'implementing', completed: 'im/plemented' } } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /\.status\.completed: must be a non-empty identifier/.test(e)));
  });

  test('a valid, distinct status pair validates successfully and survives normalization', () => {
    const definition = buildDefinition();
    assert.deepEqual(definition.steps.implementation.status, { active: 'implementing', completed: 'implemented' });
  });
});

describe('Shipped-workflow migration — status truthfully describes each definition\'s real step (D37, task 10 AC13)', () => {
  const repoRoot = join(import.meta.dirname, '..', '..');

  test('standard/architectural/small declare status on their implementation step', () => {
    for (const name of ['standard', 'architectural', 'small']) {
      const definition = loadWorkflowDefinition(name, { repoRoot });
      assert.deepEqual(definition.steps.implementation.status, { active: 'implementing', completed: 'implemented' }, `${name}.yaml`);
    }
  });

  test('exploratory declares status on its discovery step, not implementation (it has no such step)', () => {
    const definition = loadWorkflowDefinition('exploratory', { repoRoot });
    assert.equal(definition.steps.implementation, undefined);
    assert.deepEqual(definition.steps.discovery.status, { active: 'discovering', completed: 'discovered' });
  });
});

describe('Fail-closed action/gate resolution (D20, task 09 AC1/AC2)', () => {
  test('aggregateFinalizeCheck no longer filters unregistered finalize actions — the full list is aggregated, failing closed via ActionRegistry.require (AC1)', async () => {
    const step = { finalize: [{ id: 'commit-and-push' }, { id: 'not-a-real-action' }] };
    await assert.rejects(
      () => aggregateFinalizeCheck(step, {}),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.match(err.message, /Unknown action 'not-a-real-action'/);
        return true;
      }
    );
  });

  test('aggregateFinalizeCheck aggregates every registered finalize action when none are unregistered', async () => {
    const step = { finalize: [{ id: 'commit-and-push' }] };
    const result = await aggregateFinalizeCheck(step, { sourceControl: { enabled: false } });
    assert.ok('commit-and-push' in result.actions);
  });

  test('loadWorkflowDefinition rejects a real, on-disk definition referencing an unregistered action id at load time, naming it explicitly (AC2)', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'nevo-fail-closed-loader-'));
    try {
      const workflowsDir = join(repoRoot, '.nevo-ai', 'workflows');
      mkdirSync(workflowsDir, { recursive: true });
      writeFileSync(join(workflowsDir, 'custom.yaml'), [
        'id: custom-v1', 'steps:', '  implementation:',
        '    status:', '      active: implementing', '      completed: implemented',
        '    finalize:',
        '      - id: not-a-real-action', '    transitions:', '      - to: verified', '',
      ].join('\n'));

      assert.throws(
        () => loadWorkflowDefinition('custom', { repoRoot }),
        (err) => {
          assert.ok(err instanceof WorkflowDefinitionError);
          assert.match(err.message, /unknown action 'not-a-real-action'/);
          return true;
        }
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('loadWorkflowDefinition loads cleanly when every referenced action is actually registered', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'nevo-fail-closed-loader-ok-'));
    try {
      const workflowsDir = join(repoRoot, '.nevo-ai', 'workflows');
      mkdirSync(workflowsDir, { recursive: true });
      writeFileSync(join(workflowsDir, 'custom.yaml'), [
        'id: custom-v1', 'steps:', '  implementation:',
        '    status:', '      active: implementing', '      completed: implemented',
        '    finalize:',
        '      - id: commit-and-push', '    transitions:', '      - to: verified', '',
      ].join('\n'));

      const definition = loadWorkflowDefinition('custom', { repoRoot });
      assert.equal(definition.id, 'custom-v1');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('an unregistered gate type still fails exactly as before (regression check, AC5 — pre-existing schema validation, not newly added)', () => {
    const raw = { ...RAW_DEFINITION, steps: { implementation: { ...RAW_DEFINITION.steps.implementation, exitGates: [{ type: 'not-a-real-gate-type' }] } } };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /unknown gate type 'not-a-real-gate-type'/.test(e)));
  });
});
