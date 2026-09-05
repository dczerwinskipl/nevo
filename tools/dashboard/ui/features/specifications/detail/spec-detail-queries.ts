import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  SpecificationSummary,
  SpecificationActionResult,
  SpecificationActionsPayload,
  SpecificationDocument,
  SpecificationManifest,
  SpecificationOwnerAction,
} from '../types';
import { ACTIONS_QUERY_KEY, DOCUMENT_QUERY_KEY, invalidateSpecificationQueries, MANIFEST_QUERY_KEY } from '../queries';

async function fetchSpecificationManifest(specification: SpecificationSummary) {
  const response = await fetch(`/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/content`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Specification manifest API: ${response.status}`);
  return (await response.json()) as SpecificationManifest;
}

// Manifest is metadata-only (no markdown bodies) — event-driven invalidation
// only, no refetchInterval (area dashboard-data-loading-contracts).
export function useSpecificationManifest(specification: SpecificationSummary, enabled = true) {
  const query = useQuery({
    queryKey: [...MANIFEST_QUERY_KEY, specification.source, specification.slug],
    queryFn: () => fetchSpecificationManifest(specification),
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

async function fetchSpecificationDocument(specification: SpecificationSummary, docId: string) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/content/${encodeURIComponent(docId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Specification document API: ${response.status}`);
  return (await response.json()) as SpecificationDocument;
}

// One document's body, fetched only once it's actually opened, cached with
// effectively-infinite staleness and invalidated only by the specs-changed
// SSE event naming its own file (area dashboard-data-loading-contracts).
export function useSpecificationDocument(specification: SpecificationSummary, docId: string | null, enabled = true) {
  const active = enabled && Boolean(docId);
  const query = useQuery({
    queryKey: [...DOCUMENT_QUERY_KEY, specification.source, specification.slug, docId ?? ''],
    queryFn: () => fetchSpecificationDocument(specification, docId as string),
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

async function fetchSpecificationActions(specification: SpecificationSummary) {
  const response = await fetch(`/api/specs/active/${encodeURIComponent(specification.slug)}/actions`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Specification actions API: ${response.status}`);
  return (await response.json()) as SpecificationActionsPayload;
}

async function executeSpecificationAction(
  specification: SpecificationSummary,
  request: {
    action: SpecificationOwnerAction;
    taskId?: string;
    confirmed?: boolean;
  },
) {
  const response = await fetch(`/api/specs/active/${encodeURIComponent(specification.slug)}/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nevo-dashboard-action': '1',
    },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as SpecificationActionResult | { error?: string };
  if (!response.ok)
    throw new Error(
      'error' in payload && payload.error ? payload.error : `Specification action API: ${response.status}`,
    );
  return payload as SpecificationActionResult;
}

export function useSpecificationActions(
  specification: SpecificationSummary,
  enabled = true,
  onSyncSuccess?: () => Promise<unknown> | void,
) {
  const queryClient = useQueryClient();
  const active = enabled && specification.source === 'active';
  const query = useQuery({
    queryKey: [...ACTIONS_QUERY_KEY, specification.slug],
    queryFn: () => fetchSpecificationActions(specification),
    enabled: active,
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: (request: { action: SpecificationOwnerAction; taskId?: string; confirmed?: boolean }) =>
      executeSpecificationAction(specification, request),
    onSuccess: async (result) => {
      // If the action returned an async operationId, invalidation is deferred
      // until the operation reaches terminal status (operation.completed / operation.failed).
      // If no operationId was returned (direct synchronous legacy), invalidate immediately.
      if (!result?.operationId) {
        await Promise.all([invalidateSpecificationQueries(queryClient), onSyncSuccess?.()]);
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
