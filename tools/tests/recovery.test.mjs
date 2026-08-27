// Tests for the postcondition-based recovery model (area recovery-and-resume, D8/D17):
// inspectStartPostconditions, classifySimpleActionPostcondition, classifyDirtyWorktree,
// and deriveStage's suspension-/self-check-aware wrapper. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectStartPostconditions, inspectApprovePostconditions, classifySimpleActionPostcondition,
  classifyDirtyWorktree, POSTCONDITION_RESULTS,
} from '../specs/lifecycle/recovery.mjs';
import { deriveStage } from '../specs/lifecycle/stage.mjs';
import { setTaskSuspension, clearTaskSuspension, guardAgainstUnsafeManual } from '../specs.mjs';

describe('POSTCONDITION_RESULTS — the five-value vocabulary (D17)', () => {
  test('has exactly the five documented values', () => {
    assert.deepEqual(
      [...POSTCONDITION_RESULTS].sort(),
      ['completed', 'not_retryable', 'partially_completed', 'safe_to_retry', 'unsafe_manual'].sort()
    );
  });
});

describe('inspectStartPostconditions — the start-task reference contract', () => {
  test('completed: on the expected branch, already in-implementation', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'in-implementation', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(r.result, 'completed');
  });

  test('partially_completed: branch created and checked out, status not yet written', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(r.result, 'partially_completed');
    assert.deepEqual(r.missing, ['status']);
  });

  test('safe_to_retry: neither effect has happened yet, branch exists nowhere', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(r.result, 'safe_to_retry');
    assert.equal(r.remoteOnly, false);
  });

  test('safe_to_retry with remoteOnly: true when the branch exists on origin only (REC-02)', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: true,
    });
    assert.equal(r.result, 'safe_to_retry');
    assert.equal(r.remoteOnly, true);
  });

  test('not_retryable: task status is no longer approved/in-implementation', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'draft', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(r.result, 'not_retryable');
    assert.match(r.reason, /expected 'approved'/);
  });

  test('not_retryable: dependencies are no longer satisfied', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: false, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(r.result, 'not_retryable');
    assert.match(r.reason, /Dependencies/);
  });

  test('not_retryable dependency reason names the specific unsatisfied dependencies when given', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: false, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false, unsatisfiedDeps: ['task-a', 'task-b'],
    });
    assert.equal(r.result, 'not_retryable');
    assert.match(r.reason, /task-a, task-b/);
  });

  test('not_retryable: status says in-implementation but the branch is gone entirely', () => {
    const r = inspectStartPostconditions({
      taskStatus: 'in-implementation', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(r.result, 'not_retryable');
    assert.match(r.reason, /branch/);
  });

  test('the resumable recovery handle: re-invoking after a partial repair reports only what is still missing', () => {
    // First inspection: neither effect done yet.
    const first = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false,
    });
    assert.equal(first.result, 'safe_to_retry');

    // Simulate the branch having been created since (the "repair"). Re-invoking
    // the same pure classifier with fresh state — not a stored diff — reports
    // only the status write as still missing, never re-reporting the branch.
    const second = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: true,
      localBranchExists: true, remoteBranchExists: false,
    });
    assert.equal(second.result, 'partially_completed');
    assert.deepEqual(second.missing, ['status']);
    assert.ok(!second.missing.includes('branch'), 'must not re-report the already-satisfied branch effect');
  });
});

describe('inspectApprovePostconditions — approve\'s own postcondition contract', () => {
  test('completed when validateApproval reports idempotent (already approved)', () => {
    const r = inspectApprovePostconditions({ ok: true, idempotent: true });
    assert.equal(r.result, 'completed');
  });

  test('safe_to_retry when validateApproval passes and has not run yet', () => {
    const r = inspectApprovePostconditions({ ok: true, idempotent: false });
    assert.equal(r.result, 'safe_to_retry');
    assert.deepEqual(r.missing, ['status']);
  });

  test('not_retryable, carrying the code, for every rejection reason (wrong status, stale review, ...)', () => {
    const r = inspectApprovePostconditions({ ok: false, code: 'stale-fingerprint', reason: 'Review is stale: ...' });
    assert.equal(r.result, 'not_retryable');
    assert.equal(r.code, 'stale-fingerprint');
    assert.equal(r.reason, 'Review is stale: ...');
  });
});

describe('classifySimpleActionPostcondition — approve/complete/verify (single-effect actions)', () => {
  test('completed when the transition is idempotent (already at target status)', () => {
    const r = classifySimpleActionPostcondition({ ok: true, idempotent: true });
    assert.equal(r.result, 'completed');
  });

  test('safe_to_retry when the transition has not run yet', () => {
    const r = classifySimpleActionPostcondition({ ok: true, idempotent: false });
    assert.equal(r.result, 'safe_to_retry');
  });

  test('not_retryable when the transition itself is invalid', () => {
    const r = classifySimpleActionPostcondition({ ok: false, reason: 'wrong status' });
    assert.equal(r.result, 'not_retryable');
    assert.equal(r.reason, 'wrong status');
  });
});

describe('classifyDirtyWorktree — REC-05 (task files) vs. REC-06 (unrelated files)', () => {
  const allowedPaths = ['tools/specs/lifecycle.mjs', 'tools/tests/recovery.test.mjs', 'docs/ai/**'];

  test('returns null for a clean tree', () => {
    assert.equal(classifyDirtyWorktree([], allowedPaths), null);
  });

  test('REC-05 when every dirty file is within allowed_paths (exact match)', () => {
    const r = classifyDirtyWorktree(['tools/specs/lifecycle.mjs'], allowedPaths);
    assert.equal(r.code, 'REC-05');
    assert.equal(r.class, 'confirm-required');
    assert.deepEqual(r.files, ['tools/specs/lifecycle.mjs']);
  });

  test('REC-05 when the dirty file matches a `dir/**` allowed_paths entry', () => {
    const r = classifyDirtyWorktree(['docs/ai/specification-workflow.md'], allowedPaths);
    assert.equal(r.code, 'REC-05');
  });

  test('REC-06 when at least one dirty file is outside allowed_paths', () => {
    const r = classifyDirtyWorktree(['tools/specs/lifecycle.mjs', 'src/Foo/Bar.cs'], allowedPaths);
    assert.equal(r.code, 'REC-06');
    assert.equal(r.class, 'owner-decision');
    assert.deepEqual(r.files, ['src/Foo/Bar.cs']);
  });

  test('REC-06 wins even when only one of several files is unrelated', () => {
    const r = classifyDirtyWorktree(['docs/ai/x.md', 'unrelated/file.txt', 'docs/ai/y.md'], allowedPaths);
    assert.equal(r.code, 'REC-06');
    assert.deepEqual(r.files, ['unrelated/file.txt']);
  });
});

describe('deriveStage — suspension-aware (D8, requirement 7)', () => {
  const emptyFacts = () => ({ pr: null, ghAvailable: true, verification: [] });

  test('an approved task with no suspension reports the normal ready-to-start stage', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
    assert.equal(r.suspension, undefined);
  });

  test('an approved task with a confirm-required suspension overrides nextCommand', () => {
    const suspension = { kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved', execution: { suspension } }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
    assert.deepEqual(r.suspension, suspension);
    assert.match(r.nextCommand, /Confirm\/resolve REC-05/);
    assert.match(r.nextCommand, /retry start/);
    assert.match(r.detail, /REC-05/);
  });

  test('an owner-decision suspension routes to the owner, not a confirmation', () => {
    const suspension = { kind: 'owner-decision', code: 'REC-06', previous_action: 'start', created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved', execution: { suspension } }] };
    const r = deriveStage(change, emptyFacts());
    assert.match(r.nextCommand, /Owner must resolve REC-06/);
  });

  test('an in-implementation task with a suspension overrides the in-progress nextCommand too', () => {
    const suspension = { kind: 'unsafe-manual', code: 'REC-09', previous_action: null, created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'in-implementation', execution: { suspension } }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'in-progress');
    assert.match(r.nextCommand, /Owner must resolve REC-09/);
  });
});

describe('deriveStage — self-check-aware (D28, requirement 8)', () => {
  const emptyFacts = () => ({ pr: null, ghAvailable: true, verification: [] });

  test('not-run when the task has no self_check block', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'in-implementation' }] };
    const r = deriveStage(change, emptyFacts());
    assert.deepEqual(r.selfCheck, { state: 'not-run' });
  });

  test('failed surfaces failed_criteria', () => {
    const change = {
      _slug: 'c1',
      tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'failed', failed_criteria: ['AC-3', 'AC-5'] } }],
    };
    const r = deriveStage(change, emptyFacts());
    assert.deepEqual(r.selfCheck, { state: 'failed', failedCriteria: ['AC-3', 'AC-5'] });
  });

  test('passed-and-fresh when the current fingerprint/revision match self_check', () => {
    const change = {
      _slug: 'c1',
      tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'passed', fingerprint: 'fp1', revision: 'rev1' } }],
    };
    const facts = { ...emptyFacts(), currentTaskState: { fingerprint: 'fp1', revision: 'rev1' } };
    const r = deriveStage(change, facts);
    assert.deepEqual(r.selfCheck, { state: 'passed-and-fresh' });
  });

  test('passed-but-stale when the current fingerprint no longer matches', () => {
    const change = {
      _slug: 'c1',
      tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'passed', fingerprint: 'fp1', revision: 'rev1' } }],
    };
    const facts = { ...emptyFacts(), currentTaskState: { fingerprint: 'fp2', revision: 'rev1' } };
    const r = deriveStage(change, facts);
    assert.deepEqual(r.selfCheck, { state: 'passed-but-stale' });
  });

  test('passed-but-stale (conservative default) when freshness cannot be confirmed at all', () => {
    const change = {
      _slug: 'c1',
      tasks: [{ id: 't1', status: 'in-implementation', self_check: { status: 'passed', fingerprint: 'fp1', revision: 'rev1' } }],
    };
    const r = deriveStage(change, emptyFacts()); // no currentTaskState provided
    assert.deepEqual(r.selfCheck, { state: 'passed-but-stale' });
  });

  test('self_check is never written by deriveStage itself — it is a read-only classifier', () => {
    const task = { id: 't1', status: 'in-implementation' };
    const change = { _slug: 'c1', tasks: [task] };
    deriveStage(change, emptyFacts());
    assert.equal(task.self_check, undefined);
  });
});

describe('setTaskSuspension/clearTaskSuspension — writing never touches status (acceptance criterion 5)', () => {
  let dir, changeFile;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'nevo-suspension-test-'));
    changeFile = join(dir, 'change.yaml');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixtureChange(status) {
    writeFileSync(changeFile, [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t.md', `    status: ${status}`, '',
    ].join('\n'));
    return { _file: changeFile };
  }

  for (const [kind, code] of [['owner-decision', 'REC-06'], ['unsafe-manual', 'REC-09']]) {
    test(`${kind} suspension (${code}) is persisted with status unchanged`, () => {
      const change = writeFixtureChange('approved');
      setTaskSuspension(change, 't1', { kind, code, previous_action: 'start', created_at: '2026-08-04T00:00:00Z' });

      const raw = readFileSync(changeFile, 'utf8');
      assert.match(raw, /status: approved/);
      assert.match(raw, new RegExp(`kind: ${kind}`));
      assert.match(raw, new RegExp(`code: ${code}`));
    });
  }

  test('clearTaskSuspension removes the block entirely, leaving status untouched', () => {
    const change = writeFixtureChange('approved');
    setTaskSuspension(change, 't1', { kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: '2026-08-04T00:00:00Z' });
    clearTaskSuspension(change, 't1');

    const raw = readFileSync(changeFile, 'utf8');
    assert.doesNotMatch(raw, /execution:/);
    assert.match(raw, /status: approved/);
  });

  test('clearTaskSuspension on a task with no suspension is a safe no-op', () => {
    const change = writeFixtureChange('approved');
    assert.doesNotThrow(() => clearTaskSuspension(change, 't1'));
  });
});

describe('guardAgainstUnsafeManual — an unsafe-manual stop never auto-retries (D17, acceptance criterion 6)', () => {
  test('throws when the task carries an unsafe-manual suspension', () => {
    const task = { execution: { suspension: { kind: 'unsafe-manual', code: 'REC-09' } } };
    assert.throws(() => guardAgainstUnsafeManual(task, 't1', 'start'), /unsafe-manual suspension \(REC-09\)/);
  });

  test('never converts into a follow-on suspension of a different kind — it only throws, never writes', () => {
    const task = { execution: { suspension: { kind: 'unsafe-manual', code: 'REC-09' } } };
    let threw = false;
    try {
      guardAgainstUnsafeManual(task, 't1', 'start');
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
    // The guard itself never mutates the task object — no new suspension kind
    // is written on the owner's behalf (constraint, area recovery-and-resume).
    assert.equal(task.execution.suspension.kind, 'unsafe-manual');
    assert.equal(task.execution.suspension.code, 'REC-09');
  });

  test('does nothing for a confirm-required or owner-decision suspension', () => {
    assert.doesNotThrow(() => guardAgainstUnsafeManual({ execution: { suspension: { kind: 'confirm-required', code: 'REC-05' } } }, 't1', 'start'));
    assert.doesNotThrow(() => guardAgainstUnsafeManual({ execution: { suspension: { kind: 'owner-decision', code: 'REC-06' } } }, 't1', 'start'));
  });

  test('does nothing for a task with no suspension at all', () => {
    assert.doesNotThrow(() => guardAgainstUnsafeManual({}, 't1', 'start'));
  });
});
