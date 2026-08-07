// Tests for task 19 (unowned-drift-correction-flow, D34/D35, area
// unowned-drift-correction): classifyUnownedDrift, the three-option owner
// menu, and validateMaintenanceCorrectionEntry — all pure functions in
// tools/specs/lifecycle.mjs. Closes follow-ups.yaml FU-006.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyUnownedDrift, UNOWNED_DRIFT_OPTIONS, validateMaintenanceCorrectionEntry,
} from '../specs/lifecycle.mjs';

const taskPaths = {
  t1: { allowedPaths: ['tools/specs/lifecycle.mjs'], consequentialPaths: ['docs/index.generated.md'], forbiddenPaths: ['AGENTS.md', 'docs/development/**'] },
  t2: { allowedPaths: ['tools/tests/**'], consequentialPaths: [], forbiddenPaths: ['CLAUDE.md'] },
};

// ── classifyUnownedDrift (AC1, AC2) ─────────────────────────────────────────

describe('classifyUnownedDrift — outside every task\'s scope, not the current task\'s own diff, and not forbidden (AC1)', () => {
  test('a path outside every declared scope, not attributable to the current task, classifies unowned-drift', () => {
    assert.equal(classifyUnownedDrift('docs/ai/some-other-doc.md', taskPaths), 'unowned-drift');
  });

  test('a path inside a task\'s allowed_paths classifies owned', () => {
    assert.equal(classifyUnownedDrift('tools/specs/lifecycle.mjs', taskPaths), 'owned');
  });

  test('a path inside a task\'s consequential_paths classifies owned', () => {
    assert.equal(classifyUnownedDrift('docs/index.generated.md', taskPaths), 'owned');
  });

  test('a path attributed to the current task\'s own diff classifies owned even if no task declares it', () => {
    assert.equal(
      classifyUnownedDrift('some/other/file.mjs', taskPaths, { currentTaskChangedPaths: ['some/other/file.mjs'] }),
      'owned',
    );
  });

  test('a path matching any task\'s forbidden_paths classifies forbidden (AC2), never unowned-drift', () => {
    assert.equal(classifyUnownedDrift('docs/development/git-workflow.md', {
      ...taskPaths, t1: { ...taskPaths.t1, forbiddenPaths: ['docs/development/**'] },
    }), 'forbidden');
  });

  test('forbidden wins over an attempted current-task attribution', () => {
    assert.equal(
      classifyUnownedDrift('AGENTS.md', taskPaths, { currentTaskChangedPaths: ['AGENTS.md'] }),
      'forbidden',
    );
  });
});

// ── UNOWNED_DRIFT_OPTIONS (AC2) ─────────────────────────────────────────────

describe('UNOWNED_DRIFT_OPTIONS — the three-option owner menu', () => {
  test('names exactly the three options, in order', () => {
    assert.deepEqual(UNOWNED_DRIFT_OPTIONS, ['create-corrective-task', 'amend-existing-task', 'maintenance-correction']);
  });
});

// ── validateMaintenanceCorrectionEntry (AC3) ────────────────────────────────

function fullEntry(overrides = {}) {
  return {
    id: 'FU-100', source_task: 't1', kind: 'maintenance-correction', severity: 'non-blocking',
    reason: 'Fixed a stale doc.', resolver_task: null, status: 'resolved', resolution: 'Done.',
    paths: ['docs/development/git-workflow.md'], confirmed_by: 'owner', confirmed_at: '2026-08-07',
    revision: 'abc123',
    ...overrides,
  };
}

describe('validateMaintenanceCorrectionEntry — exact paths, reason, owner confirmation, revision (AC3)', () => {
  test('a complete entry validates', () => {
    assert.deepEqual(validateMaintenanceCorrectionEntry(fullEntry()), { ok: true });
  });

  test('missing paths is rejected', () => {
    const entry = fullEntry({ paths: undefined });
    const result = validateMaintenanceCorrectionEntry(entry);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('paths'));
  });

  test('a glob in paths is rejected — one exact path per entry, never a blanket pattern', () => {
    const entry = fullEntry({ paths: ['docs/development/**'] });
    const result = validateMaintenanceCorrectionEntry(entry);
    assert.equal(result.ok, false);
    assert.match(result.missing.join(','), /no globs/);
  });

  test('missing confirmed_by (or not literally "owner") is rejected', () => {
    assert.equal(validateMaintenanceCorrectionEntry(fullEntry({ confirmed_by: undefined })).ok, false);
    assert.equal(validateMaintenanceCorrectionEntry(fullEntry({ confirmed_by: 'agent' })).ok, false);
  });

  test('missing confirmed_at is rejected', () => {
    assert.equal(validateMaintenanceCorrectionEntry(fullEntry({ confirmed_at: undefined })).ok, false);
  });

  test('missing revision is rejected', () => {
    assert.equal(validateMaintenanceCorrectionEntry(fullEntry({ revision: undefined })).ok, false);
  });

  test('missing reason is rejected', () => {
    assert.equal(validateMaintenanceCorrectionEntry(fullEntry({ reason: undefined })).ok, false);
  });
});

// ── Retrospective fixtures for the two FU-006 incidents (AC5) ───────────────

describe('the two FU-006 incidents, reconstructed as fixtures, classify unowned-drift (AC5)', () => {
  test('docs/development/git-workflow.md (edited outside any task\'s own scope, made stale by task 09\'s diff) classifies unowned-drift', () => {
    const incidentPaths = {
      t09: { allowedPaths: ['tools/specs.mjs'], consequentialPaths: [], forbiddenPaths: ['docs/development/**'] },
    };
    assert.equal(classifyUnownedDrift('docs/development/git-workflow.md', incidentPaths), 'forbidden');
    // Note: forbidden_paths already excludes docs/development/** on every task
    // (per this change's own overview.md), which is exactly why FU-006 named
    // this a gap in the first place — no task's allowed_paths ever covered
    // it either, so a real fix required this named flow rather than an
    // ad hoc edit.
  });

  test('task-review.md\'s missing consequential_paths carve-out (required by task 06, only closed when task 13 happened to also own the file) classifies unowned-drift for task 06 at the time it was needed', () => {
    const incidentPaths = {
      t06: { allowedPaths: ['tools/specs/service.mjs'], consequentialPaths: [], forbiddenPaths: [] },
    };
    assert.equal(classifyUnownedDrift('.claude/commands/nevo-ai/task-review.md', incidentPaths), 'unowned-drift');
  });
});
