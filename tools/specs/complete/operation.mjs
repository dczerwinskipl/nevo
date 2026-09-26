import {
  requireChange,
  requireTask,
  setTaskStatus,
  ACTIVE_DIR,
} from '../store.mjs';
import { resolveWorkflowMode } from '../workflow/compatibility.mjs';
import { loadBatchIntent } from '../lifecycle/batch.mjs';
import { evaluateGate } from '../gates.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: mark task as implemented after evaluating human-verification request gate.
 */
export function completeTask(changeSlug, taskId, options = {}) {
  const { activeDir = ACTIVE_DIR } = options;
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);

  const workflowMode = resolveWorkflowMode(change, options);
  if (workflowMode.mode === 'deterministic') {
    throw new CliError(
      `Cannot run legacy 'complete' against deterministic specification '${changeSlug || change.id}'. ` +
      `Use deterministic command surface instead: workflow task publish, workflow step start, workflow step finish, startHumanStep, submitHumanStepResult (or workflow verify-human).`
    );
  }

  const intent = loadBatchIntent(change);
  const inActiveBatch = Boolean(intent?.orderedTasks?.includes(taskId));

  const gateResult = evaluateGate('task.request-human-verification', {
    task,
    change,
    inActiveBatch,
  }, { mode: 'full' });

  if (!gateResult.ok) {
    throw new CliError(gateResult.reason);
  }
  if (gateResult.idempotent) {
    return { change, task, gateResult, alreadyImplemented: true };
  }

  setTaskStatus(change, taskId, 'implemented');
  return { change, task, gateResult, alreadyImplemented: false };
}
