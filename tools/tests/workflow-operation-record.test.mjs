import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  operationFilePath,
  loadOperationRecord,
  saveOperationRecord,
  findInFlightOperationRecord,
  isFinishOperationReplayable,
} from '../specs/workflow/operation-record.mjs';
import {
  PreconditionError,
  WorkflowError,
} from '../specs/workflow/errors.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  normalizeWorkflowDefinition,
  finishStep,
} from '../specs/workflow/index.mjs';
import { getCurrentRevision } from '../lib/git.mjs';


function makeFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { base, repo: base };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('operationFilePath and storage layout (AC4)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-op-record-layout'); });
  after(() => cleanupFixture(fx));

  test('constructs exact attempt-scoped path', () => {
    const p = operationFilePath(fx.repo, 'demo-change', 'demo-task', 'implementation', 1);
    const expected = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task', 'implementation', 'attempt-1.json');
    assert.equal(p, expected);

    const p2 = operationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 3);
    const expected2 = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task', 'review', 'attempt-3.json');
    assert.equal(p2, expected2);
  });

  test('enforces step and attempt arguments on path construction and storage APIs', () => {
    assert.throws(
      () => operationFilePath(fx.repo, 'c', 't', null, 1),
      WorkflowError
    );
    assert.throws(
      () => operationFilePath(fx.repo, 'c', 't', 's', null),
      WorkflowError
    );
    assert.throws(
      () => loadOperationRecord(fx.repo, 'c', 't', null, 1),
      WorkflowError
    );
    assert.throws(
      () => loadOperationRecord(fx.repo, 'c', 't', 's', undefined),
      WorkflowError
    );
    assert.throws(
      () => saveOperationRecord(fx.repo, { change: 'c', task: 't', step: 's' }),
      WorkflowError
    );
  });

  test('saves and loads operation record accurately with attempt scoping', () => {
    const record = {
      operationId: 'op-1',
      change: 'change-a',
      task: 'task-a',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      resolvedInputs: { key: 'value' },
      operations: [
        { id: 'verify-gates', status: 'pending' },
      ],
    };

    saveOperationRecord(fx.repo, record);

    const filePath = operationFilePath(fx.repo, 'change-a', 'task-a', 'implementation', 1);
    assert.ok(existsSync(filePath), 'record file must exist at scoped path');

    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(raw.operationId, 'op-1');
    assert.equal(raw.attempt, 1);

    const loaded = loadOperationRecord(fx.repo, 'change-a', 'task-a', 'implementation', 1);
    assert.deepEqual(loaded, record);

    // Another attempt for the same step returns null when not written
    const nonExistent = loadOperationRecord(fx.repo, 'change-a', 'task-a', 'implementation', 2);
    assert.equal(nonExistent, null);
  });
});

describe('findInFlightOperationRecord (AC5)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-op-record-flight'); });
  after(() => cleanupFixture(fx));

  test('returns null when storage directory does not exist or has no records', () => {
    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.equal(result, null);
  });

  test('returns null when all operation records are completed', () => {
    saveOperationRecord(fx.repo, {
      operationId: 'op-c1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      attempt: 1,
      status: 'completed',
      operations: [],
    });
    saveOperationRecord(fx.repo, {
      operationId: 'op-c2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 1,
      status: 'completed',
      operations: [],
    });

    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.equal(result, null);
  });

  test('returns single record when exactly one uncompleted record exists', () => {
    saveOperationRecord(fx.repo, {
      operationId: 'op-in-flight',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 2,
      status: 'running',
      operations: [],
    });

    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.ok(result);
    assert.equal(result.operationId, 'op-in-flight');
    assert.equal(result.step, 'review');
    assert.equal(result.attempt, 2);
  });

  test('throws MULTIPLE_IN_FLIGHT_OPERATIONS when two or more uncompleted records exist', () => {
    // Add a second uncompleted record for attempt 3
    saveOperationRecord(fx.repo, {
      operationId: 'op-in-flight-2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 3,
      status: 'reconciliation-required',
      operations: [],
    });

    assert.throws(
      () => findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task'),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'MULTIPLE_IN_FLIGHT_OPERATIONS');
        return true;
      }
    );
  });
});

describe('isFinishOperationReplayable (Task 01, D2)', () => {
  describe('fail-closed classification for missing, malformed, or non-replayable records', () => {
    test('returns false for null, undefined, and non-object values', () => {
      assert.equal(isFinishOperationReplayable(null), false);
      assert.equal(isFinishOperationReplayable(undefined), false);
      assert.equal(isFinishOperationReplayable(''), false);
      assert.equal(isFinishOperationReplayable('running'), false);
      assert.equal(isFinishOperationReplayable(123), false);
      assert.equal(isFinishOperationReplayable(true), false);
    });

    test('returns false for missing or invalid status property', () => {
      assert.equal(isFinishOperationReplayable({}), false);
      assert.equal(isFinishOperationReplayable({ status: null }), false);
      assert.equal(isFinishOperationReplayable({ status: 123 }), false);
      assert.equal(isFinishOperationReplayable({ status: '' }), false);
    });

    test('returns false for unrecognized or non-replayable status values', () => {
      assert.equal(isFinishOperationReplayable({ status: 'blocked' }), false);
      assert.equal(isFinishOperationReplayable({ status: 'unknown' }), false);
      assert.equal(isFinishOperationReplayable({ status: 'completed' }), false);
      assert.equal(isFinishOperationReplayable({ status: 'pending' }), false);
      assert.equal(isFinishOperationReplayable({ status: 'failed' }), false);
      assert.equal(isFinishOperationReplayable({ status: 'arbitrary' }), false);
    });

    test('returns true for status: running when not blocked by stage outcomes', () => {
      assert.equal(isFinishOperationReplayable({ status: 'running' }), true);
      assert.equal(isFinishOperationReplayable({
        status: 'running',
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'running' },
        ],
      }), true);
    });

    test('returns false if any stage in operations is unknown, blocked, or failed', () => {
      assert.equal(isFinishOperationReplayable({
        status: 'running',
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'unknown' },
        ],
      }), false);

      assert.equal(isFinishOperationReplayable({
        status: 'running',
        operations: [
          { id: 'verify-gates', status: 'failed' },
        ],
      }), false);

      assert.equal(isFinishOperationReplayable({
        status: 'running',
        operations: [
          { id: 'commit', status: 'blocked' },
        ],
      }), false);
    });
  });

  describe('real record shapes produced by finish-operation.mjs stage functions', () => {
    let gitFx;

    function makeFinishGitFixture(prefix) {
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
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), `id: demo-change
title: "Demo change"
type: standard
status: draft
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`);
      writeFileSync(join(changeDir, 'tasks', '01-demo.md'), '# Task 01\\n');
      writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\\n');
      git(['add', '-A']);
      git(['commit', '-m', 'initial commit']);
      git(['push', '-u', 'origin', 'main']);

      return { remote, repo, base: repo, git, activeDir };
    }

    function cleanupGitFixture(fx) {
      if (!fx) return;
      try { rmSync(fx.repo, { recursive: true, force: true }); } catch {}
      try { rmSync(fx.remote, { recursive: true, force: true }); } catch {}
    }

    before(() => {
      gitFx = makeFinishGitFixture('nevo-finish-replay');
    });

    after(() => {
      cleanupGitFixture(gitFx);
    });

    const DEFINITION = normalizeWorkflowDefinition({
      id: 'standard-v1',
      title: 'Standard',
      type: 'standard',
      version: 1,
      steps: {
        implementation: {
          status: { active: 'in-implementation', completed: 'implemented' },
          entryGates: [],
          actions: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'verified' }],
        },
      },
    });

    test('classifies real in-flight running record produced by finishStep as replayable (true)', async () => {
      const customDef = normalizeWorkflowDefinition({
        id: 'interrupted-v1',
        title: 'Interrupted',
        type: 'standard',
        version: 1,
        steps: {
          implementation: {
            status: { active: 'in-implementation', completed: 'implemented' },
            entryGates: [],
            actions: [],
            exitGates: [{ type: 'custom-gate' }],
            finalize: [{ id: 'commit-and-push' }],
            transitions: [{ to: 'verified' }],
          },
        },
      });

      const gateRegistry = {
        get() {
          return {
            inspect: async () => ({ toJSON: () => ({ status: 'pending' }) }),
            verify: async () => { throw new Error('simulated interruption during verification'); },
          };
        },
        require(type) { return this.get(type); },
      };

      await assert.rejects(
        () => finishStep({
          change: { id: 'demo-change' },
          task: { id: 'demo-task', workflow_progress: { current_step: 'implementation', current_attempt: 1, state: 'active', history: [] } },
          definition: customDef,
          inputs: { 'commit.title': 'finish commit' },
          context: { repoRoot: gitFx.repo, activeDir: gitFx.activeDir, sourceControl: { enabled: true, push: false } },
          gateRegistry,
        }),
        /simulated interruption during verification/
      );

      const record = loadOperationRecord(gitFx.repo, 'demo-change', 'demo-task', 'implementation', 1);
      assert.ok(record, 'record must be persisted on disk');
      assert.equal(record.status, 'running');
      assert.equal(isFinishOperationReplayable(record), true);

      rmSync(join(gitFx.repo, '.nevo-ai-local'), { recursive: true, force: true });
    });

    test('classifies real record produced by ensureUpdateTask reconciliation failure as non-replayable (false)', async () => {
      saveOperationRecord(gitFx.repo, {
        operationId: 'op-reconcile-update',
        change: 'demo-change',
        task: 'demo-task',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        resolvedInputs: { 'commit.title': 'finish commit' },
        operations: [
          { id: 'verify-gates', status: 'completed', result: { gates: [] } },
          { id: 'update-task', status: 'running', intent: { fromState: 'active', toState: 'completed', step: 'implementation', attempt: 1 } },
          { id: 'commit', status: 'pending' },
          { id: 'push', status: 'pending' },
          { id: 'transition', status: 'pending' },
        ],
      });

      writeFileSync(join(gitFx.activeDir, 'demo-change', 'change.yaml'), `id: demo-change
title: "Demo change"
type: standard
status: draft
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          transitioned_to: verified
`);

      const result = await finishStep({
        change: { id: 'demo-change' },
        task: {
          id: 'demo-task',
          workflow_progress: {
            current_step: 'implementation',
            current_attempt: 1,
            state: 'active',
            history: [{ step: 'implementation', attempt: 1, transitioned_to: 'verified' }],
          },
        },
        inputs: { 'commit.title': 'finish commit' },
        definition: DEFINITION,
        context: { repoRoot: gitFx.repo, activeDir: gitFx.activeDir, sourceControl: { enabled: true, push: false } },
      });

      assert.equal(result.status, 'reconciliation-required');
      assert.equal(result.stage, 'update-task');

      const record = loadOperationRecord(gitFx.repo, 'demo-change', 'demo-task', 'implementation', 1);
      assert.ok(record);
      assert.equal(record.status, 'blocked');
      const updateStage = record.operations.find(o => o.id === 'update-task');
      assert.equal(updateStage.status, 'unknown');
      assert.equal(isFinishOperationReplayable(record), false);

      rmSync(join(gitFx.repo, '.nevo-ai-local'), { recursive: true, force: true });
    });

    test('classifies real record produced by ensureCommit reconciliation failure as non-replayable (false)', async () => {
      const preCommitHead = getCurrentRevision(gitFx.repo);
      writeFileSync(join(gitFx.repo, 'unrelated.txt'), 'unrelated\\n');
      gitFx.git(['add', '-A']);
      gitFx.git(['commit', '-m', 'unrelated commit']);

      saveOperationRecord(gitFx.repo, {
        operationId: 'op-reconcile-commit',
        change: 'demo-change',
        task: 'demo-task',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        resolvedInputs: { 'commit.title': 'expected finish commit' },
        operations: [
          { id: 'verify-gates', status: 'completed', result: { gates: [] } },
          { id: 'update-task', status: 'completed', intent: { fromState: 'in-implementation', toState: 'verified' }, result: { toState: 'verified' } },
          { id: 'commit', status: 'running', intent: { preCommitHead } },
          { id: 'push', status: 'pending' },
          { id: 'transition', status: 'pending' },
        ],
      });

      const result = await finishStep({
        change: { id: 'demo-change' },
        task: {
          id: 'demo-task',
          status: 'in-implementation',
          workflow_progress: { current_step: 'implementation', current_attempt: 1, state: 'active', history: [] },
        },
        definition: DEFINITION,
        context: { repoRoot: gitFx.repo, activeDir: gitFx.activeDir, sourceControl: { enabled: true, push: false } },
      });

      assert.equal(result.status, 'reconciliation-required');
      assert.equal(result.stage, 'commit');

      const record = loadOperationRecord(gitFx.repo, 'demo-change', 'demo-task', 'implementation', 1);
      assert.ok(record);
      assert.equal(record.status, 'blocked');
      const commitStage = record.operations.find(o => o.id === 'commit');
      assert.equal(commitStage.status, 'unknown');
      assert.equal(isFinishOperationReplayable(record), false);

      rmSync(join(gitFx.repo, '.nevo-ai-local'), { recursive: true, force: true });
    });

    test('classifies real record produced by ensureVerifyGates failure as non-replayable (false)', async () => {
      const gateDef = normalizeWorkflowDefinition({
        id: 'failing-gate-v1',
        title: 'Failing Gate',
        type: 'standard',
        version: 1,
        steps: {
          implementation: {
            status: { active: 'in-implementation', completed: 'implemented' },
            entryGates: [],
            actions: [],
            exitGates: [{ type: 'failing-gate' }],
            finalize: [{ id: 'commit-and-push' }],
            transitions: [{ to: 'verified' }],
          },
        },
      });

      const gateRegistry = {
        get() {
          return {
            inspect: async () => ({ toJSON: () => ({ status: 'pending' }) }),
            verify: async () => ({ toJSON: () => ({ status: 'failed', message: 'verification failed' }) }),
          };
        },
        require(type) { return this.get(type); },
      };

      const result = await finishStep({
        change: { id: 'demo-change' },
        task: { id: 'demo-task', workflow_progress: { current_step: 'implementation', current_attempt: 1, state: 'active', history: [] } },
        definition: gateDef,
        inputs: { 'commit.title': 'finish commit' },
        context: { repoRoot: gitFx.repo, activeDir: gitFx.activeDir, sourceControl: { enabled: true, push: false } },
        gateRegistry,
      });

      assert.equal(result.status, 'blocked');
      assert.equal(result.stage, 'verify-gates');

      const record = loadOperationRecord(gitFx.repo, 'demo-change', 'demo-task', 'implementation', 1);
      assert.ok(record);
      assert.equal(record.status, 'blocked');
      const verifyStage = record.operations.find(o => o.id === 'verify-gates');
      assert.equal(verifyStage.status, 'failed');
      assert.equal(isFinishOperationReplayable(record), false);

      rmSync(join(gitFx.repo, '.nevo-ai-local'), { recursive: true, force: true });
    });

  });
});

