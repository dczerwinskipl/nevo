import type {
  DashboardTask,
  OperationSnapshot,
  SpecificationActionResult,
  SpecificationOwnerAction,
} from '@/lib/types';

/**
 * Pure task-workflow orchestration — no React, no DOM, no sessionStorage. Injected
 * dependencies make each function directly testable (mock `execute`/`waitForTerminal`,
 * assert call order) independently of `SpecDetail` rendering or the
 * `useSpecWorkflowActions` hook that wires these to React state (area
 * spec-detail-and-workflow-feature-slice, task 05).
 */
export interface WorkflowActionDeps {
  execute: (input: { action: SpecificationOwnerAction; taskId?: string; confirmed?: boolean }) => Promise<SpecificationActionResult | undefined>;
  onOperationStarted: (operationId: string, title: string) => void;
  /** Resolves once the operation reaches a backend-reported terminal state (or gives up after a bounded wait). */
  waitForTerminal: (operationId: string) => Promise<OperationSnapshot | null>;
}

export async function runDirectTaskAction(
  deps: Pick<WorkflowActionDeps, 'execute' | 'onOperationStarted'>,
  task: DashboardTask,
  actionName: SpecificationOwnerAction,
): Promise<void> {
  try {
    const taskId = task.id;
    const res = await deps.execute({ action: actionName, taskId });
    if (res?.operationId) {
      deps.onOperationStarted(
        res.operationId,
        actionName === 'approve' ? `Zatwierdzanie zadania: ${taskId}` : `Weryfikacja zadania: ${taskId}`
      );
    }
  } catch {
    // Handled in mutation state
  }
}

/**
 * Runs `actionName` against each task in order, awaiting each spawned operation's own
 * backend-reported terminal state — never a fixed poll interval, never a post-completion
 * delay — before starting the next task. Stops immediately (no further tasks run) if an
 * operation is reported `'failed'`, or if dispatching the action itself throws.
 */
export async function runBatchTaskAction(
  deps: WorkflowActionDeps,
  tasks: DashboardTask[],
  actionName: SpecificationOwnerAction,
): Promise<void> {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const taskId = task.id;
      const res = await deps.execute({ action: actionName, taskId });
      if (res?.operationId) {
        deps.onOperationStarted(
          res.operationId,
          actionName === 'approve'
            ? `Zatwierdzanie zadania (${i + 1}/${tasks.length}): ${taskId}`
            : `Weryfikacja zadania (${i + 1}/${tasks.length}): ${taskId}`
        );

        const snapshot = await deps.waitForTerminal(res.operationId);
        if (snapshot?.status === 'failed') {
          return; // Stop batch execution if a task fails
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
