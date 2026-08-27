// Tests for the centralized task state machine in tools/specs/lifecycle.mjs
// (draft -> approved -> in-implementation -> implemented -> verified).
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTransition, validateApproval, TRANSITIONS,
  depsSatisfied, TASK_STATUSES, CHANGE_STATUSES, removedStatusMessage,
} from '../specs/lifecycle-primitives.mjs';
import { validateFinalize, deriveStage } from '../specs/lifecycle/stage.mjs';
import {
  scopeOf, isEndOfScope, nextInScope,
  planContinuation, stopReasonForSuspension, nextSuspensionForNotRetryable,
  resolveAfterConfirmedRepair, inspectStartPostconditions, inspectApprovePostconditions,
  classifyDirtyWorktree, CONTINUATION_STOP_REASONS,
} from '../specs/lifecycle/recovery.mjs';
import { validateStatusValue } from '../specs/validation.mjs';

describe('validateTransition — valid transitions', () => {
  test('approve: draft -> approved is allowed', () => {
    const r = validateTransition('approve', 'draft');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });

  test('start: approved -> in-implementation is allowed', () => {
    const r = validateTransition('start', 'approved');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });

  test('complete: in-implementation -> implemented is allowed', () => {
    const r = validateTransition('complete', 'in-implementation');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });

  test('verify: implemented -> verified is allowed', () => {
    const r = validateTransition('verify', 'implemented');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });
});

describe('validateTransition — idempotent re-runs (already at target status)', () => {
  for (const [command, rule] of Object.entries(TRANSITIONS)) {
    test(`${command}: already '${rule.to}' is a safe idempotent no-op`, () => {
      const r = validateTransition(command, rule.to);
      assert.equal(r.ok, true);
      assert.equal(r.idempotent, true);
    });
  }
});

describe('validateTransition — invalid transitions are rejected with a clear reason', () => {
  const cases = [
    ['approve', 'blocked'],
    ['approve', 'needs-decision'],
    ['approve', 'in-implementation'],
    ['approve', 'implemented'],
    ['approve', 'verified'],
    ['start', 'draft'],
    ['start', 'blocked'],
    ['start', 'implemented'],
    ['complete', 'draft'],
    ['complete', 'approved'],
    ['complete', 'verified'],
    ['verify', 'draft'],
    ['verify', 'in-implementation'],
  ];

  for (const [command, from] of cases) {
    test(`${command} from '${from}' is rejected`, () => {
      const r = validateTransition(command, from);
      assert.equal(r.ok, false);
      assert.match(r.reason, new RegExp(`'${command}'`));
      assert.match(r.reason, new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  }
});

test('validateTransition throws on an unknown command name', () => {
  assert.throws(() => validateTransition('nonexistent', 'draft'));
});

describe('validateApproval — the full approve gate', () => {
  const readyReview = () => ({
    verdict: 'ready-for-approval',
    unresolved_required_fixes: 0,
    unresolved_owner_decisions: 0,
    unresolved_needs_clarification: 0,
    spec_fingerprint: 'abc123',
  });

  test('rejects when task status is not draft (and not already approved)', () => {
    const r = validateApproval('blocked', readyReview(), 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /requires status 'draft'/);
  });

  test('idempotent no-op when task is already approved', () => {
    const r = validateApproval('approved', null, 'anything');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, true);
  });

  test('rejects approval without a review', () => {
    const r = validateApproval('draft', null, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /No review found/);
  });

  test('rejects approval when verdict is not ready-for-approval', () => {
    const r = validateApproval('draft', { ...readyReview(), verdict: 'changes-required' }, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /not 'ready-for-approval'/);
  });

  test('rejects approval with unresolved required fixes', () => {
    const r = validateApproval('draft', { ...readyReview(), unresolved_required_fixes: 1 }, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /unresolved items/);
  });

  test('rejects approval with unresolved owner decisions', () => {
    const r = validateApproval('draft', { ...readyReview(), unresolved_owner_decisions: 1 }, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /unresolved items/);
  });

  test('rejects approval with unresolved needs-clarification items', () => {
    const r = validateApproval('draft', { ...readyReview(), unresolved_needs_clarification: 1 }, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /unresolved items/);
  });

  test('rejects approval when the review predates the fingerprint field', () => {
    const review = readyReview();
    delete review.spec_fingerprint;
    const r = validateApproval('draft', review, 'abc123');
    assert.equal(r.ok, false);
    assert.match(r.reason, /spec_fingerprint/);
    assert.equal(r.code, 'missing-fingerprint');
  });

  test('rejects approval when the review fingerprint is stale (spec changed since review)', () => {
    const r = validateApproval('draft', readyReview(), 'a-different-hash');
    assert.equal(r.ok, false);
    assert.match(r.reason, /stale/);
    // handleApprove keys off this code (not the message text) to raise a
    // classified REC-07 RecoveryError — see tools/lib/cli-errors.mjs.
    assert.equal(r.code, 'stale-fingerprint');
  });

  test('approves successfully with a current, ready, fully-resolved review', () => {
    const r = validateApproval('draft', readyReview(), 'abc123');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });

  describe('task-level fingerprint (PR re-review packet 01) — only checked when taskId is passed', () => {
    test('skips the task-level check entirely when no taskId is passed (unchanged legacy behavior)', () => {
      const r = validateApproval('draft', readyReview(), 'abc123');
      assert.equal(r.ok, true);
    });

    test('rejects when the review has no task_fingerprints entry for this task at all', () => {
      const r = validateApproval('draft', readyReview(), 'abc123', { taskId: 't1', currentTaskFingerprint: 'tfp1' });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'missing-task-fingerprint');
      assert.match(r.reason, /task_fingerprints entry for 't1'/);
    });

    test('rejects when the review reviewed a different task set (entry present for another task only)', () => {
      const review = { ...readyReview(), task_fingerprints: { 'other-task': 'tfp-other' } };
      const r = validateApproval('draft', review, 'abc123', { taskId: 't1', currentTaskFingerprint: 'tfp1' });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'missing-task-fingerprint');
    });

    test('rejects when the recorded task fingerprint is stale (task body changed since review)', () => {
      const review = { ...readyReview(), task_fingerprints: { t1: 'tfp1-OLD' } };
      const r = validateApproval('draft', review, 'abc123', { taskId: 't1', currentTaskFingerprint: 'tfp1-NEW' });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'stale-task-fingerprint');
      assert.match(r.reason, /stale for task 't1'/);
    });

    test('an unrelated task changing does not stale a different task\'s own recorded fingerprint', () => {
      const review = { ...readyReview(), task_fingerprints: { t1: 'tfp1', t2: 'tfp2-OLD' } };
      const r = validateApproval('draft', review, 'abc123', { taskId: 't1', currentTaskFingerprint: 'tfp1' });
      assert.equal(r.ok, true);
    });

    test('approves when both the change-level and task-level fingerprints are current', () => {
      const review = { ...readyReview(), task_fingerprints: { t1: 'tfp1' } };
      const r = validateApproval('draft', review, 'abc123', { taskId: 't1', currentTaskFingerprint: 'tfp1' });
      assert.equal(r.ok, true);
      assert.equal(r.idempotent, false);
    });

    test('mechanicalExempt skips the task-level check too, same as the change-level/review checks', () => {
      const r = validateApproval('draft', null, 'abc123', {
        mechanicalExempt: true, taskId: 't1', currentTaskFingerprint: 'tfp1',
      });
      assert.equal(r.ok, true);
    });
  });
});

describe('validateFinalize — the finalize gate', () => {
  const doneChange = () => ({ tasks: [{ id: 't1', status: 'verified' }, { id: 't2', status: 'implemented' }] });
  const cleanFacts = () => ({
    gitClean: true,
    branch: { hasUpstream: true, ahead: 0, behind: 0 },
    ghAvailable: true,
    pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
    verification: [{ name: 'specs validate', passed: true }, { name: 'docs validate', passed: true }],
  });

  test('rejects when gh is unavailable, and never conflates that with "no PR exists"', () => {
    const facts = { ...cleanFacts(), ghAvailable: false, pr: null };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /gh CLI is not available/);
    assert.doesNotMatch(r.reason, /No pull request found/);
  });

  test('rejects when a task is not in a terminal status', () => {
    const change = { tasks: [{ id: 't1', status: 'in-implementation' }] };
    const r = validateFinalize(change, cleanFacts());
    assert.equal(r.ok, false);
    assert.match(r.reason, /not in a terminal status/);
    assert.match(r.reason, /t1/);
  });

  test('rejects a dirty working tree', () => {
    const r = validateFinalize(doneChange(), { ...cleanFacts(), gitClean: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /uncommitted changes/);
  });

  test('rejects when local branch is behind its remote', () => {
    const facts = { ...cleanFacts(), branch: { hasUpstream: true, ahead: 0, behind: 2 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /behind/);
  });

  test('rejects an unpushed branch (never pushed at all)', () => {
    const facts = { ...cleanFacts(), branch: { hasUpstream: false, ahead: null, behind: null } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /not yet been pushed|Push before finalizing/);
  });

  test('rejects when local commits are ahead but unpushed', () => {
    const facts = { ...cleanFacts(), branch: { hasUpstream: true, ahead: 1, behind: 0 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Push before finalizing/);
  });

  test('rejects when no PR exists for the branch', () => {
    const r = validateFinalize(doneChange(), { ...cleanFacts(), pr: null });
    assert.equal(r.ok, false);
    assert.match(r.reason, /No pull request found/);
  });

  test('idempotent no-op when the PR is already merged', () => {
    const facts = { ...cleanFacts(), pr: { number: 42, state: 'MERGED', isDraft: false, unresolvedThreads: 0 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, true);
  });

  test('rejects a draft PR', () => {
    const facts = { ...cleanFacts(), pr: { number: 42, state: 'OPEN', isDraft: true, unresolvedThreads: 0 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /draft/);
  });

  test('rejects a PR in an unexpected state (e.g. CLOSED without merging)', () => {
    const facts = { ...cleanFacts(), pr: { number: 42, state: 'CLOSED', isDraft: false, unresolvedThreads: 0 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /CLOSED/);
  });

  test('rejects when the PR has unresolved review threads', () => {
    const facts = { ...cleanFacts(), pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 3 } };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /3 unresolved review thread/);
  });

  test('rejects when a verification check failed', () => {
    const facts = {
      ...cleanFacts(),
      verification: [{ name: 'specs validate', passed: true }, { name: 'dotnet test', passed: false, detail: '2 failed' }],
    };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /dotnet test/);
    assert.match(r.reason, /2 failed/);
  });

  test('passes with a clean, pushed branch, an open PR with no unresolved threads, and green verification', () => {
    const r = validateFinalize(doneChange(), cleanFacts());
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });
});

describe('deriveStage — the whole-lifecycle navigator', () => {
  const emptyFacts = () => ({ pr: null, ghAvailable: true, verification: [] });
  const cleanPrFacts = () => ({
    pr: { number: 7, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
    ghAvailable: true,
    verification: [{ name: 'specs validate', passed: true }],
  });

  test('cannot-verify-pr (never needs-pr) when every task is terminal but gh is unavailable', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const facts = { pr: null, ghAvailable: false, verification: [] };
    const r = deriveStage(change, facts);
    assert.equal(r.stage, 'cannot-verify-pr');
    assert.doesNotMatch(r.detail, /No pull request found/);
  });

  test('needs-approval when any task is still draft, even if others are further along', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }, { id: 't2', status: 'draft' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'needs-approval');
    assert.match(r.nextCommand, /spec-review c1/);
  });

  test('ready-to-start when a task is approved but not yet started', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
    assert.match(r.nextCommand, /task-start c1 t1/);
  });

  test('in-progress when a task is in-implementation', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'in-implementation' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'in-progress');
    assert.match(r.nextCommand, /task-review c1 t1/);
  });

  test('draft beats approved beats in-implementation when several tasks are at different stages', () => {
    const change = {
      _slug: 'c1',
      tasks: [
        { id: 't1', status: 'in-implementation' },
        { id: 't2', status: 'approved' },
        { id: 't3', status: 'draft' },
      ],
    };
    assert.equal(deriveStage(change, emptyFacts()).stage, 'needs-approval');
  });

  test('needs-pr once every task is terminal but no PR exists yet', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'needs-pr');
    assert.match(r.nextCommand, /nevo-ai-github/);
  });

  test('done when the PR is already merged', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const facts = { pr: { number: 7, state: 'MERGED', isDraft: false, unresolvedThreads: 0 }, verification: [] };
    assert.equal(deriveStage(change, facts).stage, 'done');
  });

  test('pr-draft when the PR exists but is still a draft', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const facts = { pr: { number: 7, state: 'OPEN', isDraft: true, unresolvedThreads: 0 }, verification: [] };
    assert.equal(deriveStage(change, facts).stage, 'pr-draft');
  });

  test('needs-comment-resolution when the PR has unresolved review threads', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const facts = { pr: { number: 7, state: 'OPEN', isDraft: false, unresolvedThreads: 2 }, verification: [] };
    const r = deriveStage(change, facts);
    assert.equal(r.stage, 'needs-comment-resolution');
    assert.match(r.detail, /2 unresolved/);
  });

  test('needs-verification-fixes when the PR is otherwise clean but a check failed', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const facts = {
      pr: { number: 7, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
      verification: [{ name: 'dotnet test', passed: false, detail: '1 failed' }],
    };
    const r = deriveStage(change, facts);
    assert.equal(r.stage, 'needs-verification-fixes');
    assert.match(r.nextCommand, /dotnet test/);
  });

  test('ready-to-finalize when the PR is open, clean, and verification is green', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'verified' }] };
    const r = deriveStage(change, cleanPrFacts());
    assert.equal(r.stage, 'ready-to-finalize');
    assert.match(r.nextCommand, /spec-finalize c1/);
  });
});

describe('depsSatisfied — abandoned no longer satisfies a dependency (D6/requirement 4)', () => {
  const changeWith = depStatus => ({
    tasks: [{ id: 'dep', status: depStatus }, { id: 't', depends_on: ['dep'] }],
  });

  for (const status of ['implemented', 'verified', 'archived']) {
    test(`a '${status}' dependency satisfies depends_on`, () => {
      const change = changeWith(status);
      assert.equal(depsSatisfied(change.tasks[1], change), true);
    });
  }

  test("an 'abandoned' dependency does NOT satisfy depends_on", () => {
    const change = changeWith('abandoned');
    assert.equal(depsSatisfied(change.tasks[1], change), false);
  });

  test('a task with no depends_on is trivially satisfied', () => {
    const change = { tasks: [{ id: 't' }] };
    assert.equal(depsSatisfied(change.tasks[0], change), true);
  });
});

describe('status vocabulary — blocked/needs-decision removed outright (D16)', () => {
  test('removedStatusMessage names the value and points at execution.suspension', () => {
    assert.equal(
      removedStatusMessage('blocked'),
      'Status `blocked` is no longer supported. Use `execution.suspension`.'
    );
    assert.match(removedStatusMessage('needs-decision'), /needs-decision/);
    assert.match(removedStatusMessage('needs-decision'), /execution\.suspension/);
  });

  test('TASK_STATUSES and CHANGE_STATUSES no longer contain blocked/needs-decision', () => {
    assert.equal(TASK_STATUSES.has('blocked'), false);
    assert.equal(TASK_STATUSES.has('needs-decision'), false);
    assert.equal(CHANGE_STATUSES.has('blocked'), false);
    assert.equal(CHANGE_STATUSES.has('needs-decision'), false);
  });

  test('validateStatusValue rejects task status blocked with the fixed migration message', () => {
    const errors = [];
    validateStatusValue('blocked', TASK_STATUSES, errors, 'task t1.status');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Status `blocked` is no longer supported\. Use `execution\.suspension`\./);
  });

  test('validateStatusValue rejects change status needs-decision with the fixed migration message', () => {
    const errors = [];
    validateStatusValue('needs-decision', CHANGE_STATUSES, errors, 'change.status');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Status `needs-decision` is no longer supported\. Use `execution\.suspension`\./);
  });

  test('validateStatusValue accepts every remaining valid task status', () => {
    for (const status of TASK_STATUSES) {
      const errors = [];
      validateStatusValue(status, TASK_STATUSES, errors, 'task t1.status');
      assert.deepEqual(errors, []);
    }
  });

  test('validateStatusValue rejects an unrecognized status value that is not blocked/needs-decision either', () => {
    const errors = [];
    validateStatusValue('bogus-status', TASK_STATUSES, errors, 'task t1.status');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid status 'bogus-status'/);
  });

  test('validateStatusValue is a no-op when the value is absent', () => {
    const errors = [];
    validateStatusValue(undefined, TASK_STATUSES, errors, 'task t1.status');
    assert.deepEqual(errors, []);
  });
});

describe('deriveStage — suspension-aware reporting (D8, AC2)', () => {
  test('an approved task with a confirm-required suspension reports it instead of the default nextCommand', () => {
    const suspension = { kind: 'confirm-required', code: 'REC-07', previous_action: 'approve', created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved', execution: { suspension } }] };
    const r = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.equal(r.stage, 'ready-to-start');
    assert.match(r.detail, /Suspended: REC-07 \(confirm-required\)/);
    assert.match(r.nextCommand, /Confirm\/resolve REC-07/);
    assert.match(r.nextCommand, /retry approve/);
    assert.equal(r.suspension, suspension);
  });

  test('an in-implementation task with an owner-decision suspension reports "owner must resolve", not the default nextCommand', () => {
    const suspension = { kind: 'owner-decision', code: 'REC-06', previous_action: 'start', created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'in-implementation', execution: { suspension } }] };
    const r = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.equal(r.stage, 'in-progress');
    assert.doesNotMatch(r.nextCommand, /task-review/);
    assert.match(r.nextCommand, /Owner must resolve REC-06/);
  });

  test('an unsafe-manual suspension also reports "owner must resolve"', () => {
    const suspension = { kind: 'unsafe-manual', code: 'REC-09', previous_action: null, created_at: '2026-08-04T00:00:00Z' };
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved', execution: { suspension } }] };
    const r = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.match(r.nextCommand, /Owner must resolve REC-09/);
  });

  test('a task with no suspension reports the stage default nextCommand, unaffected', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', status: 'approved' }] };
    const r = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.match(r.nextCommand, /task-start c1 t1/);
    assert.equal(r.suspension, undefined);
  });
});

describe('deriveStage — self-check-aware reporting (D28, AC7)', () => {
  const inProgressChange = selfCheck => ({
    _slug: 'c1',
    tasks: [{ id: 't1', status: 'in-implementation', ...(selfCheck ? { self_check: selfCheck } : {}) }],
  });

  test('not-run: no self_check block', () => {
    const r = deriveStage(inProgressChange(null), { pr: null, ghAvailable: true, verification: [] });
    assert.deepEqual(r.selfCheck, { state: 'not-run' });
  });

  test('failed: status failed surfaces failed_criteria', () => {
    const selfCheck = { status: 'failed', failed_criteria: ['AC2', 'AC5'] };
    const r = deriveStage(inProgressChange(selfCheck), { pr: null, ghAvailable: true, verification: [] });
    assert.deepEqual(r.selfCheck, { state: 'failed', failedCriteria: ['AC2', 'AC5'] });
  });

  test('passed-and-fresh: status passed and fingerprint/revision match the current state', () => {
    const selfCheck = { status: 'passed', fingerprint: 'fp1', revision: 'rev1' };
    const facts = { pr: null, ghAvailable: true, verification: [], currentTaskState: { fingerprint: 'fp1', revision: 'rev1' } };
    const r = deriveStage(inProgressChange(selfCheck), facts);
    assert.deepEqual(r.selfCheck, { state: 'passed-and-fresh' });
  });

  test('passed-but-stale: status passed but fingerprint no longer matches the current state', () => {
    const selfCheck = { status: 'passed', fingerprint: 'fp1', revision: 'rev1' };
    const facts = { pr: null, ghAvailable: true, verification: [], currentTaskState: { fingerprint: 'fp2', revision: 'rev1' } };
    const r = deriveStage(inProgressChange(selfCheck), facts);
    assert.deepEqual(r.selfCheck, { state: 'passed-but-stale' });
  });

  test('passed-but-stale: status passed but current state is unknown (cannot confirm freshness)', () => {
    const selfCheck = { status: 'passed', fingerprint: 'fp1', revision: 'rev1' };
    const r = deriveStage(inProgressChange(selfCheck), { pr: null, ghAvailable: true, verification: [] });
    assert.deepEqual(r.selfCheck, { state: 'passed-but-stale' });
  });

  test('D33: global HEAD advancing alone (an unrelated later commit) never makes a fingerprint-unchanged self-check stale', () => {
    // Same scenario staleEvidenceTasks' own D33 regression already covers for
    // the batch gating review — describeSelfCheck must not regress the same
    // way for the single-task deriveStage path. Task A's self-check recorded
    // revision 'rev-A'; by the time deriveStage runs, task B's own later
    // commit has moved the repository's real HEAD to 'rev-B' — A's own
    // fingerprint is unchanged, so it must still read passed-and-fresh.
    const selfCheck = { status: 'passed', fingerprint: 'fp-a', revision: 'rev-A' };
    const facts = { pr: null, ghAvailable: true, verification: [], currentTaskState: { fingerprint: 'fp-a', revision: 'rev-B' } };
    const r = deriveStage(inProgressChange(selfCheck), facts);
    assert.deepEqual(r.selfCheck, { state: 'passed-and-fresh' });
  });
});

describe('scopeOf/isEndOfScope/nextInScope — authorized scope (AC4)', () => {
  test('a single-task scope is its own end', () => {
    const scope = scopeOf('t1');
    assert.equal(isEndOfScope(scope, 't1'), true);
    assert.equal(nextInScope(scope, 't1'), null);
  });

  test('a batch scope reports the next task until its last one', () => {
    const scope = scopeOf(['t1', 't2', 't3']);
    assert.equal(isEndOfScope(scope, 't1'), false);
    assert.equal(nextInScope(scope, 't1'), 't2');
    assert.equal(isEndOfScope(scope, 't2'), false);
    assert.equal(nextInScope(scope, 't2'), 't3');
    assert.equal(isEndOfScope(scope, 't3'), true);
    assert.equal(nextInScope(scope, 't3'), null);
  });

  test('a task outside the scope is treated as its end (never continues past it)', () => {
    const scope = scopeOf(['t1', 't2']);
    assert.equal(isEndOfScope(scope, 't9'), true);
    assert.equal(nextInScope(scope, 't9'), null);
  });
});

describe('planContinuation — the resume-and-continue controller (AC3, AC4)', () => {
  test('completed inside a multi-task scope continues to the next task', () => {
    const scope = scopeOf(['t1', 't2']);
    const r = planContinuation('completed', scope, 't1');
    assert.deepEqual(r, { action: 'continue', next: 't2' });
  });

  test('safe_to_retry inside a multi-task scope continues to the next task', () => {
    const scope = scopeOf(['t1', 't2']);
    const r = planContinuation('safe_to_retry', scope, 't1');
    assert.deepEqual(r, { action: 'continue', next: 't2' });
  });

  test('completed at the end of the scope stops — never continues past the authorized boundary', () => {
    const scope = scopeOf(['t1', 't2']);
    const r = planContinuation('completed', scope, 't2');
    assert.deepEqual(r, { action: 'stop', reason: 'end-of-scope' });
  });

  test('completed for a single-task scope stops at end-of-scope', () => {
    const r = planContinuation('completed', scopeOf('t1'), 't1');
    assert.deepEqual(r, { action: 'stop', reason: 'end-of-scope' });
  });

  for (const [result, reason] of [
    ['partially_completed', 'partially-completed'],
    ['not_retryable', 'not-retryable'],
    ['unsafe_manual', 'unsafe-manual'],
  ]) {
    test(`${result} always stops, even mid-scope with more tasks remaining`, () => {
      const scope = scopeOf(['t1', 't2', 't3']);
      const r = planContinuation(result, scope, 't1');
      assert.deepEqual(r, { action: 'stop', reason });
    });
  }

  test('an externalStopReason forces a stop regardless of the postcondition result', () => {
    const scope = scopeOf(['t1', 't2']);
    const r = planContinuation('completed', scope, 't1', { externalStopReason: 'failed-acceptance-criterion' });
    assert.deepEqual(r, { action: 'stop', reason: 'failed-acceptance-criterion' });
  });

  test('an unknown externalStopReason throws rather than silently continuing', () => {
    assert.throws(() => planContinuation('completed', scopeOf(['t1']), 't1', { externalStopReason: 'bogus' }));
  });

  test('an unknown postcondition result throws', () => {
    assert.throws(() => planContinuation('bogus', scopeOf(['t1']), 't1'));
  });
});

describe('stopReasonForSuspension', () => {
  test('REC-08 maps to scope-expansion', () => {
    assert.equal(stopReasonForSuspension({ code: 'REC-08', kind: 'owner-decision' }), 'scope-expansion');
  });

  test('REC-06 maps to unrelated-dirty-files', () => {
    assert.equal(stopReasonForSuspension({ code: 'REC-06', kind: 'owner-decision' }), 'unrelated-dirty-files');
  });

  test('an unsafe-manual suspension maps to unsafe-manual regardless of code', () => {
    assert.equal(stopReasonForSuspension({ code: 'REC-09', kind: 'unsafe-manual' }), 'unsafe-manual');
  });

  test('every mapped reason is a member of CONTINUATION_STOP_REASONS', () => {
    for (const reason of [
      stopReasonForSuspension({ code: 'REC-08', kind: 'owner-decision' }),
      stopReasonForSuspension({ code: 'REC-06', kind: 'owner-decision' }),
      stopReasonForSuspension({ code: 'REC-09', kind: 'unsafe-manual' }),
    ]) {
      assert.equal(CONTINUATION_STOP_REASONS.has(reason), true);
    }
  });
});

describe('nextSuspensionForNotRetryable — start requirement 4 (AC4)', () => {
  test('a pre-existing suspension produces a new one, reusing its code, previous_action: start, a fresh created_at', () => {
    const existing = { kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: '2020-01-01T00:00:00Z' };
    const next = nextSuspensionForNotRetryable(existing, '2026-08-06T12:00:00Z');
    assert.deepEqual(next, {
      kind: 'owner-decision', code: 'REC-05', previous_action: 'start', created_at: '2026-08-06T12:00:00Z',
    });
  });

  test('the new suspension never repeats the stale previous_action verbatim from an unrelated original action', () => {
    // Even if the stale suspension's own previous_action was something other
    // than 'start' (e.g. it was recorded by a different flow), the new one
    // always names 'start' — the action that just discovered the fresh
    // not_retryable situation — never a blind copy of the old value.
    const existing = { kind: 'owner-decision', code: 'REC-08', previous_action: 'approve', created_at: '2020-01-01T00:00:00Z' };
    const next = nextSuspensionForNotRetryable(existing, '2026-08-06T12:00:00Z');
    assert.equal(next.previous_action, 'start');
    assert.notEqual(next.previous_action, existing.previous_action);
  });

  test('no pre-existing suspension means nothing to do — returns null, not a fabricated suspension', () => {
    assert.equal(nextSuspensionForNotRetryable(undefined, '2026-08-06T12:00:00Z'), null);
    assert.equal(nextSuspensionForNotRetryable(null, '2026-08-06T12:00:00Z'), null);
  });

  test('defaults `now` to the real current time when not injected', () => {
    const before = Date.now();
    const next = nextSuspensionForNotRetryable({ code: 'REC-06' });
    const after = Date.now();
    const createdAtMs = Date.parse(next.created_at);
    assert.ok(createdAtMs >= before && createdAtMs <= after, 'created_at must fall within the call window');
  });
});

describe('resolveAfterConfirmedRepair — D17 resume-in-place (AC5, AC6)', () => {
  test('a repair that fully resolves the block returns the fresh completed/safe_to_retry result, resumed', () => {
    const fresh = { result: 'safe_to_retry', missing: ['status'] };
    const r = resolveAfterConfirmedRepair(fresh);
    assert.equal(r.result, 'safe_to_retry');
    assert.deepEqual(r.missing, ['status']);
    assert.equal(r.resumed, true);
  });

  test('a repair that does not resolve the block never re-offers confirm-required — it becomes a fresh not_retryable', () => {
    const fresh = { result: 'not_retryable', missing: [], reason: 'still dirty' };
    const r = resolveAfterConfirmedRepair(fresh);
    assert.equal(r.result, 'not_retryable');
    assert.equal(r.resumed, true);
    assert.match(r.reason, /Confirmed repair did not resolve/);
    assert.match(r.reason, /still dirty/);
  });

  test('a repair that reveals an unsafe-manual situation passes it through as unsafe_manual, not a repeated prompt', () => {
    const fresh = { result: 'unsafe_manual', missing: [], reason: 'ADR conflict found' };
    const r = resolveAfterConfirmedRepair(fresh);
    assert.equal(r.result, 'unsafe_manual');
    assert.equal(r.resumed, true);
  });

  test('D17 end-to-end: a confirm-required REC-05 stop inside approve->start resumes in place after one confirmation', () => {
    // Step 1 (approve) already succeeded — an authorized combined transition.
    const approveResult = validateApproval('draft', {
      verdict: 'ready-for-approval', unresolved_required_fixes: 0, unresolved_owner_decisions: 0,
      unresolved_needs_clarification: 0, spec_fingerprint: 'fp1',
    }, 'fp1');
    const approveInspection = inspectApprovePostconditions(approveResult);
    assert.equal(approveInspection.result, 'safe_to_retry');

    // Step 2 (start) hits a REC-05 confirm-required stop: dirty worktree, but
    // every dirty file is inside the task's own allowed_paths.
    const allowedPaths = ['tools/specs/lifecycle.mjs'];
    let dirtyFiles = ['tools/specs/lifecycle.mjs'];
    const classification = classifyDirtyWorktree(dirtyFiles, allowedPaths);
    assert.deepEqual(classification, { code: 'REC-05', class: 'confirm-required', files: dirtyFiles });

    // Owner confirms once; the repair (commit the file) is applied, and the
    // worktree is re-inspected from fresh state — this re-invocation is the
    // resumable recovery handle.
    dirtyFiles = []; // repair applied: the task-related file was committed
    const reclassification = classifyDirtyWorktree(dirtyFiles, allowedPaths);
    assert.equal(reclassification, null); // clean — normalize to a postcondition-shaped result
    const freshStartInspection = inspectStartPostconditions({
      taskStatus: 'approved', depsOk: true, onExpectedBranch: false,
      localBranchExists: false, remoteBranchExists: false, unsatisfiedDeps: [],
    });
    const resumed = resolveAfterConfirmedRepair(freshStartInspection);

    // Resolved without a second confirmation — the authorized sequence
    // (approve -> start) continues, executing only the still-missing effects.
    assert.equal(resumed.result, 'safe_to_retry');
    assert.deepEqual(resumed.missing, ['branch', 'status']);
    assert.equal(resumed.resumed, true);

    const continuation = planContinuation(resumed.result, scopeOf('t1'), 't1');
    assert.deepEqual(continuation, { action: 'stop', reason: 'end-of-scope' });
  });

  test('D17/AC6: if the confirmed repair still leaves the worktree dirty, it never re-offers the same confirm-required prompt', () => {
    const allowedPaths = ['tools/specs/lifecycle.mjs'];
    // Repair was supposed to commit the file but didn't fully — still dirty.
    const stillDirty = classifyDirtyWorktree(['tools/specs/lifecycle.mjs'], allowedPaths);
    // Normalize the still-blocked classification into a postcondition-shaped
    // result the way REC-05/06 do outside inspectStartPostconditions, then
    // resolve it — this must never come back out as another confirm-required.
    const asInspection = { result: 'not_retryable', missing: [], reason: `Dirty file(s): ${stillDirty.files.join(', ')}` };
    const resumed = resolveAfterConfirmedRepair(asInspection);
    assert.equal(resumed.result, 'not_retryable');
    assert.notEqual(resumed.result, 'confirm-required');
    assert.equal(resumed.resumed, true);
  });
});
