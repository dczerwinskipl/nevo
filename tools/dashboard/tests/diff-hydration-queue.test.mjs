/**
 * Integration tests for the production useBatchQueries / createBatchQueriesManager primitive
 * and progressive diff preload behavior.
 *
 * Uses real TanStack Query QueryClient, QueryObserver, QueriesObserver, and real @yornaath/batshit
 * batcher with real window scheduling.
 */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { QueryClient, QueryObserver, QueriesObserver } from '@tanstack/react-query';

import { createBatchQueriesManager } from '../ui/features/pull-requests/use-batch-queries.ts';
import { ApiError } from '../ui/features/pull-requests/queries.ts';

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
// 2. useItem() subscriber (QueryObserver) gets updated data when load() completes
// ---------------------------------------------------------------------------
test('useItem() observer receives updated data reactively when load() completes', async () => {
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

  // Set up QueryObserver (the exact observer useItem uses) with enabled: false
  const observer = new QueryObserver(queryClient, {
    queryKey: ['nevo-file-diff', 'file1.ts'],
    enabled: false,
    staleTime: Infinity,
  });

  const unsubscribe = observer.subscribe((result) => {
    observerEvents.push(result);
  });

  // Initial state: not fetched -> data is undefined, isPending is true
  assert.equal(observer.getCurrentResult().data, undefined);
  assert.equal(observer.getCurrentResult().status, 'pending');

  // Trigger imperative load
  await manager.load(req);

  // Observer must have received the loaded data directly from cache notification
  assert.ok(observerEvents.length > 0);
  const latest = observer.getCurrentResult();
  assert.equal(latest.status, 'success');
  assert.deepEqual(latest.data, { path: 'file1.ts', patch: 'diff-file1.ts' });

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 3. useItems() subscriber (QueriesObserver) gets updated data when preload/load completes
// ---------------------------------------------------------------------------
test('useItems() observer receives updated data reactively when preload/load completes', async () => {
  const queryClient = createTestQueryClient();
  const observerSnapshots = [];

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

  const requests = [{ path: 'x.ts' }, { path: 'y.ts' }];

  // Set up QueriesObserver (the exact observer useItems uses) with enabled: false
  const queriesObserver = new QueriesObserver(
    queryClient,
    requests.map((r) => ({
      queryKey: ['nevo-file-diff', r.path],
      enabled: false,
      staleTime: Infinity,
    })),
  );

  const unsubscribe = queriesObserver.subscribe((results) => {
    observerSnapshots.push(results.map((r) => ({ path: r.data?.path, status: r.status })));
  });

  // Initially, all queries in useItems observer are pending with undefined data
  const initialResults = queriesObserver.getCurrentResult();
  assert.equal(initialResults.length, 2);
  assert.equal(initialResults[0].data, undefined);
  assert.equal(initialResults[1].data, undefined);

  // Trigger preload
  manager.preload(requests);

  // Wait for batched prefetch to complete
  await sleep(40);

  const finalResults = queriesObserver.getCurrentResult();
  assert.equal(finalResults[0].status, 'success');
  assert.equal(finalResults[1].status, 'success');
  assert.equal(finalResults[0].data?.patch, 'diff-x.ts');
  assert.equal(finalResults[1].data?.patch, 'diff-y.ts');

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 4. Error state is visible reactively on failure
// ---------------------------------------------------------------------------
test('error state is propagated reactively to QueryObserver when fetchBatch rejects', async () => {
  const queryClient = createTestQueryClient();
  const observerEvents = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async () => {
      throw new Error('Network timeout loading diff');
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 15,
  });

  const observer = new QueryObserver(queryClient, {
    queryKey: ['nevo-file-diff', 'error-file.ts'],
    enabled: false,
    staleTime: Infinity,
  });

  const unsubscribe = observer.subscribe((result) => {
    observerEvents.push(result);
  });

  await assert.rejects(
    () => manager.load({ path: 'error-file.ts' }),
    /Network timeout loading diff/,
  );

  const result = observer.getCurrentResult();
  assert.equal(result.status, 'error');
  assert.equal(result.isError, true);
  assert.equal(result.error?.message, 'Network timeout loading diff');

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 5. preload + load of same item does not trigger a second underlying fetch
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

  // Issue preload (background fetch trigger using prefetchQuery)
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
// 6. Changing headSha updates scope and prevents mixing requests across revisions
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
// 7. Progressive hydration behavior: large list is fetched in sequential chunks
// ---------------------------------------------------------------------------
test('progressive hydration: large list is not all fetched at once; runs in sequential chunks', async () => {
  const queryClient = createTestQueryClient();
  const batchCalls = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      batchCalls.push(requests.map((r) => r.path));
      await sleep(30); // simulate network latency
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 10,
  });

  const allRequests = Array.from({ length: 45 }, (_, i) => ({ path: `file-${i}.ts` }));

  // Progressive preload scheduling: chunk size 15
  let cancelled = false;
  const runProgressive = async () => {
    for (let i = 0; i < allRequests.length; i += 15) {
      if (cancelled) break;
      const chunk = allRequests.slice(i, i + 15);
      manager.preload(chunk);
      await Promise.allSettled(chunk.map((req) => manager.load(req).catch(() => {})));
    }
  };

  const progressivePromise = runProgressive();

  // After first chunk is in-flight (before it finishes and schedules chunk 1)
  await sleep(20);

  // Only chunk 0 (15 files) was batched initially, not all 45!
  assert.equal(batchCalls.length, 1, 'only first chunk should be scheduled initially');
  assert.equal(batchCalls[0].length, 15);
  assert.equal(batchCalls[0][0], 'file-0.ts');
  assert.equal(batchCalls[0][14], 'file-14.ts');

  await progressivePromise;

  // All 3 chunks have completed sequentially
  assert.equal(batchCalls.length, 3, 'expected 3 progressive batches for 45 files');
  assert.equal(batchCalls[1].length, 15);
  assert.equal(batchCalls[2].length, 15);
});

// ---------------------------------------------------------------------------
// 8. Progressive hydration: explicit load() for later item jumps ahead of unscheduled background
// ---------------------------------------------------------------------------
test('progressive hydration: explicit load() for item in later queue runs immediately before unscheduled background work', async () => {
  const queryClient = createTestQueryClient();
  const batchCalls = [];

  let chunk0Resolve;
  const chunk0Barrier = new Promise((res) => {
    chunk0Resolve = res;
  });

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      batchCalls.push(requests.map((r) => r.path));
      if (requests.some((r) => r.path === 'file-0.ts')) {
        // Hold chunk 0 until user explicit load fires
        await chunk0Barrier;
      }
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 10,
  });

  const allRequests = Array.from({ length: 45 }, (_, i) => ({ path: `file-${i}.ts` }));

  const runProgressive = async () => {
    for (let i = 0; i < allRequests.length; i += 15) {
      const chunk = allRequests.slice(i, i + 15);
      manager.preload(chunk);
      await Promise.allSettled(chunk.map((req) => manager.load(req).catch(() => {})));
    }
  };

  const progressivePromise = runProgressive();

  // Wait for chunk 0 to be in-flight
  await sleep(20);
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].includes('file-40.ts'), false);

  // User explicitly clicks file-40.ts (part of chunk 2, not yet scheduled in background)
  const userLoadPromise = manager.load({ path: 'file-40.ts' });

  // Wait for user click batch window to flush
  await sleep(20);

  // User load was dispatched immediately in its own batch while chunk 0 is still in-flight
  assert.equal(batchCalls.length, 2);
  assert.deepEqual(batchCalls[1], ['file-40.ts']);

  // Release chunk 0 barrier and await completion
  chunk0Resolve();
  const userResult = await userLoadPromise;
  await progressivePromise;

  assert.equal(userResult.patch, 'diff-file-40.ts');
  // Total batches: chunk 0 (15 items), user click (1 item), chunk 1 (15 items), chunk 2 (remaining 14 items)
  assert.equal(batchCalls.length, 4);
});

// ---------------------------------------------------------------------------
// 9. load() for item already in current in-flight batch deduplicates without duplicate fetch
// ---------------------------------------------------------------------------
test('load() for item already in current in-flight batch deduplicates without duplicate fetch', async () => {
  const queryClient = createTestQueryClient();
  let fetchBatchCalls = 0;

  let barrierResolve;
  const barrier = new Promise((res) => {
    barrierResolve = res;
  });

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      fetchBatchCalls += 1;
      await barrier;
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 10,
  });

  const req = { path: 'inflight-file.ts' };

  // Start background preload
  manager.preload([req]);
  await sleep(15);

  // User clicks on the file currently in-flight
  const userLoadPromise = manager.load(req);

  barrierResolve();
  const result = await userLoadPromise;

  assert.equal(result.patch, 'diff-inflight-file.ts');
  assert.equal(fetchBatchCalls, 1, 'in-flight item must be deduplicated to exactly 1 fetchBatch call');
});

// ---------------------------------------------------------------------------
// 10. Filtering / background preload contract
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
// 11. resolve() contract: returns null (not undefined) for missing diff
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

// ---------------------------------------------------------------------------
// 12. Initial expanded state does not trigger explicit load() for all files
// ---------------------------------------------------------------------------
test('initial expanded state does not trigger explicit load() for all files on mount', async () => {
  const queryClient = createTestQueryClient();
  const explicitLoadCalls = [];

  const manager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'https://github.com', 'owner/repo', 42, 'sha-1'],
    queryKey: (req) => ['nevo-file-diff', req.path],
    fetchBatch: async (requests) => {
      explicitLoadCalls.push(requests.map((r) => r.path));
      return requests.map((r) => ({ path: r.path, patch: `diff-${r.path}` }));
    },
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
    windowMs: 10,
  });

  // 30 files are initially rendered in expanded state (open=true) in UI.
  // In the updated contract, initial mount only reads useItem() and does NOT call load().
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `initial-${i}.ts` }));

  // Simulate rendering 30 initially open items with useItem observers
  const observers = files.map(
    (file) =>
      new QueryObserver(queryClient, {
        queryKey: ['nevo-file-diff', file.path],
        enabled: false,
        staleTime: Infinity,
      }),
  );

  // Verify that setting up initial expanded UI observers produces 0 load/fetch calls
  await sleep(25);
  assert.equal(explicitLoadCalls.length, 0, 'initial mount in expanded state must not trigger fetch/load');

  // Progressive preload schedules only chunk 0 (15 items)
  const chunk0 = files.slice(0, 15);
  manager.preload(chunk0);

  await sleep(25);
  assert.equal(explicitLoadCalls.length, 1, 'only progressive chunk was scheduled');
  assert.equal(explicitLoadCalls[0].length, 15);
  assert.equal(explicitLoadCalls[0][0], 'initial-0.ts');
  assert.equal(explicitLoadCalls[0][14], 'initial-14.ts');

  // Cleanup observers
  observers.forEach((obs) => obs.destroy?.());
});

// ---------------------------------------------------------------------------
// 13. Scoped group preload: opening one group only preloads that group's files
// ---------------------------------------------------------------------------
test('scoped group preload: opening one group only preloads that group files, not collapsed groups', async () => {
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
    windowMs: 10,
  });

  const groupA = [{ path: 'a1.ts' }, { path: 'a2.ts' }];
  const groupB = [{ path: 'b1.ts' }, { path: 'b2.ts' }];
  const groupC = [{ path: 'c1.ts' }, { path: 'c2.ts' }];

  // Initially all groups collapsed: zero preloads
  await sleep(25);
  assert.equal(batchCalls.length, 0, 'collapsed groups must not trigger preload');

  // User expands Group B: only Group B files are preloaded
  manager.preload(groupB);
  await sleep(25);

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].sort(), ['b1.ts', 'b2.ts']);
  assert.ok(!batchCalls[0].includes('a1.ts') && !batchCalls[0].includes('c1.ts'));

  // User later expands Group A
  manager.preload(groupA);
  await sleep(25);

  assert.equal(batchCalls.length, 2);
  assert.deepEqual(batchCalls[1].sort(), ['a1.ts', 'a2.ts']);
  assert.ok(!batchCalls[1].includes('c1.ts'));
});

// ---------------------------------------------------------------------------
// 14. Controlled retry policy: 4xx is not retried, 503/504 retries max once
// ---------------------------------------------------------------------------
test('controlled retry policy: 404 does not retry, transient error retries at most once and recovers', async () => {
  const queryClient = createTestQueryClient();
  let fetchAttempts404 = 0;

  const notFoundManager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', '404-test'],
    queryKey: (req) => ['diff-404', req.path],
    fetchBatch: async (requests) => {
      fetchAttempts404 += 1;
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    },
    resolve: (res, req) => null,
    windowMs: 5,
    retryDelay: 10,
  });

  await assert.rejects(() => notFoundManager.load({ path: 'missing.ts' }), /Not found/);
  await sleep(30);
  assert.equal(fetchAttempts404, 1, '404 error must not be retried');

  let fetchAttempts503 = 0;
  let shouldFail503 = true;

  const transientManager = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', '503-test'],
    queryKey: (req) => ['diff-503', req.path],
    fetchBatch: async (requests) => {
      fetchAttempts503 += 1;
      if (shouldFail503) {
        const err = new Error('Service Unavailable');
        err.status = 503;
        throw err;
      }
      return [{ path: 'ok.ts', patch: 'recovered' }];
    },
    resolve: (res, req) => res.find((r) => r.path === req.path) ?? null,
    windowMs: 5,
    retryDelay: 10,
  });

  // First trial: fails, retries once (total 2 attempts), and fails
  await assert.rejects(() => transientManager.load({ path: 'ok.ts' }), /Service Unavailable/);
  assert.equal(fetchAttempts503, 2, '503 must retry exactly once (2 attempts total)');

  // Recovery trial: subsequent load after transient recovery succeeds and updates cache
  shouldFail503 = false;
  const recovered = await transientManager.reload({ path: 'ok.ts' });
  assert.deepEqual(recovered, { path: 'ok.ts', patch: 'recovered' });
  assert.equal(transientManager.get({ path: 'ok.ts' })?.patch, 'recovered');
});

// ---------------------------------------------------------------------------
// 15. HTTP fetch adapter with ApiError: status propagation governs retries
// ---------------------------------------------------------------------------
test('HTTP fetch adapter with ApiError propagates status: 404 does not retry, 503/504 retries at most once', async () => {
  const queryClient = createTestQueryClient();
  let fetchAttempts404 = 0;

  // Real fetchFileDiffsBatch adapter behavior throwing ApiError
  const adapterFetch404 = async () => {
    fetchAttempts404 += 1;
    throw new ApiError('Pull request file-diffs API: 404 Pull request not found', 404);
  };

  const manager404 = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'http-404-test'],
    queryKey: (req) => ['diff-http-404', req.path],
    fetchBatch: adapterFetch404,
    resolve: () => null,
    windowMs: 5,
    retryDelay: 10,
  });

  await assert.rejects(() => manager404.load({ path: 'missing.ts' }), (err) => err instanceof ApiError && err.status === 404);
  await sleep(30);
  assert.equal(fetchAttempts404, 1, 'HTTP 404 via ApiError must not be retried by the query manager');

  let fetchAttempts504 = 0;
  const adapterFetch504 = async () => {
    fetchAttempts504 += 1;
    throw new ApiError('Pull request file-diffs API: 504 Gateway Timeout', 504);
  };

  const manager504 = createBatchQueriesManager({
    queryClient,
    scopeKey: ['github', 'http-504-test'],
    queryKey: (req) => ['diff-http-504', req.path],
    fetchBatch: adapterFetch504,
    resolve: () => null,
    windowMs: 5,
    retryDelay: 10,
  });

  await assert.rejects(() => manager504.load({ path: 'timeout.ts' }), (err) => err instanceof ApiError && err.status === 504);
  assert.equal(fetchAttempts504, 2, 'HTTP 504 via ApiError must retry at most once (2 attempts total)');
});




