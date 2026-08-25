import { join, relative } from 'node:path';
import {
  requireChange,
  requireTask,
  guardAgainstUnsafeManual,
  loadReview,
  setTaskSuspension,
  clearTaskSuspension,
  setTaskStatus,
  ROOT,
} from '../store.mjs';
import {
  computeChangeFingerprint,
  computeTaskFingerprint,
} from '../fingerprint.mjs';
import {
  buildSpecsIndexes,
  writeSpecsIndexes,
} from '../indexes.mjs';
import { evaluateGate } from '../gates.mjs';
import { computeMechanicalExemption } from '../validation.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { CliError, RecoveryError } from '../../lib/cli-errors.mjs';
import {
  getDirtyPathsAsync,
  addAndCommitAsync,
  getCurrentBranchAsync,
  getAheadBehindAsync,
  pushAsync,
} from '../../lib/git.mjs';

export async function approveTask(options = {}) {
  const {
    changeSlug,
    taskId,
    gitRoot = ROOT,
    git = true,
    gitIntegration = true,
    check = false,
    emitter = null,
    signal = null,
  } = options;
  const activeDir = options.activeDir || join(gitRoot, 'specs', 'active');
  const archiveDir = options.archiveDir || join(gitRoot, 'specs', 'archive');
  const activeIndexMd = options.activeIndexMd || join(gitRoot, 'specs', 'active.generated.md');
  const archiveIndexMd = options.archiveIndexMd || join(gitRoot, 'specs', 'archive.generated.md');
  const indexJson = options.indexJson || join(gitRoot, 'specs', 'index.generated.json');

  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  guardAgainstUnsafeManual(task, taskId, 'approve');

  const { eligible: mechanicalExempt } = computeMechanicalExemption(change, task);
  const review = loadReview(change);
  const currentFingerprint = computeChangeFingerprint(change);
  const currentTaskFingerprint = computeTaskFingerprint(change, taskId);

  const gateResult = evaluateGate('task.approve', {
    task,
    review,
    currentFingerprint,
    mechanicalExempt,
    taskId,
    currentTaskFingerprint,
  }, { mode: 'full' });

  if (check) {
    return gateResult;
  }

  const useGit = git !== false && gitIntegration !== false;
  const steps = [
    { id: 'validate-approval', label: 'Validate approval' },
    { id: 'approve-task', label: 'Approve task' },
    { id: 'rebuild-metadata', label: 'Rebuild spec metadata' },
  ];
  if (useGit) {
    steps.push({ id: 'commit-approval', label: 'Commit approval' });
    steps.push({ id: 'push-approval', label: 'Push approval' });
  }

  const progress = emitter || createProgressEmitter({ out: null });
  progress.operationStarted({ type: 'approve', steps });

  // 1. Validate approval
  progress.stepStarted({ id: 'validate-approval', label: 'Validate approval' });
  if (!gateResult.ok) {
    progress.stepFailed({ id: 'validate-approval', error: gateResult.reason });
    progress.operationFailed({ error: gateResult.reason });
    if (gateResult.code === 'stale-fingerprint' || gateResult.code === 'missing-task-fingerprint' || gateResult.code === 'stale-task-fingerprint') {
      setTaskSuspension(change, taskId, {
        kind: 'confirm-required', code: 'REC-07', previous_action: 'approve',
        created_at: new Date().toISOString(),
      });
      throw new RecoveryError('REC-07', { detail: gateResult.reason });
    }
    throw new CliError(gateResult.reason);
  }

  const normalizePath = p => p.replace(/\\/g, '/');
  const changeYamlRel = normalizePath(relative(gitRoot, join(activeDir, changeSlug, 'change.yaml')));
  const allowedExact = new Set([
    changeYamlRel,
    normalizePath(relative(gitRoot, activeIndexMd)),
    normalizePath(relative(gitRoot, archiveIndexMd)),
    normalizePath(relative(gitRoot, indexJson)),
  ]);

  if (useGit) {
    const baselineDirty = (await getDirtyPathsAsync(gitRoot, { signal })).map(normalizePath);
    if (baselineDirty.length > 0) {
      const dirtyTargets = baselineDirty.filter(p => allowedExact.has(p));
      if (dirtyTargets.length > 0) {
        const err = `Cannot commit approval: '${dirtyTargets.join(', ')}' contains pre-existing uncommitted modifications.`;
        progress.stepFailed({ id: 'validate-approval', error: err });
        progress.operationFailed({ error: err });
        throw new CliError(err);
      }
      const unrelated = baselineDirty.filter(p => !allowedExact.has(p));
      if (unrelated.length > 0) {
        const err = `Cannot commit approval: unrelated dirty files in working tree: ${unrelated.join(', ')}`;
        progress.stepFailed({ id: 'validate-approval', error: err });
        progress.operationFailed({ error: err });
        throw new CliError(err);
      }
    }
  }
  progress.stepCompleted({ id: 'validate-approval' });

  // 2. Approve task
  progress.stepStarted({ id: 'approve-task', label: 'Approve task' });
  if (task.status !== 'approved') {
    clearTaskSuspension(change, taskId);
    setTaskStatus(change, taskId, 'approved');
  }
  progress.stepCompleted({ id: 'approve-task' });

  // 3. Rebuild metadata
  progress.stepStarted({ id: 'rebuild-metadata', label: 'Rebuild spec metadata' });
  const built = buildSpecsIndexes({ activeDir, archiveDir });
  writeSpecsIndexes(built, { activeIndexMd, archiveIndexMd, indexJson });
  progress.stepCompleted({ id: 'rebuild-metadata' });

  // 4 & 5. Git commit & push (if enabled)
  if (useGit) {
    progress.stepStarted({ id: 'commit-approval', label: 'Commit approval' });
    const currentDirty = (await getDirtyPathsAsync(gitRoot, { signal })).map(normalizePath);
    const unrelated = currentDirty.filter(p => !allowedExact.has(p));
    if (unrelated.length > 0) {
      const err = `Cannot commit approval: unrelated dirty files in working tree: ${unrelated.join(', ')}`;
      progress.stepFailed({ id: 'commit-approval', error: err });
      progress.operationFailed({ error: err });
      throw new CliError(err);
    }

    const toStage = currentDirty.filter(p => allowedExact.has(p));
    if (toStage.length > 0) {
      try {
        await addAndCommitAsync(gitRoot, toStage, `chore(specs): approve ${taskId}`, { signal });
      } catch (e) {
        progress.stepFailed({ id: 'commit-approval', error: e.message });
        progress.operationFailed({ error: e.message });
        throw new CliError(`Commit approval failed: ${e.message}`);
      }
    }
    progress.stepCompleted({ id: 'commit-approval' });

    progress.stepStarted({ id: 'push-approval', label: 'Push approval' });
    try {
      const branch = await getCurrentBranchAsync(gitRoot, { signal });
      const ab = await getAheadBehindAsync(gitRoot, branch, { signal });
      if (!ab.hasUpstream || ab.ahead > 0) {
        await pushAsync(gitRoot, branch, { signal });
      }
      progress.stepCompleted({ id: 'push-approval' });
    } catch (e) {
      progress.stepFailed({ id: 'push-approval', error: e.message });
      progress.operationFailed({ error: e.message });
      throw new CliError(`Push approval failed: ${e.message}`);
    }
  }

  const summary = mechanicalExempt
    ? `Task '${taskId}' marked as approved (type: mechanical -- review-exempt deterministic approval).`
    : `Task '${taskId}' marked as approved.`;
  progress.operationCompleted({ summary });

  return { ok: true, change, task, summary };
}
