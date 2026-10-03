// Feature-local mutation adapter for specifications human workflow step actions (Task 20, D14, D17).
// Calls the shared postHumanStepAction transport function.
// Sibling feature isolation: imports nothing from features/agent-sessions.

import { useCallback, useState } from 'react';
import { postHumanStepAction, type HumanStepActionResult } from '@/shared/lib/human-step-request';

export interface UseSpecificationHumanStepMutationOptions {
  source?: string;
  slug: string;
  taskId: string;
  onSuccess?: (result: HumanStepActionResult) => void | Promise<void>;
}

export function useSpecificationHumanStepMutation({
  source,
  slug,
  taskId,
  onSuccess,
}: UseSpecificationHumanStepMutationOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (result?: string, feedback?: string, artifacts?: unknown) => {
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

  return {
    submit,
    loading,
    error,
    clearError: () => setError(null),
  };
}
