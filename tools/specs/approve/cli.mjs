import { approveTask } from './operation.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';

export async function handleApprove(changeSlug, taskId, options = {}) {
  const emitter = options.emitter || createProgressEmitter({ out: options.out ?? (options.silent ? null : process.stdout) });
  if (options.check) {
    const result = await approveTask({ changeSlug, taskId, ...options, check: true, emitter });
    console.log(JSON.stringify({ change: changeSlug, task: taskId, result }, null, 2));
    return result;
  }
  const result = await approveTask({ changeSlug, taskId, ...options, emitter });
  if (!options.silent && !options.emitter) {
    console.log(result.summary);
  }
  return result;
}
