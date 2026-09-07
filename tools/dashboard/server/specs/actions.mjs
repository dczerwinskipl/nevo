import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import * as git from '../../../lib/git.mjs';
import { createProgressEmitter } from '../../../lib/operation-progress.mjs';
import { evaluateGate, evaluateTaskGate } from '../../../specs/gates.mjs';
import { ACTIVE_DIR, loadChange } from '../../../specs/store.mjs';
import { loadFollowUps } from '../../../specs/follow-ups.mjs';
import { approveTask } from '../../../specs/approve/operation.mjs';
import { verifyTask } from '../../../specs/verify/operation.mjs';
import { finalizeChange } from '../../../specs/finalize/operation.mjs';
import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';

const execFileAsync = promisify(execFile);

export class SpecificationActionError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'SpecificationActionError';
    this.status = status;
  }
}

export function taskGate(change, task, options = {}) {
  if (options.taskGateEvaluator) {
    return options.taskGateEvaluator(change, task);
  }
  return evaluateTaskGate(change, task, options);
}

export function finalizeGate(change, facts = {}) {
  const result = evaluateGate('finalize', { change, ...facts }, { mode: 'full' });
  return {
    enabled: Boolean(result.ok),
    reason: result.ok ? null : result.reason || 'The finalize gate did not pass.',
    checks: facts?.verification || [],
    pullRequest: facts?.pr || null,
    branch: facts?.branch || { hasUpstream: false, ahead: null, behind: null },
  };
}

function requireActiveChange(slug, activeDir) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new SpecificationActionError('Active specification not found.', 404);
  }
  const change = loadChange(slug, activeDir);
  if (!change) throw new SpecificationActionError('Active specification not found.', 404);
  return change;
}

export async function getLocalBranchTracking(root, options = {}) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      signal: options.signal,
    });
    const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
    return {
      hasUpstream: true,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return { hasUpstream: false, ahead: null, behind: null };
  }
}

export async function loadSpecificationActions({
  slug,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  taskGateEvaluator,
  worktreeLoader = git.getWorkingTreeSummaryAsync,
  branchLoader = git.getCurrentBranchAsync,
  trackingLoader = getLocalBranchTracking,
} = {}) {
  const change = requireActiveChange(slug, activeDir);
  const worktree = await worktreeLoader(root);
  const branch = await branchLoader(root);
  const tracking = await trackingLoader(root, branch);

  let openBlockingFollowUps = [];
  try {
    const followUps = loadFollowUps(change);
    openBlockingFollowUps = (followUps.follow_ups || [])
      .filter((f) => f.status === 'open' && f.severity === 'blocking')
      .map((f) => ({ id: f.id, reason: f.reason }));
  } catch {}

  const gateResult = evaluateGate(
    'finalize',
    {
      change,
      worktree,
      branch: { ...tracking, branch },
      openBlockingFollowUps,
    },
    { mode: 'fast' },
  );

  const tasks = {};
  for (const task of change.tasks) {
    const gate = await taskGate(change, task, { taskGateEvaluator, root, slug });
    if (gate) {
      tasks[task.id] = gate;
    }
  }

  return {
    id: change.id || change._slug,
    slug: change._slug,
    source: 'active',
    generatedAt: new Date().toISOString(),
    worktree: {
      ...worktree,
      branch,
      ...tracking,
    },
    tasks,
    finalize: {
      enabled: gateResult.status === 'allowed' || gateResult.status === 'needs-full-check',
      status: gateResult.status,
      reason: gateResult.status === 'blocked' ? gateResult.reason : null,
      checks: [],
      pullRequest: null,
    },
  };
}

export function executeSpecificationAction({
  slug,
  action,
  taskId,
  confirmed = false,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
  git: useGitParam,
  operationRuntime,
  onFinished,
  signal = null,
} = {}) {
  const change = requireActiveChange(slug, activeDir);

  let operationType;
  if (action === 'approve' || action === 'verify') {
    const task = change.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new SpecificationActionError('Task not found.', 404);
    operationType = `spec-action-${action}`;
  } else if (action === 'finalize') {
    if (!confirmed) throw new SpecificationActionError('Finalization requires explicit confirmation.', 400);
    operationType = 'spec-action-finalize';
  } else {
    throw new SpecificationActionError('Unknown specification action.', 400);
  }

  let finished = false;
  function markFinished() {
    if (finished) return;
    finished = true;
    if (typeof onFinished === 'function') {
      try {
        onFinished();
      } catch {}
    }
  }

  const operationId = operationRuntime ? operationRuntime.createOperation({ type: operationType }) : `op-${Date.now()}`;

  // Forward only non-terminal step and progress events to OperationRuntime.
  // Terminal state is owned exclusively by OperationRuntime.completeOperation / failOperation.
  const emitter = createProgressEmitter({
    out: null,
    onEvent: (event) => {
      if (
        operationRuntime &&
        event.type !== 'operation.started' &&
        event.type !== 'operation.completed' &&
        event.type !== 'operation.failed'
      ) {
        operationRuntime.recordEvent(operationId, event);
      }
    },
  });

  const useGit = useGitParam ?? root === REPOSITORY_ROOT;

  let resolveCompletion;
  const completion = new Promise((resolvePromise) => {
    resolveCompletion = resolvePromise;
  });

  const runner = async () => {
    try {
      let result;
      if (action === 'approve') {
        result = await approveTask({
          changeSlug: slug,
          taskId,
          activeDir,
          gitRoot: root,
          git: useGit,
          emitter,
          signal,
        });
      } else if (action === 'verify') {
        result = await verifyTask({
          changeSlug: slug,
          taskId,
          activeDir,
          gitRoot: root,
          git: useGit,
          emitter,
          signal,
        });
      } else if (action === 'finalize') {
        result = await finalizeChange({
          changeSlug: slug,
          gitRoot: root,
          emitter,
          signal,
        });
      }

      if (operationRuntime) {
        operationRuntime.completeOperation(
          operationId,
          result || {
            ok: true,
            action,
            ...(taskId ? { taskId } : {}),
          },
        );
      }
    } catch (error) {
      if (operationRuntime) {
        operationRuntime.failOperation(operationId, {
          message: error?.message || 'Operation failed',
          code: error?.code,
        });
      }
    } finally {
      markFinished();
      resolveCompletion();
    }
  };

  void runner();

  return {
    ok: true,
    operationId,
    action,
    ...(taskId ? { taskId } : {}),
    message:
      action === 'approve'
        ? 'Zadanie zostało zatwierdzone.'
        : action === 'verify'
          ? 'Implementacja została zaakceptowana.'
          : 'Specyfikacja została sfinalizowana.',
    completion,
  };
}

/**
 * The specification-actions capability: owns the single-flight-per-slug
 * concurrency lock and each in-flight action's `AbortController`, so HTTP
 * routes only ever call `loadActions`/`startAction` — never touch a Map of
 * controllers themselves. `shutdown()` aborts and awaits every in-flight
 * action atomically, for whoever owns this capability's lifecycle.
 */
export function createSpecActionsCapability({
  operationRuntime,
  actionExecutor = executeSpecificationAction,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
} = {}) {
  const activeActions = new Map(); // slug -> { controller, completion }

  function loadActions(slug) {
    return loadSpecificationActions({ slug, activeDir, root });
  }

  function startAction({ slug, action, taskId, confirmed }) {
    if (activeActions.has(slug)) {
      throw new SpecificationActionError('Another specification action is already running.', 409);
    }
    const controller = new AbortController();
    let hasStarted = false;
    let cleanupDone = false;
    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      activeActions.delete(slug);
    };

    try {
      const result = actionExecutor({
        slug,
        action,
        taskId,
        confirmed,
        activeDir,
        root,
        operationRuntime,
        signal: controller.signal,
        onFinished: cleanup,
      });
      const completion =
        result?.completion && typeof result.completion.then === 'function'
          ? result.completion.finally(cleanup)
          : Promise.resolve().finally(cleanup);
      activeActions.set(slug, { controller, completion });
      hasStarted = true;
      return result;
    } finally {
      if (!hasStarted) cleanup();
    }
  }

  async function shutdown() {
    const entries = Array.from(activeActions.values());
    for (const { controller } of entries) {
      try {
        controller.abort(new Error('Dashboard server shutting down'));
      } catch {}
    }
    if (entries.length > 0) {
      await Promise.allSettled(entries.map((e) => e.completion));
    }
    activeActions.clear();
  }

  return { loadActions, startAction, shutdown };
}
