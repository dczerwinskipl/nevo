// Feature-local mutation adapter for agent-sessions human workflow step actions (Task 20, D14, D17, D19).
// Calls the shared postHumanStepAction transport function.
// Sibling feature isolation: imports nothing from features/specifications.

import { useCallback, useState } from 'react';
import { postHumanStepAction, type HumanStepActionResult } from '@/shared/lib/human-step-request';

export interface UseAgentSessionHumanStepMutationOptions {
  source?: string;
  slug?: string | null;
  taskId?: string | null;
  onSuccess?: (result: HumanStepActionResult) => void | Promise<unknown>;
}

export function useAgentSessionHumanStepMutation({
  source,
  slug,
  taskId,
  onSuccess,
}: UseAgentSessionHumanStepMutationOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (result?: string, feedback?: string, artifacts?: unknown) => {
      if (!slug || !taskId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await postHumanStepAction({
          source,
          slug,
          taskId,
          action: 'submit',
          result,
          feedback,
          artifacts,
        });
        await onSuccess?.(response);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [source, slug, taskId, onSuccess],
  );

  const start = useCallback(async () => {
    if (!slug || !taskId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await postHumanStepAction({
        source,
        slug,
        taskId,
        action: 'start',
      });
      await onSuccess?.(response);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [source, slug, taskId, onSuccess]);

  return {
    submit,
    start,
    loading,
    error,
    clearError: () => setError(null),
  };
}
