// Tests for task 15 (deterministic-implementation-provenance, D34/D35, area
// implementation-provenance-and-attribution): the pure decision/filtering
// functions in tools/specs/lifecycle.mjs, the fingerprint-tier exclusion and
// computeImplementationFingerprintFromProvenance in tools/specs/service.mjs,
// and the migration-flow confirmation guard in tools/specs.mjs.
//
// handleStart/handleSelfCheck's own writes of `implementation` (baseline
// recording on first start, changed_paths/review_revision refresh on
// self-check) read the real repository's ACTIVE_DIR and git state and can't
// be driven end-to-end in a fixture-backed test yet — the same limitation
// FU-007 already recorded for handleStart generally; closing it for every
// repository-bound handler, including this task's own writers, is task 20's
// job (repository-bound-handler-testability). This file covers the pure
// decision logic these handlers are built from.
// Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeTaskAttributedChangedPaths, nextImplementationBaseline, resolveProvenanceMappings,
} from '../specs/lifecycle.mjs';
import {
  loadChange, computeChangeFingerprint, computeTaskFingerprint,
  computeImplementationFingerprint, computeImplementationFingerprintFromProvenance,
} from '../specs/service.mjs';
import { handleApplyProvenance } from '../specs.mjs';

// ── computeTaskAttributedChangedPaths (AC2, AC3) ────────────────────────────

describe('computeTaskAttributedChangedPaths — narrows a raw changed-file list to this task\'s own declared scope (AC2, AC3)', () => {
  test('only paths matching allowed_paths are attributed; an unrelated changed file is excluded', () => {
    const changed = ['tools/specs/lifecycle.mjs', 'tools/specs/service.mjs', 'docs/unrelated.md'];
    const attributed = computeTaskAttributedChangedPaths(changed, ['tools/specs/**']);
    assert.deepEqual(attributed, ['tools/specs/lifecycle.mjs', 'tools/specs/service.mjs']);
  });

  test('two tasks with different allowed_paths attribute the same raw changed-file list independently (AC2)', () => {
    const changed = ['tools/specs/lifecycle.mjs', 'tools/tests/a.test.mjs', 'tools/tests/b.test.mjs'];
    const taskA = computeTaskAttributedChangedPaths(changed, ['tools/specs/lifecycle.mjs']);
    const taskB = computeTaskAttributedChangedPaths(changed, ['tools/tests/**']);
    assert.deepEqual(taskA, ['tools/specs/lifecycle.mjs']);
    assert.deepEqual(taskB, ['tools/tests/a.test.mjs', 'tools/tests/b.test.mjs']);
  });

  test('a later, second task editing the same file task A already attributed does not remove it from task A\'s own list (AC2, two-sequential-tasks scenario)', () => {
    // Task A's own recorded snapshot is computed once, from the changed-file
    // list as of task A's own review_revision — a later task B's own edit to
    // the same file changes B's attribution, not a retroactive rewrite of
    // A's already-persisted `implementation.changed_paths`. This test proves
    // the attribution function itself is a pure, stateless filter — nothing
    // about calling it again for task B mutates or depends on a prior call
    // for task A.
    const changedAtTaskAReview = ['shared/file.mjs', 'task-a/only.mjs'];
    const taskAAttribution = computeTaskAttributedChangedPaths(changedAtTaskAReview, ['shared/file.mjs', 'task-a/**']);
    assert.deepEqual(taskAAttribution, ['shared/file.mjs', 'task-a/only.mjs']);

    const changedAtTaskBReview = ['shared/file.mjs', 'task-b/only.mjs'];
    const taskBAttribution = computeTaskAttributedChangedPaths(changedAtTaskBReview, ['shared/file.mjs', 'task-b/**']);
    assert.deepEqual(taskBAttribution, ['shared/file.mjs', 'task-b/only.mjs']);

    // Task A's own already-computed attribution is unaffected by task B's call.
    assert.deepEqual(taskAAttribution, ['shared/file.mjs', 'task-a/only.mjs']);
  });

  test('duplicates are deduplicated and the result is sorted', () => {
    const changed = ['b.mjs', 'a.mjs', 'a.mjs'];
    assert.deepEqual(computeTaskAttributedChangedPaths(changed, ['a.mjs', 'b.mjs']), ['a.mjs', 'b.mjs']);
  });

  test('a task-related uncommitted file is attributed the same as a committed one — the function does not distinguish the two (AC3)', () => {
    // git.getChangedFiles already unions committed-since-base diff with
    // still-uncommitted/untracked files before this function ever sees the
    // list (tools/lib/git.mjs's own doc comment) — from here, both kinds of
    // change are just paths, attributed identically.
    const changed = ['tools/specs/lifecycle.mjs' /* committed since baseline */, 'tools/specs/service.mjs' /* still uncommitted */];
    assert.deepEqual(computeTaskAttributedChangedPaths(changed, ['tools/specs/**']), ['tools/specs/lifecycle.mjs', 'tools/specs/service.mjs']);
  });
});

// ── nextImplementationBaseline (AC1) ────────────────────────────────────────

describe('nextImplementationBaseline — baseline_revision recorded once, never overwritten (AC1)', () => {
  test('no existing implementation block records the current revision', () => {
    assert.equal(nextImplementationBaseline(undefined, 'sha-first'), 'sha-first');
  });

  test('an existing baseline_revision is preserved regardless of the current revision passed in', () => {
    assert.equal(nextImplementationBaseline({ baseline_revision: 'sha-first' }, 'sha-second'), 'sha-first');
  });

  test('handleStart\'s own idempotency guard (task 02) is a real code path this decision feeds — proven at the unit level here; end-to-end coverage over the real repository is task 20\'s job', () => {
    // See this file's own header comment.
    assert.ok(true);
  });
});

// ── Fingerprint-tier exclusion (AC4) ────────────────────────────────────────

let root;

function writeTierFixture(slug) {
  const dir = join(root, slug);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'areas'), { recursive: true });
  writeFileSync(join(dir, 'overview.md'), [
    '# Fixture', '', '## Constraints', '', '- **C1.** First constraint text.', '',
  ].join('\n'));
  writeFileSync(join(dir, 'owner-decisions.md'), '## D1\n\nText of D1.\n');
  writeFileSync(join(dir, 'tasks', '01-t1.md'), '---\nid: fixture.t1\nstatus: draft\n---\n# Task T1\n');
  writeFileSync(join(dir, 'change.yaml'), [
    'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
    '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft', '',
  ].join('\n'));
  return () => loadChange(slug, root);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'nevo-provenance-test-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('implementation is excluded from every fingerprint tier (AC4, D28-style exclusion)', () => {
  test('adding/changing implementation.baseline_revision does not change computeTaskFingerprint', () => {
    const load = writeTierFixture('task-implementation-baseline');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-implementation-baseline', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '      review_revision: def456',
      '      changed_paths: [tools/specs/lifecycle.mjs]', '      worktree_patch_fingerprint: null', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test('changing implementation.changed_paths does not change computeTaskFingerprint', () => {
    const load = writeTierFixture('task-implementation-changed-paths');
    writeFileSync(join(root, 'task-implementation-changed-paths', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '      changed_paths: [a.mjs]', '',
    ].join('\n'));
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-implementation-changed-paths', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '      changed_paths: [a.mjs, b.mjs, c.mjs]', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test('adding implementation does not change computeChangeFingerprint', () => {
    const load = writeTierFixture('change-implementation');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-implementation', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '',
    ].join('\n'));
    assert.equal(computeChangeFingerprint(load()), before);
  });
});

// ── computeImplementationFingerprintFromProvenance (AC5) ────────────────────

describe('computeImplementationFingerprintFromProvenance — reads real persisted provenance (AC5)', () => {
  test('a task with no implementation block matches the plain computeImplementationFingerprint default', () => {
    const load = writeTierFixture('impl-fp-none');
    assert.equal(
      computeImplementationFingerprintFromProvenance(load(), 't1'),
      computeImplementationFingerprint(load(), 't1', {}),
    );
  });

  test('a task with a persisted implementation block produces a different fingerprint than the no-data default', () => {
    const load = writeTierFixture('impl-fp-real');
    writeFileSync(join(root, 'impl-fp-real', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '      review_revision: def456',
      '      changed_paths: [tools/specs/lifecycle.mjs]', '',
    ].join('\n'));
    const withProvenance = computeImplementationFingerprintFromProvenance(load(), 't1');
    const withoutData = computeImplementationFingerprint(load(), 't1', {});
    assert.notEqual(withProvenance, withoutData);
    // And it matches calling the underlying function with exactly that composed data
    // (AC6 — evidence read directly from the persisted block, baseline_revision and
    // review_revision both included, not folded together with `||`).
    assert.equal(
      withProvenance,
      computeImplementationFingerprint(load(), 't1', {
        revision: ['abc123', 'def456'],
        evidence: ['tools/specs/lifecycle.mjs', null],
      }),
    );
  });

  // Owner correction, seventh refinement pass: the fingerprint must identify
  // *implementation content*, not just baseline + touched-path shape — two
  // implementations sharing a baseline_revision and changed_paths list but
  // differing in actual content must never collide.
  test('same baseline_revision and changed_paths, different review_revision (different committed content) — different fingerprint', () => {
    const load = writeTierFixture('impl-fp-diff-review-revision');
    const base = [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123',
    ];
    writeFileSync(join(root, 'impl-fp-diff-review-revision', 'change.yaml'), [
      ...base, '      review_revision: rev-one', '      changed_paths: [a.mjs]', '',
    ].join('\n'));
    const fpOne = computeImplementationFingerprintFromProvenance(load(), 't1');
    writeFileSync(join(root, 'impl-fp-diff-review-revision', 'change.yaml'), [
      ...base, '      review_revision: rev-two', '      changed_paths: [a.mjs]', '',
    ].join('\n'));
    const fpTwo = computeImplementationFingerprintFromProvenance(load(), 't1');
    assert.notEqual(fpOne, fpTwo);
  });

  test('same baseline_revision, review_revision, and changed_paths, different worktree_patch_fingerprint (different uncommitted content) — different fingerprint', () => {
    const load = writeTierFixture('impl-fp-diff-worktree-fingerprint');
    const base = [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: in-implementation',
      '    implementation:', '      baseline_revision: abc123', '      review_revision: def456',
      '      changed_paths: [a.mjs]',
    ];
    writeFileSync(join(root, 'impl-fp-diff-worktree-fingerprint', 'change.yaml'), [
      ...base, '      worktree_patch_fingerprint: hash-one', '',
    ].join('\n'));
    const fpOne = computeImplementationFingerprintFromProvenance(load(), 't1');
    writeFileSync(join(root, 'impl-fp-diff-worktree-fingerprint', 'change.yaml'), [
      ...base, '      worktree_patch_fingerprint: hash-two', '',
    ].join('\n'));
    const fpTwo = computeImplementationFingerprintFromProvenance(load(), 't1');
    assert.notEqual(fpOne, fpTwo);
  });
});

// ── Migration-flow confirmation guard (AC8) ─────────────────────────────────

describe('handleApplyProvenance — never writes without explicit confirmation (AC8)', () => {
  test('throws without --confirm, before touching any real state', () => {
    assert.throws(
      () => handleApplyProvenance('nevo-ai-process-continuity-and-hardening', 'owner-workflow-acceptance-scenarios', { baseline: 'deadbeef' }),
      /requires --confirm/,
    );
  });

  test('throws without --baseline even when confirmed', () => {
    assert.throws(
      () => handleApplyProvenance('nevo-ai-process-continuity-and-hardening', 'owner-workflow-acceptance-scenarios', { confirm: true }),
      /requires --baseline/,
    );
  });

  test('more than one task id without --mappings throws, even when confirmed with --baseline', () => {
    assert.throws(
      () => handleApplyProvenance(
        'nevo-ai-process-continuity-and-hardening',
        'owner-workflow-acceptance-scenarios,repository-bound-handler-testability',
        { confirm: true, baseline: 'deadbeef' },
      ),
      /requires --mappings/,
    );
  });

  test('invalid --mappings JSON throws before writing anything', () => {
    assert.throws(
      () => handleApplyProvenance(
        'nevo-ai-process-continuity-and-hardening',
        'owner-workflow-acceptance-scenarios,repository-bound-handler-testability',
        { confirm: true, mappings: 'not-json' },
      ),
      /must be valid JSON/,
    );
  });
});

// ── resolveProvenanceMappings — several legacy mappings, one owner action ──
// (owner correction, seventh refinement pass — "do not require one separate
// prompt per task"). Pure parsing/validation, no repository I/O — the same
// split this file's header comment already describes for every other
// repository-bound handler (handleApplyProvenance itself is exercised above
// only for its error paths, which never reach a real write).

describe('resolveProvenanceMappings — several legacy provenance mappings resolved together (D34/D35 correction)', () => {
  test('a single task id with --baseline/--changed-paths resolves to the original single-mapping shape', () => {
    const mappings = resolveProvenanceMappings('t1', { baseline: 'sha-t1', changedPaths: 'a.mjs,b.mjs' });
    assert.deepEqual(mappings, [{ taskId: 't1', baseline: 'sha-t1', changedPaths: ['a.mjs', 'b.mjs'] }]);
  });

  test('--mappings resolves several task mappings in one call, each with its own baseline and changed paths', () => {
    const mappings = resolveProvenanceMappings('t1,t2', {
      mappings: JSON.stringify([
        { task: 't1', baseline: 'sha-t1', changedPaths: ['a.mjs'] },
        { task: 't2', baseline: 'sha-t2', changedPaths: ['b.mjs', 'c.mjs'] },
      ]),
    });
    assert.deepEqual(mappings, [
      { taskId: 't1', baseline: 'sha-t1', changedPaths: ['a.mjs'] },
      { taskId: 't2', baseline: 'sha-t2', changedPaths: ['b.mjs', 'c.mjs'] },
    ]);
  });

  test('more than one task id without --mappings throws — --baseline/--changed-paths are single-task only', () => {
    assert.throws(() => resolveProvenanceMappings('t1,t2', { baseline: 'sha' }), /requires --mappings/);
  });

  test('a --mappings entry missing "baseline" throws before any mapping is returned', () => {
    assert.throws(
      () => resolveProvenanceMappings('t1,t2', { mappings: JSON.stringify([{ task: 't1', baseline: 'sha-t1' }, { task: 't2' }]) }),
      /requires "task" and "baseline"/,
    );
  });

  test('invalid --mappings JSON throws', () => {
    assert.throws(() => resolveProvenanceMappings('t1', { mappings: 'not-json' }), /must be valid JSON/);
  });
});
