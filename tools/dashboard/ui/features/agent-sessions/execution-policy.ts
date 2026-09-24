import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentExecutionMode } from './types';

export interface TaskExecutionOverride {
  provider?: string;
  mode?: AgentExecutionMode;
}

export interface ExecutionPolicy {
  provider: string;
  mode: AgentExecutionMode;
  taskOverrides?: Record<string, TaskExecutionOverride>;
}

export interface ExecutionPolicyPayload {
  policy: ExecutionPolicy | null;
}

export const EXECUTION_POLICY_QUERY_KEY = ['execution-policy'] as const;

export async function fetchExecutionPolicy(slug: string): Promise<ExecutionPolicy | null> {
  const response = await fetch(`/api/specs/${encodeURIComponent(slug)}/execution-policy`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch execution policy: ${response.status}`);
  }
  const data = (await response.json()) as ExecutionPolicyPayload;
  return data.policy;
}

export async function saveExecutionPolicy(
  slug: string,
  policy: { provider: string; mode: AgentExecutionMode; taskOverrides?: Record<string, TaskExecutionOverride> },
): Promise<ExecutionPolicy> {
  const response = await fetch(`/api/specs/${encodeURIComponent(slug)}/execution-policy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Nevo-Dashboard-Action': '1',
    },
    body: JSON.stringify(policy),
  });
  if (!response.ok) {
    throw new Error(`Failed to save execution policy: ${response.status}`);
  }
  const data = (await response.json()) as ExecutionPolicyPayload;
  return data.policy!;
}

export function resolvePolicyForTask(
  policy: ExecutionPolicy | null,
  taskId?: string,
): { provider: string; mode: AgentExecutionMode } | null {
  if (!policy) return null;
  if (taskId && policy.taskOverrides?.[taskId]) {
    const override = policy.taskOverrides[taskId];
    return {
      provider: override.provider || policy.provider,
      mode: override.mode || policy.mode,
    };
  }
  return {
    provider: policy.provider,
    mode: policy.mode,
  };
}

export function computeInitialProviderAndMode(providers: {
  id: string;
  enabled?: boolean;
  available?: boolean;
  supportedModes?: AgentExecutionMode[];
  defaultMode?: AgentExecutionMode;
}[]): {
  provider: string;
  mode: AgentExecutionMode;
} {
  const enabled = providers.filter((p) => p.enabled !== false);
  const available = enabled.filter((p) => p.available !== false);
  const target = available[0] || enabled[0];
  if (!target) {
    return { provider: '', mode: 'agent' };
  }
  const supported = target.supportedModes || ['ask', 'edit', 'agent'];
  const mode: AgentExecutionMode = supported.includes('agent') ? 'agent' : (target.defaultMode || 'edit');
  return { provider: target.id, mode };
}

export function useExecutionPolicy(slug?: string, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...EXECUTION_POLICY_QUERY_KEY, slug ?? ''],
    queryFn: () => (slug ? fetchExecutionPolicy(slug) : Promise.resolve(null)),
    enabled: Boolean(slug && enabled),
    staleTime: 30_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (policy: ExecutionPolicy) => {
      if (!slug) throw new Error('No specification slug provided.');
      return saveExecutionPolicy(slug, policy);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData([...EXECUTION_POLICY_QUERY_KEY, slug ?? ''], saved);
    },
  });

  return {
    policy: query.data ?? null,
    loading: query.isPending,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
    savePolicy: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}
