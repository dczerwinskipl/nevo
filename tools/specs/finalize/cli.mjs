import { finalizeChange, createRepairBranch } from './operation.mjs';
import { requireChangeAnywhere, ROOT } from '../store.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function handleFinalizeRepairBranch(changeSlug, options = {}) {
  requireChangeAnywhere(changeSlug);
  if (!options.failingSha) {
    throw new CliError('finalize-repair-branch requires --failing-sha (the merged SHA the failed post-merge check reported).');
  }
  const branchName = `fix/${changeSlug}-post-merge`;
  const result = createRepairBranch(ROOT, { branchName, failingSha: options.failingSha });

  if (!result.ok) {
    const stateNote = result.mainSwitched
      ? 'local main was already switched to and/or fast-forwarded.'
      : result.fetchRan
        ? 'a read-only fetch already ran; nothing else was modified.'
        : 'nothing was modified.';
    throw new CliError(`Repair branch not created — guard '${result.failedGuard}' failed (${stateNote})`);
  }
  console.log(`Repair branch '${branchName}' created and checked out.`);
}

export async function handleFinalize(changeSlug, options = {}) {
  const emitter = options.emitter || createProgressEmitter({ out: options.out ?? (options.silent ? null : process.stdout) });
  if (options.check) {
    const checkReport = await finalizeChange({ changeSlug, ...options, check: true, emitter });
    console.log(JSON.stringify(checkReport, null, 2));
    return checkReport;
  }
  const result = await finalizeChange({ changeSlug, ...options, emitter });
  if (!options.silent && !options.emitter) {
    console.log(result.summary);
  }
  return result;
}
