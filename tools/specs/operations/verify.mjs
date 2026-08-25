import { join, relative } from 'node:path';
import {
  requireChange,
  requireTask,
  guardAgainstUnsafeManual,
  setTaskStatus,
  buildSpecsIndexes,
  writeSpecsIndexes,
  ACTIVE_DIR,
  ARCHIVE_DIR,
  ACTIVE_INDEX_MD,
  ARCHIVE_INDEX_MD,
  INDEX_JSON,
  ROOT,
} from '../service.mjs';
import { evaluateGate } from '../gates.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import {
  getDirtyPathsAsync,
  addAndCommitAsync,
  getCurrentBranchAsync,
  getAheadBehindAsync,
  pushAsync,
} from './git.mjs';

export async function verifyTask(options = {}) {
  const {
    changeSlug,
    taskId,
    gitRoot = ROOT,
    git = true,
    gitIntegration = true,
    check = false,
    emitter = null,
  } = options;
  const activeDir = options.activeDir || join(gitRoot, 'specs', 'active');
  const archiveDir = options.archiveDir || join(gitRoot, 'specs', 'archive');
  const activeIndexMd = options.activeIndexMd || join(gitRoot, 'specs', 'active.generated.md');
  const archiveIndexMd = options.archiveIndexMd || join(gitRoot, 'specs', 'archive.generated.md');
  const indexJson = options.indexJson || join(gitRoot, 'specs', 'index.generated.json');

  const change = requireChange(changeSlug, activeDir);
  const task = requireTask(change, taskId);
  guardAgainstUnsafeManual(task, taskId, 'verify');

  const gateResult = evaluateGate('task.verify', { task, change, taskId }, { mode: 'full' });

  if (check) {
    return gateResult;
  }

  const useGit = git !== false && gitIntegration !== false;
  const steps = [
    { id: 'validate-transition', label: 'Validate transition' },
    { id: 'verify-task', label: 'Verify task' },
    { id: 'rebuild-metadata', label: 'Rebuild spec metadata' },
  ];
  if (useGit) {
    steps.push({ id: 'commit-verification', label: 'Commit verification' });
    steps.push({ id: 'push-verification', label: 'Push verification' });
  }

  const progress = emitter || createProgressEmitter({ out: null });
  progress.operationStarted({ type: 'verify', steps });

  // 1. Validate transition
  progress.stepStarted({ id: 'validate-transition', label: 'Validate transition' });
  if (!gateResult.ok) {
    progress.stepFailed({ id: 'validate-transition', error: gateResult.reason });
    progress.operationFailed({ error: gateResult.reason });
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
    const baselineDirty = (await getDirtyPathsAsync(gitRoot)).map(normalizePath);
    if (baselineDirty.length > 0) {
      const dirtyTargets = baselineDirty.filter(p => allowedExact.has(p));
      if (dirtyTargets.length > 0) {
        const err = `Cannot commit verification: ${dirtyTargets.join(', ')} contains pre-existing uncommitted modifications.` ;
        progress.stepFailed({ id: 'validate-transition', error: err });
        progress.operationFailed({ error: err });
        throw new CliError(err);
      }
      const unrelated = baselineDirty.filter(p => !allowedExact.has(p));
      if (unrelated.length > 0) {
        const err = `Cannot commit verification: unrelated dirty files in working tree: ${unrelated.join(', ')}`;
        progress.stepFailed({ id: 'validate-transition', error: err });
        progress.operationFailed({ error: err });
        throw new CliError(err);
      }
    }
  }
  progress.stepCompleted({ id: 'validate-transition' });

  // 2. Verify task
  progress.stepStarted({ id: 'verify-task', label: 'Verify task' });
  if (task.status !== 'verified') {
    setTaskStatus(change, taskId, 'verified');
  }
  progress.stepCompleted({ id: 'verify-task' });

  // 3. Rebuild metadata
  progress.stepStarted({ id: 'rebuild-metadata', label: 'Rebuild spec metadata' });
  const built = buildSpecsIndexes({ activeDir, archiveDir });
  writeSpecsIndexes(built, { activeIndexMd, archiveIndexMd, indexJson });
  progress.stepCompleted({ id: 'rebuild-metadata' });

  // 4 & 5. Git commit & push (if enabled)
  if (useGit) {
    progress.stepStarted({ id: 'commit-verification', label: 'Commit verification' });
    const currentDirty = (await getDirtyPathsAsync(gitRoot)).map(normalizePath);
    const unrelated = currentDirty.filter(p => !allowedExact.has(p));
    if (unrelated.length > 0) {
      const err = `Cannot commit verification: unrelated dirty files in working tree: ${unrelated.join(', ')}`;
      progress.stepFailed({ id: 'commit-verification', error: err });
      progress.operationFailed({ error: err });
      throw new CliError(err);
    }

    const toStage = currentDirty.filter(P => allowedExact.has(p));
    if (toStage.length > 0) {
      try {
        await addAndCommitAsync(gitRoot, toStage, `chore(specs): verify ${changeSlug}/${taskId}`);
      } catch (e) {
        progress.stepFailed({ id: 'commit-verification', error: e.message });
        progress.operationFailed({ error: e.message });
        throw new CliError(`Commit verification failed: ${e.message}`);
      }
    }
    progress.stepCompleted({ id: 'commit-verification' });

    progress.stepStarted({ id: 'push-verification', label: 'Push verification' });
    try {
      const branch = await getCurrentBranchAsync(gitRoot);
      const ab = await getAheadBehindAsync(gitRoot, branch);
      if (!ab.hasUpstream || ab.ahead > 0) {
        await pushAsync(gitRoot, branch);
      }
      progress.stepCompleted({ id: 'push-verification' });
    } catch (e) {
      progress.stepFailed({ id: 'push-verification', error: e.message });
      progress.operationFailed({ error: e.message });
      throw new CliError(`Push verification failed: ${e.message}`);
    }
  }

  const summary = `Task '${taskId}' in change '${changeSlug}' marked as verified.`;
  progress.operationCompleted({ summary });

  return { ok: true, change, task, summary };
}
