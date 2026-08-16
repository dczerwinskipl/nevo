/**
 * Integration tests for the production useBatchQueries / createBatchQueriesManager primitive.
 *
 * Uses real TanStack Query QueryClient, QueryObserver, and real @yornaath/batshit batcher
 * with real window scheduling — no fake batcher or mock cache implementation.
 */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { createBatchQueriesManager } from '../src/hooks/use-batch-queries.ts';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Multiple items scheduled within window land in one fetchBatch call
// ---------------------------------------------------------------------------
test('multiple items scheduled within scheduler window land in one fetchBatch call', async () => {
  const queryClient = createTestQueryClient();
  const batchCalls = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      batchCalls.push(requests.map((r) => r.path));
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 25,
  });

  const [resA, resB, resC] = await Promise.all([
    manager.load({ path: 'a.js' }),
    manager.load({ path: 'b.js' }),
    manager.load({ path: 'c.js' }),
  ]);

  assert.equal(batchCalls.length, 1, 'expected exactly one batch call for items in same tick');
  assert.deepEqual(batchCalls[0].sort(), ['a.js', 'b.js', 'c.js']);
  assert.equal(resA?.patch, 'diff-a.js');
  assert.equal(resB?.patch, 'diff-b.js');
  assert.equal(resC?.patch, 'diff-c.js');
});

// ---------------------------------------------------------------------------
// 2. load() completes fetch and reactive QueryObserver gets data without manual rerender
// ---------------------------------------------------------------------------
test('load() completes fetch and a reactive QueryObserver receives updated data automatically', async () => {
  const queryClient = createTestQueryClient();
  const observerEvents = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 15,
  });

  const req = { path: 'file1.ts' };

  // Set up QueryObserver (the exact observer useQuery uses under the hood) with enabled: false
  const observer = new QueryObserver(queryClient, {
    queryKey: ['nevo-file-diff', 'file1.ts'],
    enabled: false,
    staleTime: Infinity,
  });

  const unsubscribe = observer.subscribe((result) => {
    observerEvents.push(result.data);
  });

  // Initial state: not fetched -> data is undefined
  assert.equal(observer.getCurrentResult().data, undefined);

  // Trigger imperative load
  await manager.load(req);

  // Observer must have received the loaded data directly from cache notification
  assert.ok(observerEvents.length > 0);
  assert.deepEqual(observer.getCurrentResult().data, { path: 'file1.ts', patch: 'diff-file1.ts' });

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 3. preload + load of same item does not trigger a second underlying fetch
// ---------------------------------------------------------------------------
test('preload + load for the same item does not trigger a second underlying fetch', async () => {
  const queryClient = createTestQueryClient();
  let fetchBatchCalls = 0;

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      fetchBatchCalls += 1;
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 20,
  });

  const req = { path: 'shared.ts' };

  // Issue preload (background fetch trigger)
  manager.preload([req]);

  // Immediately call load on the same item while preload is in-flight
  const loaded = await manager.load(req);

  assert.deepEqual(loaded, { path: 'shared.ts', patch: 'diff-shared.ts' });
  assert.equal(fetchBatchCalls, 1, 'underlying fetchBatch called exactly once');

  // Calling load again on settled cache also does not re-fetch
  const cached = await manager.load(req);
  assert.deepEqual(cached, { path: 'shared.ts', patch: 'diff-shared.ts' });
  assert.equal(fetchBatchCalls, 1, 'cached read did not issue second fetchBatch');
});

// ---------------------------------------------------------------------------
// 4. Changing headSha updates scope and prevents mixing requests across revisions
// ---------------------------------------------------------------------------
test('changing headSha updates scope and uses new query identity and new batcher instance', async () => {
  const queryClient = createTestQueryClient();
  const batchCalls = [];

  function makeOptions(headSha) {
    return {
      queryClient,
      scopeKey: ['github', 'https://github.com', 'owner/repo', 42, headSha],
      queryKey: (req) => ['nevo-file-diff', 'github', 'owner/repo', 42, headSha, req.path],
      fetchBatch: async (requests) => {
        batchCalls.push({ headSha, paths: requests.map((r) => r.path) });
        return requests.map((r) => ({ path: r.path, headSha, patch: `patch-${headSha}-${r.path}` }));
      },
      resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
      windowMs: 15,
    };
  }

  // First revision: sha-v1
  let manager = createBatchQueriesManager(makeOptions('sha-v1'));

  const diffV1 = await manager.load({ path: 'app.ts' });
  assert.equal(diffV1?.headSha, 'sha-v1');
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].headSha, 'sha-v1');

  // Prop update without unmount: headSha becomes sha-v2 -> new scope -> new batcher
  manager = createBatchQueriesManager(makeOptions('sha-v2'));

  const diffV2 = await manager.load({ path: 'app.ts' });
  assert.equal(diffV2?.headSha, 'sha-v2');
  assert.equal(batchCalls.length, 2);
  assert.equal(batchCalls[1].headSha, 'sha-v2');

  // Both versions are preserved in their respective cache slots
  assert.equal(manager.get({ path: 'app.ts' })?.headSha, 'sha-v2');
  assert.equal(
    queryClient.getQueryData(['nevo-file-diff', 'github', 'owner/repo', 42, 'sha-v1', 'app.ts'])?.headSha,
    'sha-v1',
  );
});

// ---------------------------------------------------------------------------
// 5. Filtering / background preload contract
// ---------------------------------------------------------------------------
test('filtering/preload contract: only visible files are passed to preload; already-dispatched batches complete', async () => {
  const queryClient = createTestQueryClient();
  const batchCalls = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      batchCalls.push(requests.map((r) => r.path));
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 15,
  });

  // Initial visible set: visible1.ts, visible2.ts (hidden.ts excluded)
  const visible1 = [{ path: 'visible1.ts' }, { path: 'visible2.ts' }];
  manager.preload(visible1);

  // Wait for window to flush
  await sleep(35);

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].sort(), ['visible1.ts', 'visible2.ts']);
  assert.ok(!batchCalls[0].includes('hidden.ts'));

  // Filter toggle hides visible2.ts; only visible1.ts is in visible set now
  const visible2 = [{ path: 'visible1.ts' }];
  manager.preload(visible2);

  await sleep(35);

  // visible1.ts was already in cache, so no new batch call was dispatched
  assert.equal(batchCalls.length, 1);
});

// ---------------------------------------------------------------------------
// 6. resolve() contract: returns null (not undefined) for missing diff
// ---------------------------------------------------------------------------
test('resolve returns concrete null (not undefined) when diff is missing in response', async () => {
  const queryClient = createTestQueryClient();

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async () => [], // returns empty list (diff missing from payload)
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 10,
  });

  const res = await manager.load({ path: 'nonexistent.ts' });
  assert.strictEqual(res, null, 'expected null for missing diff');

  // get() returns null (query settled, not found) distinct from undefined (unfetched)
  assert.strictEqual(manager.get({ path: 'nonexistent.ts' }), null);
  assert.strictEqual(manager.get({ path: 'never-requested.ts' }), undefined);
});
