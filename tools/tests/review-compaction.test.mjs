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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  computeTaskReviewChecklist, TASK_REVIEW_CHECKLIST_ITEMS, TASK_REVIEW_VERDICTS,
  classifyScopeFinding, isScopeExceptionValid,
  renderCompactReviewChecklist, renderNormalPassingReportBody, checkReportSectionUniqueness,
} from '../specs/lifecycle.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// ── Template shape regression: the actual checklist example in
// templates/review-report.md, not a self-authored fixture (AC1) ────────────

function templateReportContent() {
  return readFileSync(join(ROOT, '.claude/skills/nevo-ai-spec-workflow/templates/review-report.md'), 'utf8').replace(/\r\n/g, '\n');
}

describe('templates/review-report.md — Checklist section shape (AC1, corrected: 3-row minimal pass)', () => {
  const content = templateReportContent();
  const checklistHeadingIdx = content.indexOf('## Checklist');
  const passingBlockStart = content.indexOf('```', checklistHeadingIdx);
  const passingBlockEnd = content.indexOf('```', passingBlockStart + 3);
  const passingBlock = content.slice(passingBlockStart + 3, passingBlockEnd).trim();
  const lines = passingBlock.split('\n');

  test('the normal-pass example is exactly three rows: AC coverage, Scope, Findings', () => {
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^- \[x\] Acceptance criteria: \d+\/\d+$/);
    assert.equal(lines[1], '- [x] Scope: compliant');
    assert.equal(lines[2], '- [x] Findings: none unresolved');
  });

  test('the normal-pass example never restates any of the four internal-only gates as its own row', () => {
    for (const forbiddenText of [
      'Required automated verification passed', 'No forbidden-path violation remains unresolved',
      'Architecture and documentation remain consistent', 'No unresolved owner decision', 'No unresolved blocking findings',
    ]) {
      assert.ok(!passingBlock.includes(forbiddenText), `passing example must not restate "${forbiddenText}"`);
    }
  });

  test('the "Scope: resolved" exception-note example keeps the row checked and never uses the false-compliance word "compliant"', () => {
    const noteBlockStart = content.indexOf('```', passingBlockEnd + 3);
    const noteBlockEnd = content.indexOf('```', noteBlockStart + 3);
    const noteBlock = content.slice(noteBlockStart + 3, noteBlockEnd);
    assert.match(noteBlock, /- \[x\] Scope: resolved/);
    assert.match(noteBlock, /owner-approved exception recorded/);
    assert.doesNotMatch(noteBlock, /\[x\] Scope: compliant/);
  });

  test('the failing/exception-pending example still uses the full seven-item expanded shape, unchanged from task 13', () => {
    const failingHeadingIdx = content.indexOf('Failing / exception-pending');
    const failingBlockStart = content.indexOf('```', failingHeadingIdx);
    const failingBlockEnd = content.indexOf('```', failingBlockStart + 3);
    const failingBlock = content.slice(failingBlockStart + 3, failingBlockEnd).trim();
    const failingLines = failingBlock.split('\n').filter(l => !l.startsWith('  -'));
    assert.equal(failingLines.length, 7);
  });
});

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

// ── Task 14 (review-report-minimization, D34/D35, area §E): renderCompactReviewChecklist / renderNormalPassingReportBody / checkReportSectionUniqueness ──

function nonEmptyLines(text) {
  return text.split('\n').filter(l => l.trim().length > 0);
}

describe('renderCompactReviewChecklist — deterministic checklist rendering (task 14)', () => {
  test('a clean pass result renders exactly the seven checked items, in order, no continuation lines', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const rendered = renderCompactReviewChecklist(result);
    const lines = rendered.split('\n');
    assert.equal(lines.length, 7);
    for (const line of lines) assert.match(line, /^- \[x\] /);
  });

  test('a failed item renders unchecked with its reason(s) as indented continuation lines', () => {
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), docsConsistent: false });
    const rendered = renderCompactReviewChecklist(result);
    const lines = rendered.split('\n');
    const docsIdx = lines.findIndex(l => l.includes('Architecture and documentation remain consistent'));
    assert.match(lines[docsIdx], /^- \[ \] /);
    assert.match(lines[docsIdx + 1], /^  - /);
  });

  test('an active scope exception appends the owner-approved-exception note under the still-checked scope item, never false-compliance wording', () => {
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), scopeStatus: 'accepted-exception' });
    const rendered = renderCompactReviewChecklist(result, { scopeExceptionCount: 1 });
    assert.match(rendered, /- \[x\] Scope check resolved\n {2}- 1 owner-approved exception recorded/);
    assert.doesNotMatch(rendered, /stays within `?allowed_paths`?/);
  });
});

describe('renderNormalPassingReportBody — the minimal 4-line normal-passing body (task 14, corrected: 3 rows, not 7, plus title)', () => {
  test('a fully-passing report (no exception) is exactly 4 non-empty lines: title + AC coverage + Scope + Findings', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: some-change/some-task', totalAcceptanceCriteria: 11 });
    const lines = nonEmptyLines(body);
    assert.equal(lines.length, 4, `expected exactly 4 non-empty lines, got ${lines.length}`);
    assert.equal(lines[0], '# Review: some-change/some-task');
    assert.equal(lines[1], '- [x] Acceptance criteria: 11/11');
    assert.equal(lines[2], '- [x] Scope: compliant');
    assert.equal(lines[3], '- [x] Findings: none unresolved');
  });

  test('a fully-passing report with one accepted scope exception adds exactly one nested line (5 total)', () => {
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), scopeStatus: 'accepted-exception' });
    const body = renderNormalPassingReportBody(result, {
      title: 'Review: some-change/some-task', totalAcceptanceCriteria: 11, scopeExceptionCount: 1,
    });
    const lines = nonEmptyLines(body);
    assert.equal(lines.length, 5, `expected exactly 5 non-empty lines, got ${lines.length}`);
    assert.equal(lines[2], '- [x] Scope: resolved');
    assert.equal(lines[3], '  - 1 owner-approved exception recorded');
  });

  test('the four internal-only gates (verification, forbidden-path, docs, owner-decision) never render as their own positive rows', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: x/y', totalAcceptanceCriteria: 5 });
    for (const forbiddenText of [
      'Required automated verification passed', 'No forbidden-path violation remains unresolved',
      'Architecture and documentation remain consistent', 'No unresolved owner decision', 'No unresolved blocking findings',
    ]) {
      assert.ok(!body.includes(forbiddenText), `body must not restate "${forbiddenText}" as its own row`);
    }
  });

  test('the normal-passing body contains none of the excluded prose forms (AC4)', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: some-change/some-task', totalAcceptanceCriteria: 3 });
    const forbidden = [
      /because/i, /passed \d+/i, /test count/i, /## Findings/, /## Verification/,
      /## Acceptance-criteria coverage/, /INFORMATIONAL/, /commit/i,
    ];
    for (const re of forbidden) assert.doesNotMatch(body, re, `body must not match ${re}`);
  });

  test('pass is required — throws for a non-pass checklist result rather than silently truncating it (AC6)', () => {
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), docsConsistent: false });
    assert.throws(() => renderNormalPassingReportBody(result, { title: 'x', totalAcceptanceCriteria: 3 }), /only for a passing checklist result/);
  });

  test('totalAcceptanceCriteria is required — throws rather than rendering a bare "Acceptance criteria" line with no count', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    assert.throws(() => renderNormalPassingReportBody(result, { title: 'x' }), /requires totalAcceptanceCriteria/);
  });

  test('a failing report keeps the expanded shape — computeTaskReviewChecklist output for a failure still names the failed items in full, not truncated for a line budget (AC5)', () => {
    const result = computeTaskReviewChecklist({ ...cleanChecklistInput(), acCoverageComplete: false, verificationPassed: false });
    assert.equal(result.unresolvedItems.length, 2);
    const rendered = renderCompactReviewChecklist(result);
    assert.match(rendered, /All acceptance criteria covered/);
    assert.match(rendered, /Required automated verification passed/);
  });
});

describe('checkReportSectionUniqueness — AC coverage/scope/findings appear at most once (task 14, AC3)', () => {
  test('a normal passing body (checklist only) reports no duplicates', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const body = renderNormalPassingReportBody(result, { title: 'Review: x/y', totalAcceptanceCriteria: 4 });
    assert.deepEqual(checkReportSectionUniqueness(body), { ok: true, duplicates: [] });
  });

  test('a report restating "All acceptance criteria covered" under a second heading is flagged', () => {
    const body = [
      '- [x] All acceptance criteria covered',
      '## Acceptance-criteria coverage',
      '- [x] All 11 acceptance criteria covered',
    ].join('\n');
    const { ok, duplicates } = checkReportSectionUniqueness(body);
    assert.equal(ok, false);
    assert.ok(duplicates.some(d => d.section === 'ac-coverage'));
  });

  test('two "## Findings" headings in the same report are flagged', () => {
    const body = '## Findings\nNo findings.\n\n## Findings\nSomething else.';
    const { ok, duplicates } = checkReportSectionUniqueness(body);
    assert.equal(ok, false);
    assert.ok(duplicates.some(d => d.section === 'findings'));
  });
});

// ── Same minimal per-task format used by the implementation-review aggregate (task 14, AC7) ──

describe('renderNormalPassingReportBody reused for implementation-review per-task detail (task 14, AC7)', () => {
  test('a passing task expanded inside an aggregate report renders through the same function — no second, divergent minimal-report renderer', () => {
    const result = computeTaskReviewChecklist(cleanChecklistInput());
    const perTaskBody = renderNormalPassingReportBody(result, {
      title: 'Review: change/task-a (implementation-review, scope: 01-03)', totalAcceptanceCriteria: 7,
    });
    assert.ok(nonEmptyLines(perTaskBody).length <= 10);
    assert.equal(nonEmptyLines(perTaskBody).length, 4);
    assert.deepEqual(checkReportSectionUniqueness(perTaskBody), { ok: true, duplicates: [] });
  });
});
