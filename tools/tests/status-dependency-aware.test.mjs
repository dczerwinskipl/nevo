// Tests for task 18 (compound-actions-and-dependency-aware-status, D34/D35,
// area compound-actions-and-dependency-aware-status): deriveStage's
// dependency-aware `ready-to-start`/`blocked-on-dependencies` stages. Closes
// FU-004 ("status reported task 13 ready-to-start while its dependency
// (task 12) was still in-implementation").
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deriveStage } from '../specs/lifecycle.mjs';

const emptyFacts = () => ({ pr: null, ghAvailable: true, verification: [] });

describe('deriveStage — never reports an approved task as ready-to-start unless depsSatisfied (AC4, AC6)', () => {
  test('an approved task depending on an in-implementation task reports the dependency\'s own in-progress stage, not ready-to-start for the blocked task', () => {
    const change = {
      _slug: 'c1',
      tasks: [
        { id: 't12', order: 12, status: 'in-implementation' },
        { id: 't13', order: 13, status: 'approved', depends_on: ['t12'] },
      ],
    };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'in-progress');
    assert.match(r.detail, /'t12'/);
    assert.notEqual(r.stage, 'ready-to-start');
  });

  test('an approved task with all dependencies satisfied is still reported ready-to-start (regression, unchanged happy path)', () => {
    const change = {
      _slug: 'c1',
      tasks: [
        { id: 't12', order: 12, status: 'verified' },
        { id: 't13', order: 13, status: 'approved', depends_on: ['t12'] },
      ],
    };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
    assert.match(r.nextCommand, /task-start c1 t13/);
  });

  test('an approved task with no depends_on at all is always ready (regression)', () => {
    const change = { _slug: 'c1', tasks: [{ id: 't1', order: 1, status: 'approved' }] };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
  });

  test('when an earlier approved task is blocked but a later approved task is genuinely ready, the ready one is reported (AC4 "looks further")', () => {
    const change = {
      _slug: 'c1',
      tasks: [
        { id: 'blocker', order: 1, status: 'in-implementation' },
        { id: 'blocked', order: 2, status: 'approved', depends_on: ['blocker'] },
        { id: 'ready', order: 3, status: 'approved' },
      ],
    };
    // 'blocked' is listed before 'ready' in the array, but only 'ready' has
    // depsSatisfied — deriveStage must surface it, not silently report
    // 'blocked' anyway (the exact FU-004 bug) or stop at nothing.
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'ready-to-start');
    assert.match(r.nextCommand, /task-start c1 ready/);
  });

  test('every approved task blocked, no draft/in-implementation task exists — reports blocked-on-dependencies explicitly rather than falling through to "every task terminal" (AC5)', () => {
    const change = {
      _slug: 'c1',
      tasks: [
        { id: 't1', order: 1, status: 'abandoned' },
        { id: 't2', order: 2, status: 'approved', depends_on: ['t1'] },
      ],
    };
    const r = deriveStage(change, emptyFacts());
    assert.equal(r.stage, 'blocked-on-dependencies');
    assert.match(r.detail, /'t1' \(abandoned\)/);
    assert.match(r.nextCommand, /t1/);
  });

  test('status output never contradicts what start would actually accept — depsSatisfied is true for exactly the task deriveStage reports ready-to-start (AC6, invariant)', () => {
    const scenarios = [
      { tasks: [{ id: 't1', order: 1, status: 'verified' }, { id: 't2', order: 2, status: 'approved', depends_on: ['t1'] }] },
      { tasks: [{ id: 't1', order: 1, status: 'draft' }, { id: 't2', order: 2, status: 'approved', depends_on: ['t1'] }] },
      { tasks: [{ id: 't1', order: 1, status: 'in-implementation' }, { id: 't2', order: 2, status: 'approved', depends_on: ['t1'] }] },
    ];
    for (const s of scenarios) {
      const change = { _slug: 'c1', ...s };
      const r = deriveStage(change, emptyFacts());
      if (r.stage === 'ready-to-start') {
        const readyTaskId = r.nextCommand.split(' ').pop();
        const readyTask = change.tasks.find(t => t.id === readyTaskId);
        assert.ok(readyTask, `nextCommand must name a real task (${readyTaskId})`);
        const unmet = (readyTask.depends_on || []).some(depId => {
          const dep = change.tasks.find(t => t.id === depId);
          return !dep || !['implemented', 'verified', 'archived'].includes(dep.status);
        });
        assert.equal(unmet, false, `task reported ready-to-start (${readyTaskId}) must have every dependency satisfied`);
      }
    }
  });
});
