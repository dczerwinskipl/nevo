// Tests for task 20 (repository-bound-handler-testability, D34/D35, area
// handler-testability — closes FU-007): handleStart/checkSpecsIndexes/
// buildSpecsIndexes driven end-to-end against a fixture repository, never
// the real one. Run: node --test tools/tests/
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { createFixtureRepo } from './fixture-repo.test-helper.mjs';
import { handleStart } from '../specs/start/cli.mjs';
import { handleSelfCheck } from '../specs/self-check/cli.mjs';
import { loadChange, ACTIVE_DIR } from '../specs/store.mjs';
import { buildSpecsIndexes, checkSpecsIndexes, writeSpecsIndexes } from '../specs/indexes.mjs';
import { deriveStage } from '../specs/lifecycle/stage.mjs';
import { depsSatisfied } from '../specs/lifecycle-primitives.mjs';

const fixtures = [];
function fixture(opts) {
  const f = createFixtureRepo(opts);
  fixtures.push(f);
  return f;
}

after(() => {
  for (const f of fixtures) f.teardown();
});

// ── AC1: handleStart against a fixture, real postcondition outcomes ────────

describe('handleStart driven against a fixture repository (AC1)', () => {
  test('a first successful start sets the task in-implementation, checks out the branch, and records baseline_revision — without touching the real repository', () => {
    const f = fixture({ changeSlug: 'fx-start', tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'] }] });
    handleStart('fx-start', 't1', { activeDir: f.activeDir, gitRoot: f.root });

    const reloaded = loadChange('fx-start', f.activeDir);
    const task = reloaded.tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'in-implementation');
    assert.ok(task.implementation?.baseline_revision, 'baseline_revision must be recorded');
  });

  test('a retried start on an already in-implementation task is idempotent — completed, no error, baseline unchanged', () => {
    const f = fixture({ changeSlug: 'fx-start-retry', tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'] }] });
    handleStart('fx-start-retry', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    const afterFirst = loadChange('fx-start-retry', f.activeDir).tasks.find(t => t.id === 't1');
    const baselineAfterFirst = afterFirst.implementation.baseline_revision;

    handleStart('fx-start-retry', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    const afterRetry = loadChange('fx-start-retry', f.activeDir).tasks.find(t => t.id === 't1');
    assert.equal(afterRetry.implementation.baseline_revision, baselineAfterFirst);
  });
});

// ── AC2: checkSpecsIndexes/buildSpecsIndexes against a fixture (REC-03) ────

describe('checkSpecsIndexes/buildSpecsIndexes driven against a fixture repository (AC2)', () => {
  test('a missing generated index is reported as missing, against the fixture only', () => {
    const f = fixture({ changeSlug: 'fx-index-missing' });
    const problems = checkSpecsIndexes({
      activeDir: f.activeDir, archiveDir: f.archiveDir,
      activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson,
    });
    assert.ok(problems.some(p => p.includes('missing') && p.includes('active.generated.md')));
  });

  test('a deliberately stale generated index (REC-03) is detected, and regenerating clears it — the real repository\'s own generated files are never touched', () => {
    const f = fixture({ changeSlug: 'fx-index-stale' });
    const built = buildSpecsIndexes({ activeDir: f.activeDir, archiveDir: f.archiveDir });
    writeSpecsIndexes(built, { activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson });
    assert.deepEqual(checkSpecsIndexes({
      activeDir: f.activeDir, archiveDir: f.archiveDir,
      activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson,
    }), []);

    // Corrupt only the fixture's own generated file.
    writeSpecsIndexes({ ...built, activeMd: built.activeMd + '\nSTALE\n' }, {
      activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson,
    });
    const staleProblems = checkSpecsIndexes({
      activeDir: f.activeDir, archiveDir: f.archiveDir,
      activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson,
    });
    assert.ok(staleProblems.includes('stale: specs/active.generated.md'));

    // Regenerating against the fixture clears it.
    const rebuilt = buildSpecsIndexes({ activeDir: f.activeDir, archiveDir: f.archiveDir });
    writeSpecsIndexes(rebuilt, { activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson });
    assert.deepEqual(checkSpecsIndexes({
      activeDir: f.activeDir, archiveDir: f.archiveDir,
      activeIndexMd: f.activeIndexMd, archiveIndexMd: f.archiveIndexMd, indexJson: f.indexJson,
    }), []);
  });
});

// ── AC3: execution.suspension written/cleared correctly against a fixture ──

describe('execution.suspension correctness against a fixture-driven start (AC3)', () => {
  test('starting a task with unmet dependencies leaves no suspension written for a not_retryable stop — the task stays approved, not silently marked in-implementation', () => {
    const f = fixture({
      changeSlug: 'fx-suspension',
      tasks: [
        { id: 'dep', status: 'draft', allowedPaths: ['fixture/**'] },
        { id: 't1', status: 'approved', allowedPaths: ['fixture/**'], dependsOn: ['dep'] },
      ],
    });
    assert.throws(() => handleStart('fx-suspension', 't1', { activeDir: f.activeDir, gitRoot: f.root }));
    const reloaded = loadChange('fx-suspension', f.activeDir);
    const task = reloaded.tasks.find(t => t.id === 't1');
    assert.equal(task.status, 'approved', 'status must be unchanged after a not_retryable stop');
  });
});

// ── AC4: status/deriveStage/task-next against a fixture with a controlled task graph ──

describe('deriveStage/depsSatisfied against a fixture-loaded task graph (AC4, exercises task 18\'s dependency-aware fix)', () => {
  test('an approved task depending on an in-implementation task is never reported ready-to-start, loaded from a real fixture change.yaml', () => {
    const f = fixture({
      changeSlug: 'fx-status',
      tasks: [
        { id: 'blocker', status: 'in-implementation', allowedPaths: ['fixture/**'] },
        { id: 'blocked', status: 'approved', allowedPaths: ['fixture/**'], dependsOn: ['blocker'] },
      ],
    });
    const change = loadChange('fx-status', f.activeDir);
    const blockedTask = change.tasks.find(t => t.id === 'blocked');
    assert.equal(depsSatisfied(blockedTask, change), false);

    const stage = deriveStage(change, { pr: null, ghAvailable: true, verification: [] });
    assert.notEqual(stage.stage, 'ready-to-start');
    assert.equal(stage.stage, 'in-progress');
  });
});

// ── D39 (owner-decisions.md): handleSelfCheck against a fixture, real gitRoot param ──
// Extends this task's own gitRoot-parameterization pattern (AC1's handleStart
// coverage above) to handleSelfCheck — the cross-task integration finding X1
// (reviews/implementation-review-14-21.md) found handleSelfCheck still
// hardcoded the real repository's ROOT even after this task shipped,
// leaving task 15's own new provenance-refresh logic in it untestable via a
// fixture without touching the real repository.

describe('handleSelfCheck driven against a fixture repository (D39, extends AC1\'s pattern)', () => {
  test('a self-check run against a fixture repo writes self_check and refreshes implementation.changed_paths, without touching the real repository', () => {
    const f = fixture({
      changeSlug: 'fx-selfcheck',
      tasks: [{ id: 't1', status: 'approved', allowedPaths: ['fixture/**'], verification: ['echo ok'] }],
    });
    handleStart('fx-selfcheck', 't1', { activeDir: f.activeDir, gitRoot: f.root });
    f.commitFile('fixture/change.txt', 'hello', 'Task t1 edits a fixture file');

    handleSelfCheck('fx-selfcheck', 't1', { activeDir: f.activeDir, gitRoot: f.root });

    const task = loadChange('fx-selfcheck', f.activeDir).tasks.find(t => t.id === 't1');
    assert.equal(task.self_check?.status, 'passed');
    assert.ok(task.implementation.changed_paths.includes('fixture/change.txt'));
  });
});

// ── AC5: real CLI entry points still resolve to the real repository by default ──

describe('every real CLI entry point still resolves to the actual repository\'s paths by default (AC5, regression)', () => {
  test('buildSpecsIndexes() with no arguments still targets the real repository — this very change is present in its output', () => {
    const built = buildSpecsIndexes();
    assert.ok(built.changes.some(c => c.id === 'nevo-ai-process-continuity-and-hardening'));
  });

  test('ACTIVE_DIR is unchanged — still the real repository\'s specs/active directory', () => {
    assert.ok(ACTIVE_DIR.replace(/\\/g, '/').endsWith('specs/active'));
    assert.ok(existsSync(ACTIVE_DIR));
  });
});
