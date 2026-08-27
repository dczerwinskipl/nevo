import {
  requireChange,
  requireTask,
  ROOT,
} from '../store.mjs';
import { buildContextPacket } from '../context.mjs';
import {
  resolveProvenanceMappings,
  writeImplementationProvenance,
} from '../lifecycle/provenance.mjs';
import * as git from '../../lib/git.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: suggest baseline revision and changed paths for a legacy task.
 */
export function suggestProvenance(changeSlug, taskId, { gitRoot = ROOT } = {}) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  if (task.implementation?.baseline_revision) {
    return {
      taskId,
      alreadyHasProvenance: true,
      implementation: task.implementation,
    };
  }
  const packet = buildContextPacket(change, task);
  const commits = git.findCommitsMentioning(gitRoot, taskId);
  return {
    taskId,
    suggested: true,
    note: 'Commit-message matching is a suggestion only, never authoritative — review before applying with apply-provenance --confirm.',
    candidateBaselineRevision: commits.length ? commits[commits.length - 1].sha : null,
    candidateCommits: commits,
    allowedPaths: packet.allowed_paths,
  };
}

/**
 * Application operation: apply confirmed provenance mappings to one or more tasks.
 */
export function applyProvenance(changeSlug, taskIdOrList, options = {}) {
  if (!options.confirm) {
    throw new CliError('apply-provenance requires --confirm — a persisted implementation block is written only after explicit owner confirmation, never unattended.');
  }

  let mappings;
  try {
    mappings = resolveProvenanceMappings(taskIdOrList, options);
  } catch (error) {
    throw new CliError(error.message);
  }

  const change = requireChange(changeSlug);
  for (const { taskId } of mappings) requireTask(change, taskId);

  for (const { taskId, baseline, reviewRevision, changedPaths } of mappings) {
    writeImplementationProvenance(change, taskId, {
      baseline_revision: baseline,
      review_revision: reviewRevision || baseline,
      changed_paths: changedPaths,
      worktree_patch_fingerprint: null,
    });
  }

  const summary = mappings.map(m => `'${m.taskId}' (baseline ${m.baseline})`).join(', ');
  return {
    change,
    mappings,
    summary,
  };
}
