import { existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import {
  requireChange,
  requireTask,
  setTaskStatus,
  ROOT,
} from '../store.mjs';
import { guardAgainstUnsafeManual } from '../lifecycle/recovery.mjs';
import {
  buildSpecsIndexes,
  writeSpecsIndexes,
} from '../indexes.mjs';
import { evaluateGate } from '../gates.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { splitShellWords } from '../../lib/shell-words.mjs';
import { CliError } from '../../lib/cli-errors.mjs';
import {
  getDirtyPathsAsync,
  addAndCommitAsync,
  getCurrentBranchAsync,
  getAheadBehindAsync,
  pushAsync,
} from '../../lib/git.mjs';

function normalizePath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

export function runVerificationCommand(commandString, root = ROOT) {
  try {
    const [program, ...args] = splitShellWords(commandString);
    const normalizedArgs = [];
    for (const arg of args) {
      if (program === 'node' && args.includes('--test')) {
        const clean = arg.replace(/[\\/]+$/, '');
        try {
          if (clean && existsSync(join(root, clean)) && statSync(join(root, clean)).isDirectory()) {
            const files = readdirSync(join(root, clean))
              .filter(f => f.endsWith('.test.mjs') || f.endsWith('.test.js'))
              .map(f => `${clean}/${f}`.replace(/\\/g, '/'));
            normalizedArgs.push(...files);
            continue;
          }
        } catch {}
      }
      normalizedArgs.push(arg);
    }
    const windowsCommandShim = process.platform === 'win32'
      && ['echo', 'npm', 'npx', 'pnpm', 'yarn'].includes(program.toLowerCase());
    if (windowsCommandShim) {
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', program, ...args], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } else {
      execFileSync(program, normalizedArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    }
    return { command: commandString, exit_code: 0 };
  } catch (error) {
    return { command: commandString, exit_code: typeof error.status === 'number' ? error.status : 1 };
  }
}

export async function verifyTask(options = {}) {
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
  guardAgainstUnsafeManual(task, taskId, 'verify');

  const useGit = git !== false && gitIntegration !== false && !check;

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

  const relativeChangeYaml = normalizePath(relative(gitRoot, change._file));
  const allowedExact = new Set([
    relativeChangeYaml,
    normalizePath(relative(gitRoot, activeIndexMd)),
    normalizePath(relative(gitRoot, archiveIndexMd)),
    normalizePath(relative(gitRoot, indexJson)),
  ]);

  const gateResult = evaluateGate('task.verify', {
    change,
    task,
    taskId,
  });

  if (check) {
    if (gateResult.ok) {
      progress.stepCompleted({ id: 'validate-transition' });
    } else {
      progress.stepFailed({ id: 'validate-transition', error: gateResult.reason || 'Verification gate failed' });
    }
    return gateResult;
  }

  if (!gateResult.ok) {
    const errorMsg = gateResult.reason || 'Verification gate failed';
    progress.stepFailed({ id: 'validate-transition', error: errorMsg });
    progress.operationFailed({ error: errorMsg });
    throw new CliError(errorMsg);
  }

  if (useGit) {
    const baselineDirty = (await getDirtyPathsAsync(gitRoot, { signal })).map(normalizePath);
    if (baselineDirty.length > 0) {
      const dirtyTargets = baselineDirty.filter(p => allowedExact.has(p));
      if (dirtyTargets.length > 0) {
        const err = `Cannot commit verification: '${dirtyTargets.join(', ')}' contains pre-existing uncommitted modifications.`;
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

  // 2. Mark verified
  progress.stepStarted({ id: 'verify-task', label: 'Verify task' });
  if (!gateResult.idempotent) {
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
    const currentDirty = (await getDirtyPathsAsync(gitRoot, { signal })).map(normalizePath);
    const unrelated = currentDirty.filter(p => !allowedExact.has(p));
    if (unrelated.length > 0) {
      const err = `Cannot commit verification: unrelated dirty files in working tree: ${unrelated.join(', ')}`;
      progress.stepFailed({ id: 'commit-verification', error: err });
      progress.operationFailed({ error: err });
      throw new CliError(err);
    }

    const toStage = currentDirty.filter(p => allowedExact.has(p));
    if (toStage.length > 0) {
      try {
        await addAndCommitAsync(gitRoot, toStage, `chore(specs): verify ${changeSlug}/${taskId}`, { signal });
      } catch (e) {
        progress.stepFailed({ id: 'commit-verification', error: e.message });
        progress.operationFailed({ error: e.message });
        throw new CliError(`Commit verification failed: ${e.message}`);
      }
    }
    progress.stepCompleted({ id: 'commit-verification' });

    progress.stepStarted({ id: 'push-verification', label: 'Push verification' });
    const branch = await getCurrentBranchAsync(gitRoot, { signal });
    const aheadBehind = await getAheadBehindAsync(gitRoot, branch, { signal });
    if (aheadBehind.behind > 0) {
      const err = `Cannot push: local branch '${branch}' is ${aheadBehind.behind} commit(s) behind remote.`;
      progress.stepFailed({ id: 'push-verification', error: err });
      progress.operationFailed({ error: err });
      throw new CliError(err);
    }
    try {
      await pushAsync(gitRoot, branch, { signal });
    } catch (e) {
      progress.stepFailed({ id: 'push-verification', error: e.message });
      progress.operationFailed({ error: e.message });
      throw new CliError(`Push verification failed: ${e.message}`);
    }
    progress.stepCompleted({ id: 'push-verification' });
  }

  const summary = `Task '${taskId}' in change '${changeSlug}' marked as verified.`;
  progress.operationCompleted({ summary });
  return { ok: true, summary, gateResult };
}
