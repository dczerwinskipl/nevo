import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  AgentExecutionMode,
  DashboardChange,
  DashboardPayload,
  AiProvidersPayload,
  AiMessage,
  AiSession,
  AiSessionsPayload,
  AiTurnSnapshot,
  SpecificationManifest,
  TaskStatusesPayload,
} from '@/lib/types';

const DASHBOARD_QUERY_KEY = ['nevo-dashboard'] as const;
// Exported: owned here only because the cross-domain SSE invalidation
// (handleSpecsChanged/invalidateDashboardQueries) below needs them — the
// queries and mutations that build on these keys live feature-locally in
// spec-detail/spec-detail-queries.ts (area dashboard-frontend-features).
export const MANIFEST_QUERY_KEY = ['nevo-spec-manifest'] as const;
export const DOCUMENT_QUERY_KEY = ['nevo-spec-document'] as const;
export const ACTIONS_QUERY_KEY = ['nevo-spec-actions'] as const;
const TASK_STATUSES_QUERY_KEY = ['nevo-spec-task-statuses'] as const;
// Exported for the same reason as MANIFEST/DOCUMENT/ACTIONS above — owned by
// invalidateDashboardQueries here, consumed by changes-panel/changes-queries.ts.
export const PULL_REQUEST_QUERY_KEY = ['nevo-spec-pull-requests'] as const;
const AI_PROVIDERS_QUERY_KEY = ['nevo-ai-providers'] as const;
const AI_SESSIONS_QUERY_KEY = ['nevo-ai-sessions'] as const;
const AI_SESSION_QUERY_KEY = ['nevo-ai-session'] as const;
const AI_MESSAGES_QUERY_KEY = ['nevo-ai-messages'] as const;
const AI_TURN_QUERY_KEY = ['nevo-ai-turn'] as const;

// `/api/dashboard`'s own safety-refresh backstop (minutes, not seconds) —
// specs-changed SSE invalidation is the real trigger; this only guards
// against a missed/late SSE event (area dashboard-data-loading-contracts).
const DASHBOARD_SAFETY_REFRESH_MS = 5 * 60_000;
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
      const manifest = queryClient.getQueryData<SpecificationManifest>([MANIFEST_QUERY_KEY[0], key[1], key[2]]);
      if (!manifest) return true; // nothing cached to compare against — invalidate to be safe
      const allDocs = [
        manifest.overview,
        ...manifest.areas,
        ...manifest.tasks,
        ...(manifest.sections || []).flatMap(s => s.type === 'document' ? (s.document ? [s.document] : []) : s.documents),
      ];
      const matchingDoc = allDocs.find(d => d?.docId === key[3]);
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

export async function invalidateDashboardQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: MANIFEST_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: TASK_STATUSES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: PULL_REQUEST_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY }),
  ]);
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
    mutationFn: async (input: {
      provider: string;
      specId: string;
      taskIds?: string[];
      taskId?: string;
      title?: string;
      purpose?: string;
      mode?: AgentExecutionMode;
    }) => {
      const response = await fetch('/api/agent-sessions', {
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

export function useDeleteAiSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ provider, sessionId }: { provider: string; sessionId: string }) => {
      const response = await fetch(`/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'x-nevo-dashboard-action': '1' },
      });
      return await aiPayload<{ unbind: boolean; deleted?: boolean }>(response, 'Delete AI session API');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: AI_SESSION_QUERY_KEY });
    },
  });
  return { deleteSession: mutation.mutateAsync, deleting: mutation.isPending, error: mutation.error instanceof Error ? mutation.error.message : null };
}

export function useStartAiTurn(provider: string, sessionId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { message: string; mode?: AgentExecutionMode; idempotencyKey?: string }) => {
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
  change: DashboardChange;
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
        try { errPayload = await response.json(); } catch {}
        throw new Error(errPayload.error || `Specification creation failed (${response.status})`);
      }
      return (await response.json()) as CreateSpecificationResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
    },
  });

  return {
    createSpecification: mutation.mutateAsync,
    creating: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    reset: mutation.reset,
  };
}

