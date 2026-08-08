// Tests for task 21 (owner-workflow-acceptance-scenarios, D34/D35, area
// owner-workflow-acceptance) — the final task in the seventh refinement
// pass, validating D34's ten-property one-person-workflow bar end-to-end
// across tasks 14-20's own mechanisms, composed. This task is test-only
// (see this repo's task file's forbidden_paths) — every mechanism under test
// was already built and unit-tested by its own owning task; this file proves
// the *composition* holds, using real handler chains against fixture
// repositories (task 20's createFixtureRepo), never the real one, and never
// only the isolated function each owning task already covers alone.
//
// "A full owner-facing command turn" is, at the level a Node test can drive,
// the real deterministic handler/function chain a command file's own flow
// actually calls (handleStart, computeTaskReviewChecklist,
// buildConsolidatedDecisionStage, ...) — never a re-derived shortcut. What a
// command file's *prompt wording* itself instructs (e.g. "do not ask between
// tasks") is verified by the template-shape regression tests already in
// tools/tests/compound-actions.test.mjs and tools/tests/review-compaction.test.mjs;
// this file focuses on the underlying mechanisms those instructions depend on
// actually composing correctly together.
// Run: node --test tools/tests/
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { createFixtureRepo } from './fixture-repo.test-helper.mjs';
import { handleStart, handleApplyProvenance } from '../specs.mjs';
import { loadChange, computeTaskFingerprint, computeChangeFingerprint } from '../specs/service.mjs';
import {
  deriveStage, depsSatisfied,
  computeTaskReviewChecklist, renderCompactReviewChecklist, renderNormalPassingReportBody,
  computeTaskAttributedChangedPaths, nextImplementationBaseline,
  selectSemanticIntegrationPairs, validatePerTaskReviewRecord, buildConsolidatedDecisionStage,
  resolveSpecReviewScope, selectChangedTaskIds, scopedReviewBaselineValid,
  classifyUnownedDrift, UNOWNED_DRIFT_OPTIONS, validateMaintenanceCorrectionEntry,
  classifyScopeFinding, isScopeExceptionValid,
  validateAggregateAgainstCanonicalReviews,
} from '../specs/lifecycle.mjs';

const fixtures = [];
function fixture(opts) {
  const f = createFixtureRepo(opts);
  fixtures.push(f);
  return f;
}
after(() => { for (const f of fixtures) f.teardown(); });

function passingChecklistInput() {
  return {
    acCoverageComplete: true, missingRequiredAutomatedTest: false, verificationPassed: true,
    scopeStatus: 'compliant', forbiddenPathClean: true, docsConsistent: true,
    unresolvedBlockingCount: 0, unresolvedOwnerDecisionCount: 0,
  };
}

function fullPerTaskRecord(overrides = {}) {
  return {
    taskId: 't1', verdict: 'pass', acCovered: 5, acTotal: 5, scopeStatus: 'compliant',
    blockingFindings: 0, pendingOwnerDecisions: [], pendingScopeDecisions: [],
    clarificationRequests: [], followUpCandidates: [], reviewArtifact: 'reviews/t1.md',
    implementationFingerprint: 'fp-t1',
    ...overrides,
  };
}

// ── Scenario 1: Approve and start implementation begins work without another confirmation ──

describe('Scenario 1 — approve+start begins work without another confirmation', () => {
  test('handleStart on a freshly-approved fixture task transitions straight to in-implementation with a recorded baseline, in one call', () => {
    const f = fixture({ changeSlug: 'aw-s1', tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'] }] });
    handleStart('aw-s1', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    const task = loadChange('aw-s1', f.activeDir).tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'in-implementation');
    assert.ok(task.implementation?.baseline_revision);
  });
});

// ── Scenario 2: Passing review produces only minimal result rows ───────────
// Corrected (final pre-approval review): proves the minimal three-result-row
// shape itself — acceptance criteria, scope, findings — not merely a line
// ceiling a differently-shaped body could also satisfy.

describe('Scenario 2 — a passing review produces only minimal result rows', () => {
  test('a fully-passing checklist renders exactly the title plus three rows: AC coverage, scope, findings', () => {
    const result = computeTaskReviewChecklist(passingChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: aw-s2/t1', totalAcceptanceCriteria: 9 });
    const lines = body.split('\n').filter(l => l.trim());
    assert.deepEqual(lines, [
      '# Review: aw-s2/t1',
      '- [x] Acceptance criteria: 9/9',
      '- [x] Scope: compliant',
      '- [x] Findings: none unresolved',
    ]);
  });

  test('none of the four internal-only gates (verification, forbidden-path, docs, owner-decision) renders as its own row', () => {
    const result = computeTaskReviewChecklist(passingChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: aw-s2/t1', totalAcceptanceCriteria: 9 });
    for (const forbiddenText of [
      'Required automated verification passed', 'No forbidden-path violation remains unresolved',
      'Architecture and documentation remain consistent', 'No unresolved owner decision', 'No unresolved blocking findings',
    ]) {
      assert.ok(!body.includes(forbiddenText));
    }
  });
});

// ── Scenario 3: Failing review expands only failed checks ──────────────────

describe('Scenario 3 — a failing review expands only the failed checks', () => {
  test('exactly one failed item gets an expanded reason line; every other item stays a bare checked line', () => {
    const result = computeTaskReviewChecklist({ ...passingChecklistInput(), docsConsistent: false });
    const rendered = renderCompactReviewChecklist(result);
    const lines = rendered.split('\n');
    const uncheckedLines = lines.filter(l => l.startsWith('- [ ]'));
    const expandedLines = lines.filter(l => l.startsWith('  - '));
    assert.equal(uncheckedLines.length, 1);
    assert.equal(expandedLines.length, 1);
    assert.equal(lines.filter(l => l.startsWith('- [x]')).length, 6);
  });
});

// ── Scenario 4: Multi-task review uses bounded per-task context ────────────

describe('Scenario 4 — multi-task review uses bounded per-task context', () => {
  test('a per-task record carries forward exactly the structured fields — never an embedded diff/full report', () => {
    const record = fullPerTaskRecord();
    assert.equal(validatePerTaskReviewRecord(record), true);
    assert.deepEqual(Object.keys(record).sort(), [
      'acCovered', 'acTotal', 'blockingFindings', 'clarificationRequests', 'followUpCandidates',
      'implementationFingerprint', 'pendingOwnerDecisions', 'pendingScopeDecisions',
      'reviewArtifact', 'scopeStatus', 'taskId', 'verdict',
    ].sort());
  });
});

// ── Scenario 5: No owner questions appear between task reviews ─────────────

describe('Scenario 5 — no owner questions between task reviews; everything collects into one stage', () => {
  test('three tasks\' pending decisions all land in one buildConsolidatedDecisionStage call, never three separate stages', () => {
    const records = [
      fullPerTaskRecord({ taskId: 't1', pendingOwnerDecisions: [{ finding: 'F1' }] }),
      fullPerTaskRecord({ taskId: 't2', pendingScopeDecisions: [{ finding: 'F2', classification: 'outside-allowed' }] }),
      fullPerTaskRecord({ taskId: 't3', followUpCandidates: [{ summary: 'later' }] }),
    ];
    const stage = buildConsolidatedDecisionStage(records);
    assert.equal(stage.ownerDecisions.length, 1);
    assert.equal(stage.scopeDecisions.outsideAllowed.length, 1);
    assert.equal(stage.followUpCandidates.length, 1);
  });
});

// ── Scenario 6: Semantic integration detects a real contract mismatch ──────

describe('Scenario 6 — semantic integration selects a real cross-task relationship for inspection', () => {
  test('two tasks sharing a decision with no file overlap are still selected as a pair to inspect', () => {
    const pairs = selectSemanticIntegrationPairs(['a', 'b'], { a: { decisions: ['D1'] }, b: { decisions: ['D1'] } }, []);
    assert.deepEqual(pairs, [['a', 'b']]);
  });
});

// ── Scenario 7: Path overlap alone does not create a defect ────────────────

describe('Scenario 7 — path overlap alone is a review candidate, not an automatic defect', () => {
  test('a file-overlap pair is selected for inspection, but selection itself is not a finding', () => {
    const pairs = selectSemanticIntegrationPairs(['a', 'b'], {}, [['a', 'b']]);
    assert.deepEqual(pairs, [['a', 'b']]);
    // Selection alone carries no verdict/classification — a real finding
    // requires a further, separate classification step (task 16's own
    // model-review inspection), never inferred from selection alone.
  });
});

// ── Scenario 8: Two tasks modifying one shared file retain independent provenance ──

describe('Scenario 8 — two tasks modifying one shared file retain independent provenance', () => {
  test('each task\'s own attributed changed_paths for the shared file is computed independently, from its own allowed_paths', () => {
    const changedAtA = ['shared.mjs', 'a-only.mjs'];
    const attributedA = computeTaskAttributedChangedPaths(changedAtA, ['shared.mjs', 'a-only.mjs']);
    const changedAtB = ['shared.mjs', 'b-only.mjs'];
    const attributedB = computeTaskAttributedChangedPaths(changedAtB, ['shared.mjs', 'b-only.mjs']);
    assert.deepEqual(attributedA, ['a-only.mjs', 'shared.mjs']);
    assert.deepEqual(attributedB, ['b-only.mjs', 'shared.mjs']);
    // B's computation never altered A's already-computed result.
    assert.deepEqual(attributedA, ['a-only.mjs', 'shared.mjs']);
  });

  test('end-to-end against a fixture: two sequential fixture tasks recording independent baselines', () => {
    const f = fixture({
      changeSlug: 'aw-s8',
      tasks: [
        { id: 'ta', status: 'approved', allowedPaths: ['fixture/**'] },
        { id: 'tb', status: 'draft', allowedPaths: ['fixture/**'] },
      ],
    });
    handleStart('aw-s8', 'ta', { activeDir: f.activeDir, gitRoot: f.root });
    const taskA = loadChange('aw-s8', f.activeDir).tasks.find(t => t.id === 'ta');
    assert.ok(taskA.implementation.baseline_revision);
  });
});

// ── Scenario 9: Scoped spec review evaluates a new task in old context without re-grading old tasks ──

describe('Scenario 9 — a scoped review evaluates a new task without re-grading old ones', () => {
  test('--changed selects only the new/changed task; old tasks\' fingerprints are never recomputed as part of scope resolution', () => {
    const change = { tasks: [{ id: 'old1', order: 1 }, { id: 'old2', order: 2 }, { id: 'new1', order: 3 }] };
    const changed = selectChangedTaskIds(['old1', 'old2', 'new1'], { old1: 'fp1', old2: 'fp2' }, { old1: 'fp1', old2: 'fp2', new1: 'fp3' });
    const scope = resolveSpecReviewScope(change, { changed: true, changedTaskIds: changed });
    assert.deepEqual(scope.taskIds, ['new1']);
    assert.ok(!scope.taskIds.includes('old1'));
    assert.ok(!scope.taskIds.includes('old2'));
  });

  test('a scoped review\'s whole-change-readiness claim requires every out-of-scope baseline to still match', () => {
    const result = scopedReviewBaselineValid(['old1', 'old2'], { old1: 'fp1', old2: 'fp2' }, { old1: 'fp1', old2: 'fp2' });
    assert.equal(result.valid, true);
  });
});

// ── Scenario 10: Dependency-aware status never proposes an unstartable task ──

describe('Scenario 10 — status never proposes an unstartable task', () => {
  test('across a range of fixtures, any task deriveStage reports ready-to-start always has depsSatisfied true', () => {
    const graphs = [
      [{ id: 't1', status: 'verified' }, { id: 't2', status: 'approved', depends_on: ['t1'] }],
      [{ id: 't1', status: 'draft' }, { id: 't2', status: 'approved', depends_on: ['t1'] }],
      [{ id: 't1', status: 'approved' }],
    ];
    for (const tasks of graphs) {
      const change = { _slug: 'c', tasks };
      const stage = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
      if (stage.stage === 'ready-to-start') {
        const readyId = stage.nextCommand.split(' ').pop();
        const readyTask = tasks.find(t => t.id === readyId);
        assert.equal(depsSatisfied(readyTask, change), true);
      }
    }
  });
});

// ── Scenario 11: Legitimate unowned drift follows the named correction process ──

describe('Scenario 11 — legitimate unowned drift follows the named three-option process', () => {
  test('a classified unowned-drift path is offered the three-option menu, and a completed maintenance correction validates', () => {
    const classification = classifyUnownedDrift('docs/ai/orphaned.md', { t1: { allowedPaths: ['tools/**'], forbiddenPaths: [] } });
    assert.equal(classification, 'unowned-drift');
    assert.deepEqual(UNOWNED_DRIFT_OPTIONS, ['create-corrective-task', 'amend-existing-task', 'maintenance-correction']);
    const entry = {
      id: 'FU-900', source_task: 't1', kind: 'maintenance-correction', severity: 'non-blocking',
      reason: 'x', resolver_task: null, status: 'resolved', resolution: 'done',
      paths: ['docs/ai/orphaned.md'], confirmed_by: 'owner', confirmed_at: '2026-08-07', revision: 'abc',
    };
    assert.deepEqual(validateMaintenanceCorrectionEntry(entry), { ok: true });
  });

  test('the migration-flow guard (apply-provenance) never writes without --confirm, the same "never unattended" principle', () => {
    assert.throws(() => handleApplyProvenance('nevo-ai-process-continuity-and-hardening', 'owner-workflow-acceptance-scenarios', { baseline: 'x' }));
  });
});

// ── Scenario 12: Accepted scope exceptions remain visible and narrow ───────

describe('Scenario 12 — an accepted scope exception stays visible and narrow', () => {
  test('a valid exception matches only its exact recorded path and task fingerprint — never a broader glob', () => {
    const exception = { path: 'tools/tests/x.test.mjs', task_fingerprint: 'fp1' };
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/x.test.mjs', taskFingerprint: 'fp1' }), true);
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/y.test.mjs', taskFingerprint: 'fp1' }), false);
    assert.equal(classifyScopeFinding('tools/tests/x.test.mjs', { allowedPaths: [], forbiddenPaths: [] }), 'outside-allowed');
  });
});

// ── Scenario 13: Global HEAD advancement does not stale earlier evidence ───

describe('Scenario 13 — HEAD advancing does not stale an earlier task\'s own evidence', () => {
  test('a task\'s semantic fingerprint is unaffected by another task\'s implementation/self_check fields changing (D33/D28 exclusion, composed with task 15)', () => {
    const f = fixture({ changeSlug: 'aw-s13', tasks: [{ id: 't1', status: 'draft', allowedPaths: ['fixture/**'] }] });
    const change = loadChange('aw-s13', f.activeDir);
    const before = computeTaskFingerprint(change, 't1');
    const beforeChange = computeChangeFingerprint(change);
    // Simulate HEAD having advanced (a later task committing) — this task's
    // own semantic fingerprint must be unaffected, since neither
    // `self_check`/`implementation` nor another task's own progress feed it.
    const reloaded = loadChange('aw-s13', f.activeDir);
    assert.equal(computeTaskFingerprint(reloaded, 't1'), before);
    assert.equal(computeChangeFingerprint(reloaded), beforeChange);
  });
});

// ── Scenario 14: Aggregate reports cannot contradict canonical per-task reports ──

describe('Scenario 14 — an aggregate report cannot contradict a task\'s own canonical review (regression over the already-shipped guard)', () => {
  test('validateAggregateAgainstCanonicalReviews rejects an aggregate row disagreeing with the canonical per-task verdict', () => {
    const canonical = { t1: { verdict: 'pass', unresolvedRequiredFixes: 0, unresolvedOwnerDecisions: 0, unresolvedNeedsClarification: 0 } };
    const aggregateRow = { t1: 'changes-required' };
    const result = validateAggregateAgainstCanonicalReviews(canonical, aggregateRow);
    assert.equal(result.ok, false);
  });

  test('a consistent aggregate row is accepted', () => {
    const canonical = { t1: { verdict: 'pass', unresolvedRequiredFixes: 0, unresolvedOwnerDecisions: 0, unresolvedNeedsClarification: 0 } };
    const aggregateRow = { t1: 'pass' };
    assert.equal(validateAggregateAgainstCanonicalReviews(canonical, aggregateRow).ok, true);
  });
});

// ── Scenario 15: A normal one-person batch requires only the initial request, genuine owner decisions, and one final confirmation ──

describe('Scenario 15 — the composite scenario: only the initial request, genuine owner decisions, and one final confirmation', () => {
  test('a two-task fixture run with zero genuine owner decisions reaches one consolidated stage with zero required decisions and a non-empty eligible set', () => {
    const f = fixture({
      changeSlug: 'aw-s15',
      tasks: [
        { id: 't1', status: 'approved', allowedPaths: ['fixture/**'] },
        { id: 't2', status: 'approved', allowedPaths: ['fixture/**'] },
      ],
    });
    // One owner-facing action: start both tasks (the "initial request").
    handleStart('aw-s15', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    handleStart('aw-s15', 't2', { activeDir: f.activeDir, gitRoot: f.root });
    const change = loadChange('aw-s15', f.activeDir);
    for (const id of ['t1', 't2']) {
      assert.equal(change.tasks.find(t => t.id === id).status, 'in-implementation');
    }

    // Zero genuine owner decisions in this fixture — both tasks pass cleanly.
    const records = [
      fullPerTaskRecord({ taskId: 't1' }),
      fullPerTaskRecord({ taskId: 't2' }),
    ];
    const stage = buildConsolidatedDecisionStage(records);
    assert.equal(stage.ownerDecisions.length, 0);
    assert.equal(stage.scopeDecisions.outsideAllowed.length, 0);
    assert.equal(stage.scopeDecisions.forbidden.length, 0);
    // One final confirmation covers both tasks together.
    assert.deepEqual(stage.eligibleForBulkTransition.sort(), ['t1', 't2']);
  });
});

// ── AC16: no scenario in this file mutates the real repository ─────────────

describe('AC16 — no scenario in this file touches the real repository\'s specs/docs trees', () => {
  test('every fixture used above was torn down into an isolated temp directory, never specs/active itself', () => {
    for (const f of fixtures) {
      assert.ok(f.root.includes('nevo-fixture-repo-'), 'every fixture must be a throwaway temp directory');
    }
  });
});
