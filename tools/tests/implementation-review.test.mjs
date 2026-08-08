// Tests for /nevo-ai:implementation-review's deterministic surface (D30, task
// 12, area implementation-review-orchestration): tools/specs/lifecycle.mjs's
// parseTaskOrderSpec/resolveReviewScope/computeMultiTaskReviewVerdict/
// selectEligibleForVerification/computeBulkTransitionTarget/
// validateBulkTransition, and tools/specs/service.mjs's writeBulkTransition.
// The per-task review depth itself is task-review's own flow, reused
// verbatim (not reimplemented) — there is nothing to unit-test for that
// reuse beyond what tools/tests/batch.test.mjs already covers for the
// cross-task integration functions this area also reuses
// (attributeTouchedPaths/detectBatchIntegrationFindings). Run: node --test
// tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseTaskOrderSpec, resolveReviewScope, MULTI_REVIEW_ELIGIBLE_STATUSES,
  computeMultiTaskReviewVerdict, MULTI_TASK_REVIEW_VERDICTS,
  selectEligibleForVerification,
  computeBulkTransitionTarget, validateBulkTransition, MULTI_REVIEW_OUTCOMES,
  attributeTouchedPaths, detectBatchIntegrationFindings,
  validateAggregateAgainstCanonicalReviews,
} from '../specs/lifecycle.mjs';
import { loadChange, writeBulkTransition } from '../specs/service.mjs';

// ── parseTaskOrderSpec / resolveReviewScope (AC1, AC2) ──────────────────────

function scopeFixture() {
  return {
    tasks: [
      { id: 'a', order: 1, status: 'draft' },
      { id: 'b', order: 2, status: 'approved' },
      { id: 'c', order: 3, status: 'in-implementation' },
      { id: 'd', order: 4, status: 'implemented' },
      { id: 'e', order: 5, status: 'verified' },
      { id: 'f', order: 6, status: 'abandoned' },
      { id: 'g', order: 7, status: 'archived' },
    ],
  };
}

describe('parseTaskOrderSpec — dash range or comma list, never mixed (AC1)', () => {
  test('a dash range resolves to every order in between, inclusive', () => {
    assert.deepEqual(parseTaskOrderSpec('01-03'), { ok: true, orders: [1, 2, 3] });
  });

  test('an inverted range is rejected', () => {
    const r = parseTaskOrderSpec('05-02');
    assert.equal(r.ok, false);
    assert.match(r.reason, /start \(5\) is after end \(2\)/);
  });

  test('a comma list resolves to exactly those orders, deduplicated', () => {
    assert.deepEqual(parseTaskOrderSpec('01,03,07,03'), { ok: true, orders: [1, 3, 7] });
  });

  test('a malformed spec is rejected, naming the expected shapes', () => {
    const r = parseTaskOrderSpec('01-03,07');
    assert.equal(r.ok, false);
    assert.match(r.reason, /dash range.*comma list/);
  });
});

describe('resolveReviewScope — deterministic, eligibility-checked scope resolution (AC1, AC2)', () => {
  test('requires exactly one of --all/--tasks', () => {
    assert.equal(resolveReviewScope(scopeFixture(), {}).ok, false);
    assert.equal(resolveReviewScope(scopeFixture(), { all: true, tasks: '01-02' }).ok, false);
  });

  test('--all selects every task in order-id order', () => {
    const r = resolveReviewScope({ tasks: [
      { id: 'c', order: 3, status: 'implemented' },
      { id: 'a', order: 1, status: 'implemented' },
      { id: 'b', order: 2, status: 'implemented' },
    ] }, { all: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });

  test('--tasks 01-03 (a range) resolves to the correct task id list, in order', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '03-05' }); // c, d, e are all eligible
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['c', 'd', 'e']);
  });

  test('--tasks 01,03,07 (a list) resolves to the correct, deduplicated task id list', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '3,5,7' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['c', 'e', 'g']);
  });

  test('an order number with no matching task is reported by name, never silently dropped or included (AC1)', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '3,99' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /Order number\(s\) not found.*99/);
  });

  test('a selected task whose status is draft is rejected, naming the task and its status (AC2)', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '1' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /'a' \(draft\)/);
  });

  test('a selected task whose status is approved is rejected (AC2)', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '2' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /'b' \(approved\)/);
  });

  test('a selected task whose status is abandoned is rejected (AC2)', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '6' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /'f' \(abandoned\)/);
  });

  test('in-implementation/implemented/verified/archived are all eligible', () => {
    const r = resolveReviewScope(scopeFixture(), { tasks: '3-5' });
    assert.equal(r.ok, true);
    for (const id of r.orderedTasks) {
      const status = scopeFixture().tasks.find(t => t.id === id).status;
      assert.equal(MULTI_REVIEW_ELIGIBLE_STATUSES.has(status), true);
    }
  });
});

// ── validateAggregateAgainstCanonicalReviews — aggregate/per-task consistency guard ─

function cleanReview(overrides = {}) {
  return {
    verdict: 'pass', unresolvedRequiredFixes: 0, unresolvedOwnerDecisions: 0, unresolvedNeedsClarification: 0,
    ...overrides,
  };
}

describe('validateAggregateAgainstCanonicalReviews — the aggregate must never contradict its own per-task artifacts', () => {
  test('every task pass, aggregate agrees: ok', () => {
    const perTaskReviews = { a: cleanReview(), b: cleanReview() };
    const aggregateRow = { a: 'pass', b: 'pass' };
    assert.deepEqual(validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow), { ok: true });
  });

  test('a missing canonical review artifact is rejected by name', () => {
    const perTaskReviews = { a: cleanReview(), b: null };
    const aggregateRow = { a: 'pass', b: 'pass' };
    const r = validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow);
    assert.equal(r.ok, false);
    assert.match(r.reason, /'b'.*no canonical review artifact/);
  });

  test('a review claiming pass with unresolved findings recorded is rejected as internally inconsistent (the exact bug this guard exists to catch)', () => {
    const perTaskReviews = { a: cleanReview({ verdict: 'pass', unresolvedRequiredFixes: 1 }) };
    const aggregateRow = { a: 'pass' };
    const r = validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow);
    assert.equal(r.ok, false);
    assert.match(r.reason, /'a'.*internally inconsistent/);
  });

  test('a review claiming changes-required with zero unresolved findings recorded is rejected as internally inconsistent', () => {
    // The real bug found 2026-08-06: a per-task review's frontmatter verdict
    // said changes-required while its own unresolved counts were all 0 —
    // the body text had been updated to pass, the frontmatter verdict field
    // hadn't.
    const perTaskReviews = { a: cleanReview({ verdict: 'changes-required' }) };
    const aggregateRow = { a: 'changes-required' };
    const r = validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow);
    assert.equal(r.ok, false);
    assert.match(r.reason, /'a'.*internally inconsistent/);
  });

  test('the aggregate row disagreeing with an internally-consistent canonical review is rejected, naming both values', () => {
    const perTaskReviews = { a: cleanReview({ verdict: 'changes-required', unresolvedRequiredFixes: 1 }) };
    const aggregateRow = { a: 'pass' };
    const r = validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow);
    assert.equal(r.ok, false);
    assert.match(r.reason, /'a'.*claims 'pass'.*says 'changes-required'/);
  });

  test('an owner-decision-classified unresolved count alone (no required fixes) still makes a pass verdict inconsistent', () => {
    const perTaskReviews = { a: cleanReview({ verdict: 'pass', unresolvedOwnerDecisions: 1 }) };
    const aggregateRow = { a: 'pass' };
    assert.equal(validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow).ok, false);
  });

  test('checks tasks in aggregateRow key order and reports the first disagreement', () => {
    const perTaskReviews = { a: cleanReview(), b: null, c: null };
    const aggregateRow = { a: 'pass', b: 'pass', c: 'pass' };
    const r = validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow);
    assert.match(r.reason, /'b'/);
  });
});

// ── computeMultiTaskReviewVerdict — explicit table (AC6) ────────────────────

describe('computeMultiTaskReviewVerdict — explicit table, never composed as prose (AC6)', () => {
  test('every value is a member of MULTI_TASK_REVIEW_VERDICTS', () => {
    for (const v of [
      computeMultiTaskReviewVerdict({}),
      computeMultiTaskReviewVerdict({ validationFailed: true }),
      computeMultiTaskReviewVerdict({ taskVerdicts: ['blocked'] }),
      computeMultiTaskReviewVerdict({ ownerDecisionFindings: 1 }),
      computeMultiTaskReviewVerdict({ taskVerdicts: ['changes-required'] }),
    ]) {
      assert.equal(MULTI_TASK_REVIEW_VERDICTS.has(v), true);
    }
  });

  test('no findings, every task passing: pass', () => {
    assert.equal(computeMultiTaskReviewVerdict({ taskVerdicts: ['pass', 'pass'] }), 'pass');
  });

  test('a failed validate forces blocked regardless of task verdicts', () => {
    assert.equal(
      computeMultiTaskReviewVerdict({ validationFailed: true, taskVerdicts: ['pass', 'pass'] }),
      'blocked'
    );
  });

  test('a single blocked per-task verdict forces the overall verdict to blocked, regardless of every other task\'s outcome (AC6)', () => {
    assert.equal(
      computeMultiTaskReviewVerdict({ taskVerdicts: ['pass', 'blocked', 'changes-required'] }),
      'blocked'
    );
  });

  test('an unresolved owner-decision finding wins over changes-required (row 3 before row 4)', () => {
    assert.equal(
      computeMultiTaskReviewVerdict({ taskVerdicts: ['changes-required'], ownerDecisionFindings: 1 }),
      'owner-decision-required'
    );
  });

  test('a changes-required per-task verdict, with no owner-decision finding, is changes-required', () => {
    assert.equal(computeMultiTaskReviewVerdict({ taskVerdicts: ['pass', 'changes-required'] }), 'changes-required');
  });

  test('an unresolved cross-task AUTO_FIX finding alone (every task itself passing) is changes-required', () => {
    assert.equal(computeMultiTaskReviewVerdict({ taskVerdicts: ['pass'], autoFixFindings: 1 }), 'changes-required');
  });
});

// ── selectEligibleForVerification (AC7) ─────────────────────────────────────

describe('selectEligibleForVerification — pass and zero unresolved blocking findings, at either level (AC7)', () => {
  test('a passing task with no blocking findings is eligible', () => {
    const eligible = selectEligibleForVerification([{ id: 'a', verdict: 'pass', blockingFindings: 0 }]);
    assert.deepEqual(eligible, ['a']);
  });

  test('a passing task with an unresolved cross-task blocking finding is not eligible', () => {
    const eligible = selectEligibleForVerification([{ id: 'a', verdict: 'pass', blockingFindings: 1 }]);
    assert.deepEqual(eligible, []);
  });

  test('a changes-required or blocked task is never eligible, regardless of blockingFindings', () => {
    const eligible = selectEligibleForVerification([
      { id: 'a', verdict: 'changes-required', blockingFindings: 0 },
      { id: 'b', verdict: 'blocked', blockingFindings: 0 },
    ]);
    assert.deepEqual(eligible, []);
  });

  test('a mixed set returns only the genuinely eligible subset', () => {
    const eligible = selectEligibleForVerification([
      { id: 'a', verdict: 'pass', blockingFindings: 0 },
      { id: 'b', verdict: 'pass', blockingFindings: 1 },
      { id: 'c', verdict: 'changes-required', blockingFindings: 0 },
    ]);
    assert.deepEqual(eligible, ['a']);
  });
});

// ── computeBulkTransitionTarget / validateBulkTransition (AC8, AC9) ─────────

describe('computeBulkTransitionTarget — per-task target status for a chosen outcome', () => {
  test('rejects an unknown outcome', () => {
    const r = computeBulkTransitionTarget('implemented', 'bogus');
    assert.equal(r.ok, false);
    assert.match(r.reason, /Unknown outcome/);
  });

  test('self-verified: in-implementation becomes implemented', () => {
    assert.deepEqual(computeBulkTransitionTarget('in-implementation', 'self-verified'), { ok: true, to: 'implemented', noop: false });
  });

  test('self-verified: an already-implemented task is a no-op', () => {
    assert.deepEqual(computeBulkTransitionTarget('implemented', 'self-verified'), { ok: true, to: 'implemented', noop: true });
  });

  test('self-verified: an already-verified task is a no-op, never regressed', () => {
    assert.deepEqual(computeBulkTransitionTarget('verified', 'self-verified'), { ok: true, to: 'verified', noop: true });
  });

  test('self-verified: an ineligible status is rejected', () => {
    assert.equal(computeBulkTransitionTarget('draft', 'self-verified').ok, false);
  });

  test('verified: in-implementation hops straight to verified in one computed transition', () => {
    assert.deepEqual(computeBulkTransitionTarget('in-implementation', 'verified'), { ok: true, to: 'verified', noop: false });
  });

  test('verified: implemented becomes verified', () => {
    assert.deepEqual(computeBulkTransitionTarget('implemented', 'verified'), { ok: true, to: 'verified', noop: false });
  });

  test('verified: an already-verified task is a no-op', () => {
    assert.deepEqual(computeBulkTransitionTarget('verified', 'verified'), { ok: true, to: 'verified', noop: true });
  });

  test('an archived task is always a no-op, regardless of outcome', () => {
    assert.deepEqual(computeBulkTransitionTarget('archived', 'self-verified'), { ok: true, to: 'archived', noop: true });
    assert.deepEqual(computeBulkTransitionTarget('archived', 'verified'), { ok: true, to: 'archived', noop: true });
  });

  test('every real MULTI_REVIEW_OUTCOMES value is handled', () => {
    for (const outcome of MULTI_REVIEW_OUTCOMES) {
      assert.equal(computeBulkTransitionTarget('implemented', outcome).ok, true);
    }
  });
});

describe('validateBulkTransition — all-or-nothing, hard-stop-aware (AC8, AC9)', () => {
  function change(tasks) {
    return { tasks };
  }

  test('a mixed-status eligible set all reaches the correct target status under "verified" in one computed batch, without regressing an already-verified task (AC9)', () => {
    const c = change([
      { id: 'a', status: 'in-implementation' },
      { id: 'b', status: 'implemented' },
      { id: 'c', status: 'verified' },
    ]);
    const r = validateBulkTransition(c, ['a', 'b', 'c'], 'verified');
    assert.equal(r.ok, true);
    assert.deepEqual(r.transitions, [
      { id: 'a', from: 'in-implementation', to: 'verified', noop: false },
      { id: 'b', from: 'implemented', to: 'verified', noop: false },
      { id: 'c', from: 'verified', to: 'verified', noop: true },
    ]);
  });

  test('an in-implementation task with a failed self-check is rejected (same hard-stop complete performs standalone)', () => {
    const c = change([{ id: 'a', status: 'in-implementation', self_check: { status: 'failed', failed_criteria: ['AC1'] } }]);
    const r = validateBulkTransition(c, ['a'], 'self-verified');
    assert.equal(r.ok, false);
    assert.match(r.reason, /hard-stopped self-check/);
  });

  test('an in-implementation task with no self_check at all is NOT hard-stopped outside a batch (matches complete\'s own out-of-batch behavior)', () => {
    const c = change([{ id: 'a', status: 'in-implementation' }]);
    const r = validateBulkTransition(c, ['a'], 'self-verified');
    assert.equal(r.ok, true);
  });

  test('one invalid task rejects the whole operation before anything would be written — no partial transitions list (AC8)', () => {
    const c = change([
      { id: 'a', status: 'implemented' },
      { id: 'b', status: 'draft' }, // invalid for either outcome
    ]);
    const r = validateBulkTransition(c, ['a', 'b'], 'verified');
    assert.equal(r.ok, false);
    assert.match(r.reason, /'b':/);
  });

  test('an unknown task id is rejected by name', () => {
    const r = validateBulkTransition(change([{ id: 'a', status: 'implemented' }]), ['ghost'], 'verified');
    assert.equal(r.ok, false);
    assert.match(r.reason, /not found/);
  });
});

// ── writeBulkTransition — one atomic change.yaml write (AC8) ────────────────

describe('writeBulkTransition — exactly one change.yaml write covering every eligible task (AC8)', () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-bulk-transition-test-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  function writeFixture(slug) {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), [
      'id: fixture',
      'title: Fixture',
      'status: draft',
      'tasks:',
      '  - id: task-a',
      '    status: in-implementation',
      '  - id: task-b',
      '    status: implemented',
      '  - id: task-c',
      '    status: verified',
      '',
    ].join('\n'));
    return loadChange(slug, root);
  }

  test('applies every non-noop transition in one write; a noop entry is never rewritten', () => {
    const change = writeFixture('mixed');
    const validated = validateBulkTransition(change, ['task-a', 'task-b', 'task-c'], 'verified');
    assert.equal(validated.ok, true);

    writeBulkTransition(change, validated.transitions);

    const reloaded = loadChange('mixed', root);
    assert.equal(reloaded.tasks.find(t => t.id === 'task-a').status, 'verified');
    assert.equal(reloaded.tasks.find(t => t.id === 'task-b').status, 'verified');
    assert.equal(reloaded.tasks.find(t => t.id === 'task-c').status, 'verified'); // unchanged, still verified
  });

  test('a self-verified outcome never regresses an already-implemented/verified task', () => {
    const change = writeFixture('self-verified-noop');
    const validated = validateBulkTransition(change, ['task-b', 'task-c'], 'self-verified');
    assert.equal(validated.ok, true);
    writeBulkTransition(change, validated.transitions);

    const reloaded = loadChange('self-verified-noop', root);
    assert.equal(reloaded.tasks.find(t => t.id === 'task-b').status, 'implemented');
    assert.equal(reloaded.tasks.find(t => t.id === 'task-c').status, 'verified');
  });
});

// ── Cross-task integration reuse (area requirement 7 — reused, not reimplemented) ──

describe('cross-task integration pass reuses attributeTouchedPaths/detectBatchIntegrationFindings verbatim (requirement 7)', () => {
  test('two in-scope tasks whose attributed touched paths overlap produce an integration finding, never a re-evaluation of either task\'s own acceptance criteria', () => {
    const touchedPaths = attributeTouchedPaths(
      ['task-a', 'task-b'],
      { 'task-a': ['tools/shared.mjs'], 'task-b': ['tools/shared.mjs'] },
      ['tools/shared.mjs']
    );
    const findings = detectBatchIntegrationFindings({ temporaryInconsistencies: [] }, ['task-a', 'task-b'], touchedPaths);
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].tasks, ['task-a', 'task-b']);
    assert.equal(findings[0].category, 'integration');
    // No acceptance-criteria-shaped field exists on the finding at all.
    assert.equal('acceptanceCriteria' in findings[0], false);
  });
});
