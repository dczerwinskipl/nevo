import {
  requireChange,
  requireTask,
  loadBatchIntent,
  setTaskStatus,
} from '../store.mjs';
import { evaluateGate } from '../gates.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function handleComplete(changeSlug, taskId) {
  const change = requireChange(changeSlug);
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
    console.log(`Task '${taskId}' is already implemented.`);
    return;
  }

  setTaskStatus(change, taskId, 'implemented');
  console.log(`Task '${taskId}' marked as implemented. Present results to owner for verification.`);
}
