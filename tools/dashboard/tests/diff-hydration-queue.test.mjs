import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDiffFetchPlan } from '../src/hooks/use-dashboard-data.ts';

test('background hydration batches every not-yet-settled path, in order', () => {
  const plan = buildDiffFetchPlan({
    allPaths: ['a.js', 'b.js', 'c.js', 'd.js'],
    resolvedPaths: new Set(),
    inFlightPaths: new Set(),
    batchSize: 2,
  });
  assert.deepEqual(plan, [
    { paths: ['a.js', 'b.js'], priority: false },
    { paths: ['c.js', 'd.js'], priority: false },
  ]);
});

test('an explicit user-open jumps ahead of every queued background batch (AC4)', () => {
  // "d.js" would otherwise land deep in the last background batch — the
  // explicit open must still surface as the very first unit.
  const plan = buildDiffFetchPlan({
    allPaths: ['a.js', 'b.js', 'c.js', 'd.js'],
    resolvedPaths: new Set(),
    inFlightPaths: new Set(),
    priorityPaths: ['d.js'],
    batchSize: 2,
  });
  assert.deepEqual(plan[0], { paths: ['d.js'], priority: true });
  // The background batches still cover every other remaining path, still in order.
  assert.deepEqual(plan.slice(1), [
    { paths: ['a.js', 'b.js'], priority: false },
    { paths: ['c.js'], priority: false },
  ]);
});

test('a path already resolved or already in flight is never re-planned', () => {
  const plan = buildDiffFetchPlan({
    allPaths: ['a.js', 'b.js', 'c.js'],
    resolvedPaths: new Set(['a.js']),
    inFlightPaths: new Set(['b.js']),
    priorityPaths: ['a.js', 'b.js'],
    batchSize: 5,
  });
  // Neither "a.js" (resolved) nor "b.js" (in flight) gets a priority unit,
  // and only "c.js" remains for the background batch.
  assert.deepEqual(plan, [{ paths: ['c.js'], priority: false }]);
});

test('an unknown priority path (not part of this PR at all) is silently ignored', () => {
  const plan = buildDiffFetchPlan({
    allPaths: ['a.js'],
    resolvedPaths: new Set(),
    inFlightPaths: new Set(),
    priorityPaths: ['not-a-real-file.js'],
    batchSize: 5,
  });
  assert.deepEqual(plan, [{ paths: ['a.js'], priority: false }]);
});
