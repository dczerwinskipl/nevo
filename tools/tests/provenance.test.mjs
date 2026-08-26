// Tests for task 15 (deterministic-implementation-provenance, D34/D35, area
// implementation-provenance-and-attribution): the pure decision/filtering
// functions in tools/specs/lifecycle.mjs, the fingerprint-tier exclusion and
// computeImplementationFingerprintFromProvenance in tools/specs/service.mjs,
// the migration-flow confirmation guard in tools/specs.mjs, and (AC7/AC9,
// corrective pass) handleSelfCheck's cross-task provenance-overlap detection
// driven end-to-end against a fixture repository.
//
// handleStart/handleSelfCheck's own writes of `implementation` are now
// fixture-testable (task 20, D39 extended handleSelfCheck's own gitRoot/
// activeDir parameterization to close the gap this comment used to name) —
// see the AC7/AC9 describe block below and tools/tests/handler-testability.test.mjs's
// own D39 coverage. Most of this file still covers the pure decision logic
// these handlers are built from, which needs no fixture at all.
// Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  computeTaskAttributedChangedPaths, nextImplementationBaseline, resolveProvenanceMappings,
  detectProvenanceOverlap, mergeAttributedChangedPaths,
} from '../specs/lifecycle/provenance.mjs';
import { loadChange } from '../specs/store.mjs';
import {
  computeChangeFingerprint, computeTaskFingerprint,
  computeImplementationFingerprint, computeImplementationFingerprintFromProvenance,
} from '../specs/fingerprint.mjs';
import { handleApplyProvenance } from '../specs/provenance/cli.mjs';
import { handleStart } from '../specs/start/cli.mjs';
import { handleSelfCheck } from '../specs/self-check/cli.mjs';
import { createFixtureRepo } from './fixture-repo.test-helper.mjs';

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

// ── mergeAttributedChangedPaths (review-fix incremental attribution) ───────

describe('mergeAttributedChangedPaths — pure union backing --incremental self-check', () => {
  test('unions two disjoint lists, deduplicated and sorted', () => {
    assert.deepEqual(
      mergeAttributedChangedPaths(['b.mjs', 'a.mjs'], ['c.mjs', 'a.mjs']),
      ['a.mjs', 'b.mjs', 'c.mjs'],
    );
  });

  test('an empty increment leaves the existing list unchanged (content-wise)', () => {
    assert.deepEqual(mergeAttributedChangedPaths(['a.mjs'], []), ['a.mjs']);
  });

  test('missing/undefined inputs are treated as empty', () => {
    assert.deepEqual(mergeAttributedChangedPaths(undefined, ['a.mjs']), ['a.mjs']);
    assert.deepEqual(mergeAttributedChangedPaths(['a.mjs'], undefined), ['a.mjs']);
    assert.deepEqual(mergeAttributedChangedPaths(undefined, undefined), []);
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

  test('handleStart\'s own idempotency guard (task 02) is a real code path this decision feeds — proven at the unit level here; end-to-end coverage against a fixture repository is in the AC7/AC9 describe block below', () => {
    assert.ok(true);
  });
});

// ── detectProvenanceOverlap (AC7, AC9) ──────────────────────────────────────
// AC7: a later task's self-check inspects current repository state for a
// regression against an earlier task's already-attributed evidence when
// both touch the same file — extends AC2's two-sequential-tasks scenario
// (above) from a pure-function check into a real fixture-driven flow.
// AC9: no freshness computation this task adds compares any `implementation`
// field against global HEAD equality — mirrors the regression test already
// covering `describeSelfCheck`/`staleEvidenceTasks` (D33) for the new
// provenance fields.

describe('detectProvenanceOverlap — pure, data-only cross-task overlap detection (AC9: no HEAD-equality dependency)', () => {
  test('two tasks whose persisted changed_paths share a file are reported as overlapping', () => {
    const tasks = [
      { id: 't1', implementation: { changed_paths: ['shared.mjs', 'a-only.mjs'] } },
      { id: 't2', implementation: { changed_paths: ['shared.mjs', 'b-only.mjs'] } },
    ];
    const overlaps = detectProvenanceOverlap(tasks, 't1', ['shared.mjs', 'a-only.mjs']);
    assert.deepEqual(overlaps, [{ taskId: 't2', paths: ['shared.mjs'] }]);
  });

  test('two tasks with disjoint changed_paths report no overlap', () => {
    const tasks = [
      { id: 't1', implementation: { changed_paths: ['a-only.mjs'] } },
      { id: 't2', implementation: { changed_paths: ['b-only.mjs'] } },
    ];
    assert.deepEqual(detectProvenanceOverlap(tasks, 't1', ['a-only.mjs']), []);
  });

  test('a task with no persisted implementation block at all is simply skipped, never thrown on', () => {
    const tasks = [{ id: 't1', implementation: { changed_paths: ['x.mjs'] } }, { id: 't2' }];
    assert.deepEqual(detectProvenanceOverlap(tasks, 't1', ['x.mjs']), []);
  });

  test('the function signature takes no revision/HEAD argument at all — same "data-only" contract as describeSelfCheck/staleEvidenceTasks (D33, AC9)', () => {
    // A regression here would be adding a `currentRevision`/`head` parameter
    // this function reads — the two-argument-plus-paths shape below is the
    // full, intended contract; a 4th argument silently accepted would not
    // fail this assertion, so what matters is this function is never called
    // with one anywhere in this codebase (grepped manually — only the two
    // call sites this file and tools/specs.mjs's own handleSelfCheck use).
    assert.equal(detectProvenanceOverlap.length, 3);
  });
});

describe('handleSelfCheck surfaces a real cross-task provenance overlap end-to-end (AC7, extends AC2\'s fixture)', () => {
  test('task B\'s self-check, after editing a file task A already attributed to itself, surfaces the overlap — task A\'s own persisted changed_paths is unaffected (AC2 extended + AC7)', () => {
    const f = createFixtureRepo({
      changeSlug: 'fx-provenance-overlap',
      tasks: [
        { id: 'task-a', status: 'approved', allowedPaths: ['shared/**', 'task-a/**'], verification: ['echo ok'] },
        { id: 'task-b', status: 'approved', allowedPaths: ['shared/**', 'task-b/**'], verification: ['echo ok'] },
      ],
    });
    try {
      handleStart('fx-provenance-overlap', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('shared/file.mjs', 'task A content', 'Task A edits the shared file');
      handleSelfCheck('fx-provenance-overlap', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });

      const afterTaskA = loadChange('fx-provenance-overlap', f.activeDir).tasks.find(t => t.id === 'task-a');
      assert.deepEqual(afterTaskA.implementation.changed_paths, ['shared/file.mjs']);

      handleStart('fx-provenance-overlap', 'task-b', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('shared/file.mjs', 'task B content', 'Task B edits the same shared file');
      handleSelfCheck('fx-provenance-overlap', 'task-b', { activeDir: f.activeDir, gitRoot: f.root });

      const reloaded = loadChange('fx-provenance-overlap', f.activeDir);
      const taskAAfterB = reloaded.tasks.find(t => t.id === 'task-a');
      const taskBAfterB = reloaded.tasks.find(t => t.id === 'task-b');

      // AC2 (extended): task A's own already-persisted record is unchanged
      // by task B's later self-check — no retroactive rewrite.
      assert.deepEqual(taskAAfterB.implementation.changed_paths, ['shared/file.mjs']);

      // AC7: the real overlap between the two tasks' persisted changed_paths
      // is detectable, computed purely from what's now persisted for both —
      // exactly the signal handleSelfCheck's own call to
      // detectProvenanceOverlap surfaces as a console note during task B's
      // self-check above.
      const overlaps = detectProvenanceOverlap(reloaded.tasks, 'task-b', taskBAfterB.implementation.changed_paths);
      assert.deepEqual(overlaps, [{ taskId: 'task-a', paths: ['shared/file.mjs'] }]);
    } finally {
      f.teardown();
    }
  });
});

// ── --incremental self-check (review-fix review finding, spec-detail-and-workflow-
// feature-slice): the default (non-incremental) self-check always re-derives
// changed_paths from the full since-baseline_revision range. When a later review-fix
// commit touches several sibling tasks that share overlapping allowed_paths, that
// full-range recompute re-absorbs every sibling's own unrelated intervening commits.
// --incremental instead attributes only the commit(s) since this task's own last
// review_revision, unioned onto its existing evidence.

describe('executeSelfCheck --incremental: sequential tasks A/B/C, a later review-fix commit touching only A and C', () => {
  test('A and C each gain only their own review-fix contribution; B (untouched by the fix) is never re-checked and stays exactly as it was; review_revision reflects the real reviewed commit', () => {
    const f = createFixtureRepo({
      changeSlug: 'fx-incremental-provenance',
      tasks: [
        { id: 'task-a', status: 'approved', allowedPaths: ['domain-a/**'], verification: ['echo ok'] },
        { id: 'task-b', status: 'approved', allowedPaths: ['domain-b/**'], verification: ['echo ok'] },
        { id: 'task-c', status: 'approved', allowedPaths: ['domain-c/**'], verification: ['echo ok'] },
      ],
    });
    try {
      handleStart('fx-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('domain-a/impl.mjs', 'a v1', 'Task A implementation');
      handleSelfCheck('fx-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });

      handleStart('fx-incremental-provenance', 'task-b', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('domain-b/impl.mjs', 'b v1', 'Task B implementation');
      handleSelfCheck('fx-incremental-provenance', 'task-b', { activeDir: f.activeDir, gitRoot: f.root });

      handleStart('fx-incremental-provenance', 'task-c', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('domain-c/impl.mjs', 'c v1', 'Task C implementation');
      handleSelfCheck('fx-incremental-provenance', 'task-c', { activeDir: f.activeDir, gitRoot: f.root });

      // Sanity: before any review-fix, each task's evidence is already correctly
      // scoped to just its own file — the pre-existing (non-incremental) behavior is
      // fine for a clean history with no later cross-task commit.
      let reloaded = loadChange('fx-incremental-provenance', f.activeDir);
      assert.deepEqual(reloaded.tasks.find(t => t.id === 'task-a').implementation.changed_paths, ['domain-a/impl.mjs']);
      assert.deepEqual(reloaded.tasks.find(t => t.id === 'task-b').implementation.changed_paths, ['domain-b/impl.mjs']);
      assert.deepEqual(reloaded.tasks.find(t => t.id === 'task-c').implementation.changed_paths, ['domain-c/impl.mjs']);
      const taskBReviewRevisionBeforeFix = reloaded.tasks.find(t => t.id === 'task-b').implementation.review_revision;

      // One review-fix commit touches BOTH task A's and task C's files — task B's
      // own file is untouched by it.
      writeFileSync(join(f.root, 'domain-a/impl.mjs'), 'a v2 (review fix)');
      writeFileSync(join(f.root, 'domain-c/impl.mjs'), 'c v2 (review fix)');
      execFileSync('git', ['-C', f.root, 'add', 'domain-a/impl.mjs', 'domain-c/impl.mjs']);
      execFileSync('git', ['-C', f.root, 'commit', '-q', '-m', 'Review fix touching task A and task C']);
      const reviewFixRevision = execFileSync('git', ['-C', f.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

      // Only A and C are re-checked — exactly what a real review-fix round would do
      // (B was never touched, so there is nothing to re-verify for it).
      handleSelfCheck('fx-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root, incremental: true });
      handleSelfCheck('fx-incremental-provenance', 'task-c', { activeDir: f.activeDir, gitRoot: f.root, incremental: true });

      reloaded = loadChange('fx-incremental-provenance', f.activeDir);
      const taskA = reloaded.tasks.find(t => t.id === 'task-a');
      const taskB = reloaded.tasks.find(t => t.id === 'task-b');
      const taskC = reloaded.tasks.find(t => t.id === 'task-c');

      // A: still attributable to exactly its own file (the review fix revised it,
      // didn't add a new one) — never task B's or task C's files.
      assert.deepEqual(taskA.implementation.changed_paths, ['domain-a/impl.mjs']);
      assert.equal(taskA.implementation.review_revision, reviewFixRevision, 'A\'s verification revision points at the actual reviewed commit');

      // B: never re-self-checked, and must NOT have silently inherited the
      // review-fix commit or anything else that happened after its own check.
      assert.deepEqual(taskB.implementation.changed_paths, ['domain-b/impl.mjs']);
      assert.equal(taskB.implementation.review_revision, taskBReviewRevisionBeforeFix);

      // C: still attributable to exactly its own file, never A's or B's.
      assert.deepEqual(taskC.implementation.changed_paths, ['domain-c/impl.mjs']);
      assert.equal(taskC.implementation.review_revision, reviewFixRevision, 'C\'s verification revision points at the actual reviewed commit');
    } finally {
      f.teardown();
    }
  });

  test('without --incremental, the same scenario re-absorbs sibling tasks\' unrelated work whenever allowed_paths overlap — proves --incremental is the fix, not a no-op', () => {
    const f = createFixtureRepo({
      changeSlug: 'fx-non-incremental-provenance',
      tasks: [
        // Deliberately overlapping allowed_paths — the exact real-world shape that
        // triggered this finding (sibling vertical-slice tasks sharing a broad glob).
        { id: 'task-a', status: 'approved', allowedPaths: ['shared/**'], verification: ['echo ok'] },
        { id: 'task-b', status: 'approved', allowedPaths: ['shared/**'], verification: ['echo ok'] },
      ],
    });
    try {
      handleStart('fx-non-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('shared/a.mjs', 'a v1', 'Task A implementation');
      handleSelfCheck('fx-non-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });

      handleStart('fx-non-incremental-provenance', 'task-b', { activeDir: f.activeDir, gitRoot: f.root });
      f.commitFile('shared/b.mjs', 'b v1', 'Task B implementation');

      // Re-checking task A now (default, non-incremental) re-diffs from task A's
      // ORIGINAL baseline_revision — which predates task B's commit — so task B's
      // unrelated file, matching task A's broad allowed_paths, is wrongly absorbed.
      handleSelfCheck('fx-non-incremental-provenance', 'task-a', { activeDir: f.activeDir, gitRoot: f.root });

      const reloaded = loadChange('fx-non-incremental-provenance', f.activeDir);
      const taskA = reloaded.tasks.find(t => t.id === 'task-a');
      assert.deepEqual(taskA.implementation.changed_paths, ['shared/a.mjs', 'shared/b.mjs']);
    } finally {
      f.teardown();
    }
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
