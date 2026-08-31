/**
 * useBatchQueries — generic primitive for batched, deduplicated item fetching.
 *
 * Architecture:
 *   TanStack Query  ← source of truth: per-item cache, in-flight dedup, staleness
 *         ↑
 *     batshit       ← merges multiple queryFn calls (one per item) into one transport batch
 *         ↑
 *   useBatchQueries ← generic hook + BatchQueriesManager; manages batcher scope & lifecycle
 *         ↑
 *   usePullRequestFileDiffs ← domain adapter
 *         ↑
 *   dashboard UI
 */
import { create, windowedFiniteBatchScheduler } from '@yornaath/batshit';
import type { Batcher } from '@yornaath/batshit';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

export interface BatchQueryItemResult<TResult> {
  data: TResult | undefined;
  status: 'pending' | 'error' | 'success';
  error: Error | null;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  isPending: boolean;
}

export interface BatchQueriesOptions<TRequest, TBatchResult, TResult = TBatchResult> {
  /**
   * Optional scope identity (e.g. [provider, baseUrl, repository, number, headSha]).
   * When any value in scopeKey changes, a new batcher instance is created so that
   * in-flight requests from different scopes / PR revisions are never mixed into
   * the same transport batch or stale closures.
   */
  scopeKey?: readonly unknown[];

  /**
   * Derive a stable React Query key for a single request.
   * Determines per-item cache identity — include every dimension that affects the result.
   */
  queryKey: (request: TRequest) => QueryKey;

  /**
   * Send a batch of requests to the upstream transport.
   * Called at most once per scheduler window for all requests arriving in that window.
   * React Query deduplication ensures this is never called twice for the same in-flight item.
   * The AbortSignal is forwarded from batshit.
   */
  fetchBatch: (requests: TRequest[], signal: AbortSignal) => Promise<TBatchResult>;

  /**
   * Extract the single-item result from the batch response.
   * Must return a concrete result (or null if missing/not applicable).
   * Note: resolve should NOT return undefined (undefined is reserved for "not yet in cache").
   */
  resolve: (batchResult: TBatchResult, request: TRequest) => TResult;

  /**
   * Scheduler window in ms and optional max batch size.
   * Default: 20 ms window, 15 items/batch.
   */
  windowMs?: number;
  maxBatchSize?: number;

  /** How long to treat a cached result as fresh. Default: Infinity (invalidate explicitly). */
  staleTime?: number;

  /**
   * Retry policy for failed batch items.
   * Default: 0 retries on 4xx status, max 1 retry on 5xx/network errors.
   */
  retry?: boolean | number | ((failureCount: number, error: unknown) => boolean);

  /**
   * Delay in ms between retries.
   * Default: 500ms.
   */
  retryDelay?: number | ((retryAttempt: number, error: unknown) => number);
}

export interface BatchQueriesHandle<TRequest, TResult> {
  /**
   * Declare that this item is needed now (imperative fetch trigger).
   * Deduplicated by React Query — if already cached or in-flight, no new fetch is issued.
   */
  load: (request: TRequest) => Promise<TResult>;

  /**
   * Background-load a set of items (imperative prefetch trigger).
   * Uses queryClient.prefetchQuery under the hood with the batcher.
   */
  preload: (requests: TRequest[]) => void;

  /**
   * Force-refresh a single item, invalidating cache and fetching immediately.
   */
  reload: (request: TRequest) => Promise<TResult>;

  /**
   * Synchronously read an item from the cache without subscribing to updates.
   * Returns undefined if the item is not currently in the cache.
   */
  get: (request: TRequest) => TResult | undefined;

  /**
   * Reactive React hook: subscribes to cache updates for a single item.
   * Uses TanStack Query under the hood with enabled: false (does NOT initiate fetching).
   */
  useItem: (request: TRequest) => BatchQueryItemResult<TResult>;

  /**
   * Reactive React hook: subscribes to cache updates for a list of items.
   * Uses TanStack Query useQueries under the hood with enabled: false.
   */
  useItems: (requests: TRequest[]) => Array<BatchQueryItemResult<TResult>>;
}

export interface BatchQueriesManager<TRequest, TBatchResult, TResult> {
  readonly scope: string;
  load: (request: TRequest) => Promise<TResult>;
  preload: (requests: TRequest[]) => void;
  reload: (request: TRequest) => Promise<TResult>;
  get: (request: TRequest) => TResult | undefined;
  updateOptions: (options: BatchQueriesOptions<TRequest, TBatchResult, TResult>) => void;
}

function defaultBatchRetry(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function createBatchQueriesManager<TRequest, TBatchResult, TResult = TBatchResult>(
  options: BatchQueriesOptions<TRequest, TBatchResult, TResult> & { queryClient: QueryClient },
): BatchQueriesManager<TRequest, TBatchResult, TResult> {
  const {
    queryClient,
    scopeKey,
    queryKey,
    fetchBatch,
    resolve,
    windowMs = 20,
    maxBatchSize = 15,
    staleTime = Infinity,
    retry = defaultBatchRetry,
    retryDelay = 500,
  } = options;

  const scope = JSON.stringify(scopeKey ?? []);
  let currentFetchBatch = fetchBatch;
  let currentResolve = resolve;
  let currentStaleTime = staleTime;
  let currentRetry = retry;
  let currentRetryDelay = retryDelay;

  const batcher: Batcher<TBatchResult, TRequest, TResult> = create<TBatchResult, TRequest, TResult>({
    name: `useBatchQueries:${scope}`,
    fetcher: (requests, signal) => currentFetchBatch(requests, signal),
    resolver: (batchResult, request) => currentResolve(batchResult, request),
    scheduler: windowedFiniteBatchScheduler({ windowMs, maxBatchSize }),
  });

  const makeQueryFn = (request: TRequest) => () => batcher.fetch(request);

  const load = (request: TRequest): Promise<TResult> => {
    return queryClient.fetchQuery({
      queryKey: queryKey(request),
      queryFn: makeQueryFn(request),
      staleTime: currentStaleTime,
      retry: currentRetry,
      retryDelay: currentRetryDelay,
    });
  };

  const preload = (requests: TRequest[]): void => {
    for (const request of requests) {
      void queryClient.prefetchQuery({
        queryKey: queryKey(request),
        queryFn: makeQueryFn(request),
        staleTime: currentStaleTime,
        retry: currentRetry,
        retryDelay: currentRetryDelay,
      });
    }
  };

  const reload = (request: TRequest): Promise<TResult> => {
    void queryClient.invalidateQueries({ queryKey: queryKey(request) });
    return queryClient.fetchQuery({
      queryKey: queryKey(request),
      queryFn: makeQueryFn(request),
      staleTime: 0,
      retry: currentRetry,
      retryDelay: currentRetryDelay,
    });
  };

  const get = (request: TRequest): TResult | undefined => {
    return queryClient.getQueryData<TResult>(queryKey(request));
  };

  const updateOptions = (nextOptions: BatchQueriesOptions<TRequest, TBatchResult, TResult>) => {
    currentFetchBatch = nextOptions.fetchBatch;
    currentResolve = nextOptions.resolve;
    currentStaleTime = nextOptions.staleTime ?? Infinity;
    currentRetry = nextOptions.retry ?? defaultBatchRetry;
    currentRetryDelay = nextOptions.retryDelay ?? 500;
  };

  return {
    scope,
    load,
    preload,
    reload,
    get,
    updateOptions,
  };
}

export function useBatchQueries<TRequest, TBatchResult, TResult = TBatchResult>(
  options: BatchQueriesOptions<TRequest, TBatchResult, TResult>,
): BatchQueriesHandle<TRequest, TResult> {
  const queryClient = useQueryClient();
  const serializedScope = JSON.stringify(options.scopeKey ?? []);

  const managerRef = useRef<BatchQueriesManager<TRequest, TBatchResult, TResult> | null>(null);

  if (!managerRef.current || managerRef.current.scope !== serializedScope) {
    managerRef.current = createBatchQueriesManager({
      ...options,
      queryClient,
    });
  } else {
    managerRef.current.updateOptions(options);
  }

  const manager = managerRef.current;

  const load = useCallback((request: TRequest) => manager.load(request), [manager]);
  const preload = useCallback((requests: TRequest[]) => manager.preload(requests), [manager]);
  const reload = useCallback((request: TRequest) => manager.reload(request), [manager]);
  const get = useCallback((request: TRequest) => manager.get(request), [manager]);

  const useItem = (request: TRequest): BatchQueryItemResult<TResult> => {
    const query = useQuery({
      queryKey: options.queryKey(request),
      queryFn: () => manager.load(request),
      enabled: false,
      staleTime: options.staleTime ?? Infinity,
    });
    return {
      data: query.data as TResult | undefined,
      status: query.status,
      error: (query.error as Error | null) ?? null,
      isFetching: query.isFetching,
      isError: query.isError,
      isSuccess: query.isSuccess,
      isPending: query.isPending,
    };
  };

  const useItems = (requests: TRequest[]): Array<BatchQueryItemResult<TResult>> => {
    const queries = useQueries({
      queries: requests.map((req) => ({
        queryKey: options.queryKey(req),
        queryFn: () => manager.load(req),
        enabled: false,
        staleTime: options.staleTime ?? Infinity,
      })),
    });
    return queries.map((query) => ({
      data: query.data as TResult | undefined,
      status: query.status,
      error: (query.error as Error | null) ?? null,
      isFetching: query.isFetching,
      isError: query.isError,
      isSuccess: query.isSuccess,
      isPending: query.isPending,
    }));
  };

  return { load, preload, reload, get, useItem, useItems };
}
