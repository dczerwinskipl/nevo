import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { SpecificationSummary, SpecificationTask, SpecificationOwnerAction } from '../types';
import { invalidateSpecificationQueries } from '../queries';
import { invalidatePullRequestQueries } from '@/features/pull-requests/queries';
import { waitForOperationTerminal } from '@/features/operations/wait-for-operation-terminal';
import type { useSpecificationActions } from '../detail/spec-detail-queries';
import { describeBatchStopReason, runBatchTaskAction, runDirectTaskAction, runFinalizeAction } from './spec-workflow-actions';

type ActionsQuery = ReturnType<typeof useSpecificationActions>;

function activeOperationStorageKey(slug: string) {
  return `nevo:active-op:${slug}`;
}

function activeOperationTitleStorageKey(slug: string) {
  return `nevo:active-op-title:${slug}`;
}

function readSessionStorage(key: string): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/**
 * Owns the Specification Detail page's task-workflow orchestration: which operation
 * (if any) is currently shown in the progress modal — persisted across reloads in
 * sessionStorage, per spec — and wiring the pure action runners in
 * `spec-workflow-actions.ts` to this page's own query mutation and operation-wait
 * primitives. Extracted out of `SpecificationDetail` so that component is left to compose page
 * state and UI, not run an operation loop itself (area
 * spec-detail-and-workflow-feature-slice, task 05).
 */
export function useSpecWorkflowActions(specification: SpecificationSummary, actionsQuery: ActionsQuery) {
  const queryClient = useQueryClient();

  const [activeOperationId, setActiveOperationId] = useState<string | null>(() => (
    readSessionStorage(activeOperationStorageKey(specification.slug))
  ));
  const [operationTitle, setOperationTitle] = useState<string>(() => (
    readSessionStorage(activeOperationTitleStorageKey(specification.slug)) || 'Przebieg operacji'
  ));
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const updateActiveOperation = useCallback((opId: string | null, title?: string) => {
    setActiveOperationId(opId);
    if (title) setOperationTitle(title);
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (opId) {
          sessionStorage.setItem(activeOperationStorageKey(specification.slug), opId);
          if (title) sessionStorage.setItem(activeOperationTitleStorageKey(specification.slug), title);
        } else {
          sessionStorage.removeItem(activeOperationStorageKey(specification.slug));
          sessionStorage.removeItem(activeOperationTitleStorageKey(specification.slug));
        }
      }
    } catch {}
  }, [specification.slug]);

  // Restore this specification's own persisted operation (if any) whenever the page switches
  // to a different spec — never carry a previous spec's active operation across.
  useEffect(() => {
    setFinalizeOpen(false);
    setActiveOperationId(readSessionStorage(activeOperationStorageKey(specification.slug)));
    setOperationTitle(readSessionStorage(activeOperationTitleStorageKey(specification.slug)) || 'Przebieg operacji');
  }, [specification.slug]);

  const handleOperationTerminal = useCallback(async () => {
    await Promise.all([
      invalidateSpecificationQueries(queryClient),
      invalidatePullRequestQueries(queryClient),
    ]);
  }, [queryClient]);

  const executeDirectTaskAction = useCallback((task: SpecificationTask, actionName: SpecificationOwnerAction) => (
    runDirectTaskAction(
      { execute: actionsQuery.execute, onOperationStarted: updateActiveOperation },
      task,
      actionName,
    )
  ), [actionsQuery, updateActiveOperation]);

  const executeBatchTaskAction = useCallback((tasks: SpecificationTask[], actionName: SpecificationOwnerAction) => (
    runBatchTaskAction(
      {
        execute: actionsQuery.execute,
        onOperationStarted: updateActiveOperation,
        waitForTerminal: waitForOperationTerminal,
        // Surfaced through the same OperationModal already showing this task's own
        // operation — reusing the existing progress UI (kept open, on that exact
        // operation) rather than adding a new one.
        onBatchStopped: ({ operationId, title, outcome }) => {
          updateActiveOperation(operationId, `${title} — ${describeBatchStopReason(outcome)}`);
        },
      },
      tasks,
      actionName,
    )
  ), [actionsQuery, updateActiveOperation]);

  const executeFinalize = useCallback(() => (
    runFinalizeAction(
      { execute: actionsQuery.execute, onOperationStarted: updateActiveOperation },
      () => setFinalizeOpen(false),
    )
  ), [actionsQuery, updateActiveOperation]);

  const openFinalize = useCallback(() => {
    actionsQuery.resetExecution();
    setFinalizeOpen(true);
  }, [actionsQuery]);

  const closeFinalize = useCallback(() => {
    if (!actionsQuery.executing) setFinalizeOpen(false);
  }, [actionsQuery.executing]);

  return {
    activeOperationId,
    operationTitle,
    updateActiveOperation,
    handleOperationTerminal,
    finalizeOpen,
    openFinalize,
    closeFinalize,
    executeDirectTaskAction,
    executeBatchTaskAction,
    executeFinalize,
  };
}
