import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { SpecificationSummary, SpecificationIndex, SpecificationManifest, TaskStatusesPayload } from './types';

export const SPECIFICATION_INDEX_QUERY_KEY = ['nevo-specification-index'] as const;
// Exported: owned here only because the cross-domain SSE invalidation
// (handleSpecsChanged/invalidateSpecificationQueries) below needs them — the
// queries and mutations that build on these keys live feature-locally in
// detail/spec-detail-queries.ts.
export const MANIFEST_QUERY_KEY = ['nevo-spec-manifest'] as const;
export const DOCUMENT_QUERY_KEY = ['nevo-spec-document'] as const;
export const ACTIONS_QUERY_KEY = ['nevo-spec-actions'] as const;
export const TASK_STATUSES_QUERY_KEY = ['nevo-spec-task-statuses'] as const;

// `/api/dashboard`'s own safety-refresh backstop (minutes, not seconds) —
// specs-changed SSE invalidation is the real trigger; this only guards
// against a missed/late SSE event (area dashboard-data-loading-contracts).
const SPECIFICATION_INDEX_SAFETY_REFRESH_MS = 5 * 60_000;
const TASK_STATUS_POLL_MS = 4_000;

type SpecsChangedEvent = { type: 'specs-changed'; at: string; eventType?: string; files?: string[] };

async function fetchSpecificationIndex() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Specification index API: ${response.status}`);
  return (await response.json()) as SpecificationIndex;
}

export function handleSpecsChanged(queryClient: ReturnType<typeof useQueryClient>, event: SpecsChangedEvent) {
  void queryClient.invalidateQueries({ queryKey: SPECIFICATION_INDEX_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY });

  const files = event.files;
  if (!files || !files.length) {
    // Coarse fallback — this change can't be attributed to specific files.
    void queryClient.invalidateQueries({ queryKey: MANIFEST_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY });
    return;
  }

  const changedSlugs = new Set(files.map((path) => path.split('/')[2]).filter(Boolean));
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey as QueryKey;
      if (key[0] !== MANIFEST_QUERY_KEY[0]) return false;
      return changedSlugs.has(String(key[2]));
    },
  });
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey as QueryKey;
      if (key[0] !== DOCUMENT_QUERY_KEY[0]) return false;
      const manifest = queryClient.getQueryData<SpecificationManifest>([MANIFEST_QUERY_KEY[0], key[1], key[2]]);
      if (!manifest) return true; // nothing cached to compare against — invalidate to be safe
      const allDocs = [
        manifest.overview,
        ...manifest.areas,
        ...manifest.tasks,
        ...(manifest.sections || []).flatMap((s) =>
          s.type === 'document' ? (s.document ? [s.document] : []) : s.documents,
        ),
      ];
      const matchingDoc = allDocs.find((d) => d?.docId === key[3]);
      return Boolean(matchingDoc?.path && files.includes(matchingDoc.path));
    },
  });
}

export type LiveConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'unknown';

export function useSpecificationIndex() {
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('unknown');
  const query = useQuery({
    queryKey: SPECIFICATION_INDEX_QUERY_KEY,
    queryFn: fetchSpecificationIndex,
    staleTime: 30_000,
    refetchInterval: SPECIFICATION_INDEX_SAFETY_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onopen = () => setConnectionStatus('connected');
    events.addEventListener('connected', () => setConnectionStatus('connected'));
    events.addEventListener('specs-changed', (rawEvent) => {
      const detail = JSON.parse((rawEvent as MessageEvent).data) as SpecsChangedEvent;
      handleSpecsChanged(queryClient, detail);
    });
    events.onerror = () => {
      if (events.readyState === 2) {
        setConnectionStatus('disconnected');
      } else {
        setConnectionStatus('reconnecting');
      }
    };
    return () => events.close();
  }, [queryClient]);

  const live = connectionStatus === 'connected';

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error.message : null,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    live,
    connectionStatus,
    refresh: query.refetch,
  };
}

async function fetchTaskStatuses(specification: SpecificationSummary) {
  const response = await fetch(
    `/api/specs/${specification.source}/${encodeURIComponent(specification.slug)}/task-statuses`,
    {
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(`Task statuses API: ${response.status}`);
  return (await response.json()) as TaskStatusesPayload;
}

// Small enough to poll every few seconds regardless of specs-changed —
// deliberately not event-driven (area dashboard-data-loading-contracts: "not
// worth the added complexity of event-driven invalidation for a payload this
// small").
export function useTaskStatuses(specification: SpecificationSummary, enabled = true) {
  const query = useQuery({
    queryKey: [...TASK_STATUSES_QUERY_KEY, specification.source, specification.slug],
    queryFn: () => fetchTaskStatuses(specification),
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

export async function invalidateSpecificationQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SPECIFICATION_INDEX_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: MANIFEST_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: TASK_STATUSES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY }),
  ]);
}

export type CreateSpecificationInput = {
  slug: string;
  title: string;
  type?: 'standard' | 'architectural' | 'small' | 'exploratory';
  goal?: string;
};

export type CreateSpecificationResult = {
  ok: boolean;
  slug: string;
  specId: string;
  change: SpecificationSummary;
};

export function useCreateSpecification() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateSpecificationInput) => {
      const response = await fetch('/api/specs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        let errPayload: { error?: string; code?: string } = {};
        try {
          errPayload = await response.json();
        } catch {}
        throw new Error(errPayload.error || `Specification creation failed (${response.status})`);
      }
      return (await response.json()) as CreateSpecificationResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SPECIFICATION_INDEX_QUERY_KEY });
    },
  });

  return {
    createSpecification: mutation.mutateAsync,
    creating: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    reset: mutation.reset,
  };
}
