import { executeSelfCheck } from './operation.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';

export function handleSelfCheck(changeSlug, taskId, options = {}) {
  const emitter = createProgressEmitter();
  const result = executeSelfCheck(changeSlug, taskId, { ...options, emitter });

  for (const overlap of result.overlaps) {
    console.log(`Note: '${taskId}' and '${overlap.taskId}' both attribute changed_paths: ${overlap.paths.join(', ')} — verify this overlap is expected before trusting either task's evidence in isolation.`);
  }

  if (!result.passed) {
    console.log(`Self-check FAILED for '${taskId}': ${result.selfCheck.failed_criteria.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Self-check passed for '${taskId}'.`);
  }
}
