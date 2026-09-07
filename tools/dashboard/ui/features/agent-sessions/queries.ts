import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AgentExecutionMode, AgentSession, AgentSessionsPayload, AgentProvidersPayload } from './types';

const AGENT_PROVIDERS_QUERY_KEY = ['nevo-ai-providers'] as const;
const AGENT_SESSIONS_QUERY_KEY = ['nevo-ai-sessions'] as const;
const AGENT_SESSION_QUERY_KEY = ['nevo-ai-session'] as const;

async function fetchAgentProviders() {
  const response = await fetch('/api/agent-providers', { cache: 'no-store' });
  if (!response.ok) throw new Error(`AI providers API: ${response.status}`);
  return (await response.json()) as AgentProvidersPayload;
}

export function useAgentProviders(enabled = true) {
  const query = useQuery({
    queryKey: AGENT_PROVIDERS_QUERY_KEY,
    queryFn: fetchAgentProviders,
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

async function fetchAgentSessions({ specId, taskId }: { specId?: string; taskId?: string }) {
  const query = new URLSearchParams();
  if (specId) query.set('specId', specId);
  if (taskId) query.set('taskId', taskId);
  const suffix = query.size ? `?${query.toString()}` : '';
  const response = await fetch(`/api/agent-sessions${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`AI sessions API: ${response.status}`);
  return (await response.json()) as AgentSessionsPayload;
}

export function useAgentSessions({
  specId,
  taskId,
  enabled = true,
}: {
  specId?: string;
  taskId?: string;
  enabled?: boolean;
} = {}) {
  const query = useQuery({
    queryKey: [...AGENT_SESSIONS_QUERY_KEY, specId ?? 'all', taskId ?? 'all'],
    queryFn: () => fetchAgentSessions({ specId, taskId }),
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
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
    throw new Error(message || `${fallback}: ${response.status}`);
  }
  return payload as T;
}

export function useCreateAgentSession() {
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
      return (await aiPayload<{ session: AgentSession }>(response, 'Create AI session API')).session;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENT_SESSIONS_QUERY_KEY }),
  });
  return {
    create: mutation.mutateAsync,
    creating: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    reset: mutation.reset,
  };
}

export function useDeleteAgentSession() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ provider, sessionId }: { provider: string; sessionId: string }) => {
      const response = await fetch(
        `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}`,
        {
          method: 'DELETE',
          headers: { 'x-nevo-dashboard-action': '1' },
        },
      );
      return await aiPayload<{ unbind: boolean; deleted?: boolean }>(response, 'Delete AI session API');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENT_SESSIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: AGENT_SESSION_QUERY_KEY });
    },
  });
  return {
    deleteSession: mutation.mutateAsync,
    deleting: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
