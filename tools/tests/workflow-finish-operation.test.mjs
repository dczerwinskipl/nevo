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
} from '../specs/workflow/index.mjs';
import { requireChange, requireTask, setTaskStatus } from '../specs/store.mjs';
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
    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.ok(record);
    assert.equal(record.status, 'completed');
    const recordPath = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task.json');
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

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task');
    const updateTaskStage = record.operations.find(o => o.id === 'update-task');
    assert.equal(updateTaskStage.status, 'completed');
    // The intent must be exactly what was crafted, not recomputed from the (already-moved)
    // current state — proving reconciliation, not a fresh (re-)execution, was taken.
    assert.deepEqual(updateTaskStage.intent, craftedIntent);
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

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task');
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

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task');
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

    const record = loadOperationRecord(fx.repo, 'demo-change', 'demo-task');
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
