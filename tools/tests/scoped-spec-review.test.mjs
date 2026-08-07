// Tests for task 17 (scoped-and-incremental-spec-review, D34/D35, area
// scoped-spec-review): resolveSpecReviewScope, selectChangedTaskIds,
// findPotentiallyImpactedOutOfScopeTasks, scopedReviewBaselineValid, and
// renderScopedSpecReviewBody — all pure functions in tools/specs/lifecycle.mjs.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSpecReviewScope, selectChangedTaskIds, findPotentiallyImpactedOutOfScopeTasks,
  scopedReviewBaselineValid, renderScopedSpecReviewBody,
} from '../specs/lifecycle.mjs';

function fixtureChange() {
  return {
    tasks: [
      { id: 't1', order: 1 }, { id: 't2', order: 2 }, { id: 't3', order: 3 }, { id: 't4', order: 4 },
    ],
  };
}

// ── resolveSpecReviewScope (AC1, AC2) ───────────────────────────────────────

describe('resolveSpecReviewScope — --all/--tasks/--changed resolution (AC1)', () => {
  test('--all resolves to every task in the change', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { all: true });
    assert.deepEqual(result, { ok: true, mode: 'all', taskIds: ['t1', 't2', 't3', 't4'] });
  });

  test('--tasks 2-3 (order range) resolves to the correct task ids', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { tasks: '2-3' });
    assert.deepEqual(result, { ok: true, mode: 'tasks', taskIds: ['t2', 't3'] });
  });

  test('--tasks 1,3 (order list) resolves to the correct, deduplicated task ids', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { tasks: '1,3,3' });
    assert.deepEqual(result, { ok: true, mode: 'tasks', taskIds: ['t1', 't3'] });
  });

  test('an unresolvable order number is reported by name, never silently dropped', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { tasks: '1,99' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /order 99/);
  });

  test('--changed resolves to exactly the caller-supplied changedTaskIds', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { changed: true, changedTaskIds: ['t2', 't4'] });
    assert.deepEqual(result, { ok: true, mode: 'changed', taskIds: ['t2', 't4'] });
  });

  test('zero flags given is rejected — no implicit default from this function itself (AC1)', () => {
    const result = resolveSpecReviewScope(fixtureChange(), {});
    assert.equal(result.ok, false);
  });

  test('more than one flag given is rejected', () => {
    const result = resolveSpecReviewScope(fixtureChange(), { all: true, tasks: '1-2' });
    assert.equal(result.ok, false);
  });
});

// ── selectChangedTaskIds (AC3) ───────────────────────────────────────────────

describe('selectChangedTaskIds — fingerprint-based, never re-derived from prose (AC3)', () => {
  test('a task whose current fingerprint matches the prior review is not selected', () => {
    const selected = selectChangedTaskIds(['t1', 't2'], { t1: 'a', t2: 'b' }, { t1: 'a', t2: 'b' });
    assert.deepEqual(selected, []);
  });

  test('a task whose fingerprint changed is selected', () => {
    const selected = selectChangedTaskIds(['t1', 't2'], { t1: 'a', t2: 'b' }, { t1: 'a', t2: 'CHANGED' });
    assert.deepEqual(selected, ['t2']);
  });

  test('a genuinely new task (no prior entry) is selected', () => {
    const selected = selectChangedTaskIds(['t1', 't2'], { t1: 'a' }, { t1: 'a', t2: 'new' });
    assert.deepEqual(selected, ['t2']);
  });
});

// ── findPotentiallyImpactedOutOfScopeTasks (AC5) ────────────────────────────

describe('findPotentiallyImpactedOutOfScopeTasks — named, never silently re-reviewed or ignored (AC5)', () => {
  test('a selected task naming an out-of-scope task in dependency_contracts is reported', () => {
    const impacted = findPotentiallyImpactedOutOfScopeTasks(['t2'], { t2: ['t1'] });
    assert.deepEqual(impacted, ['t1']);
  });

  test('a dependency_contracts reference to another in-scope task is not reported', () => {
    const impacted = findPotentiallyImpactedOutOfScopeTasks(['t1', 't2'], { t2: ['t1'] });
    assert.deepEqual(impacted, []);
  });

  test('no relationships at all reports nothing', () => {
    assert.deepEqual(findPotentiallyImpactedOutOfScopeTasks(['t1'], {}), []);
  });
});

// ── scopedReviewBaselineValid (AC6) ─────────────────────────────────────────

describe('scopedReviewBaselineValid — whole-change readiness requires every out-of-scope baseline to still hold (AC6)', () => {
  test('every out-of-scope task with a matching fingerprint is valid', () => {
    const result = scopedReviewBaselineValid(['t1', 't2'], { t1: 'a', t2: 'b' }, { t1: 'a', t2: 'b' });
    assert.deepEqual(result, { valid: true, invalidTaskIds: [] });
  });

  test('one out-of-scope task with a changed fingerprint invalidates the whole-change claim, named', () => {
    const result = scopedReviewBaselineValid(['t1', 't2'], { t1: 'a', t2: 'b' }, { t1: 'a', t2: 'CHANGED' });
    assert.deepEqual(result, { valid: false, invalidTaskIds: ['t2'] });
  });

  test('a checkable out-of-scope task with no prior fingerprint at all is invalid, not silently skipped', () => {
    const result = scopedReviewBaselineValid(['t1'], {}, { t1: 'a' });
    assert.deepEqual(result, { valid: false, invalidTaskIds: ['t1'] });
  });
});

// ── renderScopedSpecReviewBody (AC7) ────────────────────────────────────────

describe('renderScopedSpecReviewBody — task 14\'s compact shape, adapted to spec-review\'s own verdict vocabulary (AC7)', () => {
  test('a fully-passing ready-for-approval result renders the compact checklist', () => {
    const body = renderScopedSpecReviewBody({
      status: 'ready-for-approval', unresolvedRequiredFixes: 0, unresolvedOwnerDecisions: 0, unresolvedNeedsClarification: 0,
    }, { title: 'Review: change (scoped)' });
    assert.match(body, /No unresolved required fix/);
    assert.match(body, /Verdict: ready-for-approval/);
  });

  test('approved-for-implementation is also accepted as a passing status', () => {
    const body = renderScopedSpecReviewBody({
      status: 'approved-for-implementation', unresolvedRequiredFixes: 0, unresolvedOwnerDecisions: 0, unresolvedNeedsClarification: 0,
    }, { title: 'x' });
    assert.match(body, /Verdict: approved-for-implementation/);
  });

  test('throws for a non-passing status rather than silently rendering a false-positive checklist', () => {
    assert.throws(() => renderScopedSpecReviewBody({ status: 'changes-required', unresolvedRequiredFixes: 1 }, { title: 'x' }));
  });

  test('throws when the status is passing-shaped but an unresolved count is nonzero', () => {
    assert.throws(() => renderScopedSpecReviewBody({ status: 'ready-for-approval', unresolvedOwnerDecisions: 1 }, { title: 'x' }));
  });
});
