// Tests for the centralized task state machine in tools/specs/lifecycle.mjs
// (draft -> approved -> in-implementation -> implemented -> verified).
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateTransition, validateApproval, validateFinalize, TRANSITIONS } from '../specs/lifecycle.mjs';

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
  });

  test('rejects approval when the review fingerprint is stale (spec changed since review)', () => {
    const r = validateApproval('draft', readyReview(), 'a-different-hash');
    assert.equal(r.ok, false);
    assert.match(r.reason, /stale/);
  });

  test('approves successfully with a current, ready, fully-resolved review', () => {
    const r = validateApproval('draft', readyReview(), 'abc123');
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });
});

describe('validateFinalize — the finalize gate', () => {
  const doneChange = () => ({ tasks: [{ id: 't1', status: 'verified' }, { id: 't2', status: 'implemented' }] });
  const cleanFacts = () => ({
    gitClean: true,
    branch: { hasUpstream: true, ahead: 0, behind: 0 },
    pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
    verification: [{ name: 'specs validate', passed: true }, { name: 'docs validate', passed: true }],
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
