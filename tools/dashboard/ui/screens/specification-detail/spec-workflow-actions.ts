import type {
  SpecificationTask,
  SpecificationActionResult,
  SpecificationOwnerAction,
} from '@/features/specifications/types';
import type { OperationWaitOutcome } from '@/features/operations/wait-for-operation-terminal';

/**
 * Pure task-workflow orchestration — no React, no DOM, no sessionStorage. Injected
 * dependencies make each function directly testable (mock `execute`/`waitForTerminal`,
 * assert call order) independently of `SpecificationDetail` rendering or the
 * `useSpecWorkflowActions` hook that wires these to React state (area
 * spec-detail-and-workflow-feature-slice, task 05).
 */
export interface WorkflowActionDeps {
  execute: (input: {
    action: SpecificationOwnerAction;
    taskId?: string;
    confirmed?: boolean;
  }) => Promise<SpecificationActionResult | undefined>;
  onOperationStarted: (operationId: string, title: string) => void;
  /** Resolves to an explicit, discriminated outcome once waiting for the operation ends — see `OperationWaitOutcome`. */
  waitForTerminal: (operationId: string) => Promise<OperationWaitOutcome>;
  /**
   * Reports why a batch stopped before running every task — called only for the one
   * task whose wait did not resolve `'completed'`, so `outcome` is never that variant.
   */
  onBatchStopped?: (info: {
    taskId: string;
    operationId: string;
    title: string;
    outcome: Exclude<OperationWaitOutcome, { kind: 'completed' }>;
  }) => void;
}

/** Short, user-facing explanation of a non-'completed' wait outcome, for the existing operation-progress UI. */
export function describeBatchStopReason(outcome: Exclude<OperationWaitOutcome, { kind: 'completed' }>): string {
  switch (outcome.kind) {
    case 'failed':
      return 'zadanie nie powiodło się — pozostałe zadania w partii nie zostały uruchomione';
    case 'timeout':
      return 'przekroczono czas oczekiwania na zakończenie operacji — pozostałe zadania w partii nie zostały uruchomione';
    case 'error':
      return `nie udało się ustalić statusu operacji (${outcome.message}) — pozostałe zadania w partii nie zostały uruchomione`;
  }
}

export async function runDirectTaskAction(
  deps: Pick<WorkflowActionDeps, 'execute' | 'onOperationStarted'>,
  task: SpecificationTask,
  actionName: SpecificationOwnerAction,
): Promise<void> {
  try {
    const taskId = task.id;
    const res = await deps.execute({ action: actionName, taskId });
    if (res?.operationId) {
      deps.onOperationStarted(
        res.operationId,
        actionName === 'approve' ? `Zatwierdzanie zadania: ${taskId}` : `Weryfikacja zadania: ${taskId}`,
      );
    }
  } catch {
    // Handled in mutation state
  }
}

/**
 * Runs `actionName` against each task strictly in order. Task N+1 may start only after
 * task N's own spawned operation has been *authoritatively* observed `completed` —
 * never on a timeout, a status-read failure, or any other non-terminal outcome. Those
 * are safety stops, not evidence the operation finished, so the batch halts on the
 * first one encountered (fail closed): no two batch-spawned operations can ever be
 * concurrently in flight through this loop.
 */
export async function runBatchTaskAction(
  deps: WorkflowActionDeps,
  tasks: SpecificationTask[],
  actionName: SpecificationOwnerAction,
): Promise<void> {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const taskId = task.id;
      const res = await deps.execute({ action: actionName, taskId });
      if (res?.operationId) {
        const title =
          actionName === 'approve'
            ? `Zatwierdzanie zadania (${i + 1}/${tasks.length}): ${taskId}`
            : `Weryfikacja zadania (${i + 1}/${tasks.length}): ${taskId}`;
        deps.onOperationStarted(res.operationId, title);

        const outcome = await deps.waitForTerminal(res.operationId);
        if (outcome.kind !== 'completed') {
          deps.onBatchStopped?.({ taskId, operationId: res.operationId, title, outcome });
          return; // Fail closed: anything but an authoritative 'completed' stops the batch.
        }
      }
    } catch {
      break;
    }
  }
}

export async function runFinalizeAction(
  deps: Pick<WorkflowActionDeps, 'execute' | 'onOperationStarted'>,
  onClosed: () => void,
): Promise<void> {
  try {
    const res = await deps.execute({ action: 'finalize', confirmed: true });
    onClosed();
    if (res?.operationId) {
      deps.onOperationStarted(res.operationId, 'Finalizacja specyfikacji');
    }
  } catch {
    // The mutation exposes its sanitized error in the confirmation dialog.
  }
}
