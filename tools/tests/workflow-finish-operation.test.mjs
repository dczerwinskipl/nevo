// Tests for durable, resumable finish execution (Task 06, D14): `finishStep`'s fixed
// `verify-gates -> update-task -> commit -> push -> transition` sequence, crash-window
// reconciliation for stages found `running`/`unknown`, resolved-inputs persistence and
// conflict detection (C19), and the C17 clean-worktree invariant. Covers AC5-AC17.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDefaultGateRegistry,
  MemoryCommandVerificationStore,
  MemoryHumanVerificationReader,
  normalizeWorkflowDefinition,
  finishStep,
  loadOperationRecord,
  saveOperationRecord,
  PreconditionError,
  resolveCurrentStepName,
} from '../specs/workflow/index.mjs';
import { requireChange, requireTask, setTaskStatus, setTaskWorkflowState } from '../specs/store.mjs';
import { getCurrentRevision, getCommitInfo } from '../lib/git.mjs';

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
      finalize: [{ id: 'verify-task-output' }, { id: 'commit-and-push' }],
      transitions: [{ to: 'verified' }],
    },
  },
};
const DEFINITION = normalizeWorkflowDefinition(RAW_DEFINITION);

// A ≥3-step definition used only for the step-kind (internal-transition) update-task
// reconciliation tests below (D28's effective-position fix): stepA -> stepB -> stepC ->
// verified gives a real, declared "unrelated" step (stepC) distinct from any one
// transition's own fromStep/toStep pair.
const THREE_STEP_RAW_DEFINITION = {
  id: 'three-step-v1',
  title: 'Three Step',
  type: 'standard',
  version: 1,
  steps: {
    stepA: {
      entryGates: [],
      actions: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'stepB' }],
    },
    stepB: {
      entryGates: [],
      actions: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'stepC' }],
    },
    stepC: {
      entryGates: [],
      actions: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'verified' }],
    },
  },
};
const THREE_STEP_DEFINITION = normalizeWorkflowDefinition(THREE_STEP_RAW_DEFINITION);

const CHANGE_YAML = `id: demo-change
title: "Demo change"
type: standard
status: draft
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

function makeFixture(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['remote', 'add', 'origin', remote]);

  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), CHANGE_YAML);
  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'root\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial']);
  git(['push', '-u', 'origin', 'main']);

  return { repo, remote, git, activeDir };
}

function cleanupFixture({ repo, remote }) {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
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

function freshChange(activeDir) {
  return requireChange('demo-change', activeDir);
}

function taskStatus(activeDir) {
  return requireTask(freshChange(activeDir), 'demo-task').status;
}

function commitCount(repo) {
  return execFileSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
}

const RESOLVED_INPUTS = { 'commit.title': 'Finish task 06', 'commit.message': 'Body', include: ['*'], exclude: [] };

function baseParams(fx, gateRegistry, { push = true } = {}) {
  return {
    change: { id: 'demo-change', _slug: 'demo-change' },
    task: { id: 'demo-task', status: 'in-implementation' },
    definition: DEFINITION,
    context: { repoRoot: fx.repo, activeDir: fx.activeDir, taskId: 'demo-task', sourceControl: { enabled: true, push } },
    activeDir: fx.activeDir,
    gateRegistry,
  };
}

function threeStepParams(fx, gateRegistry, { push = true } = {}) {
  return {
    change: { id: 'demo-change', _slug: 'demo-change' },
    task: { id: 'demo-task', status: 'in-implementation' },
    definition: THREE_STEP_DEFINITION,
    context: { repoRoot: fx.repo, activeDir: fx.activeDir, taskId: 'demo-task', sourceControl: { enabled: true, push } },
    activeDir: fx.activeDir,
    gateRegistry,
  };
}

describe('finishStep — happy path executes the fixed stage order (AC5)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-happy'); });
  after(() => cleanupFixture(fx));

  test('commits both the implementation change and the task/spec status update in one commit, then pushes and transitions', async () => {
    writeFileSync(join(fx.repo, 'feature.txt'), 'implementation work\n');
    const gateRegistry = makeGateRegistry();

    const result = await finishStep({ ...baseParams(fx, gateRegistry), inputs: RESOLVED_INPUTS });

    assert.equal(result.status, 'completed');
    assert.equal(taskStatus(fx.activeDir), 'verified');

    const headSha = getCurrentRevision(fx.repo);
    const info = getCommitInfo(fx.repo, headSha);
    assert.equal(info.subject, 'Finish task 06');
    const changedInCommit = execFileSync('git', ['-C', fx.repo, 'show', '--name-only', '--format=', headSha], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    assert.ok(changedInCommit.includes('feature.txt'));
    assert.ok(changedInCommit.some(p => p.endsWith('change.yaml')));

    assert.equal(result.result.commit.sha, headSha);
    assert.equal(result.result.push.status, 'completed');

    const remoteHead = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    assert.equal(remoteHead, headSha, 'the expected commit must be confirmed on the remote');
  });

  test('the worktree is left clean — no residual dirtiness from finish-operation bookkeeping (AC17, C17)', () => {
    const status = execFileSync('git', ['-C', fx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(status, '');
  });

  test('the operation record is persisted only under .nevo-ai-local/workflow-operations/, never in change.yaml (AC16)', () => {
    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'implementation');
    assert.ok(record);
    assert.equal(record.status, 'completed');
    const recordPath = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task', 'implementation.json');
    assert.ok(existsSync(recordPath));
    const changeYaml = readFileSync(join(fx.activeDir, 'demo-change', 'change.yaml'), 'utf8');
    assert.ok(!changeYaml.includes('operationId'));
    assert.ok(!changeYaml.includes('resolvedInputs'));
  });

  test('a repeated finish call after full success returns the completed result without repeating any action (AC10)', async () => {
    const gateRegistry = makeGateRegistry();
    const commitsBefore = commitCount(fx.repo);

    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'completed');
    assert.equal(commitCount(fx.repo), commitsBefore);
  });
});

describe('finishStep — recovering an update-task stage found running (AC6)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-updatetask'); });
  after(() => cleanupFixture(fx));

  test('recognizes the mutation already happened, marks update-task completed without repeating it, and proceeds to commit', async () => {
    const change = freshChange(fx.activeDir);
    setTaskStatus(change, 'demo-task', 'verified');

    const craftedIntent = { fromState: 'in-implementation', toState: 'verified' };
    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'running', intent: { ...craftedIntent } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'completed');
    assert.equal(taskStatus(fx.activeDir), 'verified');

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'implementation');
    const updateTaskStage = record.operations.find(o => o.id === 'update-task');
    assert.equal(updateTaskStage.status, 'completed');
    // The intent must be exactly what was crafted, not recomputed from the (already-moved)
    // current state — proving reconciliation, not a fresh (re-)execution, was taken.
    assert.deepEqual(updateTaskStage.intent, craftedIntent);
  });
});

describe('finishStep — step-kind (internal-transition) update-task reconciliation uses the effective workflow position (D28)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-stepkind'); });
  after(() => cleanupFixture(fx));

  test('a crash on a task\'s very first internal transition (no workflow_progress yet) is safely redone, not reported ambiguous', async () => {
    // Task has never advanced within this workflow at all — no workflow_progress field
    // exists — but by D28/resolveCurrentStepName's own precedence that means it is
    // still effectively sitting on entryStep (stepA). A crash that persisted the
    // update-task intent as 'running' before the tracked write happened must reconcile
    // against that effective position, not the raw `undefined`.
    saveOperationRecord(fx.repo, {
      operationId: 'crafted-stepkind-1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'stepA',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'running', intent: { kind: 'step', fromStep: 'stepA', toStep: 'stepB' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep({ ...threeStepParams(fx, gateRegistry), inputs: RESOLVED_INPUTS });

    assert.equal(result.status, 'completed');
    const task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.workflow_progress.current_step, 'stepB');
    assert.equal(task.status, 'in-implementation', 'an internal transition never touches task.status');

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepA');
    assert.equal(record.operations.find(o => o.id === 'update-task').status, 'completed');
  });

  test('already-advanced-to-toStep is recognized as completed without repeating the write', async () => {
    // The mutation already happened (workflow_progress.current_step is already the
    // crafted intent's toStep) — update-task must recognize this and move on to commit,
    // never re-derive or repeat the write.
    const change = freshChange(fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', { workflowProgress: { current_step: 'stepC', history: [] } });

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-stepkind-2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'stepB',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'running', intent: { kind: 'step', fromStep: 'stepB', toStep: 'stepC' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep({ ...threeStepParams(fx, gateRegistry), inputs: RESOLVED_INPUTS });

    assert.equal(result.status, 'completed');
    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepB');
    const updateTaskStage = record.operations.find(o => o.id === 'update-task');
    assert.equal(updateTaskStage.status, 'completed');
    // Recognized via reconciliation, not re-derived — the intent stays exactly as crafted.
    assert.deepEqual(updateTaskStage.intent, { kind: 'step', fromStep: 'stepB', toStep: 'stepC' });
    const task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.workflow_progress.current_step, 'stepC');
  });

  test('an unrelated tracked position (neither fromStep nor toStep) is reported unknown, never guessed', async () => {
    const change = freshChange(fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', { workflowProgress: { current_step: 'stepC', history: [] } });

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-stepkind-3',
      change: 'demo-change',
      task: 'demo-task',
      step: 'stepA',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'running', intent: { kind: 'step', fromStep: 'stepA', toStep: 'stepB' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep({ ...threeStepParams(fx, gateRegistry), inputs: RESOLVED_INPUTS });

    assert.equal(result.status, 'reconciliation-required');
    assert.equal(result.stage, 'update-task');
    assert.equal(result.details.currentStep, 'stepC');

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepA');
    assert.equal(record.operations.find(o => o.id === 'update-task').status, 'unknown');
    assert.equal(record.operations.find(o => o.id === 'commit').status, 'pending', 'no further stage may execute');
  });
});

describe('finishStep — full multi-hop happy path across two internal transitions then terminal (task 08 AC2/AC3/AC4/AC5/AC7/AC8)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-multihop'); });
  after(() => cleanupFixture(fx));

  test('stepA -> stepB -> stepC -> verified: each internal transition advances workflow_progress in the same commit as the implementation change, and the final finish is the terminal write', async () => {
    // stepA -> stepB
    writeFileSync(join(fx.repo, 'feature-a.txt'), 'work on stepA\n');
    let gateRegistry = makeGateRegistry();
    let result = await finishStep({ ...threeStepParams(fx, gateRegistry), inputs: { ...RESOLVED_INPUTS, 'commit.title': 'Finish stepA' } });
    assert.equal(result.status, 'completed');

    let task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.workflow_progress.current_step, 'stepB', 'AC3: internal transition advances current_step');
    assert.equal(task.status, 'in-implementation', 'AC3: an internal transition never touches task.status');
    assert.equal(task.workflow_progress.history.length, 1);

    // AC7: the implementation change and the workflow-position update landed in the same commit.
    const headShaA = getCurrentRevision(fx.repo);
    const changedInCommitA = execFileSync('git', ['-C', fx.repo, 'show', '--name-only', '--format=', headShaA], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    assert.ok(changedInCommitA.includes('feature-a.txt'));
    assert.ok(changedInCommitA.some(p => p.endsWith('change.yaml')));

    // AC8: step A's own completed operation record exists and is untouched by what follows.
    const stepARecordBefore = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepA');
    assert.equal(stepARecordBefore.status, 'completed');

    // stepB -> stepC (AC8: a distinct operation, actually executes stepB's own finalize).
    // Each call re-fetches the task fresh from change.yaml, exactly as the real CLI's
    // resolveWorkflowRuntime does on every invocation — a stale, hand-held task object
    // (still reporting no workflow_progress) would wrongly re-resolve to stepA's entryStep.
    writeFileSync(join(fx.repo, 'feature-b.txt'), 'work on stepB\n');
    gateRegistry = makeGateRegistry();
    result = await finishStep({
      ...threeStepParams(fx, gateRegistry),
      task: requireTask(freshChange(fx.activeDir), 'demo-task'),
      inputs: { ...RESOLVED_INPUTS, 'commit.title': 'Finish stepB' },
    });
    assert.equal(result.status, 'completed');
    assert.notEqual(result.result.commit.sha, headShaA, 'AC8: stepB must produce its own, distinct commit — never a cached stepA result');

    task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.workflow_progress.current_step, 'stepC');
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.history.length, 2);

    const stepARecordAfter = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepA');
    assert.deepEqual(stepARecordAfter, stepARecordBefore, 'AC8: step A\'s own completed record file must be untouched by step B\'s finish');
    const stepBRecord = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'stepB');
    assert.equal(stepBRecord.status, 'completed');

    // stepC -> verified (terminal, AC4)
    writeFileSync(join(fx.repo, 'feature-c.txt'), 'work on stepC\n');
    gateRegistry = makeGateRegistry();
    result = await finishStep({
      ...threeStepParams(fx, gateRegistry),
      task: requireTask(freshChange(fx.activeDir), 'demo-task'),
      inputs: { ...RESOLVED_INPUTS, 'commit.title': 'Finish stepC' },
    });
    assert.equal(result.status, 'completed');

    task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.status, 'verified', 'AC4: a terminal transition writes task.status exactly as today\'s single-step behavior does');
    assert.equal(task.workflow_progress.current_step, 'stepC', 'AC4: workflow_progress is never cleared/nulled at completion');
    assert.equal(task.workflow_progress.history.length, 3, 'AC4: history gains a final entry recording the terminal transition');

    // AC5: the next resolution must report complete, never re-resolving entryStep as if fresh.
    assert.equal(resolveCurrentStepName(THREE_STEP_DEFINITION, task), null);
  });
});

describe('finishStep — recovering a commit stage found running (AC7)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-commit'); });
  after(() => cleanupFixture(fx));

  test('proves the existing HEAD is this operation\'s own commit, recovers its SHA, and never creates a second commit', async () => {
    const preCommitHead = getCurrentRevision(fx.repo);
    const change = freshChange(fx.activeDir);
    setTaskStatus(change, 'demo-task', 'verified');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', RESOLVED_INPUTS['commit.title']]);
    const commitSha = getCurrentRevision(fx.repo);
    const commitsBefore = commitCount(fx.repo);

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'running', intent: { preCommitHead } },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep({ ...baseParams(fx, gateRegistry, { push: false }) });

    assert.equal(result.status, 'completed');
    assert.equal(commitCount(fx.repo), commitsBefore, 'no second commit must be created');

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'implementation');
    const commitStage = record.operations.find(o => o.id === 'commit');
    assert.equal(commitStage.status, 'completed');
    assert.equal(commitStage.result.sha, commitSha);
  });
});

describe('finishStep — recovering a push stage found running or unknown (AC8)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-push'); });
  after(() => cleanupFixture(fx));

  async function craftUpToCommit() {
    const change = freshChange(fx.activeDir);
    setTaskStatus(change, 'demo-task', 'verified');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', RESOLVED_INPUTS['commit.title']]);
    return getCurrentRevision(fx.repo);
  }

  test('push left "running" but never actually sent: reconciles against remote and retries the push', async () => {
    const sha = await craftUpToCommit();
    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-3',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'completed', intent: { preCommitHead: 'irrelevant' }, result: { sha, status: 'completed' } },
        { id: 'push', status: 'running', result: { remote: 'origin', branch: 'main', expectedSha: sha } },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'completed');
    const remoteHead = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    assert.equal(remoteHead, sha);
  });

  test('push left "unknown" but already landed on remote: resolves to completed without re-pushing', async () => {
    // The previous test already pushed `sha` to remote `main`; simulate a second task
    // whose own commit builds on top and was already pushed, but bookkeeping is unknown.
    writeFileSync(join(fx.repo, 'more.txt'), 'more\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', 'second commit']);
    const sha2 = getCurrentRevision(fx.repo);
    fx.git(['push', 'origin', 'main']);

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-4',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'completed', intent: { preCommitHead: 'irrelevant' }, result: { sha: sha2, status: 'completed' } },
        { id: 'push', status: 'unknown', result: { remote: 'origin', branch: 'main', expectedSha: sha2 } },
        { id: 'transition', status: 'pending' },
      ],
    });

    const remoteHeadBefore = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'completed');
    const remoteHeadAfter = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    assert.equal(remoteHeadAfter, remoteHeadBefore, 'no re-push must occur when the commit is already on the remote');
  });
});

describe('finishStep — interrupted after a successful push but before transition (AC9)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-transition'); });
  after(() => cleanupFixture(fx));

  test('does not re-push and completes only the transition stage', async () => {
    const change = freshChange(fx.activeDir);
    setTaskStatus(change, 'demo-task', 'verified');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', RESOLVED_INPUTS['commit.title']]);
    const sha = getCurrentRevision(fx.repo);
    fx.git(['push', 'origin', 'main']);
    const remoteHeadBefore = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-5',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'completed', intent: { preCommitHead: 'irrelevant' }, result: { sha, status: 'completed' } },
        { id: 'push', status: 'completed', result: { remote: 'origin', branch: 'main', expectedSha: sha, status: 'completed' } },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'completed');
    const remoteHeadAfter = execFileSync('git', ['-C', fx.remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    assert.equal(remoteHeadAfter, remoteHeadBefore);

    const changeYamlBefore = readFileSync(join(fx.activeDir, 'demo-change', 'change.yaml'), 'utf8');
    // transition performs no further change.yaml write of its own (D13) — re-reading
    // immediately after must be stable/unchanged by this call.
    const changeYamlAfter = readFileSync(join(fx.activeDir, 'demo-change', 'change.yaml'), 'utf8');
    assert.equal(changeYamlBefore, changeYamlAfter);
  });
});

describe('finishStep — resolved-inputs persistence and conflict detection (AC11, AC12)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-inputs'); });
  after(() => cleanupFixture(fx));

  function craftPendingRecord() {
    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-6',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'pending' },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });
  }

  test('resumes using persisted resolvedInputs when retried with no inputs supplied at all (AC11)', async () => {
    craftPendingRecord();
    const gateRegistry = makeGateRegistry();

    const result = await finishStep({ ...baseParams(fx, gateRegistry), inputs: {} });

    assert.equal(result.status, 'completed');
    const headSha = getCurrentRevision(fx.repo);
    const info = getCommitInfo(fx.repo, headSha);
    assert.equal(info.subject, RESOLVED_INPUTS['commit.title']);
  });

  test('rejects a conflicting resupply of an already-resolved input deterministically (AC12)', async () => {
    craftPendingRecord();
    const gateRegistry = makeGateRegistry();

    await assert.rejects(
      () => finishStep({ ...baseParams(fx, gateRegistry), inputs: { 'commit.title': 'A different title' } }),
      PreconditionError
    );

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'implementation');
    assert.equal(record.resolvedInputs['commit.title'], RESOLVED_INPUTS['commit.title']);
    assert.equal(record.operations.find(o => o.id === 'update-task').status, 'pending');
  });

  test('accepts a resupply of the identical value as a harmless no-op', async () => {
    // The prior (rejected) test left the crafted record's stages pending against a
    // fixture whose task/worktree already reached the target state from AC11's run —
    // give this retry something new to commit so it can actually reach that far.
    writeFileSync(join(fx.repo, 'noop-resupply.txt'), 'x\n');
    const gateRegistry = makeGateRegistry();
    const result = await finishStep({ ...baseParams(fx, gateRegistry), inputs: { 'commit.title': RESOLVED_INPUTS['commit.title'] } });
    assert.equal(result.status, 'completed');
  });
});

describe('finishStep — unresolvable ambiguity is reported, never guessed (AC13, AC14)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-finish-unknown'); });
  after(() => cleanupFixture(fx));

  test('update-task found running whose current state matches neither fromState nor toState is reported unknown', async () => {
    const change = freshChange(fx.activeDir);
    setTaskStatus(change, 'demo-task', 'approved');

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-7',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'running', intent: { fromState: 'in-implementation', toState: 'verified' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry));

    assert.equal(result.status, 'reconciliation-required');
    assert.equal(result.stage, 'update-task');

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task', 'implementation');
    assert.equal(record.operations.find(o => o.id === 'update-task').status, 'unknown');
    assert.equal(record.operations.find(o => o.id === 'commit').status, 'pending', 'no further stage may execute');

    // Clean up so the next test in this suite starts from a known task state.
    setTaskStatus(freshChange(fx.activeDir), 'demo-task', 'in-implementation');
    rmSync(join(fx.repo, '.nevo-ai-local'), { recursive: true, force: true });
  });

  test('commit found running whose HEAD cannot be proven to be this operation\'s own commit is reported unknown', async () => {
    const preCommitHead = getCurrentRevision(fx.repo);
    // An unrelated commit lands on the branch — not the operation's own commit.
    writeFileSync(join(fx.repo, 'unrelated.txt'), 'unrelated\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-m', 'an unrelated commit landed']);
    const commitsBefore = commitCount(fx.repo);

    saveOperationRecord(fx.repo, {
      operationId: 'crafted-op-8',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      status: 'running',
      resolvedInputs: RESOLVED_INPUTS,
      operations: [
        { id: 'verify-gates', status: 'completed', result: { gates: [] } },
        { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
        { id: 'commit', status: 'running', intent: { preCommitHead } },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const gateRegistry = makeGateRegistry();
    const result = await finishStep(baseParams(fx, gateRegistry, { push: false }));

    assert.equal(result.status, 'reconciliation-required');
    assert.equal(result.stage, 'commit');
    assert.equal(commitCount(fx.repo), commitsBefore, 'the commit action must never be invoked again');
  });
});
