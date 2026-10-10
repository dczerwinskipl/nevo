// Tests for Activity query and export module (task 04, ai-spec-history).
// Run: node --test tools/tests/activity-query.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordActivity } from '../specs/activity/store.mjs';
import {
  queryTaskActivity,
  querySpecOnlyActivity,
  queryFullSpecHistory,
  exportActivityAsJson,
} from '../specs/activity/query.mjs';

function makeRecord(specId, overrides = {}) {
  return {
    type: 'workflow.step.completed',
    actor: { type: 'user', id: 'test-user@nevo.dev' },
    scope: { specId },
    ...overrides,
  };
}

describe('Activity query and export', () => {
  let testBaseDir;

  beforeEach(() => {
    testBaseDir = mkdtempSync(join(tmpdir(), 'nevo-activity-query-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test tempdir
    }
  });

  test('a spec with only spec-level activity returns activity for spec-only and full-history, and empty for any task', () => {
    const specId = 'spec-only-level-test';

    const rec1 = recordActivity(
      makeRecord(specId, {
        type: 'spec.finalized',
        data: { step: 1 },
      }),
      { activityDir: testBaseDir }
    );
    const rec2 = recordActivity(
      makeRecord(specId, {
        type: 'spec.reviewed',
        data: { step: 2 },
      }),
      { activityDir: testBaseDir }
    );

    const specOnly = querySpecOnlyActivity(specId, { activityDir: testBaseDir });
    const fullHistory = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    const taskActivityA = queryTaskActivity(specId, 'task-01', { activityDir: testBaseDir });
    const taskActivityB = queryTaskActivity(specId, 'task-02', { activityDir: testBaseDir });

    assert.equal(specOnly.length, 2);
    assert.equal(specOnly[0].id, rec1.id);
    assert.equal(specOnly[1].id, rec2.id);

    assert.equal(fullHistory.length, 2);
    assert.equal(fullHistory[0].id, rec1.id);
    assert.equal(fullHistory[1].id, rec2.id);

    assert.deepEqual(taskActivityA, []);
    assert.deepEqual(taskActivityB, []);
  });

  test('a spec with both spec-level and task-level activity filters correctly and preserves interleaved append order in full history', () => {
    const specId = 'spec-interleaved-test';

    // 1. Spec-level entry
    const s1 = recordActivity(
      makeRecord(specId, {
        type: 'spec.created',
        data: { name: 's1' },
      }),
      { activityDir: testBaseDir }
    );

    // 2. Task 1 entry
    const t1_1 = recordActivity(
      makeRecord(specId, {
        scope: { specId, taskId: 'task-1' },
        type: 'workflow.step.started',
        data: { name: 't1_1' },
      }),
      { activityDir: testBaseDir }
    );

    // 3. Task 2 entry
    const t2_1 = recordActivity(
      makeRecord(specId, {
        scope: { specId, taskId: 'task-2' },
        type: 'workflow.step.started',
        data: { name: 't2_1' },
      }),
      { activityDir: testBaseDir }
    );

    // 4. Spec-level entry
    const s2 = recordActivity(
      makeRecord(specId, {
        type: 'spec.comment.added',
        data: { name: 's2' },
      }),
      { activityDir: testBaseDir }
    );

    // 5. Task 1 second entry
    const t1_2 = recordActivity(
      makeRecord(specId, {
        scope: { specId, taskId: 'task-1' },
        type: 'workflow.step.completed',
        data: { name: 't1_2' },
      }),
      { activityDir: testBaseDir }
    );

    // Test queryTaskActivity for task-1
    const task1Entries = queryTaskActivity(specId, 'task-1', { activityDir: testBaseDir });
    assert.equal(task1Entries.length, 2);
    assert.equal(task1Entries[0].id, t1_1.id);
    assert.equal(task1Entries[1].id, t1_2.id);

    // Test queryTaskActivity for task-2
    const task2Entries = queryTaskActivity(specId, 'task-2', { activityDir: testBaseDir });
    assert.equal(task2Entries.length, 1);
    assert.equal(task2Entries[0].id, t2_1.id);

    // Test querySpecOnlyActivity
    const specOnlyEntries = querySpecOnlyActivity(specId, { activityDir: testBaseDir });
    assert.equal(specOnlyEntries.length, 2);
    assert.equal(specOnlyEntries[0].id, s1.id);
    assert.equal(specOnlyEntries[1].id, s2.id);

    // Test queryFullSpecHistory preserves interleaved append order
    const fullHistory = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    assert.equal(fullHistory.length, 5);
    assert.equal(fullHistory[0].id, s1.id);
    assert.equal(fullHistory[1].id, t1_1.id);
    assert.equal(fullHistory[2].id, t2_1.id);
    assert.equal(fullHistory[3].id, s2.id);
    assert.equal(fullHistory[4].id, t1_2.id);
  });

  test('calling any query function twice in a row on unchanged data returns identically ordered results (determinism)', () => {
    const specId = 'spec-determinism-test';

    for (let i = 0; i < 10; i++) {
      recordActivity(
        makeRecord(specId, {
          scope: i % 2 === 0 ? { specId } : { specId, taskId: `task-${i % 3}` },
          data: { seq: i },
        }),
        { activityDir: testBaseDir }
      );
    }

    const full1 = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    const full2 = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    assert.deepEqual(full1, full2);

    const specOnly1 = querySpecOnlyActivity(specId, { activityDir: testBaseDir });
    const specOnly2 = querySpecOnlyActivity(specId, { activityDir: testBaseDir });
    assert.deepEqual(specOnly1, specOnly2);

    const task1_a = queryTaskActivity(specId, 'task-1', { activityDir: testBaseDir });
    const task1_b = queryTaskActivity(specId, 'task-1', { activityDir: testBaseDir });
    assert.deepEqual(task1_a, task1_b);
  });

  test('preserves file append order even when occurredAt timestamps are inverted (no re-sorting by time)', () => {
    const specId = 'spec-timestamp-order-test';

    // Later timestamp written first
    const r1 = recordActivity(
      makeRecord(specId, {
        occurredAt: '2026-10-10T15:00:00.000Z',
        data: { order: 1 },
      }),
      { activityDir: testBaseDir }
    );

    // Earlier timestamp written second
    const r2 = recordActivity(
      makeRecord(specId, {
        occurredAt: '2026-10-10T10:00:00.000Z',
        data: { order: 2 },
      }),
      { activityDir: testBaseDir }
    );

    const full = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    assert.equal(full.length, 2);
    assert.equal(full[0].id, r1.id);
    assert.equal(full[1].id, r2.id);

    const specOnly = querySpecOnlyActivity(specId, { activityDir: testBaseDir });
    assert.equal(specOnly.length, 2);
    assert.equal(specOnly[0].id, r1.id);
    assert.equal(specOnly[1].id, r2.id);
  });

  test('inherits read-side deduplication by id from readActivities', () => {
    const specId = 'spec-dedup-query-test';
    const dupId = 'workflow.step.started:spec:task-1:step:1';

    // Append two records with same id
    recordActivity(
      makeRecord(specId, {
        id: dupId,
        scope: { specId, taskId: 'task-1' },
        data: { attempt: 1, note: 'first' },
      }),
      { activityDir: testBaseDir }
    );

    recordActivity(
      makeRecord(specId, {
        id: dupId,
        scope: { specId, taskId: 'task-1' },
        data: { attempt: 1, note: 'second-duplicate' },
      }),
      { activityDir: testBaseDir }
    );

    const taskEntries = queryTaskActivity(specId, 'task-1', { activityDir: testBaseDir });
    assert.equal(taskEntries.length, 1);
    assert.equal(taskEntries[0].id, dupId);
    assert.equal(taskEntries[0].data.note, 'first');

    const full = queryFullSpecHistory(specId, { activityDir: testBaseDir });
    assert.equal(full.length, 1);
    assert.equal(full[0].id, dupId);
    assert.equal(full[0].data.note, 'first');
  });

  test('queryTaskActivity with missing, empty, or non-string taskId returns empty array', () => {
    const specId = 'spec-task-edge-cases';
    recordActivity(
      makeRecord(specId, {
        scope: { specId, taskId: 'task-1' },
      }),
      { activityDir: testBaseDir }
    );

    assert.deepEqual(queryTaskActivity(specId, undefined, { activityDir: testBaseDir }), []);
    assert.deepEqual(queryTaskActivity(specId, null, { activityDir: testBaseDir }), []);
    assert.deepEqual(queryTaskActivity(specId, '', { activityDir: testBaseDir }), []);
    assert.deepEqual(queryTaskActivity(specId, '   ', { activityDir: testBaseDir }), []);
    assert.deepEqual(queryTaskActivity(specId, 123, { activityDir: testBaseDir }), []);
  });

  test('query on non-existent specification returns empty array without throwing', () => {
    const nonExistent = 'non-existent-spec-uuid-404';
    assert.deepEqual(queryFullSpecHistory(nonExistent, { activityDir: testBaseDir }), []);
    assert.deepEqual(querySpecOnlyActivity(nonExistent, { activityDir: testBaseDir }), []);
    assert.deepEqual(queryTaskActivity(nonExistent, 'task-1', { activityDir: testBaseDir }), []);
  });

  test('exportActivityAsJson exports queried entries as plain JSON-serializable array for all scopes', () => {
    const specId = 'spec-export-test';

    const s1 = recordActivity(
      makeRecord(specId, { data: { type: 'spec-level' } }),
      { activityDir: testBaseDir }
    );
    const t1 = recordActivity(
      makeRecord(specId, { scope: { specId, taskId: 'task-export-1' }, data: { type: 'task-1' } }),
      { activityDir: testBaseDir }
    );

    // 1. Export without options / default scope -> full history
    const expDefault = exportActivityAsJson(specId, { activityDir: testBaseDir });
    assert.equal(expDefault.length, 2);
    assert.equal(expDefault[0].id, s1.id);
    assert.equal(expDefault[1].id, t1.id);
    assert.doesNotThrow(() => JSON.stringify(expDefault));

    // 2. Export with scope: 'full'
    const expFull = exportActivityAsJson(specId, { scope: 'full', activityDir: testBaseDir });
    assert.equal(expFull.length, 2);
    assert.deepEqual(expFull, expDefault);

    // 3. Export with scope: 'spec-only'
    const expSpecOnly = exportActivityAsJson(specId, { scope: 'spec-only', activityDir: testBaseDir });
    assert.equal(expSpecOnly.length, 1);
    assert.equal(expSpecOnly[0].id, s1.id);

    // 4. Export with scope: 'task' and taskId
    const expTask = exportActivityAsJson(specId, { scope: 'task', taskId: 'task-export-1', activityDir: testBaseDir });
    assert.equal(expTask.length, 1);
    assert.equal(expTask[0].id, t1.id);

    // 5. Export with object scope: { taskId }
    const expTaskObj = exportActivityAsJson(specId, { scope: { taskId: 'task-export-1' }, activityDir: testBaseDir });
    assert.equal(expTaskObj.length, 1);
    assert.equal(expTaskObj[0].id, t1.id);
  });
});
