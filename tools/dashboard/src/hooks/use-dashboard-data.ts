import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type {
  DashboardChange,
  DashboardPayload,
  PullRequestsPayload,
  SpecificationActionResult,
  SpecificationActionsPayload,
  SpecificationContent,
  SpecificationOwnerAction,
} from '@/lib/types';

const DASHBOARD_QUERY_KEY = ['nevo-dashboard'] as const;
const CONTENT_QUERY_KEY = ['nevo-spec-content'] as const;
const PULL_REQUEST_QUERY_KEY = ['nevo-spec-pull-requests'] as const;
const ACTIONS_QUERY_KEY = ['nevo-spec-actions'] as const;

async function fetchDashboard() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard API: ${response.status}`);
  return await response.json() as DashboardPayload;
}

export function useDashboardData() {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const query = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: fetchDashboard,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: 2,
  });

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.addEventListener('connected', () => setLive(true));
    events.addEventListener('specs-changed', () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: PULL_REQUEST_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY });
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

async function fetchSpecificationContent(change: DashboardChange) {
  const response = await fetch(`/api/specs/${change.source}/${encodeURIComponent(change.slug)}/content`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Specification content API: ${response.status}`);
  return await response.json() as SpecificationContent;
}

export function useSpecificationContent(change: DashboardChange, enabled = true) {
  const query = useQuery({
    queryKey: [...CONTENT_QUERY_KEY, change.source, change.slug],
    queryFn: () => fetchSpecificationContent(change),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: true,
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

async function fetchPullRequests(change: DashboardChange) {
  const response = await fetch(`/api/specs/${change.source}/${encodeURIComponent(change.slug)}/pull-requests`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Pull request API: ${response.status}`);
  return await response.json() as PullRequestsPayload;
}

export function usePullRequests(change: DashboardChange, enabled = true) {
  const query = useQuery({
    queryKey: [...PULL_REQUEST_QUERY_KEY, change.source, change.slug],
    queryFn: () => fetchPullRequests(change),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: true,
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CONTENT_QUERY_KEY }),
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
