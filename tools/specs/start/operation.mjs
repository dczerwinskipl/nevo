import {
  requireChange,
  requireTask,
  setTaskStatus,
  ACTIVE_DIR,
  ROOT,
} from '../store.mjs';
import { buildContextPacket } from '../context.mjs';
import {
  validateTransition,
  depsSatisfied,
  DEPENDENCY_SATISFYING_STATUSES,
} from '../lifecycle-primitives.mjs';
import {
  inspectStartPostconditions,
  classifyDirtyWorktree,
  nextSuspensionForNotRetryable,
  setTaskSuspension,
  clearTaskSuspension,
  guardAgainstUnsafeManual,
} from '../lifecycle/recovery.mjs';
import {
  nextImplementationBaseline,
  writeImplementationProvenance,
} from '../lifecycle/provenance.mjs';
import * as git from '../../lib/git.mjs';
import { CliError, RecoveryError } from '../../lib/cli-errors.mjs';

export function startNeedsDirtyTreeCheck(postconditionResult, onExpectedBranch) {
  if (postconditionResult === 'completed' || postconditionResult === 'not_retryable') return false;
  return !onExpectedBranch;
}

/**
 * Application operation: start a task in a specification.
 * Handles validation, postcondition inspection, git branch management, and status/provenance recording.
 * Returns structured result without stdout/stderr side-effects.
 */
export function startTask(changeSlug, taskId, { activeDir = ACTIVE_DIR, gitRoot = ROOT } = {}) {
  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  guardAgainstUnsafeManual(task, taskId, 'start');
  const packet = buildContextPacket(change, task);
  const branch = packet.branch;

  const transition = validateTransition('start', task.status);
  if (!transition.ok) throw new CliError(transition.reason);

  const depsOk = transition.idempotent || depsSatisfied(task, change);
  const localExists = git.branchExists(gitRoot, branch);
  const remoteOnly = !localExists && git.hasUpstream(gitRoot, branch);
  const onExpectedBranch = git.getCurrentBranch(gitRoot) === branch;

  const inspection = inspectStartPostconditions({
    taskStatus: task.status,
    depsOk,
    onExpectedBranch,
    localBranchExists: localExists,
    remoteBranchExists: remoteOnly,
    unsatisfiedDeps: (task.depends_on || []).filter(depId => {
      const dep = change.tasks.find(t => t.id === depId);
      return !dep || !DEPENDENCY_SATISFYING_STATUSES.has(dep.status);
    }),
  });

  if (inspection.result === 'not_retryable') {
    const nextSuspension = nextSuspensionForNotRetryable(task.execution?.suspension);
    if (nextSuspension) setTaskSuspension(change, taskId, nextSuspension);
    throw new CliError(`Task '${taskId}' cannot be started: ${inspection.reason}`);
  }

  if (inspection.result === 'completed') {
    return {
      change,
      task,
      packet,
      branch,
      alreadyStarted: true,
    };
  }

  let branchAction = null;
  if (startNeedsDirtyTreeCheck(inspection.result, onExpectedBranch)) {
    const dirtyPaths = git.getDirtyPaths(gitRoot);
    if (dirtyPaths.length) {
      const classification = classifyDirtyWorktree(dirtyPaths, packet.allowed_paths);
      setTaskSuspension(change, taskId, {
        kind: classification.class,
        code: classification.code,
        previous_action: 'start',
        created_at: new Date().toISOString(),
      });
      throw new RecoveryError(classification.code, { detail: `Dirty file(s): ${classification.files.join(', ')}` });
    }

    if (localExists) {
      git.checkoutBranch(gitRoot, branch);
      branchAction = 'switched';
    } else if (remoteOnly) {
      git.checkoutTrackingBranch(gitRoot, branch);
      branchAction = 'tracking';
    } else {
      git.createAndCheckoutBranch(gitRoot, branch);
      branchAction = 'created';
    }
  }

  let statusChanged = false;
  if (task.status !== 'in-implementation') {
    setTaskStatus(change, taskId, 'in-implementation');
    statusChanged = true;
  }

  const baseline = nextImplementationBaseline(task.implementation, git.getCurrentRevision(gitRoot));
  if (baseline !== task.implementation?.baseline_revision) {
    writeImplementationProvenance(change, taskId, {
      ...(task.implementation || {}),
      baseline_revision: baseline,
    });
  }

  clearTaskSuspension(change, taskId);

  return {
    change,
    task,
    packet,
    branch,
    branchAction,
    statusChanged,
    alreadyStarted: false,
  };
}
