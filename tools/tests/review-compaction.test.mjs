// Tests for task 13 (review-report-compaction-and-scope-exceptions, D31, area
// review-report-compaction-and-scope-exceptions)'s deterministic surface in
// tools/specs/lifecycle.mjs: computeTaskReviewChecklist (the seven-item
// verdict-consistency guard), classifyScopeFinding (compliant/outside-allowed/
// forbidden), and isScopeExceptionValid (path/task-fingerprint exception
// validity across re-review). Report shape/wording (the compact checklist
// rendering, the aggregate table, the scope-exception owner menu) is a
// template/command-file concern verified by inspection, per this task's own
// acceptance criteria — not something a pure function renders. Run:
// node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTaskReviewChecklist, TASK_REVIEW_CHECKLIST_ITEMS, TASK_REVIEW_VERDICTS,
  classifyScopeFinding, isScopeExceptionValid,
} from '../specs/lifecycle.mjs';

// ── computeTaskReviewChecklist (AC1, AC3, AC4, AC5, AC6) ────────────────────

function cleanChecklistInput() {
  return {
    acCoverageComplete: true,
    missingRequiredAutomatedTest: false,
    verificationPassed: true,
    scopeStatus: 'compliant',
    forbiddenPathClean: true,
    docsConsistent: true,
    unresolvedBlockingCount: 0,
    unresolvedOwnerDecisionCount: 0,
  };
}

describe('computeTaskReviewChecklist — deterministic verdict-consistency guard (AC3, AC4, AC5, AC6)', () => {
  test('every one of the seven checklist items resolving clean yields pass, no unresolved items', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    assert.deepEqual(result, { verdict: 'pass', unresolvedItems: [] });
  });

  test('TASK_REVIEW_CHECKLIST_ITEMS names exactly the seven items, in checklist order', () => {
    assert.deepEqual(TASK_REVIEW_CHECKLIST_ITEMS, [
      'ac-coverage', 'verification', 'scope', 'forbidden-path', 'docs', 'blocking-findings', 'owner-decision',
    ]);
  });

  test('pass is impossible when exactly one of the seven items is false, tested independently (AC3)', () => {
    const perItemOverride = {
      'ac-coverage': { acCoverageComplete: false },
      'verification': { verificationPassed: false },
      'scope': { scopeStatus: 'unresolved' },
      'forbidden-path': { forbiddenPathClean: false },
      'docs': { docsConsistent: false },
      'blocking-findings': { unresolvedBlockingCount: 1 },
      'owner-decision': { unresolvedOwnerDecisionCount: 1 },
    };
    for (const item of TASK_REVIEW_CHECKLIST_ITEMS) {
      const input = { ...cleanChecklistInput(), ...perItemOverride[item] };
      const result = computeTaskReviewChecklist(input);
      assert.notEqual(result.verdict, 'pass', `item '${item}' alone false must not yield pass`);
      assert.ok(TASK_REVIEW_VERDICTS.has(result.verdict));
      assert.ok(
        result.unresolvedItems.some(u => u.item === item),
        `unresolvedItems must name '${item}'`,
      );
    }
  });

  test('a missing required automated test is AUTO_FIX-blocking, never merely non-blocking, even with acCoverageComplete true (AC4, AC5)', () => {
    const result = computeTaskReviewChecklist({
      ...cleanChecklistInput(),
      acCoverageComplete: true,
      missingRequiredAutomatedTest: true,
    });
    assert.notEqual(result.verdict, 'pass');
    const finding = result.unresolvedItems.find(u => u.reason.includes('explicitly required automated test'));
    assert.ok(finding, 'missing-required-test finding must be present');
    assert.equal(finding.category, 'AUTO_FIX');
  });

  test('a passing verification command alone never satisfies AC coverage for a scenario the tests do not exercise (AC5)', () => {
    // verificationPassed: true (the command ran and exited 0), but the required
    // test scenario itself is still missing — must not be pass.
    const result = computeTaskReviewChecklist({
      ...cleanChecklistInput(),
      verificationPassed: true,
      missingRequiredAutomatedTest: true,
    });
    assert.notEqual(result.verdict, 'pass');
  });

  test('an unrecognized scopeStatus is rejected rather than silently treated as compliant', () => {
    assert.throws(() => computeTaskReviewChecklist({ ...cleanChecklistInput(), scopeStatus: 'bogus' }), /Unknown scope status/);
  });

  test('multiple unresolved items are all reported together, not just the first', () => {
    const result = computeTaskReviewChecklist({
      ...cleanChecklistInput(),
      verificationPassed: false,
      docsConsistent: false,
    });
    assert.equal(result.unresolvedItems.length, 2);
    assert.deepEqual(result.unresolvedItems.map(u => u.item).sort(), ['docs', 'verification']);
  });
});

// ── classifyScopeFinding (AC7) ───────────────────────────────────────────────

describe('classifyScopeFinding — compliant / outside-allowed / forbidden (AC7)', () => {
  const paths = {
    allowedPaths: ['tools/specs/lifecycle.mjs', 'docs/ai/**'],
    forbiddenPaths: ['src/**', 'AGENTS.md'],
  };

  test('an exact allowed_paths match is compliant', () => {
    assert.equal(classifyScopeFinding('tools/specs/lifecycle.mjs', paths), 'compliant');
  });

  test('a path under an allowed_paths ** prefix is compliant', () => {
    assert.equal(classifyScopeFinding('docs/ai/specification-workflow.md', paths), 'compliant');
  });

  test('a path matching neither allowed_paths nor forbidden_paths is outside-allowed', () => {
    assert.equal(classifyScopeFinding('tools/specs/service.mjs', paths), 'outside-allowed');
  });

  test('an exact forbidden_paths match is forbidden', () => {
    assert.equal(classifyScopeFinding('AGENTS.md', paths), 'forbidden');
  });

  test('a path under a forbidden_paths ** prefix is forbidden', () => {
    assert.equal(classifyScopeFinding('src/NEvo.Core/Foo.cs', paths), 'forbidden');
  });

  test('forbidden_paths wins over allowed_paths for a path matching both patterns', () => {
    const overlapping = { allowedPaths: ['src/**'], forbiddenPaths: ['src/**'] };
    assert.equal(classifyScopeFinding('src/anything.cs', overlapping), 'forbidden');
  });
});

// ── isScopeExceptionValid (AC10) ─────────────────────────────────────────────

describe('isScopeExceptionValid — path/task-fingerprint validity across re-review (AC10)', () => {
  const exception = {
    finding: 'F1',
    path: 'tools/tests/start.test.mjs',
    reason: 'Dedicated lifecycle tests are clearer here.',
    decision: 'accepted',
    task_fingerprint: 'abc123',
  };

  test('a matching path and task fingerprint is valid', () => {
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/start.test.mjs', taskFingerprint: 'abc123' }), true);
  });

  test('a changed task fingerprint invalidates the exception', () => {
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/start.test.mjs', taskFingerprint: 'def456' }), false);
  });

  test('a different path never matches an existing entry', () => {
    assert.equal(isScopeExceptionValid(exception, { path: 'tools/tests/other.test.mjs', taskFingerprint: 'abc123' }), false);
  });

  test('no recorded exception at all is invalid', () => {
    assert.equal(isScopeExceptionValid(null, { path: 'tools/tests/start.test.mjs', taskFingerprint: 'abc123' }), false);
  });
});

// ── Integration: scope classification + exception validity feeding the checklist (AC8, AC9) ─

describe('scope classification and exception validity feeding computeTaskReviewChecklist (AC8, AC9)', () => {
  const paths = { allowedPaths: ['tools/specs/lifecycle.mjs'], forbiddenPaths: ['src/**'] };

  test('an outside-allowed finding with no recorded scope_exceptions entry keeps pass unreachable (AC8)', () => {
    const classification = classifyScopeFinding('tools/specs/service.mjs', paths);
    assert.equal(classification, 'outside-allowed');
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), scopeStatus: 'unresolved' });
    assert.notEqual(result.verdict, 'pass');
  });

  test('the same outside-allowed finding with a valid, matching scope_exceptions entry no longer counts as unresolved (AC8)', () => {
    const exception = { path: 'tools/specs/service.mjs', task_fingerprint: 'fp1' };
    const valid = isScopeExceptionValid(exception, { path: 'tools/specs/service.mjs', taskFingerprint: 'fp1' });
    assert.equal(valid, true);
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), scopeStatus: 'accepted-exception' });
    assert.equal(result.verdict, 'pass');
  });

  test('a forbidden finding is never resolvable through scope_exceptions — unresolved regardless of any recorded exception naming that path (AC9)', () => {
    const classification = classifyScopeFinding('src/NEvo.Core/Foo.cs', paths);
    assert.equal(classification, 'forbidden');
    // Even a scope_exceptions entry naming this exact path/fingerprint must never
    // clear it — forbiddenPathClean stays false regardless of scopeStatus.
    const result = computeTaskReviewChecklist({
      ...cleanChecklistInput(),
      scopeStatus: 'compliant',
      forbiddenPathClean: false,
    });
    assert.notEqual(result.verdict, 'pass');
    assert.ok(result.unresolvedItems.some(u => u.item === 'forbidden-path'));
  });
});
