import {
  startBatch,
  getBatchStatus,
  reviewBatch,
  BATCH_SELECTION_MODES,
} from '../operations/batch.mjs';
import { handleStart } from './start.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';

export { BATCH_SELECTION_MODES };

export function handleBatchStart(changeSlug, mode, options = {}) {
  const result = startBatch(changeSlug, mode, options);

  console.log(
    result.checkpointTask
      ? `Batch started for '${changeSlug}' (mode: ${mode}, checkpoint: ${result.checkpointTask}): ${result.orderedTasks.join(' -> ')}`
      : `Batch started for '${changeSlug}' (mode: ${mode}): ${result.orderedTasks.join(' -> ')}`
  );

  handleStart(changeSlug, result.firstTask);
}

export function handleBatchStatus(changeSlug) {
  const status = getBatchStatus(changeSlug);
  console.log(JSON.stringify(status, null, 2));
}

export function handleBatchReview(changeSlug, options = {}) {
  const emitter = createProgressEmitter();
  const result = reviewBatch(changeSlug, { ...options, emitter });
  console.log(`Batch review written: ${result.relativeReportPath}`);
  console.log(`Verdict: ${result.verdict}`);
}
