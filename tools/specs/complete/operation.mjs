import {
  requireChange,
  requireTask,
  setTaskStatus,
  ACTIVE_DIR,
} from '../store.mjs';
import { loadBatchIntent } from '../lifecycle/batch.mjs';
import { evaluateGate } from '../gates.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: mark task as implemented after evaluating human-verification request gate.
 */
export function completeTask(changeSlug, taskId, { activeDir = ACTIVE_DIR } = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
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
