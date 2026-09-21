import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import * as git from '../../../lib/git.mjs';
import { evaluateGate, evaluateTaskGate } from '../../../specs/gates.mjs';
import { isTaskReady } from '../../../specs/lifecycle-primitives.mjs';
import { ACTIVE_DIR, loadChange } from '../../../specs/store.mjs';
import { loadFollowUps } from '../../../specs/follow-ups.mjs';
import { executeLegacySpecificationAction } from './actions/legacy-mutations.mjs';
import { executeDeterministicHumanDecision } from './actions/deterministic-mutations.mjs';
import { resolveWorkflowMode } from '../../../specs/workflow/compatibility.mjs';
import { loadWorkflowDefinition } from '../../../specs/workflow/definitions/loader.mjs';
import { projectTask } from '../../../specs/workflow/task-projection.mjs';
import { describeStep } from '../../../specs/workflow/human-step/projection.mjs';
import { evaluateExecutionReadiness } from '../../../specs/workflow/readiness-policy.mjs';
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

/**
 * Legacy workflow available actions.
 */
export function computeLegacyTaskAvailableActions(task, change) {
  if (!task) return [];
  if (task.status === 'verified') return [];
  if (task.status === 'in-implementation') return [];
  return isTaskReady(task, change) ? ['start-implementation'] : [];
}

/**
 * Legacy workflow position projection.
 */
export function computeLegacyTaskWorkflowProjection(task) {
  const wp = task?.workflow_progress || null;
  return {
    status: task?.status ?? null,
    currentStep: wp?.current_step ?? null,
    attempt: wp?.current_attempt ?? null,
    workflowState: wp?.state ?? null,
  };
}

/**
 * Authoritative deterministic task action projection (DashboardActionProjection, D10).
 * Composes TaskProjection with ExecutionReadiness.
 *
 * Exposes: state, executor, attempt, currentStep, blockedBy, blockingDependencies,
 * terminalOutcome, terminalStatus, stepDescriptor, currentStepDescriptor, nextStepDescriptor,
 * humanInteraction, and availableActions.
 *
 * availableActions is exactly ["start-step"] when waiting for a start and ExecutionReadiness allows it,
 * for EITHER executor (D15). Never contains step-id-derived action names.
 *
 * Contains ZERO references to task.status, isTaskReady, or literal step names ('implementation', 'review', etc.).
 */
export function computeDeterministicTaskActionProjection(task, change, options = {}) {
  const repoRoot = options.root || options.repoRoot || REPOSITORY_ROOT;
  let definition = options.definition;
  if (!definition) {
    const resolvedMode = resolveWorkflowMode(change, options);
    if (resolvedMode.definition) {
      definition = loadWorkflowDefinition(resolvedMode.definition, { repoRoot });
    }
  }

  const projection = projectTask(task, change, { ...options, repoRoot, definition });

  // Resolve step descriptor (tier-1)
  const isCurrentlyActive = projection.state === 'active' || projection.state === 'human-interaction';
  const targetDescriptor = isCurrentlyActive
    ? (definition && projection.currentStep ? describeStep(definition, projection.currentStep) : null)
    : (projection.nextStep || null);

  // Evaluate execution readiness for availableActions (D10, D15)
  let availableActions = [];
  const isWaitingForStart = projection.state === 'ready' || projection.state === 'waiting-for-step-start';
  if (isWaitingForStart) {
    const targetExecutor = targetDescriptor?.executor || projection.executor || 'agent';
    const readiness = evaluateExecutionReadiness(task, change, targetExecutor, {
      repoRoot,
      definition,
    });
    if (readiness.ready) {
      availableActions = ['start-step'];
    }
  }

  return {
    state: projection.state,
    canPublish: projection.canPublish ?? (projection.state === 'draft'),
    executor: projection.executor,
    attempt: projection.currentAttempt,
    currentStep: projection.currentStep,
    blockedBy: projection.blockedBy,
    blockingDependencies: projection.blockingDependencies,
    terminalOutcome: projection.terminalOutcome,
    terminalStatus: projection.terminalStatus,
    stepDescriptor: targetDescriptor,
    currentStepDescriptor: isCurrentlyActive ? targetDescriptor : null,
    nextStepDescriptor: !isCurrentlyActive ? targetDescriptor : null,
    humanInteraction: projection.humanInteraction,
    availableActions,
  };
}

export function computeTaskAvailableActions(task, change, options = {}) {
  if (!task) return [];
  const resolvedMode = change ? resolveWorkflowMode(change, options) : { mode: 'legacy' };
  if (resolvedMode.mode === 'deterministic') {
    const projection = computeDeterministicTaskActionProjection(task, change, options);
    return projection.availableActions;
  }
  return computeLegacyTaskAvailableActions(task, change);
}

export function computeTaskWorkflowProjection(task, change, options = {}) {
  const resolvedMode = change ? resolveWorkflowMode(change, options) : { mode: 'legacy' };
  if (resolvedMode.mode === 'deterministic') {
    return computeDeterministicTaskActionProjection(task, change, options);
  }
  return computeLegacyTaskWorkflowProjection(task);
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

  // Authoritative source for whether this specification runs under the deterministic
  // workflow engine — the exact same resolver the CLI/workflow engine itself uses (D15).
  // The UI must read this rather than re-deriving it from task.status, a localStorage
  // preference, or session state.
  const resolvedWorkflow = resolveWorkflowMode(change);
  let workflowDef = null;
  if (resolvedWorkflow.mode === 'deterministic' && resolvedWorkflow.definition) {
    workflowDef = loadWorkflowDefinition(resolvedWorkflow.definition, { repoRoot: root });
  }

  const tasks = {};
  for (const task of change.tasks) {
    const gate = await taskGate(change, task, { taskGateEvaluator, root, slug });
    if (resolvedWorkflow.mode === 'deterministic') {
      const projectionDto = computeDeterministicTaskActionProjection(task, change, {
        root,
        definition: workflowDef,
      });
      tasks[task.id] = {
        ...(gate || {}),
        ...projectionDto,
      };
    } else {
      const availableActions = computeLegacyTaskAvailableActions(task, change);
      tasks[task.id] = {
        ...(gate || {}),
        ...computeLegacyTaskWorkflowProjection(task),
        availableActions,
      };
    }
  }

  return {
    id: change.id || change._slug,
    slug: change._slug,
    source: 'active',
    generatedAt: new Date().toISOString(),
    workflowMode: resolvedWorkflow.mode,
    workflowDefinition: resolvedWorkflow.mode === 'deterministic' ? resolvedWorkflow.definition : null,
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
  const workflowMode = resolveWorkflowMode(change, { activeDir, repoRoot: root });
  if (workflowMode.mode === 'deterministic') {
    throw new SpecificationActionError(
      `Cannot run legacy '${action}' against deterministic specification '${slug || change.id}'. ` +
      `Use deterministic command surface instead: workflow task publish, workflow step start, workflow step finish, startHumanStep, submitHumanStepResult, or workflow verify-human.`,
      400,
    );
  }

  return executeLegacySpecificationAction({
    change,
    slug,
    action,
    taskId,
    confirmed,
    activeDir,
    root,
    git: useGitParam,
    operationRuntime,
    onFinished,
    signal,
  });
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

  return {
    loadActions,
    startAction,
    executeHumanDecision: (opts) => executeHumanDecision({ activeDir, root, ...opts }),
    shutdown,
  };
}

export async function executeHumanDecision({
  slug,
  taskId,
  decision,
  feedback,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
} = {}) {
  const change = requireActiveChange(slug, activeDir);
  const workflowMode = resolveWorkflowMode(change, { activeDir, repoRoot: root });
  if (workflowMode.mode === 'legacy') {
    throw new SpecificationActionError(
      `Cannot run deterministic human decision against legacy specification '${slug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`,
      400,
    );
  }

  return await executeDeterministicHumanDecision({
    change,
    slug,
    taskId,
    decision,
    feedback,
    activeDir,
    root,
  });
}
