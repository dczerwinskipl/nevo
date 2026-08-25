// Tests for task 16 (semantic-cross-task-integration-and-consolidated-decisions,
// D34/D35, area implementation-review-orchestration §"Semantic integration and
// consolidated decisions"): selectSemanticIntegrationPairs (bounded pair
// selection), validatePerTaskReviewRecord (the structured per-task contract),
// and buildConsolidatedDecisionStage (one collected owner-facing stage).
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectSemanticIntegrationPairs, PER_TASK_REVIEW_FIELDS, validatePerTaskReviewRecord,
  buildConsolidatedDecisionStage,
} from '../specs/lifecycle/reviews.mjs';

// ── selectSemanticIntegrationPairs ──────────────────────────────────────────

describe('selectSemanticIntegrationPairs — bounded pair selection (AC1, AC7)', () => {
  test('an existing file-overlap pair is included', () => {
    const pairs = selectSemanticIntegrationPairs(['a', 'b', 'c'], {}, [['a', 'b']]);
    assert.deepEqual(pairs, [['a', 'b']]);
  });

  test('two tasks sharing a semantic_references.decisions entry are selected even with no file overlap (a real relationship attributeTouchedPaths alone cannot see)', () => {
    const refs = { a: { decisions: ['D1'] }, b: { decisions: ['D1'] }, c: { decisions: ['D2'] } };
    const pairs = selectSemanticIntegrationPairs(['a', 'b', 'c'], refs, []);
    assert.deepEqual(pairs, [['a', 'b']]);
  });

  test('a dependency_contracts reference selects the pair', () => {
    const refs = { a: { dependencyContracts: ['b'] }, b: {} };
    const pairs = selectSemanticIntegrationPairs(['a', 'b'], refs, []);
    assert.deepEqual(pairs, [['a', 'b']]);
  });

  test('a pair with no relationship of any kind is never selected — this is "bounded," not every pair in scope', () => {
    const refs = { a: { decisions: ['D1'] }, b: { decisions: ['D2'] }, c: {} };
    const pairs = selectSemanticIntegrationPairs(['a', 'b', 'c'], refs, []);
    assert.deepEqual(pairs, []);
  });

  test('a pair selected by both file overlap and a shared decision appears exactly once, not twice', () => {
    const refs = { a: { decisions: ['D1'] }, b: { decisions: ['D1'] } };
    const pairs = selectSemanticIntegrationPairs(['a', 'b'], refs, [['a', 'b']]);
    assert.equal(pairs.length, 1);
  });
});

// ── PER_TASK_REVIEW_FIELDS / validatePerTaskReviewRecord ────────────────────

function fullRecord(overrides = {}) {
  return {
    taskId: 't1', verdict: 'pass', acCovered: 11, acTotal: 11, scopeStatus: 'compliant',
    blockingFindings: 0, pendingOwnerDecisions: [], pendingScopeDecisions: [],
    clarificationRequests: [], followUpCandidates: [], reviewArtifact: 'reviews/t1.md',
    implementationFingerprint: 'abc123',
    ...overrides,
  };
}

describe('PER_TASK_REVIEW_FIELDS / validatePerTaskReviewRecord — the complete structured per-task contract (AC4)', () => {
  test('names exactly the ten concepts the owner\'s requirement lists (task ID, verdict, AC covered/total, scope status, blocking findings, pending owner/scope decisions, clarification requests, follow-up candidates, review artifact, implementation fingerprint)', () => {
    assert.deepEqual(PER_TASK_REVIEW_FIELDS, [
      'taskId', 'verdict', 'acCovered', 'acTotal', 'scopeStatus', 'blockingFindings',
      'pendingOwnerDecisions', 'pendingScopeDecisions', 'clarificationRequests',
      'followUpCandidates', 'reviewArtifact', 'implementationFingerprint',
    ]);
  });

  test('a complete record validates without throwing', () => {
    assert.equal(validatePerTaskReviewRecord(fullRecord()), true);
  });

  test('a record missing implementationFingerprint throws naming it', () => {
    const record = fullRecord();
    delete record.implementationFingerprint;
    assert.throws(() => validatePerTaskReviewRecord(record), /implementationFingerprint/);
  });

  test('a record missing multiple fields names all of them', () => {
    const record = { taskId: 't1', verdict: 'pass' };
    assert.throws(() => validatePerTaskReviewRecord(record), /acCovered/);
  });
});

// ── buildConsolidatedDecisionStage ──────────────────────────────────────────

describe('buildConsolidatedDecisionStage — one collected owner-facing stage, never per-task (AC2, AC5, AC6)', () => {
  test('collects pending owner decisions, scope decisions (grouped by classification), clarification requests, and follow-up candidates across every reviewed task', () => {
    const records = [
      fullRecord({
        taskId: 't1', verdict: 'changes-required', blockingFindings: 1,
        pendingOwnerDecisions: [{ finding: 'F1', summary: 'Needs a call' }],
        pendingScopeDecisions: [{ finding: 'F2', path: 'x.mjs', classification: 'outside-allowed' }],
      }),
      fullRecord({
        taskId: 't2', verdict: 'changes-required', blockingFindings: 1,
        pendingScopeDecisions: [{ finding: 'F3', path: 'AGENTS.md', classification: 'forbidden' }],
        clarificationRequests: [{ finding: 'F4', question: 'Which file?' }],
        followUpCandidates: [{ summary: 'Track this later' }],
      }),
    ];
    const stage = buildConsolidatedDecisionStage(records);
    assert.equal(stage.ownerDecisions.length, 1);
    assert.equal(stage.ownerDecisions[0].taskId, 't1');
    assert.equal(stage.scopeDecisions.outsideAllowed.length, 1);
    assert.equal(stage.scopeDecisions.outsideAllowed[0].taskId, 't1');
    assert.equal(stage.scopeDecisions.forbidden.length, 1);
    assert.equal(stage.scopeDecisions.forbidden[0].taskId, 't2');
    assert.equal(stage.clarificationRequests.length, 1);
    assert.equal(stage.followUpCandidates.length, 1);
  });

  test('a task with zero unresolved blocking findings and verdict pass is eligible for bulk transition; one with a blocking finding is not (AC6)', () => {
    const records = [
      fullRecord({ taskId: 't1', verdict: 'pass', blockingFindings: 0 }),
      fullRecord({ taskId: 't2', verdict: 'changes-required', blockingFindings: 1 }),
    ];
    const stage = buildConsolidatedDecisionStage(records);
    assert.deepEqual(stage.eligibleForBulkTransition, ['t1']);
  });

  test('an empty record set produces an empty, well-formed stage rather than throwing', () => {
    const stage = buildConsolidatedDecisionStage([]);
    assert.deepEqual(stage, {
      ownerDecisions: [], scopeDecisions: { outsideAllowed: [], forbidden: [] },
      clarificationRequests: [], followUpCandidates: [], eligibleForBulkTransition: [],
    });
  });
});
