import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentExecutionMode } from './types';

export interface TaskExecutionOverride {
  provider?: string;
  model?: string;
  mode?: AgentExecutionMode;
}

export interface RoleExecutionOverride {
  provider: string;
  model?: string;
  mode?: AgentExecutionMode;
}

export interface ExecutionPolicy {
  provider: string;
  model?: string;
  mode: AgentExecutionMode;
  default?: {
    provider: string;
    model?: string;
    mode: AgentExecutionMode;
  };
  roles?: Record<string, RoleExecutionOverride>;
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
  policy: {
    provider: string;
    model?: string;
    mode: AgentExecutionMode;
    default?: { provider: string; model?: string; mode: AgentExecutionMode };
    roles?: Record<string, RoleExecutionOverride>;
    taskOverrides?: Record<string, TaskExecutionOverride>;
  },
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
  options?: { role?: string },
): { provider: string; model?: string; mode: AgentExecutionMode } | null {
  if (!policy) return null;
  const defaultProvider = policy.default?.provider || policy.provider;
  const defaultMode = policy.default?.mode || policy.mode;
  const defaultModel = (policy.default?.model || policy.model || '').trim() || undefined;

  let roleProvider = defaultProvider;
  let roleMode = defaultMode;
  let roleModel = defaultModel;

  if (options?.role && policy.roles?.[options.role]) {
    const roleOverride = policy.roles[options.role];
    const newRoleProvider = roleOverride.provider || defaultProvider;
    roleMode = roleOverride.mode || defaultMode;
    if (roleOverride.model) {
      roleModel = roleOverride.model.trim();
    } else if (newRoleProvider !== defaultProvider) {
      roleModel = undefined;
    } else {
      roleModel = defaultModel;
    }
    roleProvider = newRoleProvider;
  }

  if (taskId && policy.taskOverrides?.[taskId]) {
    const override = policy.taskOverrides[taskId];
    const effectiveProvider = override.provider || roleProvider;
    const effectiveMode = override.mode || roleMode;
    let effectiveModel: string | undefined;
    if (override.model) {
      effectiveModel = override.model.trim();
    } else if (override.provider && override.provider !== roleProvider) {
      effectiveModel = undefined;
    } else {
      effectiveModel = roleModel;
    }
    return {
      provider: effectiveProvider,
      ...(effectiveModel ? { model: effectiveModel } : {}),
      mode: effectiveMode,
    };
  }

  return {
    provider: roleProvider,
    ...(roleModel ? { model: roleModel } : {}),
    mode: roleMode,
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
