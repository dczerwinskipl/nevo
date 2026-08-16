/**
 * useBatchQueries — generic primitive for batched, deduplicated item fetching.
 *
 * Architecture:
 *   TanStack Query  ← source of truth: per-item cache, in-flight dedup, staleness
 *         ↑
 *     batshit       ← merges multiple queryFn calls (one per item) into one transport batch
 *         ↑
 *   useBatchQueries ← this file; hides enabled/batchSize/batcher lifecycle from callers
 *         ↑
 *   useFileDiffs    ← domain adapter (see use-dashboard-data.ts)
 *         ↑
 *   dashboard UI
 */
import { create, windowedFiniteBatchScheduler } from '@yornaath/batshit';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';

export interface BatchQueriesOptions<TRequest, TBatchResult, TResult = TBatchResult> {
  /**
   * Derive a stable React Query key for a single request.
   * Determines per-item cache identity — include every dimension that affects the result
   * (e.g. provider, repo, number, headSha, path).
   */
  queryKey: (request: TRequest) => QueryKey;

  /**
   * Send a batch of requests to the upstream transport.
   * Called at most once per scheduler window for all requests arriving in that window.
   * React Query deduplication ensures this is never called twice for the same in-flight item.
   * The AbortSignal is forwarded from batshit — honour it to cancel in-flight network requests.
   */
  fetchBatch: (requests: TRequest[], signal: AbortSignal) => Promise<TBatchResult>;

  /**
   * Extract the single-item result from the batch response.
   * Called per item after the batch resolves.
   */
  resolve: (batchResult: TBatchResult, request: TRequest) => TResult | undefined;

  /**
   * Scheduler window in ms and optional max batch size.
   * Default: 20 ms window, 15 items/batch — large enough to coalesce a typical initial
   * render (visible files all mount within a single microtask flush) without adding
   * perceptible latency for a user-triggered load().
   */
  windowMs?: number;
  maxBatchSize?: number;

  /** How long to treat a cached result as fresh. Default: Infinity (invalidate explicitly). */
  staleTime?: number;
}

export interface BatchQueriesHandle<TRequest, TResult> {
  /**
   * Declare that this item is needed now.
   * If the item is already in cache or an identical request is in-flight (deduped by TQ),
   * no new fetch is issued. Safe to call from an onClick or on expand — React Query
   * is the single gating authority; no separate inFlight set required.
   */
  load: (request: TRequest) => void;

  /**
   * Background-load a set of items.
   * Each item goes through the same dedup check as load(); only uncached, not-in-flight
   * items produce real fetches, and batshit groups those into a single transport call.
   */
  preload: (requests: TRequest[]) => void;

  /**
   * Force-refresh a single item, even if it is already cached.
   */
  reload: (request: TRequest) => void;

  /**
   * Read an item synchronously from the React Query cache.
   * Returns undefined if the item has not been fetched yet.
   */
  get: (request: TRequest) => TResult | undefined;
}

export function useBatchQueries<TRequest, TBatchResult, TResult = TBatchResult>(
  options: BatchQueriesOptions<TRequest, TBatchResult, TResult>,
): BatchQueriesHandle<TRequest, TResult> {
  const {
    queryKey,
    fetchBatch,
    resolve,
    windowMs = 20,
    maxBatchSize = 15,
    staleTime = Infinity,
  } = options;

  const queryClient = useQueryClient();

  // The batcher lives for the lifetime of the hook instance (stable ref).
  // It must NOT be re-created per render — a new batcher per render would
  // defeat the entire batching purpose (items from different renders would
  // never land in the same batch).
  //
  // useMemo with an empty dep array gives us a stable, lazily-initialized value
  // without the null-safety ceremony of useRef + lazy-init guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batcher = useRef(
    create<TBatchResult, TRequest, TResult | undefined>({
      name: 'useBatchQueries',
      fetcher: (requests, signal) => fetchBatch(requests, signal),
      resolver: (batchResult, request) => resolve(batchResult, request),
      scheduler: windowedFiniteBatchScheduler({ windowMs, maxBatchSize }),
    }),
  ).current;

  // The queryFn for a single item. TanStack Query calls this at most once per cache miss
  // / stale entry — batshit then windows these calls across components/effects into one
  // transport batch.
  const makeQueryFn = useCallback(
    (request: TRequest) => () => batcher.fetch(request),
    [batcher],
  );

  const load = useCallback(
    (request: TRequest) => {
      void queryClient.fetchQuery({
        queryKey: queryKey(request),
        queryFn: makeQueryFn(request),
        staleTime,
      });
    },
    [queryClient, queryKey, makeQueryFn, staleTime],
  );

  const preload = useCallback(
    (requests: TRequest[]) => {
      for (const request of requests) load(request);
    },
    [load],
  );

  const reload = useCallback(
    (request: TRequest) => {
      void queryClient.invalidateQueries({ queryKey: queryKey(request) }).then(() =>
        queryClient.fetchQuery({
          queryKey: queryKey(request),
          queryFn: makeQueryFn(request),
          staleTime: 0,
        }),
      );
    },
    [queryClient, queryKey, makeQueryFn],
  );

  const get = useCallback(
    (request: TRequest): TResult | undefined =>
      queryClient.getQueryData<TResult>(queryKey(request)),
    [queryClient, queryKey],
  );

  return { load, preload, reload, get };
}
