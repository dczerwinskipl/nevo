import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AvailablePullRequest,
  DashboardChange,
  DashboardPayload,
  AiProvidersPayload,
  AiMessage,
  AiSession,
  AiSessionsPayload,
  AiTurnSnapshot,
  PullRequestFile,
  PullRequestFileDiffsPayload,
  PullRequestFileManifestEntry,
  PullRequestFilesPayload,
  PullRequestFullDiffPayload,
  PullRequestsPayload,
  SpecificationActionResult,
  SpecificationActionsPayload,
  SpecificationDocument,
  SpecificationManifest,
  SpecificationOwnerAction,
  TaskStatusesPayload,
} from '@/lib/types';

const DASHBOARD_QUERY_KEY = ['nevo-dashboard'] as const;
const MANIFEST_QUERY_KEY = ['nevo-spec-manifest'] as const;
const DOCUMENT_QUERY_KEY = ['nevo-spec-document'] as const;
const TASK_STATUSES_QUERY_KEY = ['nevo-spec-task-statuses'] as const;
const PULL_REQUEST_QUERY_KEY = ['nevo-spec-pull-requests'] as const;
const PULL_REQUEST_FILES_QUERY_KEY = ['nevo-spec-pull-request-files'] as const;
const PULL_REQUEST_FULL_DIFF_QUERY_KEY = ['nevo-spec-pull-request-full-diff'] as const;
const ACTIONS_QUERY_KEY = ['nevo-spec-actions'] as const;
const AI_PROVIDERS_QUERY_KEY = ['nevo-ai-providers'] as const;
const AI_SESSIONS_QUERY_KEY = ['nevo-ai-sessions'] as const;
const AI_SESSION_QUERY_KEY = ['nevo-ai-session'] as const;
const AI_MESSAGES_QUERY_KEY = ['nevo-ai-messages'] as const;
const AI_TURN_QUERY_KEY = ['nevo-ai-turn'] as const;

// `/api/dashboard`'s own safety-refresh backstop (minutes, not seconds) —
// specs-changed SSE invalidation is the real trigger; this only guards
// against a missed/late SSE event (area dashboard-data-loading-contracts).
const DASHBOARD_SAFETY_REFRESH_MS = 5 * 60_000;
// PR-list cannot rely on specs-changed (D5 — a GitHub push changes headSha
// without touching any specs/ file), so it keeps its own slow safety
// interval well above the old 30s, plus refetch-on-focus/explicit refresh.
const PULL_REQUEST_SAFETY_REFRESH_MS = 5 * 60_000;
const TASK_STATUS_POLL_MS = 4_000;

type SpecsChangedEvent = { type: 'specs-changed'; at: string; eventType?: string; files?: string[] };

async function fetchDashboard() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard API: ${response.status}`);
  return await response.json() as DashboardPayload;
}

export function handleSpecsChanged(queryClient: ReturnType<typeof useQueryClient>, event: SpecsChangedEvent) {
  void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY });

  const files = event.files;
  if (!files || !files.length) {
    // Coarse fallback — this change can't be attributed to specific files.
    void queryClient.invalidateQueries({ queryKey: MANIFEST_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY });
    return;
  }

  const changedSlugs = new Set(files.map(path => path.split('/')[2]).filter(Boolean));
  void queryClient.invalidateQueries({
    predicate: query => {
      const key = query.queryKey as QueryKey;
      if (key[0] !== MANIFEST_QUERY_KEY[0]) return false;
      return changedSlugs.has(String(key[2]));
    },
  });
  void queryClient.invalidateQueries({
    predicate: query => {
      const key = query.queryKey as QueryKey;
      if (key[0] !== DOCUMENT_QUERY_KEY[0]) return false;
      // A changed file's own repo-relative path (`specs/active/<slug>/tasks/x.md`)
      // matches a manifest document's `path` field exactly — no separate
      // mapping table needed to know which docId a raw fs event touched.
      const manifest = queryClient.getQueryData<SpecificationManifest>([MANIFEST_QUERY_KEY[0], key[1], key[2]]);
      if (!manifest) return true; // nothing cached to compare against — invalidate to be safe
      const matchingDoc = [manifest.overview, ...manifest.areas, ...manifest.tasks].find(d => d.docId === key[3]);
      return Boolean(matchingDoc?.path && files.includes(matchingDoc.path));
    },
  });
}

export function useDashboardData() {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const query = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: fetchDashboard,
    staleTime: 30_000,
    refetchInterval: DASHBOARD_SAFETY_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.addEventListener('connected', () => setLive(true));
    events.addEventListener('specs-changed', rawEvent => {
      const detail = JSON.parse((rawEvent as MessageEvent).data) as SpecsChangedEvent;
      handleSpecsChanged(queryClient, detail);
    });
    events.onerror = () => setLive(false);
    return () => events.close();
  }, [queryClient]);

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    live,
    refresh: query.refetch,
  };
}

async function fetchSpecificationManifest(change: DashboardChange) {
  const response = await fetch(`/api/specs/${change.source}/${encodeURIComponent(change.slug)}/content`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Specification manifest API: ${response.status}`);
  return await response.json() as SpecificationManifest;
}

// Manifest is metadata-only (no markdown bodies) — event-driven invalidation
// only, no refetchInterval (area dashboard-data-loading-contracts).
export function useSpecificationManifest(change: DashboardChange, enabled = true) {
  const query = useQuery({
    queryKey: [...MANIFEST_QUERY_KEY, change.source, change.slug],
    queryFn: () => fetchSpecificationManifest(change),
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

async function fetchSpecificationDocument(change: DashboardChange, docId: string) {
  const response = await fetch(
    `/api/specs/${change.source}/${encodeURIComponent(change.slug)}/content/${encodeURIComponent(docId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Specification document API: ${response.status}`);
  return await response.json() as SpecificationDocument;
}

// One document's body, fetched only once it's actually opened, cached with
// effectively-infinite staleness and invalidated only by the specs-changed
// SSE event naming its own file (area dashboard-data-loading-contracts).
export function useSpecificationDocument(change: DashboardChange, docId: string | null, enabled = true) {
  const active = enabled && Boolean(docId);
  const query = useQuery({
    queryKey: [...DOCUMENT_QUERY_KEY, change.source, change.slug, docId ?? ''],
    queryFn: () => fetchSpecificationDocument(change, docId as string),
    enabled: active,
    staleTime: Infinity,
    retry: 2,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && active,
    refreshing: query.isFetching && !query.isPending,
    refresh: query.refetch,
  };
}

async function fetchTaskStatuses(change: DashboardChange) {
  const response = await fetch(`/api/specs/${change.source}/${encodeURIComponent(change.slug)}/task-statuses`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Task statuses API: ${response.status}`);
  return await response.json() as TaskStatusesPayload;
}

// Small enough to poll every few seconds regardless of specs-changed —
// deliberately not event-driven (area dashboard-data-loading-contracts: "not
// worth the added complexity of event-driven invalidation for a payload this
// small").
export function useTaskStatuses(change: DashboardChange, enabled = true) {
  const query = useQuery({
    queryKey: [...TASK_STATUSES_QUERY_KEY, change.source, change.slug],
    queryFn: () => fetchTaskStatuses(change),
    enabled,
    staleTime: TASK_STATUS_POLL_MS,
    refetchInterval: enabled ? TASK_STATUS_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && enabled,
    refreshing: query.isFetching && !query.isPending,
    refresh: query.refetch,
  };
}

async function fetchPullRequests(change: DashboardChange) {
  const response = await fetch(`/api/specs/${change.source}/${encodeURIComponent(change.slug)}/pull-requests`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Pull request API: ${response.status}`);
  return await response.json() as PullRequestsPayload;
}

// PR-list metadata refresh is independent of specs-changed (D5): initial
// fetch + refetch-on-window-focus + explicit refresh + a slow safety
// interval, never the SSE watcher (it structurally can't see a GitHub push).
export function usePullRequests(change: DashboardChange, enabled = true) {
  const query = useQuery({
    queryKey: [...PULL_REQUEST_QUERY_KEY, change.source, change.slug],
    queryFn: () => fetchPullRequests(change),
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

async function fetchPullRequestFiles(change: DashboardChange, number: number) {
  const response = await fetch(
    `/api/specs/${change.source}/${encodeURIComponent(change.slug)}/pull-requests/${number}/files`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Pull request files API: ${response.status}`);
  return await response.json() as PullRequestFilesPayload;
}

// Client-side keyed by headSha too (even though the server route itself
// isn't headSha-scoped) — a new PR version simply gets a fresh cache entry,
// so "re-open the same PR at the same headSha costs nothing" holds without
// any extra invalidation wiring (area pull-request-file-and-diff-loading).
export function usePullRequestFiles(change: DashboardChange, pullRequest: AvailablePullRequest, enabled = true) {
  const query = useQuery({
    queryKey: [...PULL_REQUEST_FILES_QUERY_KEY, change.source, change.slug, pullRequest.number, pullRequest.headSha],
    queryFn: () => fetchPullRequestFiles(change, pullRequest.number),
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

async function fetchFileDiffsBatch(change: DashboardChange, number: number, paths: string[], headSha: string | null) {
  const response = await fetch(
    `/api/specs/${change.source}/${encodeURIComponent(change.slug)}/pull-requests/${number}/file-diffs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths, headSha }),
    },
  );
  if (!response.ok) throw new Error(`Pull request file-diffs API: ${response.status}`);
  return (await response.json() as PullRequestFileDiffsPayload).diffs;
}

const DEFAULT_DIFF_BATCH_SIZE = 15;

export interface DiffFetchUnit {
  paths: string[];
  priority: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Pure diff-hydration fetch-order policy (area pull-request-file-and-diff-
 * loading, AC4) — kept separate from the stateful hook below so the ordering
 * guarantee itself is directly testable without a DOM/React renderer. Every
 * path in `priorityPaths` that isn't already resolved/in-flight becomes its
 * own single-path unit, always ordered first — ahead of every background
 * batch, regardless of where that path would otherwise fall in `allPaths`'
 * own order. The remaining not-yet-settled paths are chunked into background
 * batches of `batchSize`, in `allPaths`' own order.
 */
export function buildDiffFetchPlan({
  allPaths,
  resolvedPaths,
  inFlightPaths,
  priorityPaths = [],
  batchSize,
}: {
  allPaths: string[];
  // A `Map`'s `.has()` works identically to a `Set`'s for this purpose — the
  // hook passes its `diffs` Map directly rather than re-deriving a Set on
  // every render just to satisfy a narrower parameter type.
  resolvedPaths: { has(path: string): boolean };
  inFlightPaths: { has(path: string): boolean };
  priorityPaths?: string[];
  batchSize: number;
}): DiffFetchUnit[] {
  const known = new Set(allPaths);
  const settled = (path: string) => resolvedPaths.has(path) || inFlightPaths.has(path);

  const priorityUnits: DiffFetchUnit[] = priorityPaths
    .filter(path => known.has(path) && !settled(path))
    .map(path => ({ paths: [path], priority: true }));

  const prioritySet = new Set(priorityPaths);
  const backgroundRemaining = allPaths.filter(path => !settled(path) && !prioritySet.has(path));
  const backgroundUnits: DiffFetchUnit[] = chunk(backgroundRemaining, batchSize)
    .map(paths => ({ paths, priority: false }));

  return [...priorityUnits, ...backgroundUnits];
}

// Priority-aware background diff hydration (area pull-request-file-and-diff-
// loading): batches the PR's files in the background (lowest priority), but
// an explicit `requestDiff(path)` call (a user opening a file) jumps straight
// to its own fetch ahead of anything still queued. Cached per (headSha, path)
// client-side — a diff already in `diffs` or already in flight is never
// re-fetched, satisfying "two sequential opens at the same headSha cost
// nothing" without needing react-query's own cache for this custom queue.
export function usePullRequestFileDiffs(
  change: DashboardChange,
  pullRequest: AvailablePullRequest,
  files: PullRequestFileManifestEntry[],
  enabled = true,
  batchSize = DEFAULT_DIFF_BATCH_SIZE,
) {
  const [diffs, setDiffs] = useState<Map<string, PullRequestFile>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const cacheKeyRef = useRef<string>('');
  const cancelledRef = useRef(false);

  const cacheKey = `${pullRequest.reference.provider}:${pullRequest.reference.baseUrl}:${pullRequest.reference.repository}:${pullRequest.number}:${pullRequest.headSha ?? ''}`;

  useEffect(() => {
    if (cacheKeyRef.current === cacheKey) return;
    cacheKeyRef.current = cacheKey;
    inFlightRef.current = new Set();
    setDiffs(new Map());
  }, [cacheKey]);

  const runBatch = useCallback(async (paths: string[]) => {
    const pending = paths.filter(path => !inFlightRef.current.has(path));
    if (!pending.length) return;
    pending.forEach(path => inFlightRef.current.add(path));
    try {
      const result = await fetchFileDiffsBatch(change, pullRequest.number, pending, pullRequest.headSha);
      if (cacheKeyRef.current !== cacheKey) return; // PR moved on to a new headSha while this was in flight
      setDiffs(prev => {
        const next = new Map(prev);
        for (const file of result) next.set(file.path, file);
        return next;
      });
    } finally {
      pending.forEach(path => inFlightRef.current.delete(path));
    }
  }, [cacheKey, change, pullRequest.headSha, pullRequest.number]);

  // Explicit user open — the plan always places a not-yet-settled priority
  // path in its own unit, first, so this fetch is issued immediately rather
  // than joining the background queue's own sequential await chain below.
  const requestDiff = useCallback((path: string) => {
    const [unit] = buildDiffFetchPlan({
      allPaths: [path],
      resolvedPaths: diffs,
      inFlightPaths: inFlightRef.current,
      priorityPaths: [path],
      batchSize: 1,
    });
    if (unit) void runBatch(unit.paths);
  }, [diffs, runBatch]);

  // Background hydration, in batches, lowest priority — runs after mount and
  // whenever the file list/PR version changes; a path already resolved or
  // already in flight (including via a just-issued requestDiff) is skipped.
  useEffect(() => {
    if (!enabled || !files.length) return undefined;
    cancelledRef.current = false;
    const plan = buildDiffFetchPlan({
      allPaths: files.map(file => file.path),
      resolvedPaths: diffs,
      inFlightPaths: inFlightRef.current,
      batchSize,
    });
    void (async () => {
      for (const unit of plan) {
        if (cancelledRef.current) return;
        await runBatch(unit.paths);
      }
    })();
    return () => { cancelledRef.current = true; };
    // Deliberately excludes `diffs` — re-running this effect on every diff
    // arrival would re-walk already-hydrated batches; `runBatch` itself
    // already skips paths that are cached or in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, files, cacheKey, batchSize, runBatch]);

  return { diffs, requestDiff };
}

async function fetchFullDiff(change: DashboardChange, number: number) {
  const response = await fetch(
    `/api/specs/${change.source}/${encodeURIComponent(change.slug)}/pull-requests/${number}/diff`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Pull request diff API: ${response.status}`);
  return await response.json() as PullRequestFullDiffPayload;
}

// On-demand only (area pull-request-file-and-diff-loading: "never fetched as
// a side effect of listing PRs or opening the files manifest") — `load()` is
// the only thing that triggers the request.
export function useFullDiff(change: DashboardChange, number: number) {
  const query = useQuery({
    queryKey: [...PULL_REQUEST_FULL_DIFF_QUERY_KEY, change.source, change.slug, number],
    queryFn: () => fetchFullDiff(change, number),
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

async function fetchSpecificationActions(change: DashboardChange) {
  const response = await fetch(`/api/specs/active/${encodeURIComponent(change.slug)}/actions`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Specification actions API: ${response.status}`);
  return await response.json() as SpecificationActionsPayload;
}

async function executeSpecificationAction(change: DashboardChange, request: {
  action: SpecificationOwnerAction;
  taskId?: string;
  confirmed?: boolean;
}) {
  const response = await fetch(`/api/specs/active/${encodeURIComponent(change.slug)}/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nevo-dashboard-action': '1',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as SpecificationActionResult | { error?: string };
  if (!response.ok) throw new Error('error' in payload && payload.error ? payload.error : `Specification action API: ${response.status}`);
  return payload as SpecificationActionResult;
}

export function useSpecificationActions(change: DashboardChange, enabled = true) {
  const queryClient = useQueryClient();
  const active = enabled && change.source === 'active';
  const query = useQuery({
    queryKey: [...ACTIONS_QUERY_KEY, change.slug],
    queryFn: () => fetchSpecificationActions(change),
    enabled: active,
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: (request: { action: SpecificationOwnerAction; taskId?: string; confirmed?: boolean }) => (
      executeSpecificationAction(change, request)
    ),
    onSuccess: async () => {
      // A mutation (verify/approve/finalize) is an explicit, known event —
      // not the specs-changed SSE's unattributed fallback — but it can touch
      // any task's status/manifest, so invalidate both broadly here too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: MANIFEST_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: TASK_STATUSES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PULL_REQUEST_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY }),
      ]);
    },
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && active,
    refreshing: query.isFetching && !query.isPending,
    executing: mutation.isPending,
    executionError: mutation.error instanceof Error ? mutation.error.message : null,
    refresh: query.refetch,
    execute: mutation.mutateAsync,
    resetExecution: mutation.reset,
  };
}

async function fetchAiProviders() {
  const response = await fetch('/api/ai/providers', { cache: 'no-store' });
  if (!response.ok) throw new Error(`AI providers API: ${response.status}`);
  return await response.json() as AiProvidersPayload;
}

export function useAiProviders(enabled = true) {
  const query = useQuery({
    queryKey: AI_PROVIDERS_QUERY_KEY,
    queryFn: fetchAiProviders,
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && enabled,
    refresh: query.refetch,
  };
}

async function fetchAiSessions({ specId, taskId }: { specId?: string; taskId?: string }) {
  const query = new URLSearchParams();
  if (specId) query.set('specId', specId);
  if (taskId) query.set('taskId', taskId);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await fetch(`/api/ai/sessions${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`AI sessions API: ${response.status}`);
  return await response.json() as AiSessionsPayload;
}

export function useAiSessions({
  specId,
  taskId,
  enabled = true,
}: {
  specId?: string;
  taskId?: string;
  enabled?: boolean;
} = {}) {
  const query = useQuery({
    queryKey: [...AI_SESSIONS_QUERY_KEY, specId ?? 'all', taskId ?? 'all'],
    queryFn: () => fetchAiSessions({ specId, taskId }),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  return {
    data: query.data ?? null,
    sessions: query.data?.sessions ?? [],
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending && enabled,
    refreshing: query.isFetching && !query.isPending,
    refresh: query.refetch,
  };
}

async function aiPayload<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
    throw new Error(message || `${fallback}: ${response.status}`);
  }
  return payload as T;
}

async function fetchAiSession(provider: string, sessionId: string) {
  const response = await fetch(`/api/ai/sessions/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
  return (await aiPayload<{ session: AiSession }>(response, 'AI session API')).session;
}

export function useAiSession(provider: string, sessionId: string, enabled = true) {
  const query = useQuery({
    queryKey: [...AI_SESSION_QUERY_KEY, provider, sessionId],
    queryFn: () => fetchAiSession(provider, sessionId),
    enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? 10_000 : false,
    retry: 1,
  });
  return { data: query.data ?? null, loading: query.isPending && enabled, error: query.error instanceof Error ? query.error.message : null, refresh: query.refetch };
}

async function fetchAiMessages(provider: string, sessionId: string) {
  const response = await fetch(`/api/ai/sessions/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}/messages`, { cache: 'no-store' });
  return (await aiPayload<{ messages: AiMessage[] }>(response, 'AI messages API')).messages;
}

export function useAiMessages(provider: string, sessionId: string, enabled = true) {
  const query = useQuery({
    queryKey: [...AI_MESSAGES_QUERY_KEY, provider, sessionId],
    queryFn: () => fetchAiMessages(provider, sessionId),
    enabled,
    staleTime: 5_000,
    retry: 1,
  });
  return { messages: query.data ?? [], loading: query.isPending && enabled, error: query.error instanceof Error ? query.error.message : null, refresh: query.refetch };
}

export function useCreateAiSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { provider: string; specId: string; taskIds: string[]; title?: string }) => {
      const response = await fetch('/api/ai/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        body: JSON.stringify(input),
      });
      return (await aiPayload<{ session: AiSession }>(response, 'Create AI session API')).session;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY }),
  });
  return { create: mutation.mutateAsync, creating: mutation.isPending, error: mutation.error instanceof Error ? mutation.error.message : null, reset: mutation.reset };
}

export function useStartAiTurn(provider: string, sessionId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { message: string; idempotencyKey?: string }) => {
      const response = await fetch(`/api/ai/sessions/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        body: JSON.stringify(input),
      });
      return await aiPayload<{ turnId: string; idempotent: boolean }>(response, 'Start AI turn API');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_SESSION_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
    },
  });
  return { start: mutation.mutateAsync, starting: mutation.isPending, error: mutation.error instanceof Error ? mutation.error.message : null, reset: mutation.reset };
}

export function useAiTurn(turnId: string | null) {
  const query = useQuery({
    queryKey: [...AI_TURN_QUERY_KEY, turnId],
    queryFn: async () => {
      const response = await fetch(`/api/ai/turns/${encodeURIComponent(turnId || '')}`, { cache: 'no-store' });
      return (await aiPayload<{ turn: AiTurnSnapshot }>(response, 'AI turn API')).turn;
    },
    enabled: Boolean(turnId),
    staleTime: 0,
    retry: 1,
  });
  return { data: query.data ?? null, loading: query.isPending && Boolean(turnId), error: query.error instanceof Error ? query.error.message : null, refresh: query.refetch };
}

export function useResolveAiInteraction(turnId: string | null) {
  const mutation = useMutation({
    mutationFn: async ({ interactionId, response: interactionResponse }: { interactionId: string; response: unknown }) => {
      const response = await fetch(`/api/ai/turns/${encodeURIComponent(turnId || '')}/interactions/${encodeURIComponent(interactionId)}/response`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        body: JSON.stringify(interactionResponse),
      });
      return (await aiPayload<{ turn: AiTurnSnapshot }>(response, 'AI interaction API')).turn;
    },
  });
  return { resolve: mutation.mutateAsync, resolving: mutation.isPending, error: mutation.error instanceof Error ? mutation.error.message : null };
}

export function useCancelAiTurn(turnId: string | null) {
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/ai/turns/${encodeURIComponent(turnId || '')}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' }, body: '{}',
      });
      return (await aiPayload<{ turn: AiTurnSnapshot }>(response, 'Cancel AI turn API')).turn;
    },
  });
  return { cancel: mutation.mutateAsync, cancelling: mutation.isPending, error: mutation.error instanceof Error ? mutation.error.message : null };
}
