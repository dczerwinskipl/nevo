// Feature-local mutation adapter for publishing deterministic workflow tasks.
// Calls the shared postPublishTask and postBatchPublish transport functions.

import { useCallback, useState } from 'react';
import {
  postPublishTask,
  postBatchPublish,
  type PublishTaskResult,
  type BatchPublishResult,
} from '@/shared/lib/publish-task-request';

export interface UseSpecificationPublishMutationOptions {
  source?: string;
  slug: string;
  taskId?: string;
  onSuccess?: (result: PublishTaskResult | BatchPublishResult) => void | Promise<void>;
}

export function useSpecificationPublishMutation({
  source,
  slug,
  taskId: defaultTaskId,
  onSuccess,
}: UseSpecificationPublishMutationOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    async (targetTaskId?: string) => {
      const effectiveTaskId = targetTaskId || defaultTaskId;
      if (!effectiveTaskId) {
        throw new Error('Task ID is required for publish');
      }
      setLoading(true);
      setError(null);
      try {
        const response = await postPublishTask({
          source,
          slug,
          taskId: effectiveTaskId,
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
    [source, slug, defaultTaskId, onSuccess],
  );

  const publishBatch = useCallback(
    async (taskIds?: string[], status?: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await postBatchPublish({
          source,
          slug,
          taskIds,
          status,
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
    [source, slug, onSuccess],
  );

  return {
    publish,
    publishBatch,
    loading,
    error,
    clearError: () => setError(null),
  };
}
