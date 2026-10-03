// Legacy workflow mutations (Task 17, D1, D4).
// Handles legacy approve, verify, and finalize operations.
// Never calls into deterministic mutation operations.

import { approveTask } from '../../../../specs/approve/operation.mjs';
import { verifyTask } from '../../../../specs/verify/operation.mjs';
import { finalizeChange } from '../../../../specs/finalize/operation.mjs';
import { createProgressEmitter } from '../../../../lib/operation-progress.mjs';
import { resolveWorkflowMode } from '../../../../specs/workflow/compatibility.mjs';
import { ACTIVE_DIR } from '../../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../../infrastructure/paths.mjs';
import { SpecificationActionError } from '../actions.mjs';

/**
 * Executes a legacy specification mutation (approve, verify, finalize).
 */
export function executeLegacySpecificationAction({
  change,
  slug,
  action,
  taskId,
  confirmed = false,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  git: useGitParam,
  operationRuntime,
  onFinished,
  signal = null,
} = {}) {
  const workflowMode = resolveWorkflowMode(change, { activeDir, repoRoot: root });
  if (workflowMode.mode === 'deterministic') {
    throw new SpecificationActionError(
      `Cannot run legacy '${action}' against deterministic specification '${slug || change?.id}'. ` +
      `Use deterministic command surface instead: workflow task publish, workflow step start, workflow step finish, startHumanStep, submitHumanStepResult, or workflow verify-human.`,
      400,
    );
  }

  let operationType;
  if (action === 'approve' || action === 'verify') {
    const task = change.tasks?.find((candidate) => candidate.id === taskId);
    if (!task) throw new SpecificationActionError('Task not found.', 404);
    operationType = `spec-action-${action}`;
  } else if (action === 'finalize') {
    if (!confirmed) throw new SpecificationActionError('Finalization requires explicit confirmation.', 400);
    operationType = 'spec-action-finalize';
  } else {
    throw new SpecificationActionError('Unknown specification action.', 400);
  }

  let finished = false;
  function markFinished() {
    if (finished) return;
    finished = true;
    if (typeof onFinished === 'function') {
      try {
        onFinished();
      } catch {}
    }
  }

  const operationId = operationRuntime ? operationRuntime.createOperation({ type: operationType }) : `op-${Date.now()}`;

  const emitter = createProgressEmitter({
    out: null,
    onEvent: (event) => {
      if (
        operationRuntime &&
        event.type !== 'operation.started' &&
        event.type !== 'operation.completed' &&
        event.type !== 'operation.failed'
      ) {
        operationRuntime.recordEvent(operationId, event);
      }
    },
  });

  const useGit = useGitParam ?? root === REPOSITORY_ROOT;

  let resolveCompletion;
  const completion = new Promise((resolvePromise) => {
    resolveCompletion = resolvePromise;
  });

  const runner = async () => {
    try {
      let result;
      if (action === 'approve') {
        result = await approveTask({
          changeSlug: slug,
          taskId,
          activeDir,
          gitRoot: root,
          git: useGit,
          emitter,
          signal,
        });
      } else if (action === 'verify') {
        result = await verifyTask({
          changeSlug: slug,
          taskId,
          activeDir,
          gitRoot: root,
          git: useGit,
          emitter,
          signal,
        });
      } else if (action === 'finalize') {
        result = await finalizeChange({
          changeSlug: slug,
          gitRoot: root,
          emitter,
          signal,
        });
      }

      if (operationRuntime) {
        operationRuntime.completeOperation(
          operationId,
          result || {
            ok: true,
            action,
            ...(taskId ? { taskId } : {}),
          },
        );
      }
    } catch (error) {
      if (operationRuntime) {
        operationRuntime.failOperation(operationId, {
          message: error?.message || 'Operation failed',
          code: error?.code,
        });
      }
    } finally {
      markFinished();
      resolveCompletion();
    }
  };

  void runner();

  return {
    ok: true,
    operationId,
    action,
    ...(taskId ? { taskId } : {}),
    message:
      action === 'approve'
        ? 'Zadanie zostało zatwierdzone.'
        : action === 'verify'
          ? 'Implementacja została zaakceptowana.'
          : 'Specyfikacja została sfinalizowana.',
    completion,
  };
}
