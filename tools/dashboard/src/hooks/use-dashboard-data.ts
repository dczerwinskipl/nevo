import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { DashboardPayload } from '@/lib/types';

const DASHBOARD_QUERY_KEY = ['nevo-dashboard'] as const;

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
