import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  DashboardChange,
  SpecificationActionResult,
  SpecificationActionsPayload,
  SpecificationDocument,
  SpecificationManifest,
  SpecificationOwnerAction,
} from '@/lib/types';
import {
  ACTIONS_QUERY_KEY,
  DOCUMENT_QUERY_KEY,
  invalidateDashboardQueries,
  MANIFEST_QUERY_KEY,
} from '@/hooks/use-dashboard-data';

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
    onSuccess: async (result) => {
      // If the action returned an async operationId, invalidation is deferred
      // until the operation reaches terminal status (operation.completed / operation.failed).
      // If no operationId was returned (direct synchronous legacy), invalidate immediately.
      if (!result?.operationId) {
        await invalidateDashboardQueries(queryClient);
      }
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
