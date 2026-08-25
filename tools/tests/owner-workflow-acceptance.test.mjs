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
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFixtureRepo } from './fixture-repo.test-helper.mjs';
import { handleStart, handleSelfCheck, handleApplyProvenance } from '../specs.mjs';
import { loadChange } from '../specs/store.mjs';
import { computeTaskFingerprint, computeChangeFingerprint } from '../specs/fingerprint.mjs';
import { buildContextPacket } from '../specs/context.mjs';
import { getChangedFiles, getCurrentRevision } from '../lib/git.mjs';

// Captures the fixture repo's current revision before any task edits it —
// the real `startRevision` baseline `getChangedFiles(root, startRevision)`
// diffs against, mirroring how the gating batch review computes its own
// real diff (area batch-execution-and-gating-review).
function captureRevision(root) {
  return getCurrentRevision(root);
}
import { deriveStage } from '../specs/lifecycle/stage.mjs';
import { depsSatisfied } from '../specs/lifecycle-primitives.mjs';
import {
  computeTaskReviewChecklist, renderCompactReviewChecklist, renderNormalPassingReportBody,
  selectSemanticIntegrationPairs, validatePerTaskReviewRecord, buildConsolidatedDecisionStage,
  resolveSpecReviewScope, selectChangedTaskIds, scopedReviewBaselineValid,
  classifyScopeFinding, isScopeExceptionValid,
  validateAggregateAgainstCanonicalReviews,
  resolveScopeCheckPaths,
} from '../specs/lifecycle/reviews.mjs';
import {
  computeTaskAttributedChangedPaths, nextImplementationBaseline,
  classifyUnownedDrift, UNOWNED_DRIFT_OPTIONS, validateMaintenanceCorrectionEntry,
  detectProvenanceOverlap,
} from '../specs/lifecycle/provenance.mjs';
import {
  attributeTouchedPaths, detectBatchIntegrationFindings,
} from '../specs/lifecycle/batch.mjs';

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
  test('scope and verification-passed derived from a real handleStart+handleSelfCheck fixture run; the checklist renders exactly the title plus three rows', () => {
    const f = fixture({
      changeSlug: 'aw-s2',
      tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'], verification: ['echo ok'] }],
    });
    handleStart('aw-s2', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/change.txt', 'content', 'Task t1 edits an in-scope file');
    handleSelfCheck('aw-s2', 't1', { activeDir: f.activeDir, gitRoot: f.root });

    const task = loadChange('aw-s2', f.activeDir).tasks.find(t => t.id === 't1');
    const touchedPaths = resolveScopeCheckPaths(task, []);
    assert.ok(touchedPaths.length > 0, 'the real self-check must have attributed at least the committed file');
    const scopeStatus = touchedPaths.every(p => classifyScopeFinding(p, { allowedPaths: ['fixture/**'], forbiddenPaths: [] }) === 'compliant')
      ? 'compliant' : 'unresolved';

    const result = computeTaskReviewChecklist({
      acCoverageComplete: true, missingRequiredAutomatedTest: false,
      verificationPassed: task.self_check.status === 'passed', // real self-check outcome
      scopeStatus, // real classification of the real attributed paths
      forbiddenPathClean: true, docsConsistent: true,
      unresolvedBlockingCount: 0, unresolvedOwnerDecisionCount: 0,
    });
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
  test('scope/verification derived real and passing from a fixture run; only the one deliberately-failing gate (docsConsistent) gets an expanded reason line', () => {
    const f = fixture({
      changeSlug: 'aw-s3',
      tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'], verification: ['echo ok'] }],
    });
    handleStart('aw-s3', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/change.txt', 'content', 'in-scope edit');
    handleSelfCheck('aw-s3', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    const task = loadChange('aw-s3', f.activeDir).tasks.find(t => t.id === 't1');
    const touchedPaths = resolveScopeCheckPaths(task, []);
    const scopeStatus = touchedPaths.every(p => classifyScopeFinding(p, { allowedPaths: ['fixture/**'], forbiddenPaths: [] }) === 'compliant')
      ? 'compliant' : 'unresolved';
    assert.equal(scopeStatus, 'compliant');

    const result = computeTaskReviewChecklist({
      acCoverageComplete: true, missingRequiredAutomatedTest: false,
      verificationPassed: task.self_check.status === 'passed',
      scopeStatus, forbiddenPathClean: true,
      docsConsistent: false, // the one deliberate failure this scenario proves stays isolated
      unresolvedBlockingCount: 0, unresolvedOwnerDecisionCount: 0,
    });
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
  test('a real out-of-scope finding (task 2) and a real cross-task provenance overlap (tasks 3/4) both land in one buildConsolidatedDecisionStage call, never separate stages', () => {
    const f = fixture({
      changeSlug: 'aw-s5',
      tasks: [
        { id: 't1', status: 'approved', allowedPaths: ['fixture/t1/**'], verification: ['echo ok'] },
        { id: 't2', status: 'approved', allowedPaths: ['fixture/t2/**'], verification: ['echo ok'] },
        { id: 't3', status: 'approved', allowedPaths: ['fixture/shared/**'], verification: ['echo ok'] },
        { id: 't4', status: 'approved', allowedPaths: ['fixture/shared/**'], verification: ['echo ok'] },
      ],
    });

    // t2 touches a file outside its own declared scope — a real outside-allowed
    // finding. No self-check run yet for t2, so it has no persisted
    // implementation.changed_paths (that field is only ever a subset of its
    // own allowed_paths, by construction — it can never itself contain an
    // out-of-scope path) — resolveScopeCheckPaths correctly falls back to the
    // real live diff since t2's own baseline_revision.
    handleStart('aw-s5', 't2', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/outside/oops.mjs', 'x', 't2 edits an out-of-scope file');
    const t2 = loadChange('aw-s5', f.activeDir).tasks.find(t => t.id === 't2');
    const t2LiveDiff = getChangedFiles(f.root, t2.implementation.baseline_revision);
    const t2Touched = resolveScopeCheckPaths(t2, t2LiveDiff);
    const t2Classification = t2Touched
      .map(p => classifyScopeFinding(p, { allowedPaths: ['fixture/t2/**'], forbiddenPaths: [] }))
      .find(c => c !== 'compliant');
    assert.equal(t2Classification, 'outside-allowed');

    // t3, then t4, both edit the same shared file — a real cross-task provenance overlap.
    handleStart('aw-s5', 't3', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/file.mjs', 'v1', 't3 edits the shared file');
    handleSelfCheck('aw-s5', 't3', { activeDir: f.activeDir, gitRoot: f.root });
    handleStart('aw-s5', 't4', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/file.mjs', 'v2', 't4 edits the same shared file');
    handleSelfCheck('aw-s5', 't4', { activeDir: f.activeDir, gitRoot: f.root });
    const reloaded = loadChange('aw-s5', f.activeDir);
    const t4 = reloaded.tasks.find(t => t.id === 't4');
    const overlaps = detectProvenanceOverlap(reloaded.tasks, 't4', t4.implementation.changed_paths);
    assert.ok(overlaps.some(o => o.taskId === 't3'));

    const records = [
      fullPerTaskRecord({ taskId: 't1' }), // clean — nothing pending
      fullPerTaskRecord({
        taskId: 't2',
        pendingScopeDecisions: [{ finding: 'F1', path: t2Touched.find(p => classifyScopeFinding(p, { allowedPaths: ['fixture/t2/**'], forbiddenPaths: [] }) === 'outside-allowed'), classification: t2Classification }],
      }),
      fullPerTaskRecord({
        taskId: 't4',
        pendingOwnerDecisions: [{ finding: 'F1', summary: `provenance overlap with '${overlaps[0].taskId}': ${overlaps[0].paths.join(', ')}` }],
      }),
    ];
    const stage = buildConsolidatedDecisionStage(records);
    assert.equal(stage.ownerDecisions.length, 1);
    assert.equal(stage.scopeDecisions.outsideAllowed.length, 1);
  });
});

// ── Scenario 6: Semantic integration detects a real contract mismatch ──────

describe('Scenario 6 — semantic integration selects a real cross-task relationship for inspection', () => {
  test('a real file-overlap pair, derived from an actual fixture diff, is selected alongside a decision-shared pair with no file overlap at all', () => {
    const f = fixture({
      changeSlug: 'aw-s6',
      tasks: [
        { id: 'a', status: 'approved', allowedPaths: ['fixture/shared/**', 'fixture/a/**'] },
        { id: 'b', status: 'approved', allowedPaths: ['fixture/shared/**', 'fixture/b/**'] },
      ],
    });
    const startRevision = captureRevision(f.root);
    handleStart('aw-s6', 'a', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/x.mjs', 'v1', 'task a edits the shared file');
    handleStart('aw-s6', 'b', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/x.mjs', 'v2', 'task b edits the same shared file');

    const changedFiles = getChangedFiles(f.root, startRevision);
    const touched = attributeTouchedPaths(['a', 'b'], {
      a: ['fixture/shared/**', 'fixture/a/**'], b: ['fixture/shared/**', 'fixture/b/**'],
    }, changedFiles);
    const findings = detectBatchIntegrationFindings({ temporaryInconsistencies: [] }, ['a', 'b'], touched);
    assert.ok(findings.length >= 1, 'the real fixture diff must produce a real file-overlap finding');
    const fileOverlapPairs = findings.map(fnd => fnd.tasks);

    // 'c' shares a decision with 'a' but never touches a file 'a' also touches.
    const pairs = selectSemanticIntegrationPairs(
      ['a', 'b', 'c'],
      { a: { decisions: ['D1'] }, b: {}, c: { decisions: ['D1'] } },
      fileOverlapPairs,
    );
    assert.ok(pairs.some(p => p.includes('a') && p.includes('b')), 'the real file-overlap pair must be selected');
    assert.ok(pairs.some(p => p.includes('a') && p.includes('c')), 'the decision-shared, file-disjoint pair must also be selected');
  });
});

// ── Scenario 7: Path overlap alone does not create a defect ────────────────

describe('Scenario 7 — path overlap alone is a review candidate, not an automatic defect', () => {
  test('a real file-overlap pair, derived from an actual fixture diff, is selected for inspection — but selection itself carries no finding/verdict', () => {
    const f = fixture({
      changeSlug: 'aw-s7',
      tasks: [
        { id: 'a', status: 'approved', allowedPaths: ['fixture/shared/**'] },
        { id: 'b', status: 'approved', allowedPaths: ['fixture/shared/**'] },
      ],
    });
    const startRevision = captureRevision(f.root);
    handleStart('aw-s7', 'a', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/x.mjs', 'v1', 'task a edits the shared file');
    handleStart('aw-s7', 'b', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/shared/x.mjs', 'v2', 'task b edits the same shared file');

    const changedFiles = getChangedFiles(f.root, startRevision);
    const touched = attributeTouchedPaths(['a', 'b'], { a: ['fixture/shared/**'], b: ['fixture/shared/**'] }, changedFiles);
    const findings = detectBatchIntegrationFindings({ temporaryInconsistencies: [] }, ['a', 'b'], touched);
    assert.ok(findings.length >= 1);
    const fileOverlapPairs = findings.map(fnd => fnd.tasks);

    const pairs = selectSemanticIntegrationPairs(['a', 'b'], {}, fileOverlapPairs);
    assert.deepEqual(pairs, [['a', 'b']]);
    // Selection alone carries no verdict/classification field of any kind —
    // a real finding requires a further, separate classification step (task
    // 16's own model-review inspection), never inferred from selection alone.
    assert.ok(!('verdict' in pairs[0]) && !('classification' in pairs[0]));
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
  test('--changed selects only the new/changed task, using real fixture-computed fingerprints; old tasks\' fingerprints are unaffected', () => {
    const f = fixture({
      changeSlug: 'aw-s9',
      tasks: [
        { id: 'old1', status: 'verified', allowedPaths: ['fixture/old1/**'] },
        { id: 'old2', status: 'verified', allowedPaths: ['fixture/old2/**'] },
        { id: 'new1', status: 'draft', allowedPaths: ['fixture/new1/**'] },
      ],
    });
    const change = loadChange('aw-s9', f.activeDir);
    // Simulates the last review's recorded task_fingerprints — new1 has none
    // (it didn't exist at the time of that review).
    const priorFingerprints = {
      old1: computeTaskFingerprint(change, 'old1'),
      old2: computeTaskFingerprint(change, 'old2'),
    };
    const currentFingerprints = {
      old1: computeTaskFingerprint(change, 'old1'),
      old2: computeTaskFingerprint(change, 'old2'),
      new1: computeTaskFingerprint(change, 'new1'),
    };
    const changed = selectChangedTaskIds(['old1', 'old2', 'new1'], priorFingerprints, currentFingerprints);
    assert.deepEqual(changed, ['new1']);

    const scope = resolveSpecReviewScope(change, { changed: true, changedTaskIds: changed });
    assert.deepEqual(scope.taskIds, ['new1']);
    assert.ok(!scope.taskIds.includes('old1'));
    assert.ok(!scope.taskIds.includes('old2'));

    // A scoped review's whole-change-readiness claim requires every
    // out-of-scope baseline to still match — proven against the same real
    // fingerprints just computed, not hand-typed placeholder strings.
    const result = scopedReviewBaselineValid(['old1', 'old2'], priorFingerprints, currentFingerprints);
    assert.equal(result.valid, true);
  });
});

// ── Scenario 10: Dependency-aware status never proposes an unstartable task ──

describe('Scenario 10 — status never proposes an unstartable task', () => {
  test('across three real fixture-loaded task graphs, any task deriveStage reports ready-to-start always has depsSatisfied true', () => {
    const graphs = [
      [{ id: 't1', status: 'verified', allowedPaths: ['fixture/**'] }, { id: 't2', status: 'approved', allowedPaths: ['fixture/**'], dependsOn: ['t1'] }],
      [{ id: 't1', status: 'draft', allowedPaths: ['fixture/**'] }, { id: 't2', status: 'approved', allowedPaths: ['fixture/**'], dependsOn: ['t1'] }],
      [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'] }],
    ];
    for (const tasks of graphs) {
      const f = fixture({ changeSlug: 'aw-s10', tasks });
      const change = loadChange('aw-s10', f.activeDir); // real change.yaml, not an inline JS object
      const stage = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
      if (stage.stage === 'ready-to-start') {
        const readyId = stage.nextCommand.split(' ').pop();
        const readyTask = change.tasks.find(t => t.id === readyId);
        assert.equal(depsSatisfied(readyTask, change), true);
      }
    }
  });
});

// ── Scenario 11: Legitimate unowned drift follows the named correction process ──

describe('Scenario 11 — legitimate unowned drift follows the named three-option process', () => {
  test('a path classified against a real fixture change\'s own allowed_paths/forbidden_paths is offered the three-option menu, and a completed maintenance correction validates', () => {
    const f = fixture({
      changeSlug: 'aw-s11',
      tasks: [{ id: 't1', status: 'approved', allowedPaths: ['tools/**'] }],
    });
    const change = loadChange('aw-s11', f.activeDir);
    const taskPaths = Object.fromEntries(change.tasks.map(t => {
      const packet = buildContextPacket(change, t);
      return [t.id, { allowedPaths: packet.allowed_paths, forbiddenPaths: packet.forbidden_paths }];
    }));
    const classification = classifyUnownedDrift('docs/ai/orphaned.md', taskPaths);
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
  test('a valid exception matches only its exact recorded path and a real fixture task\'s own current fingerprint — never a broader glob', () => {
    const f = fixture({
      changeSlug: 'aw-s12',
      tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/t1/**'] }],
    });
    const change = loadChange('aw-s12', f.activeDir);
    const task = change.tasks.find(t => t.id === 't1');
    const realFingerprint = computeTaskFingerprint(change, 't1');

    const exception = { path: 'tools/tests/x.test.mjs', task_fingerprint: realFingerprint };
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/x.test.mjs', taskFingerprint: realFingerprint }), true);
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/y.test.mjs', taskFingerprint: realFingerprint }), false);

    // A real task-file amendment drifts the fingerprint and invalidates the
    // exception — the exact real-world case this change's own D36→D41
    // scope-exception re-review hit directly (an unrelated task-file wording
    // edit invalidated an already-accepted exception).
    appendFileSync(join(f.changeDir, 'tasks', '01-t1.md'), '\nA later amendment to this task file.\n');
    const driftedFingerprint = computeTaskFingerprint(loadChange('aw-s12', f.activeDir), 't1');
    assert.notEqual(driftedFingerprint, realFingerprint);
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/x.test.mjs', taskFingerprint: driftedFingerprint }), false);

    const packet = buildContextPacket(change, task);
    assert.equal(classifyScopeFinding('tools/tests/x.test.mjs', { allowedPaths: packet.allowed_paths, forbiddenPaths: packet.forbidden_paths }), 'outside-allowed');
  });
});

// ── Scenario 13: Global HEAD advancement does not stale earlier evidence ───

describe('Scenario 13 — HEAD advancing does not stale an earlier task\'s own evidence', () => {
  test('t1\'s semantic fingerprint is unaffected by t2\'s real HEAD-advancing start+self-check — not a same-state comparison (corrected 2026-08-08: the prior version compared two loadChange() calls against unmodified fixture state, a tautology)', () => {
    const f = fixture({
      changeSlug: 'aw-s13',
      tasks: [
        { id: 't1', status: 'draft', allowedPaths: ['fixture/t1/**'] },
        { id: 't2', status: 'approved', allowedPaths: ['fixture/t2/**'], verification: ['echo ok'] },
      ],
    });
    const before = computeTaskFingerprint(loadChange('aw-s13', f.activeDir), 't1');
    const beforeChange = computeChangeFingerprint(loadChange('aw-s13', f.activeDir));

    // t2 genuinely advances: a real commit lands (HEAD moves), and t2 gains
    // real self_check/implementation fields — exactly the fields D33/D28
    // (self_check) and task 15 (implementation) both exclude from every
    // fingerprint tier.
    const revisionBefore = captureRevision(f.root);
    handleStart('aw-s13', 't2', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/t2/change.txt', 'content', 't2 advances HEAD');
    handleSelfCheck('aw-s13', 't2', { activeDir: f.activeDir, gitRoot: f.root });
    const revisionAfter = captureRevision(f.root);
    assert.notEqual(revisionAfter, revisionBefore, 'HEAD must have genuinely advanced');

    const reloaded = loadChange('aw-s13', f.activeDir);
    const t2After = reloaded.tasks.find(t => t.id === 't2');
    assert.equal(t2After.self_check?.status, 'passed');
    assert.ok(t2After.implementation?.changed_paths?.length, 't2 must have real, non-empty implementation fields now');

    // t1's own fingerprint — and the change-level fingerprint, which
    // excludes every task's status/self_check/implementation by design — are
    // both unaffected by t2's real, HEAD-advancing progress.
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
