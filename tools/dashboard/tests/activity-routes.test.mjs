import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDashboardApp, listen } from '../server/index.mjs';
import { recordActivity } from '../../specs/activity/store.mjs';
import {
  queryTaskActivity,
  querySpecOnlyActivity,
  queryFullSpecHistory,
} from '../../specs/activity/query.mjs';
import {
  createActivityDataAdapter,
  getTaskActivity,
  getSpecOnlyActivity,
  getFullSpecHistory,
} from '../server/activity/data.mjs';
import { ARCHIVED_FIXTURE_SLUG, ACTIVE_FIXTURE_SLUG, createSpecificationRouteFixtures } from './helpers/spec-fixtures.mjs';

const NONEXISTENT_DIST = join(tmpdir(), 'nevo-nonexistent-dist');

describe('Activity Dashboard API', () => {
  test('serves task activity, spec-only activity, and full history matching query.mjs exactly', async (t) => {
    const fixtures = await createSpecificationRouteFixtures(t);
    const tempActivityDir = await mkdtemp(join(tmpdir(), 'nevo-activity-routes-test-'));
    t.after(() => rm(tempActivityDir, { recursive: true, force: true }));

    const specId = ACTIVE_FIXTURE_SLUG;

    // Seed activity records in a deterministic interleaved sequence
    // 1. Spec-level event
    const s1 = recordActivity(
      {
        type: 'spec.created',
        actor: { type: 'user', id: 'author@nevo.dev' },
        scope: { specId },
        data: { title: 'Created specification' },
      },
      { activityDir: tempActivityDir }
    );

    // 2. Task-1 event
    const t1_1 = recordActivity(
      {
        type: 'workflow.step.started',
        actor: { type: 'agent-session', id: 'session-001' },
        scope: { specId, taskId: 'task-1' },
        data: { step: 'implementation', attempt: 1 },
      },
      { activityDir: tempActivityDir }
    );

    // 3. Task-2 event
    const t2_1 = recordActivity(
      {
        type: 'workflow.step.started',
        actor: { type: 'agent-session', id: 'session-002' },
        scope: { specId, taskId: 'task-2' },
        data: { step: 'implementation', attempt: 1 },
      },
      { activityDir: tempActivityDir }
    );

    // 4. Task-1 second event
    const t1_2 = recordActivity(
      {
        type: 'workflow.step.completed',
        actor: { type: 'agent-session', id: 'session-001' },
        scope: { specId, taskId: 'task-1' },
        data: { step: 'implementation', attempt: 1, result: 'pass' },
      },
      { activityDir: tempActivityDir }
    );

    // 5. Spec-level second event
    const s2 = recordActivity(
      {
        type: 'spec.reviewed',
        actor: { type: 'user', id: 'reviewer@nevo.dev' },
        scope: { specId },
        data: { approved: true },
      },
      { activityDir: tempActivityDir }
    );

    // Expected data directly from query.mjs
    const expectedTask1 = queryTaskActivity(specId, 'task-1', { activityDir: tempActivityDir });
    const expectedTask2 = queryTaskActivity(specId, 'task-2', { activityDir: tempActivityDir });
    const expectedSpecOnly = querySpecOnlyActivity(specId, { activityDir: tempActivityDir });
    const expectedFullHistory = queryFullSpecHistory(specId, { activityDir: tempActivityDir });

    // Sanity checks on direct query functions
    assert.equal(expectedTask1.length, 2);
    assert.equal(expectedTask2.length, 1);
    assert.equal(expectedSpecOnly.length, 2);
    assert.equal(expectedFullHistory.length, 5);

    // Spin up Fastify server with auto-loaded activity capability
    const server = await buildDashboardApp({
      config: {
        distDir: NONEXISTENT_DIST,
        activityDir: tempActivityDir,
        ...fixtures,
      },
    });
    const baseUrl = await listen(server, { port: 0 });

    try {
      // 1. Task activity endpoints
      // GET /api/activity/:specId/tasks/:taskId
      const resTask1 = await fetch(`${baseUrl}/api/activity/${specId}/tasks/task-1`);
      assert.equal(resTask1.status, 200);
      assert.equal(resTask1.headers.get('cache-control'), 'no-store');
      const dataTask1 = await resTask1.json();
      assert.deepEqual(dataTask1, expectedTask1);
      assert.equal(dataTask1[0].id, t1_1.id);
      assert.equal(dataTask1[1].id, t1_2.id);

      // GET /api/activity/:specId/task/:taskId (alias)
      const resTask1Alias = await fetch(`${baseUrl}/api/activity/${specId}/task/task-1`);
      assert.equal(resTask1Alias.status, 200);
      assert.deepEqual(await resTask1Alias.json(), expectedTask1);

      // GET /api/activity/:specId/tasks/task-2
      const resTask2 = await fetch(`${baseUrl}/api/activity/${specId}/tasks/task-2`);
      assert.equal(resTask2.status, 200);
      const dataTask2 = await resTask2.json();
      assert.deepEqual(dataTask2, expectedTask2);
      assert.equal(dataTask2[0].id, t2_1.id);

      // GET /api/activity/:specId with query ?taskId=task-1
      const resTaskQuery = await fetch(`${baseUrl}/api/activity/${specId}?taskId=task-1`);
      assert.equal(resTaskQuery.status, 200);
      assert.deepEqual(await resTaskQuery.json(), expectedTask1);

      // 2. Spec-only activity endpoints (excludes task-scoped entries)
      // GET /api/activity/:specId/spec-only
      const resSpecOnly = await fetch(`${baseUrl}/api/activity/${specId}/spec-only`);
      assert.equal(resSpecOnly.status, 200);
      assert.equal(resSpecOnly.headers.get('cache-control'), 'no-store');
      const dataSpecOnly = await resSpecOnly.json();
      assert.deepEqual(dataSpecOnly, expectedSpecOnly);
      assert.equal(dataSpecOnly.length, 2);
      assert.equal(dataSpecOnly[0].id, s1.id);
      assert.equal(dataSpecOnly[1].id, s2.id);
      // Verify no task-scoped entry leaked in
      assert.ok(dataSpecOnly.every((item) => !item.scope?.taskId));

      // GET /api/activity/:specId/spec (alias)
      const resSpecOnlyAlias = await fetch(`${baseUrl}/api/activity/${specId}/spec`);
      assert.equal(resSpecOnlyAlias.status, 200);
      assert.deepEqual(await resSpecOnlyAlias.json(), expectedSpecOnly);

      // GET /api/activity/:specId with query ?scope=spec-only
      const resSpecOnlyQuery = await fetch(`${baseUrl}/api/activity/${specId}?scope=spec-only`);
      assert.equal(resSpecOnlyQuery.status, 200);
      assert.deepEqual(await resSpecOnlyQuery.json(), expectedSpecOnly);

      // 3. Full-history endpoint (spec + task entries combined in deterministic file append order)
      // GET /api/activity/:specId
      const resFull = await fetch(`${baseUrl}/api/activity/${specId}`);
      assert.equal(resFull.status, 200);
      assert.equal(resFull.headers.get('cache-control'), 'no-store');
      const dataFull = await resFull.json();
      assert.deepEqual(dataFull, expectedFullHistory);
      assert.equal(dataFull.length, 5);
      assert.equal(dataFull[0].id, s1.id);
      assert.equal(dataFull[1].id, t1_1.id);
      assert.equal(dataFull[2].id, t2_1.id);
      assert.equal(dataFull[3].id, t1_2.id);
      assert.equal(dataFull[4].id, s2.id);

      // GET /api/activity/:specId/full (alias)
      const resFullAlias = await fetch(`${baseUrl}/api/activity/${specId}/full`);
      assert.equal(resFullAlias.status, 200);
      assert.deepEqual(await resFullAlias.json(), expectedFullHistory);

      // GET /api/activity/:specId/history (alias)
      const resHistoryAlias = await fetch(`${baseUrl}/api/activity/${specId}/history`);
      assert.equal(resHistoryAlias.status, 200);
      assert.deepEqual(await resHistoryAlias.json(), expectedFullHistory);

      // Contextual aliases under /api/specs/
      const resSpecAlias = await fetch(`${baseUrl}/api/specs/${specId}/activity`);
      assert.equal(resSpecAlias.status, 200);
      assert.deepEqual(await resSpecAlias.json(), expectedFullHistory);

      const resSpecOnlyContext = await fetch(`${baseUrl}/api/specs/${specId}/activity/spec-only`);
      assert.equal(resSpecOnlyContext.status, 200);
      assert.deepEqual(await resSpecOnlyContext.json(), expectedSpecOnly);

      const resTaskContext = await fetch(`${baseUrl}/api/specs/${specId}/tasks/task-1/activity`);
      assert.equal(resTaskContext.status, 200);
      assert.deepEqual(await resTaskContext.json(), expectedTask1);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('rejects mutating write requests with 404 (read-only capability)', async (t) => {
    const fixtures = await createSpecificationRouteFixtures(t);
    const server = await buildDashboardApp({
      config: { distDir: NONEXISTENT_DIST, ...fixtures },
    });
    const baseUrl = await listen(server, { port: 0 });

    try {
      const specId = ACTIVE_FIXTURE_SLUG;
      const mutationPost = await fetch(`${baseUrl}/api/activity/${specId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'hack' }),
      });
      assert.equal(mutationPost.status, 404);

      const mutationPut = await fetch(`${baseUrl}/api/activity/${specId}/tasks/task-1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'hack' }),
      });
      assert.equal(mutationPut.status, 404);

      const mutationDelete = await fetch(`${baseUrl}/api/activity/${specId}`, {
        method: 'DELETE',
      });
      assert.equal(mutationDelete.status, 404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('returns 404 for invalid specId or taskId path traversal and 400 for missing query parameters', async (t) => {
    const fixtures = await createSpecificationRouteFixtures(t);
    const server = await buildDashboardApp({
      config: { distDir: NONEXISTENT_DIST, ...fixtures },
    });
    const baseUrl = await listen(server, { port: 0 });

    try {
      // Path traversal or invalid characters
      const invalidSpec = await fetch(`${baseUrl}/api/activity/%2e%2e%2fsecret`);
      assert.equal(invalidSpec.status, 404);

      const invalidTask = await fetch(`${baseUrl}/api/activity/${ACTIVE_FIXTURE_SLUG}/tasks/%2e%2e%2fbad`);
      assert.equal(invalidTask.status, 404);

      // Query param scope=task without taskId
      const missingTaskId = await fetch(`${baseUrl}/api/activity/${ACTIVE_FIXTURE_SLUG}?scope=task`);
      assert.equal(missingTaskId.status, 400);
      assert.deepEqual(await missingTaskId.json(), {
        error: 'Valid taskId is required for task-scoped activity query',
      });

      // Query on unknown source
      const badSource = await fetch(`${baseUrl}/api/specs/unknown-source/${ACTIVE_FIXTURE_SLUG}/activity`);
      assert.equal(badSource.status, 404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('returns empty array when querying a spec with no activity records', async (t) => {
    const fixtures = await createSpecificationRouteFixtures(t);
    const tempActivityDir = await mkdtemp(join(tmpdir(), 'nevo-activity-empty-test-'));
    t.after(() => rm(tempActivityDir, { recursive: true, force: true }));

    const server = await buildDashboardApp({
      config: { distDir: NONEXISTENT_DIST, activityDir: tempActivityDir, ...fixtures },
    });
    const baseUrl = await listen(server, { port: 0 });

    try {
      const res = await fetch(`${baseUrl}/api/activity/nonexistent-empty-spec`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data, []);

      const resTask = await fetch(`${baseUrl}/api/activity/nonexistent-empty-spec/tasks/task-1`);
      assert.equal(resTask.status, 200);
      assert.deepEqual(await resTask.json(), []);

      const resSpecOnly = await fetch(`${baseUrl}/api/activity/nonexistent-empty-spec/spec-only`);
      assert.equal(resSpecOnly.status, 200);
      assert.deepEqual(await resSpecOnly.json(), []);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('capability is auto-loaded and app.mjs has no manual activity route registration', async () => {
    const appMjsContent = await readFile(
      join(import.meta.dirname, '..', 'server', 'app.mjs'),
      'utf-8'
    );
    // Confirm app.mjs does NOT import or mention activity routes manually
    assert.doesNotMatch(
      appMjsContent,
      /activity/i,
      'app.mjs must not contain any manual activity route imports or registrations'
    );
  });

  test('data.mjs thin adapter functions work standalone without server', async (t) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nevo-activity-data-test-'));
    t.after(() => rm(tempDir, { recursive: true, force: true }));

    const specId = 'data-standalone-test';
    recordActivity(
      {
        type: 'workflow.step.started',
        actor: { type: 'agent-session', id: 'session-standalone' },
        scope: { specId, taskId: 't-1' },
      },
      { activityDir: tempDir }
    );
    recordActivity(
      {
        type: 'spec.finalized',
        actor: { type: 'user', id: 'user-standalone' },
        scope: { specId },
      },
      { activityDir: tempDir }
    );

    const adapter = createActivityDataAdapter({ activityDir: tempDir });
    assert.equal(adapter.getTaskActivity(specId, 't-1').length, 1);
    assert.equal(adapter.getSpecOnlyActivity(specId).length, 1);
    assert.equal(adapter.getFullSpecHistory(specId).length, 2);

    // Direct exported functions
    assert.equal(getTaskActivity(specId, 't-1', { activityDir: tempDir }).length, 1);
    assert.equal(getSpecOnlyActivity(specId, { activityDir: tempDir }).length, 1);
    assert.equal(getFullSpecHistory(specId, { activityDir: tempDir }).length, 2);
  });
});
