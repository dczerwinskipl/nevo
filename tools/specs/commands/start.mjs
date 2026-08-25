import {
  requireChange,
  requireTask,
  guardAgainstUnsafeManual,
  setTaskStatus,
  setTaskSuspension,
  clearTaskSuspension,
  writeImplementationProvenance,
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
} from '../lifecycle/recovery.mjs';
import { nextImplementationBaseline } from '../lifecycle/provenance.mjs';
import * as git from '../../lib/git.mjs';
import { CliError, RecoveryError } from '../../lib/cli-errors.mjs';

export function startNeedsDirtyTreeCheck(postconditionResult, onExpectedBranch) {
  if (postconditionResult === 'completed' || postconditionResult === 'not_retryable') return false;
  return !onExpectedBranch;
}

export function handleStart(changeSlug, taskId, { activeDir = ACTIVE_DIR, gitRoot = ROOT } = {}) {
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
    taskStatus: task.status, depsOk, onExpectedBranch, localBranchExists: localExists, remoteBranchExists: remoteOnly,
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
    console.log(`Task '${taskId}' is already in-implementation on branch '${branch}'.`);
    return;
  }

  if (startNeedsDirtyTreeCheck(inspection.result, onExpectedBranch)) {
    const dirtyPaths = git.getDirtyPaths(gitRoot);
    if (dirtyPaths.length) {
      const classification = classifyDirtyWorktree(dirtyPaths, packet.allowed_paths);
      setTaskSuspension(change, taskId, {
        kind: classification.class, code: classification.code, previous_action: 'start',
        created_at: new Date().toISOString(),
      });
      throw new RecoveryError(classification.code, { detail: `Dirty file(s): ${classification.files.join(', ')}` });
    }

    if (localExists) {
      git.checkoutBranch(gitRoot, branch);
      console.log(`Switched to branch: ${branch}`);
    } else if (remoteOnly) {
      git.checkoutTrackingBranch(gitRoot, branch);
      console.log(`Checked out existing remote branch: ${branch} (REC-02)`);
    } else {
      git.createAndCheckoutBranch(gitRoot, branch);
      console.log(`Created branch: ${branch}`);
    }
  }

  if (task.status !== 'in-implementation') {
    setTaskStatus(change, taskId, 'in-implementation');
    console.log(`Task '${taskId}' set to in-implementation.`);
  }

  const baseline = nextImplementationBaseline(task.implementation, git.getCurrentRevision(gitRoot));
  if (baseline !== task.implementation?.baseline_revision) {
    writeImplementationProvenance(change, taskId, {
      ...(task.implementation || {}),
      baseline_revision: baseline,
    });
  }

  clearTaskSuspension(change, taskId);
  console.log('\nContext packet:');
  console.log(JSON.stringify(packet, null, 2));
}
