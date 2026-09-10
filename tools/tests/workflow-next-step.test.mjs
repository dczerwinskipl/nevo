// Tests for step lifecycle orchestration (Task 06, step-orchestration-and-next-step-service):
// `StepContext` compilation (`step-context.mjs`) and non-mutating finish planning
// (`finish-operation.mjs`'s `planFinish`, the `--check` code path). Covers AC1, AC2, AC3,
// AC4, AC15. Durable/resumable finish *execution* is covered separately in
// tools/tests/workflow-finish-operation.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  aggregateFinalizeCheck,
  loadWorkflowDefinition,
  WorkflowError,
  WorkflowDefinitionError,
} from '../specs/workflow/index.mjs';
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

describe('Multi-step current-step resolution and terminal precedence (task 08 AC2, AC5)', () => {
  const MULTI_STEP_RAW = {
    id: 'multi-v1',
    steps: {
      stepA: { actions: [{ id: 'a' }], transitions: [{ to: 'stepB' }] },
      stepB: { actions: [{ id: 'a' }], transitions: [{ to: 'verified' }] },
    },
  };
  const MULTI_STEP_DEFINITION = normalizeWorkflowDefinition(MULTI_STEP_RAW);

  test('a task with no workflow_progress at all resolves the definition\'s entry step, not just "the first step" by accident', () => {
    assert.equal(resolveCurrentStepName(MULTI_STEP_DEFINITION, { status: 'in-implementation' }), 'stepA');
  });

  test('a task with workflow_progress.current_step resolves exactly that step, never re-deriving entryStep', () => {
    const task = { status: 'in-implementation', workflow_progress: { current_step: 'stepB', history: [] } };
    assert.equal(resolveCurrentStepName(MULTI_STEP_DEFINITION, task), 'stepB');
  });

  test('terminal precedence: task.status already terminal resolves complete even against a stale current_step (AC5)', () => {
    const task = {
      status: 'verified',
      workflow_progress: { current_step: 'stepB', history: [{ step: 'stepB', completed_at: 'x', transitioned_to: 'verified' }] },
    };
    assert.equal(resolveCurrentStepName(MULTI_STEP_DEFINITION, task), null, 'must never re-resolve entryStep once status is terminal');
  });

  test('a task whose status is already terminal with no workflow_progress at all also resolves complete (today\'s single-step case, AC5)', () => {
    assert.equal(resolveCurrentStepName(MULTI_STEP_DEFINITION, { status: 'verified' }), null);
  });

  test('workflow_progress.current_step naming an undeclared step throws, never silently resolved to something else', () => {
    const task = { status: 'in-implementation', workflow_progress: { current_step: 'no-such-step' } };
    assert.throws(() => resolveCurrentStepName(MULTI_STEP_DEFINITION, task), /does not name a step declared/);
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
        'id: custom-v1', 'steps:', '  implementation:', '    finalize:',
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
        'id: custom-v1', 'steps:', '  implementation:', '    finalize:',
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
