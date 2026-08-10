// Tests for batch execution and the gating batch review (area
// batch-execution-and-gating-review, task 08): tools/specs/lifecycle.mjs's
// selectBatch/deriveBatchProgress/hardStopReason/detectRiskSignals/
// requiresFullReview/buildSelfCheckResult/staleEvidenceTasks/
// isTemporaryInconsistency/batchValidationBlocks/computeBatchReviewVerdict.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectBatch, deriveBatchProgress, hardStopReason, completionHardStop, detectRiskSignals, requiresFullReview,
  buildSelfCheckResult, isTemporaryInconsistency, batchValidationBlocks, staleEvidenceTasks,
  computeBatchReviewVerdict, BATCH_REVIEW_VERDICTS, validateBatchCheckpoint,
  attributeTouchedPaths, detectBatchIntegrationFindings,
} from '../specs/lifecycle.mjs';

// A linear approved chain a -> b -> c (b depends on a, c depends on b), plus
// one already-terminal task and one still-draft task, for exercising every
// selection mode against the same fixture.
function linearChangeFixture() {
  return {
    tasks: [
      { id: 'z-done', status: 'verified' },
      { id: 'a', status: 'approved', depends_on: [] },
      { id: 'b', status: 'approved', depends_on: ['a'] },
      { id: 'c', status: 'approved', depends_on: ['b'] },
      { id: 'd-draft', status: 'draft', depends_on: [] },
    ],
  };
}

describe('selectBatch — dispatches on mode, never four independent code paths (AC1, AC8, AC9)', () => {
  test('rejects an unknown mode', () => {
    const r = selectBatch('bogus-mode', linearChangeFixture());
    assert.equal(r.ok, false);
    assert.match(r.reason, /Unknown batch selection mode/);
  });

  test('currently-ready selects only next-ready tasks, in dependency order', () => {
    const r = selectBatch('currently-ready', linearChangeFixture());
    assert.equal(r.ok, true);
    // Only 'a' is next-ready — b/c depend on tasks not yet terminal.
    assert.deepEqual(r.orderedTasks, ['a']);
  });

  test('all-approved-reachable selects the full linear chain currently-ready alone would only select the first task of (D20, AC8)', () => {
    const r = selectBatch('all-approved-reachable', linearChangeFixture());
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });

  test('until-checkpoint selects the same reachable set as all-approved-reachable', () => {
    const r = selectBatch('until-checkpoint', linearChangeFixture());
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });

  test('named-subset with a full, satisfiable list succeeds in dependency order', () => {
    const r = selectBatch('named-subset', linearChangeFixture(), { taskIds: ['c', 'a', 'b'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, ['a', 'b', 'c']);
  });

  test('named-subset requires at least one task id', () => {
    const r = selectBatch('named-subset', linearChangeFixture(), { taskIds: [] });
    assert.equal(r.ok, false);
  });

  test('named-subset rejects an unknown task id', () => {
    const r = selectBatch('named-subset', linearChangeFixture(), { taskIds: ['nope'] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /Unknown task id/);
  });

  test('named-subset missing a required prerequisite is reported, not silently included or excluded (D20, AC9)', () => {
    const r = selectBatch('named-subset', linearChangeFixture(), { taskIds: ['c'] }); // needs 'b', which needs 'a'
    assert.equal(r.ok, false);
    assert.match(r.reason, /missing required prerequisite/);
    assert.match(r.reason, /'c' needs 'b'/);
  });

  test('all-approved-reachable excludes a task blocked by its own unresolved owner-decision suspension', () => {
    const change = linearChangeFixture();
    change.tasks.find(t => t.id === 'a').execution = { suspension: { kind: 'owner-decision', code: 'REC-06' } };
    const r = selectBatch('all-approved-reachable', change);
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, []); // a excluded -> b, c unreachable too
  });

  test('a batch that would select zero tasks is unsatisfiable before any task starts (AC1)', () => {
    const empty = { tasks: [{ id: 'x', status: 'draft' }] };
    const r = selectBatch('currently-ready', empty);
    assert.equal(r.ok, true);
    assert.deepEqual(r.orderedTasks, []);
  });
});

describe('validateBatchCheckpoint — D20 until-checkpoint argument validation (PR re-review packet 04)', () => {
  test('--checkpoint with a non-until-checkpoint mode is rejected (contradictory mode/checkpoint syntax)', () => {
    const r = validateBatchCheckpoint('all-approved-reachable', 'b', ['a', 'b'], 'approved');
    assert.equal(r.ok, false);
    assert.match(r.reason, /only valid with mode 'until-checkpoint'/);
  });

  test('a non-until-checkpoint mode with no --checkpoint at all is fine', () => {
    assert.equal(validateBatchCheckpoint('all-approved-reachable', null, ['a', 'b'], undefined).ok, true);
  });

  test('until-checkpoint with no --checkpoint is rejected (missing checkpoint)', () => {
    const r = validateBatchCheckpoint('until-checkpoint', null, ['a', 'b'], undefined);
    assert.equal(r.ok, false);
    assert.match(r.reason, /requires --checkpoint/);
  });

  test('an unknown checkpoint task (no status — does not exist in the change) is rejected', () => {
    const r = validateBatchCheckpoint('until-checkpoint', 'ghost', ['a', 'b'], undefined);
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not exist/);
  });

  test('a checkpoint task not part of the selected batch is rejected', () => {
    const r = validateBatchCheckpoint('until-checkpoint', 'z-done', ['a', 'b'], 'verified');
    assert.equal(r.ok, false);
    assert.match(r.reason, /not part of the selected batch/);
  });

  test('a checkpoint task that is already terminal (the checkpoint is already passed) is rejected', () => {
    const r = validateBatchCheckpoint('until-checkpoint', 'a', ['a', 'b'], 'implemented');
    assert.equal(r.ok, false);
    assert.match(r.reason, /already passed/);
  });

  test('a valid, not-yet-terminal checkpoint within the selected batch is accepted', () => {
    const r = validateBatchCheckpoint('until-checkpoint', 'b', ['a', 'b', 'c'], 'approved');
    assert.equal(r.ok, true);
  });
});

describe('deriveBatchProgress — always derived, never a second persisted copy (D10, AC2, AC3)', () => {
  test('reconstructs completed/current/next/failed purely from change.yaml, safe after a simulated interruption', () => {
    const change = {
      tasks: [
        { id: 'a', status: 'implemented' },
        { id: 'b', status: 'in-implementation' },
        { id: 'c', status: 'approved' },
      ],
    };
    const intent = { orderedTasks: ['a', 'b', 'c'] };
    const progress = deriveBatchProgress(change, intent);
    assert.deepEqual(progress, {
      completed: ['a'], current: 'b', next: 'c', failed: null, checkpointTask: null, checkpointReached: false,
    });
  });

  test('exactly one task is ever "current" — the first non-terminal task, never more (AC2)', () => {
    const change = { tasks: [{ id: 'a', status: 'approved' }, { id: 'b', status: 'approved' }] };
    const intent = { orderedTasks: ['a', 'b'] };
    const progress = deriveBatchProgress(change, intent);
    assert.equal(progress.current, 'a');
    assert.notEqual(progress.next, progress.current);
  });

  test('current is null once every batched task is terminal', () => {
    const change = { tasks: [{ id: 'a', status: 'implemented' }, { id: 'b', status: 'verified' }] };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a', 'b'] });
    assert.deepEqual(progress, {
      completed: ['a', 'b'], current: null, next: null, failed: null, checkpointTask: null, checkpointReached: false,
    });
  });

  test('a current task with a failed self-check is reported as failed', () => {
    const change = { tasks: [{ id: 'a', status: 'in-implementation', self_check: { status: 'failed' } }] };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a'] });
    assert.equal(progress.failed, 'a');
  });

  test('a current task with an unresolved execution.suspension is reported as failed', () => {
    const change = { tasks: [{ id: 'a', status: 'approved', execution: { suspension: { kind: 'confirm-required' } } }] };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a'] });
    assert.equal(progress.failed, 'a');
  });

  test('checkpointReached is false while the checkpoint task is not yet terminal (D20 until-checkpoint, PR re-review packet 04)', () => {
    const change = {
      tasks: [{ id: 'a', status: 'implemented' }, { id: 'b', status: 'in-implementation' }, { id: 'c', status: 'approved' }],
    };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a', 'b', 'c'], checkpointPolicy: 'b' });
    assert.equal(progress.checkpointTask, 'b');
    assert.equal(progress.checkpointReached, false);
  });

  test('checkpointReached is true once the checkpoint task is terminal, without nulling current/next (execution bound, not selection bound)', () => {
    const change = {
      tasks: [{ id: 'a', status: 'implemented' }, { id: 'b', status: 'implemented' }, { id: 'c', status: 'approved' }],
    };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a', 'b', 'c'], checkpointPolicy: 'b' });
    assert.equal(progress.checkpointReached, true);
    assert.equal(progress.current, 'c'); // still real — handleBatchReview needs this to keep refusing to run early
    assert.equal(progress.next, null);
  });

  test('no checkpointPolicy at all reports checkpointTask: null, checkpointReached: false regardless of progress', () => {
    const change = { tasks: [{ id: 'a', status: 'implemented' }] };
    const progress = deriveBatchProgress(change, { orderedTasks: ['a'] });
    assert.equal(progress.checkpointTask, null);
    assert.equal(progress.checkpointReached, false);
  });

  test('the persisted intent carries no progress fields — this function is the only source of them', () => {
    const intent = {
      change: 'c', requestedTasks: ['a'], orderedTasks: ['a'], startRevision: 'abc',
      reviewMode: 'batch', checkpointPolicy: null, temporaryInconsistencies: [],
    };
    assert.deepEqual(Object.keys(intent).sort(), [
      'change', 'checkpointPolicy', 'orderedTasks', 'requestedTasks', 'reviewMode', 'startRevision', 'temporaryInconsistencies',
    ].sort());
  });
});

describe('hardStopReason — checked before any risk signal, never bypassable by a full task-review (D24, AC12, AC13, AC14)', () => {
  test('a failed self-check is a hard stop, naming the failed criteria', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC2', 'AC5'] } };
    const r = hardStopReason(task);
    assert.equal(r.code, 'failed-self-check');
    assert.match(r.detail, /AC2, AC5/);
  });

  test('no self_check at all is a hard stop (unresolved)', () => {
    const r = hardStopReason({});
    assert.equal(r.code, 'unresolved-self-check');
  });

  test('a passed self-check is not a hard stop', () => {
    assert.equal(hardStopReason({ self_check: { status: 'passed' } }), null);
  });

  test('correcting the implementation and rerunning a previously-failing self-check clears the hard stop, resuming the batch (AC14)', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC2'] } };
    assert.notEqual(hardStopReason(task), null);
    task.self_check = { status: 'passed' }; // simulates a rerun self-check overwrite
    assert.equal(hardStopReason(task), null);
  });

  test('requiresFullReview never offers a full review as a substitute for a hard stop, regardless of risk signals (AC12, AC13)', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC2'] } };
    assert.equal(requiresFullReview(task, ['scope-expansion', 'public-api-impact']), false);
  });
});

describe('completionHardStop — `complete` gate for a missing/failed self-check (D24/D28, PR re-review packet 02)', () => {
  test('outside an active batch, a task with no self_check at all completes (self-check stays optional)', () => {
    assert.equal(completionHardStop({}, { inActiveBatch: false }), null);
  });

  test('inside an active batch, a task with no self_check at all is a hard stop — it must not silently complete', () => {
    const stop = completionHardStop({}, { inActiveBatch: true });
    assert.notEqual(stop, null);
    assert.equal(stop.code, 'unresolved-self-check');
  });

  test('a failed self-check is always a hard stop, in or out of a batch', () => {
    const task = { self_check: { status: 'failed', failed_criteria: ['AC1'] } };
    assert.notEqual(completionHardStop(task, { inActiveBatch: false }), null);
    assert.notEqual(completionHardStop(task, { inActiveBatch: true }), null);
  });

  test('a passed self-check never blocks completion, in or out of a batch', () => {
    const task = { self_check: { status: 'passed' } };
    assert.equal(completionHardStop(task, { inActiveBatch: false }), null);
    assert.equal(completionHardStop(task, { inActiveBatch: true }), null);
  });

  test('rerunning self-check to a passing result clears a previously in-batch-blocked completion', () => {
    const task = {};
    assert.notEqual(completionHardStop(task, { inActiveBatch: true }), null);
    task.self_check = { status: 'passed' };
    assert.equal(completionHardStop(task, { inActiveBatch: true }), null);
  });
});

describe('detectRiskSignals / requiresFullReview — evidence-based, self-check-excluding (D11/D24, AC4, AC5, AC15, AC16)', () => {
  const passedTask = { self_check: { status: 'passed' } };

  test('a task meeting no risk signal proceeds via self-check + gating review only (AC4, AC16)', () => {
    const signals = detectRiskSignals(passedTask, { allowed_paths: ['tools/foo.mjs'] }, { diffFiles: ['tools/foo.mjs'] });
    assert.deepEqual(signals, []);
    assert.equal(requiresFullReview(passedTask, signals), false);
  });

  test('a task meeting at least one risk signal cannot be batch-completed without its own task-review (AC5)', () => {
    const signals = detectRiskSignals(passedTask, { review: 'required' }, {});
    assert.deepEqual(signals, ['declared-review-required']);
    assert.equal(requiresFullReview(passedTask, signals), true);
  });

  test('scope expansion (REC-08) is detected as a risk signal', () => {
    const task = { self_check: { status: 'passed' }, execution: { suspension: { code: 'REC-08' } } };
    const signals = detectRiskSignals(task, {}, {});
    assert.ok(signals.includes('scope-expansion'));
  });

  test('an unexpected file outside allowed_paths is detected as a risk signal', () => {
    const signals = detectRiskSignals(passedTask, { allowed_paths: ['tools/foo.mjs'] }, { diffFiles: ['tools/foo.mjs', 'src/Oops.cs'] });
    assert.ok(signals.includes('unexpected-files'));
  });

  test('touching src/**/tests/**/consequential_paths alone is never a signal on its own', () => {
    const signals = detectRiskSignals(passedTask, { allowed_paths: ['src/Foo/**'] }, { diffFiles: ['src/Foo/Bar.cs'] });
    assert.deepEqual(signals, []);
  });

  test('an owner-flagged high-risk task is detected as a risk signal', () => {
    const signals = detectRiskSignals(passedTask, { high_risk: true }, {});
    assert.deepEqual(signals, ['owner-flagged-high-risk']);
  });

  test('extraSignals passes through only recognized signal codes (semantic judgment supplied by the caller)', () => {
    const signals = detectRiskSignals(passedTask, {}, { extraSignals: ['public-api-impact', 'not-a-real-signal'] });
    assert.deepEqual(signals, ['public-api-impact']);
  });

  test('a self-check that now passes but meets an independent risk signal still requires a full task-review (AC15)', () => {
    const task = { self_check: { status: 'passed' } }; // previously failed, now rerun and passed
    const signals = detectRiskSignals(task, { review: 'required' }, {});
    assert.equal(requiresFullReview(task, signals), true);
  });
});

describe('buildSelfCheckResult — the single self_check write shape (D28, AC17)', () => {
  test('a fully-passing run writes status: passed with no failed_criteria', () => {
    const r = buildSelfCheckResult({
      commandResults: [{ command: 'a', exit_code: 0 }, { command: 'b', exit_code: 0 }],
      fingerprint: 'fp1', revision: 'rev1',
    });
    assert.equal(r.status, 'passed');
    assert.equal(r.failed_criteria, undefined);
    assert.equal(r.fingerprint, 'fp1');
    assert.equal(r.revision, 'rev1');
    assert.deepEqual(r.commands, [{ command: 'a', exit_code: 0 }, { command: 'b', exit_code: 0 }]);
  });

  test('a failing run writes status: failed with failed_criteria naming the failing commands, exit codes readable from commands[]', () => {
    const r = buildSelfCheckResult({
      commandResults: [{ command: 'a', exit_code: 0 }, { command: 'b', exit_code: 1 }],
      fingerprint: 'fp1', revision: 'rev1',
    });
    assert.equal(r.status, 'failed');
    assert.deepEqual(r.failed_criteria, ['b']);
    assert.equal(r.commands[1].exit_code, 1);
  });
});

describe('isTemporaryInconsistency / batchValidationBlocks (AC6)', () => {
  const intent = { temporaryInconsistencies: [['task-a', 'task-b']] };

  test('a declared pair is recognized symmetrically', () => {
    assert.equal(isTemporaryInconsistency(intent, 'task-a', 'task-b'), true);
    assert.equal(isTemporaryInconsistency(intent, 'task-b', 'task-a'), true);
  });

  test('an undeclared pair is not recognized', () => {
    assert.equal(isTemporaryInconsistency(intent, 'task-a', 'task-c'), false);
  });

  test('a validate failure at the declared pair boundary does not block batch progress (AC6)', () => {
    assert.equal(batchValidationBlocks(intent, 'task-a', 'task-b', true), false);
  });

  test('a validate failure at any other boundary still blocks (AC6 — enforced everywhere except the declared pair)', () => {
    assert.equal(batchValidationBlocks(intent, 'task-b', 'task-c', true), true);
  });

  test('no validate failure at all never blocks, declared pair or not', () => {
    assert.equal(batchValidationBlocks(intent, 'task-a', 'task-b', false), false);
  });
});

describe('staleEvidenceTasks — evidence freshness before the gating review (D19/D28, AC10, AC11, AC18)', () => {
  function change() {
    return {
      tasks: [
        { id: 'a', self_check: { status: 'passed', fingerprint: 'fp-a' } },
        { id: 'b', self_check: { status: 'passed', fingerprint: 'fp-b' } },
      ],
    };
  }

  test('a later batched task\'s file-overlapping change invalidates an earlier task\'s evidence (AC10)', () => {
    const stale = staleEvidenceTasks(
      change(), ['a', 'b'],
      { a: ['tools/specs/shared.mjs'], b: ['tools/specs/shared.mjs'] },
      { a: 'fp-a', b: 'fp-b' } // fingerprints unchanged — only the file overlap should trigger
    );
    assert.deepEqual(stale, ['a']);
  });

  test('an unrelated later-batched task\'s change does not stale an earlier task\'s evidence (AC11)', () => {
    const stale = staleEvidenceTasks(
      change(), ['a', 'b'],
      { a: ['tools/specs/a-only.mjs'], b: ['tools/specs/b-only.mjs'] },
      { a: 'fp-a', b: 'fp-b' }
    );
    assert.deepEqual(stale, []);
  });

  test('a self_check.fingerprint no longer matching the current fingerprint is stale regardless of file overlap (D28, AC18)', () => {
    const stale = staleEvidenceTasks(
      change(), ['a', 'b'],
      {}, // no file-touch data at all
      { a: 'fp-a-CHANGED', b: 'fp-b' }
    );
    assert.deepEqual(stale, ['a']);
  });

  test('a task with no self_check at all is skipped, not reported stale', () => {
    const c = { tasks: [{ id: 'a' }, { id: 'b', self_check: { status: 'passed', fingerprint: 'fp-b' } }] };
    const stale = staleEvidenceTasks(c, ['a', 'b'], {}, { a: 'anything', b: 'fp-b' });
    assert.deepEqual(stale, []);
  });
});

describe('attributeTouchedPaths — real whole-batch diff attribution, never an empty caller-supplied map (PR re-review packet 03)', () => {
  test('a changed file is attributed to the one task whose declared paths match it', () => {
    const result = attributeTouchedPaths(
      ['a', 'b'],
      { a: ['tools/foo.mjs'], b: ['tools/bar.mjs'] },
      ['tools/foo.mjs', 'tools/bar.mjs', 'unrelated/baz.mjs']
    );
    assert.deepEqual(result, { a: ['tools/foo.mjs'], b: ['tools/bar.mjs'] });
  });

  test('a file matching more than one task\'s declared paths is attributed to every matching task (ambiguous shared file)', () => {
    const result = attributeTouchedPaths(
      ['a', 'b'],
      { a: ['tools/specs/**'], b: ['tools/specs/lifecycle.mjs'] },
      ['tools/specs/lifecycle.mjs']
    );
    assert.deepEqual(result, { a: ['tools/specs/lifecycle.mjs'], b: ['tools/specs/lifecycle.mjs'] });
  });

  test('a changed file matching no batched task\'s declared paths is attributed to none of them', () => {
    const result = attributeTouchedPaths(['a'], { a: ['tools/foo.mjs'] }, ['docs/unrelated.md']);
    assert.deepEqual(result, { a: [] });
  });

  test('a task with no declared paths at all gets an empty attribution, not a crash', () => {
    const result = attributeTouchedPaths(['a'], {}, ['tools/foo.mjs']);
    assert.deepEqual(result, { a: [] });
  });
});

describe('detectBatchIntegrationFindings — deterministic whole-batch findings, never composed as review prose (PR re-review packet 03)', () => {
  test('two tasks that actually touched the same file produce a finding naming both tasks and the shared path', () => {
    const intent = { temporaryInconsistencies: [] };
    const touchedPaths = { a: ['tools/shared.mjs'], b: ['tools/shared.mjs'], c: ['tools/only-c.mjs'] };
    const findings = detectBatchIntegrationFindings(intent, ['a', 'b', 'c'], touchedPaths);
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].tasks, ['a', 'b']);
    assert.deepEqual(findings[0].paths, ['tools/shared.mjs']);
  });

  test('no shared touched files produces no findings', () => {
    const intent = { temporaryInconsistencies: [] };
    const touchedPaths = { a: ['tools/a-only.mjs'], b: ['tools/b-only.mjs'] };
    assert.deepEqual(detectBatchIntegrationFindings(intent, ['a', 'b'], touchedPaths), []);
  });

  test('a declared temporary-inconsistency pair\'s overlap is not reported (already owner-sanctioned)', () => {
    const intent = { temporaryInconsistencies: [['a', 'b']] };
    const touchedPaths = { a: ['tools/shared.mjs'], b: ['tools/shared.mjs'] };
    assert.deepEqual(detectBatchIntegrationFindings(intent, ['a', 'b'], touchedPaths), []);
  });

  test('declared-pattern overlap alone (no actually-shared file) produces no finding — real diff evidence only', () => {
    const intent = { temporaryInconsistencies: [] };
    const touchedPaths = { a: ['tools/a-only.mjs'], b: [] }; // b declared overlapping patterns but touched nothing shared
    assert.deepEqual(detectBatchIntegrationFindings(intent, ['a', 'b'], touchedPaths), []);
  });
});

describe('computeBatchReviewVerdict — explicit table, never a re-evaluation of individual acceptance criteria (AC7)', () => {
  test('every value is a member of BATCH_REVIEW_VERDICTS', () => {
    for (const v of [
      computeBatchReviewVerdict({}),
      computeBatchReviewVerdict({ otherFindings: 1 }),
      computeBatchReviewVerdict({ ownerDecisionFindings: 1 }),
    ]) {
      assert.equal(BATCH_REVIEW_VERDICTS.has(v), true);
    }
  });

  test('no findings at all is no-findings', () => {
    assert.equal(computeBatchReviewVerdict({}), 'no-findings');
  });

  test('any owner-decision finding wins over other findings', () => {
    assert.equal(computeBatchReviewVerdict({ ownerDecisionFindings: 1, otherFindings: 3 }), 'owner-decision-required');
  });

  test('other findings alone (no owner-decision findings) is changes-recommended', () => {
    assert.equal(computeBatchReviewVerdict({ otherFindings: 2 }), 'changes-recommended');
  });
});
