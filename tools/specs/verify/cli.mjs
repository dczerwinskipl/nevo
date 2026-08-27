import { verifyTask, runVerificationCommand } from './operation.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';

// Re-export runVerificationCommand for backward compatibility
export { runVerificationCommand };

export async function handleVerify(changeSlug, taskId, options = {}) {
  const emitter = options.emitter || createProgressEmitter({ out: options.out ?? (options.silent ? null : process.stdout) });
  if (options.check) {
    const gateResult = await verifyTask({ changeSlug, taskId, ...options, check: true, emitter });
    const result = {
      ok: gateResult.ok,
      ...(gateResult.idempotent ? { idempotent: true } : {}),
      ...(gateResult.reason ? { reason: gateResult.reason } : {}),
    };
    console.log(JSON.stringify({ change: changeSlug, task: taskId, result }, null, 2));
    return result;
  }
  const result = await verifyTask({ changeSlug, taskId, ...options, emitter });
  if (!options.silent && !options.emitter) {
    console.log(result.summary);
  }
  return result;
}
