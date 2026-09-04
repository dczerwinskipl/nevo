import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { useBatchQueries } from './use-batch-queries.ts';
import type { BatchQueriesHandle } from './use-batch-queries.ts';
import type {
  AvailablePullRequest,
  PullRequestFile,
  PullRequestFileDiffsPayload,
  PullRequestFilesPayload,
  PullRequestFullDiffPayload,
  PullRequestsPayload,
} from './types';
import type { SpecificationSummary } from '@/features/specifications/types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const PULL_REQUEST_QUERY_KEY = ['nevo-spec-pull-requests'] as const;
export const PULL_REQUEST_FILES_QUERY_KEY = ['nevo-spec-pull-request-files'] as const;
export const PULL_REQUEST_FULL_DIFF_QUERY_KEY = ['nevo-spec-pull-request-full-diff'] as const;

// PR-list cannot rely on specs-changed (D5 — a GitHub push changes headSha
// without touching any specs/ file), so it keeps its own slow safety
// interval well above the old 30s, plus refetch-on-focus/explicit refresh.
const PULL_REQUEST_SAFETY_REFRESH_MS = 5 * 60_000;

async function fetchPullRequests(specification: SpecificationSummary) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/pull-requests`,
    {
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(`Pull request API: ${response.status}`);
  return (await response.json()) as PullRequestsPayload;
}

// PR-list metadata refresh is independent of specs-changed (D5): initial
// fetch + refetch-on-window-focus + explicit refresh + a slow safety
// interval, never the SSE watcher (it structurally can't see a GitHub push).
export function usePullRequests(specification: SpecificationSummary, enabled = true) {
  const query = useQuery({
    queryKey: [...PULL_REQUEST_QUERY_KEY, specification.source, specification.slug],
    queryFn: () => fetchPullRequests(specification),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? PULL_REQUEST_SAFETY_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && enabled,
    refreshing: query.isFetching && !query.isPending,
    refresh: query.refetch,
  };
}

async function fetchPullRequestFiles(specification: SpecificationSummary, number: number) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/pull-requests/${number}/files`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Pull request files API: ${response.status}`);
  return (await response.json()) as PullRequestFilesPayload;
}

// Client-side keyed by headSha too (even though the server route itself
// isn't headSha-scoped) — a new PR version simply gets a fresh cache entry,
// so "re-open the same PR at the same headSha costs nothing" holds without
// any extra invalidation wiring (area pull-request-file-and-diff-loading).
export function usePullRequestFiles(
  specification: SpecificationSummary,
  pullRequest: AvailablePullRequest,
  enabled = true,
) {
  const query = useQuery({
    queryKey: [
      ...PULL_REQUEST_FILES_QUERY_KEY,
      specification.source,
      specification.slug,
      pullRequest.number,
      pullRequest.headSha,
    ],
    queryFn: () => fetchPullRequestFiles(specification, pullRequest.number),
    enabled,
    staleTime: Infinity,
    retry: 2,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && enabled,
    refreshing: query.isFetching && !query.isPending,
    refresh: query.refetch,
  };
}

async function fetchFileDiffsBatch(
  specification: SpecificationSummary,
  number: number,
  paths: string[],
  headSha: string | null,
) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/pull-requests/${number}/file-diffs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths, headSha }),
    },
  );
  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error ? `: ${errJson.error}` : '';
    } catch {}
    throw new ApiError(`Pull request file-diffs API: ${response.status}${errorDetail}`, response.status);
  }
  return ((await response.json()) as PullRequestFileDiffsPayload).diffs;
}

/** Per-file diff request identity (all dimensions that affect the diff content). */
export interface FileDiffRequest {
  provider: string;
  baseUrl: string;
  repository: string;
  number: number;
  headSha: string | null;
  path: string;
}

/**
 * Thin domain adapter over useBatchQueries for file-level diffs.
 *
 * Responsibility split:
 *   - usePullRequestFileDiffs owns the React Query key shape (all 5 identity dimensions),
 *     the fetch transport, and the per-item result mapping.
 *   - useBatchQueries owns batch-window scheduling (via @yornaath/batshit), in-flight
 *     dedup, and TQ lifecycle.
 *   - The dashboard UI only calls load/preload/get — it never sees batchSize,
 *     inFlight state, or other implementation details.
 *
 * Cache semantics:
 *   - A new headSha → different query key → automatic cache miss (bug #2 fix).
 *   - Same item requested via preload then load → TQ dedup → one fetch (bug #1 fix).
 *   - Changing visible/filtering → new preload() call with updated set; TQ handles
 *     dedup for items still in the previous set (bug #3 fix).
 */
export function usePullRequestFileDiffs(
  specification: SpecificationSummary,
  pullRequest: AvailablePullRequest,
): BatchQueriesHandle<FileDiffRequest, PullRequestFile | null> {
  return useBatchQueries<FileDiffRequest, PullRequestFile[], PullRequestFile | null>({
    scopeKey: [
      pullRequest.reference.provider,
      pullRequest.reference.baseUrl,
      pullRequest.reference.repository,
      pullRequest.number,
      pullRequest.headSha ?? '',
    ],
    queryKey: (req) => [
      'nevo-file-diff',
      req.provider,
      req.baseUrl,
      req.repository,
      req.number,
      req.headSha ?? '',
      req.path,
    ],
    fetchBatch: (requests) =>
      fetchFileDiffsBatch(
        specification,
        pullRequest.number,
        requests.map((r) => r.path),
        pullRequest.headSha,
      ),
    resolve: (files, req) => files.find((f) => f.path === req.path) ?? null,
  });
}

/**
 * Progressive background hydration policy for pull request file diffs.
 *
 * Semantic behavior:
 *   - Schedules visible files in sequential chunks (default 15 items).
 *   - Chunk N+1 is dispatched only after Chunk N has settled.
 *   - An explicit user action (e.g. expanding file 80) calls `load()`, which
 *     immediately fetches ahead of yet-unscheduled background chunks (16..100).
 *   - Expanding an item from the currently in-flight chunk deduplicates automatically via React Query.
 *   - Unscheduled chunks are cleanly cancelled if the PR card closes or visible files change.
 */
export function useProgressiveDiffPreload(
  enabled: boolean,
  requests: FileDiffRequest[],
  diffHandle: BatchQueriesHandle<FileDiffRequest, PullRequestFile | null>,
  batchSize = 15,
): void {
  const { preload, load } = diffHandle;
  useEffect(() => {
    if (!enabled || !requests.length) return;

    let cancelled = false;

    async function runProgressivePreload() {
      for (let i = 0; i < requests.length; i += batchSize) {
        if (cancelled) break;
        const chunk = requests.slice(i, i + batchSize);
        preload(chunk);
        // Wait for all items in the current chunk to settle before scheduling next chunk
        await Promise.allSettled(chunk.map((req) => load(req).catch(() => {})));
      }
    }

    void runProgressivePreload();

    return () => {
      cancelled = true;
    };
  }, [enabled, requests, preload, load, batchSize]);
}

async function fetchFullDiff(specification: SpecificationSummary, number: number) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/pull-requests/${number}/diff`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Pull request diff API: ${response.status}`);
  return (await response.json()) as PullRequestFullDiffPayload;
}

// On-demand only (area pull-request-file-and-diff-loading: "never fetched as
// a side effect of listing PRs or opening the files manifest") — `load()` is
// the only thing that triggers the request.
//
// headSha is included in the query key (bug #2 fix) — a new push to the same PR
// produces a different headSha → different cache entry → stale diff is never shown.
export function useFullDiff(specification: SpecificationSummary, pullRequest: AvailablePullRequest) {
  const query = useQuery({
    queryKey: [
      ...PULL_REQUEST_FULL_DIFF_QUERY_KEY,
      specification.source,
      specification.slug,
      pullRequest.number,
      pullRequest.headSha ?? '',
    ],
    queryFn: () => fetchFullDiff(specification, pullRequest.number),
    enabled: false,
    staleTime: Infinity,
    retry: 1,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isFetching,
    loaded: query.isFetched && !query.isError,
    load: query.refetch,
  };
}

export async function invalidatePullRequestQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: PULL_REQUEST_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: PULL_REQUEST_FILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: PULL_REQUEST_FULL_DIFF_QUERY_KEY }),
  ]);
}
