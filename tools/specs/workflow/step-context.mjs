// Compiles the agent-facing `StepContext` returned by `workflow step start` (D9/D10).
// Aggregates action/gate contracts already computed by `WorkflowEngine.checkStep`
// (Task 03) and `GateContract.inspect()` (Task 05) into one step-level payload —
// this module aggregates, it never re-implements, that underlying evaluation.

import { existsSync } from 'node:fs';
import { relative, join } from 'node:path';
import { defaultWorkflowEngine } from './engine.mjs';
import { defaultActionRegistry } from './registry.mjs';
import { resolveWorkflowPosition, resolveSemanticStatus, inspectGates } from './step-runner.mjs';
import { WorkflowError } from './errors.mjs';
import { setTaskWorkflowState, ROOT, ACTIVE_DIR } from '../store.mjs';
import { loadRoutingIndex, matchRoutingRules, resolveTaskScope, loadTaskFrontMatter } from '../context.mjs';
import { readUtf8, resolveWithinBase } from '../../lib/fs.mjs';
// D37 correction: read via `operation-record.mjs` directly (not `finish-operation.mjs`,
// which itself imports from this module — importing it here would create a cycle).
import { loadOperationRecord } from './operation-record.mjs';
import * as git from '../../lib/git.mjs';

// D38: re-export resolveTaskScope from context.mjs as single source of truth
export { resolveTaskScope } from '../context.mjs';
import { resolveWorkflowOwnedPaths } from './actions/commit-and-push.mjs';
export { resolveWorkflowOwnedPaths };

/**
 * Runs `WorkflowEngine.checkStep` over a step's full, unfiltered finalize action list.
 * Shared by `StepContext` compilation and finish planning (`finish-operation.mjs`) so
 * both compute the exact same aggregation via the exact same code path — never two
 * independently maintained implementations that could drift. A finalize entry
 * referencing an unregistered action id is never silently dropped (D20/C20) — it fails
 * closed via `WorkflowEngine.checkStep`'s own existing `ActionRegistry.require` error
 * (Task 03); `loadWorkflowDefinition` (`definitions/loader.mjs`) is the earlier,
 * load-time gate that should catch this first in normal operation.
 *
 * @param {object} step - Normalized step definition (`{ finalize, ... }`)
 * @param {object} context - Runtime environmental context passed through to actions
 * @param {object} [options]
 * @param {import('./engine.mjs').WorkflowEngine} [options.engine]
 * @param {import('./registry.mjs').ActionRegistry} [options.actionRegistry]
 * @returns {Promise<{ step: string, ready: boolean, actions: Record<string, object> }>}
 */
export async function aggregateFinalizeCheck(step, context, { engine = defaultWorkflowEngine, actionRegistry = defaultActionRegistry } = {}) {
  return engine.checkStep({ name: 'finalize', actions: step?.finalize || [] }, context);
}

/**
 * `CommitAndPushAction.check()` returns two differently-shaped `context` payloads
 * depending on `sourceControl.enabled` (`commit-and-push.mjs`): disabled returns
 * `{ sourceControl: {...inert config} }`, enabled returns a flat factual object
 * (`changedFiles`, `currentBranch`, ...) with no `sourceControl` key at all. Both
 * `StepContext.context.sourceControl` and finish planning's `sourceControl` field need
 * one consistent flat shape regardless of which branch produced it — this unwraps the
 * disabled branch's nesting rather than doubly re-wrapping it.
 *
 * @param {object|undefined} rawContext
 * @returns {object|null}
 */
export function normalizeSourceControlFacts(rawContext) {
  if (!rawContext) return null;
  return Object.prototype.hasOwnProperty.call(rawContext, 'sourceControl') ? rawContext.sourceControl : rawContext;
}

/**
 * Builds canonical `finishContract.parameters` (Task 03, D3/D4) unifying finalize action
 * parameter schemas with workflow-level parameters (`result`, `artifacts`).
 *
 * @param {{ actions: Record<string, { requiredInputs: Array<object> }> }} finalizeCheckResult
 * @param {object} [step] - Normalized step definition
 * @returns {Record<string, object>} Canonical parameters schema map
 */
export function buildFinishContract(finalizeCheckResult, step = null) {
  const parameters = {};
  if (finalizeCheckResult?.actions) {
    for (const actionResult of Object.values(finalizeCheckResult.actions)) {
      if (Array.isArray(actionResult.requiredInputs)) {
        for (const schema of actionResult.requiredInputs) {
          const s = { ...schema };
          if (s.type === 'array' && !s.items) {
            s.items = { type: 'string' };
          }
          parameters[schema.name] = s;
        }
      }
    }
  }

  // Compose workflow-level parameters
  const transitions = step?.transitions || [];
  const isConditional = transitions.length > 1 || (transitions.length === 1 && transitions[0].value !== undefined);

  if (isConditional) {
    const allowedValues = transitions.map(t => t.value).filter(Boolean);
    parameters.result = {
      type: 'enum',
      required: true,
      allowedValues,
      description: 'Semantic completion result selecting the next workflow transition.',
    };
  }

  parameters.artifacts = {
    type: 'array',
    items: { type: 'string' },
    required: false,
    description: 'Optional list of artifact reference strings (e.g. file paths) associated with this completion.',
  };

  parameters.feedback = {
    type: 'string',
    required: false,
    description: 'Optional review feedback or requested changes text associated with this completion.',
  };

  return parameters;
}

/**
 * Validates finish inputs against canonical `finishContract.parameters` schema.
 *
 * @param {object} inputs
 * @param {Record<string, object>} parameters
 * @param {object} [options]
 * @param {boolean} [options.allowMissing=false] - Whether to allow missing required inputs (e.g. in --check mode)
 */
export function validateFinishInputs(inputs, parameters, { allowMissing = false } = {}) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new WorkflowError('Finish inputs must be a non-null object', { code: 'INVALID_INPUT_JSON' });
  }

  // 1. Unknown properties check
  for (const key of Object.keys(inputs)) {
    if (!Object.prototype.hasOwnProperty.call(parameters, key)) {
      throw new WorkflowError(`Unknown finish input property '${key}'`, {
        code: 'UNKNOWN_INPUT_PROPERTY',
        property: key,
      });
    }
  }

  // 2. Required properties check
  if (!allowMissing) {
    for (const [name, schema] of Object.entries(parameters)) {
      if (schema.required) {
        if (inputs[name] === undefined || inputs[name] === null || inputs[name] === '') {
          throw new WorkflowError(`Missing required finish input '${name}'`, {
            code: 'MISSING_REQUIRED_INPUT',
            property: name,
          });
        }
      }
    }
  }

  // 3. Property type validation
  for (const [name, value] of Object.entries(inputs)) {
    if (value === undefined || value === null) continue;
    const schema = parameters[name];
    if (!schema) continue;

    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        throw new WorkflowError(`Finish input '${name}' must be a string`, {
          code: 'INVALID_INPUT_TYPE',
          property: name,
        });
      }
      if (schema.constraints?.minLength && value.length < schema.constraints.minLength) {
        throw new WorkflowError(
          `Finish input '${name}' must have minimum length ${schema.constraints.minLength}`,
          { code: 'INVALID_INPUT_VALUE', property: name }
        );
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        throw new WorkflowError(`Finish input '${name}' must be an array`, {
          code: 'INVALID_INPUT_TYPE',
          property: name,
        });
      }
      if (schema.items?.type === 'string') {
        if (!value.every(item => typeof item === 'string')) {
          throw new WorkflowError(`Finish input '${name}' items must be strings`, {
            code: 'INVALID_INPUT_TYPE',
            property: name,
          });
        }
      }
    } else if (schema.type === 'enum') {
      if (typeof value !== 'string') {
        throw new WorkflowError(`Finish input '${name}' must be a string`, {
          code: 'INVALID_INPUT_TYPE',
          property: name,
        });
      }
      if (Array.isArray(schema.allowedValues) && !schema.allowedValues.includes(value)) {
        throw new WorkflowError(
          `Finish input '${name}' value '${value}' is not allowed (must be one of: ${schema.allowedValues.join(', ')})`,
          { code: 'INVALID_INPUT_VALUE', property: name, allowedValues: schema.allowedValues }
        );
      }
    }
  }
}

/**
 * D37: `workflow step start` is the sole operation that ever advances
 * `workflow_progress.current_step`. Resolves the task's current position (D37's four
 * cases) and, for the two cases that require activation — `new` (fresh, no
 * `workflow_progress` yet) and `completed` (the current step already finished, its one
 * transition names another declared step) — performs exactly one atomic
 * `workflow_progress` write via `setTaskWorkflowState` (D32). `active` (resume) and
 * `terminal` never mutate anything.
 *
 * This is deliberately *not* a new durable multi-stage operation (unlike `finish`,
 * D14/D23) — a single atomic write needs none: a crash before the write means the next
 * call re-resolves the identical case and writes the identical value; a crash after
 * means the next call resolves `active` (resume) and returns the current `StepContext`.
 * Idempotent by construction, not by a second protocol.
 *
 * **Activation guard (D37 correction):** the `completed` case must never activate the
 * next step while the just-completed step's own finish operation hasn't actually
 * settled — a crash between `update-task` (which sets `state: 'completed'`) and
 * `commit`/`push`/`transition` would otherwise let this function silently move the task
 * past an unresolved finish, violating the durable finish/resume contract (D14/D23) the
 * operation record exists to uphold. Before activating, this checks the just-completed
 * step's own operation record (`operation-record.mjs`, the same on-disk convention
 * `finish-operation.mjs` uses — read directly, never through `finish-operation.mjs`
 * itself, to avoid a circular import); if it exists and isn't `completed`, this throws
 * rather than activating — it never resumes commit/push itself, it only guards
 * activation. The caller must retry `workflow step finish` for the prior step first.
 *
 * @param {object} change - Change manifest (requires `._file` for the store write)
 * @param {object} task - Task record
 * @param {object} definition - Normalized workflow definition
 * @param {object} [context] - Runtime context; `context.repoRoot` is required whenever
 *   position resolves to `completed`, to look up the prior step's operation record
 * @returns {{ task: object, position: {phase: 'active', step: string} | {phase: 'terminal', step: string} }}
 *   The *effective* task (unchanged for `active`/`terminal`; a locally-updated view
 *   carrying the just-written `workflow_progress` for `new`/`completed`, avoiding a
 *   redundant re-read of what the caller already knows it wrote) and its now-resolved
 *   position, always `active` or `terminal` after this call.
 * @throws {WorkflowError} `FINISH_OPERATION_UNRESOLVED` if the just-completed step's own
 *   finish operation hasn't settled; `REPO_ROOT_REQUIRED` if position resolves to
 *   `completed` and no `context.repoRoot` was supplied to check it
 */
/**
 * Asserts that the Git worktree is clean before activating a new step attempt (D13).
 *
 * @param {string} [repoRoot] - Repository root path
 * @throws {WorkflowError} DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT if working tree has uncommitted changes outside .nevo-ai-local/
 * @throws {WorkflowError} WORKTREE_STATE_UNAVAILABLE if git inspection fails
 */
export function assertCleanWorktreeForNewAttempt(repoRoot) {
  if (!repoRoot) return;
  let dirtyPaths;
  try {
    dirtyPaths = git.getDirtyPaths(repoRoot);
  } catch (err) {
    if (err instanceof WorkflowError) throw err;
    throw new WorkflowError(
      `Unable to inspect Git working tree state before activating new attempt: ${err.message}`,
      { code: 'WORKTREE_STATE_UNAVAILABLE', cause: err }
    );
  }
  const relevantDirty = dirtyPaths.filter(p => {
    const norm = p.replace(/\\/g, '/');
    if (norm === '.nevo-ai-local' || norm.startsWith('.nevo-ai-local/')) return false;
    if (norm === 'change.yaml' || norm.endsWith('/change.yaml')) return false;
    return true;
  });
  if (relevantDirty.length > 0) {
    throw new WorkflowError(
      `Working tree has uncommitted changes outside .nevo-ai-local/ (${relevantDirty.join(', ')}) — clean the workspace before starting a new attempt`,
      { code: 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT', dirtyFiles: relevantDirty }
    );
  }
}

export function ensureStepActivated(change, task, definition, context = {}) {
  const position = resolveWorkflowPosition(definition, task);
  if (position.phase !== 'new' && position.phase !== 'completed') {
    return { task, position };
  }

  if (position.phase === 'completed') {
    if (!context.repoRoot) {
      throw new WorkflowError(
        `Cannot activate the step after '${position.step}' without repoRoot — unable to verify its finish operation has settled`,
        { code: 'REPO_ROOT_REQUIRED', step: position.step }
      );
    }
    const changeSlug = change.id || change._slug;
    const priorRecord = loadOperationRecord(context.repoRoot, changeSlug, task.id, position.step, position.attempt);
    if (priorRecord && priorRecord.status !== 'completed') {
      throw new WorkflowError(
        `Step '${position.step}' has an unresolved finish operation (status: '${priorRecord.status}') — ` +
        `resume it with 'workflow step finish' before starting the next step`,
        {
          code: 'FINISH_OPERATION_UNRESOLVED',
          step: position.step,
          operationId: priorRecord.operationId,
          operationStatus: priorRecord.status,
        }
      );
    }
  }

  if (context.repoRoot) {
    assertCleanWorktreeForNewAttempt(context.repoRoot);
  }

  const targetStep = position.phase === 'new' ? definition.entryStep : position.nextStep;
  // D37: starting the next step never appends a `history` entry — `history` records
  // completions only, never activations.
  const history = task.workflow_progress?.history || [];
  const currentAttempt = history.filter(h => h.step === targetStep).length + 1;
  const workflowProgress = { current_step: targetStep, current_attempt: currentAttempt, state: 'active', history };
  setTaskWorkflowState(change, task.id, { workflowProgress });

  return {
    task: { ...task, workflow_progress: workflowProgress },
    position: { phase: 'active', step: targetStep, attempt: currentAttempt },
  };
}

/**
 * Derives a short, structural summary instruction from entry blockers and allowed paths (D22).
 * Never free-form AI-authored text — changes deterministically with blocker count and paths in scope.
 *
 * @param {string[]} allowedPaths
 * @param {Array<object>} blockers
 * @returns {string}
 */
export function deriveInstructions(allowedPaths = [], blockers = []) {
  const blockerCount = blockers.length;
  const pathsSummary = allowedPaths.length > 0
    ? `declared allowed_paths (${allowedPaths.join(', ')})`
    : 'allowed paths';

  if (blockerCount === 0) {
    return `Work within ${pathsSummary}; entry gates already satisfied.`;
  }

  const blockerList = blockers.map(b => b.id || b.gateType || 'gate').join(', ');
  return `Work within ${pathsSummary}; ${blockerCount} entry blocker(s) outstanding (${blockerList}).`;
}

/**
 * Projects matched routing rules into the StepContext relevantDocs shape (D22, AC3).
 * Sourced via `matchRoutingRules` from `tools/specs/context.mjs`.
 *
 * @param {Array<object>} matchedRules
 * @returns {Array<{ ruleId: string, docRef: string, pathGlob: string }>}
 */
export function projectRelevantDocs(matchedRules = []) {
  return (matchedRules || []).map(rule => {
    const item = {
      ruleId: rule.rule_id,
      docRef: rule.doc_ref,
      pathGlob: rule.path_glob,
    };
    Object.defineProperty(item, 'rule_id', { value: rule.rule_id, enumerable: false });
    Object.defineProperty(item, 'doc_ref', { value: rule.doc_ref, enumerable: false });
    return item;
  });
}

/**
 * Resolves relevant-docs hints by matching the task's `allowedPaths` against the
 * machine-readable routing rules index (`docs/routing.generated.json`), reusing
 * `tools/specs/context.mjs`'s deterministic `matchRoutingRules` logic (D22, D38, AC3).
 *
 * @param {string[]} allowedPaths
 * @param {object|null} routingIndex
 * @returns {Array<{ ruleId: string, docRef: string, pathGlob: string }>}
 */
export function resolveRelevantDocs(allowedPaths = [], routingIndex = null) {
  const matched = matchRoutingRules(routingIndex, allowedPaths);
  return projectRelevantDocs(matched);
}

/**
 * Extracts a step's declarative behavior contract (`purpose`, `expectedWork`, `hints`)
 * declared in the workflow definition (D25). If the step declares none of these fields,
 * returns `undefined` so that `stepContract` is omitted from `StepContext` rather than
 * producing a fabricated empty object.
 *
 * @param {object} step - Normalized step definition
 * @returns {object|undefined}
 */
export function buildStepContract(step) {
  if (!step) return undefined;
  const hasPurpose = step.purpose !== undefined;
  const hasExpectedWork = step.expectedWork !== undefined;
  const hasHints = step.hints !== undefined;

  if (!hasPurpose && !hasExpectedWork && !hasHints) {
    return undefined;
  }

  const contract = {};
  if (hasPurpose) contract.purpose = step.purpose;
  if (hasExpectedWork) contract.expectedWork = step.expectedWork;
  if (hasHints) contract.hints = step.hints;
  return contract;
}

/**
 * Extracts previous transition details if the previous completion represents a review failure,
 * requested changes, or provides feedback/artifacts (AC6).
 *
 * @param {object} task
 * @returns {object|undefined}
 */
export function extractPreviousTransition(task) {
  const history = task?.workflow_progress?.history;
  if (!Array.isArray(history) || history.length === 0) {
    return undefined;
  }
  const last = history[history.length - 1];
  if (!last) return undefined;

  const isFailureOrChanges = last.result === 'fail'
    || last.result === 'needs-changes'
    || Boolean(last.feedback)
    || Boolean(last.requestedChanges);

  if (!isFailureOrChanges) {
    return undefined;
  }

  const requestedChanges = last.feedback ?? last.requestedChanges ?? null;
  const transition = {
    from: last.step,
    attempt: last.attempt,
    result: last.result,
    ...(requestedChanges !== null ? { requestedChanges } : {}),
    ...(Array.isArray(last.artifacts) && last.artifacts.length > 0 ? { artifacts: last.artifacts } : {}),
  };
  if (requestedChanges !== null) {
    Object.defineProperty(transition, 'feedback', {
      value: requestedChanges,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return transition;
}

/**
 * Resolves the task's own definition document (D22).
 * Returns { id, path, content } where path is repository-root-relative,
 * and content is the task markdown file's full raw text.
 *
 * @param {object} change
 * @param {object} task
 * @param {object} [context]
 * @returns {{ id: string, path: string|null, content: string }}
 */
export function resolveTaskDefinition(change, task, context = {}) {
  const repoRoot = context.repoRoot || ROOT;
  const activeDir = context.activeDir || (repoRoot ? resolveWithinBase(repoRoot, 'specs/active') : ACTIVE_DIR);
  const changeSlug = change.id || change._slug;
  const changeDir = change._dir || (changeSlug && activeDir ? resolveWithinBase(activeDir, changeSlug) : null);

  let taskFile = null;
  let content = task.content || null;

  if (task.file && changeDir) {
    try {
      const resolved = resolveWithinBase(changeDir, task.file);
      if (existsSync(resolved)) {
        taskFile = resolved;
        if (content === null) {
          content = readUtf8(resolved);
        }
      }
    } catch {}
  }

  const relPath = taskFile && repoRoot
    ? relative(repoRoot, taskFile).replace(/\\/g, '/')
    : (task.file ? (changeSlug ? `specs/active/${changeSlug}/${task.file}` : task.file) : null);

  return {
    id: task.id,
    path: relPath,
    content: content ?? '',
  };
}

/**
 * Resolves task-declared required context documents (D23).
 * Sourced directly from task frontmatter's context.required (or in-memory task.context.required).
 * Each entry carries path and content inline.
 *
 * @param {object} change
 * @param {object} task
 * @param {object} [context]
 * @returns {Array<{ path: string, content: string }>}
 */
export function resolveRequiredContext(change, task, context = {}) {
  const taskFm = loadTaskFrontMatter(change, task, context);
  const required = task?.context?.required || taskFm?.context?.required;
  if (!Array.isArray(required) || required.length === 0) {
    return [];
  }
  const repoRoot = context.repoRoot || ROOT;
  const changeSlug = change.id || change._slug;
  return required.map(rawPath => {
    const relPath = typeof rawPath === 'string' && rawPath.startsWith('../')
      ? join('specs/active', changeSlug, rawPath).replace(/\\/g, '/')
      : (typeof rawPath === 'string' ? rawPath.replace(/\\/g, '/') : String(rawPath));
    try {
      const absPath = repoRoot ? resolveWithinBase(repoRoot, relPath) : relPath;
      const content = absPath && existsSync(absPath) ? readUtf8(absPath) : '';
      return { path: relPath, content };
    } catch {
      return { path: relPath, content: '' };
    }
  });
}

/**
 * Trims source-control facts to an agent-facing projection (D24).
 * Drops existingCommits/unpushedCommits (full branch history) while preserving
 * currentBranch, changedFiles, taskAffectedFiles, etc.
 *
 * @param {object|null} facts
 * @returns {object|null}
 */
export function pickAgentFacingSourceControl(facts) {
  if (!facts) return null;
  const { existingCommits, unpushedCommits, ...rest } = facts;
  return rest;
}

/**
 * Compiles the full `StepContext` returned by `workflow step start` (D10): current step,
 * task/spec identity, workflow state, entry state/blockers, factual context (including
 * source-control context when enabled), the finish contract (`requiredInputs` aggregated
 * across finalize actions, plus the exit gates that must pass), next-step guidance, and
 * the resolved runtime state/semantic status (D37) — activating the step first
 * (`ensureStepActivated`) when the task's position requires it.
 *
 * @param {object} params
 * @param {object} params.change - Change manifest (requires `.id` or `._slug`)
 * @param {object} params.task - Task record (requires `.id`, `.status`)
 * @param {object} params.definition - Normalized workflow definition (`definitions/schema.mjs`)
 * @param {object} [params.context={}] - Runtime environmental context passed to actions/gates
 * @param {import('./engine.mjs').WorkflowEngine} [params.engine]
 * @param {import('./registry.mjs').GateRegistry} [params.gateRegistry]
 * @param {import('./registry.mjs').ActionRegistry} [params.actionRegistry]
 * @returns {Promise<object>} StepContext payload
 */
export async function compileStepContext({
  change,
  task,
  definition,
  context = {},
  engine = defaultWorkflowEngine,
  gateRegistry,
  actionRegistry = defaultActionRegistry,
} = {}) {
  if (!change) throw new WorkflowError('compileStepContext requires a change manifest');
  if (!task) throw new WorkflowError('compileStepContext requires a task');
  if (!definition) throw new WorkflowError('compileStepContext requires a normalized workflow definition');

  const changeId = change.id || change._slug;
  const { task: effectiveTask, position } = ensureStepActivated(change, task, definition, context);

  const protocol = {
    authoritative: true,
    noDirectStateMutation: true,
    doNotInferNextStep: true,
    logicalCompletionPerAttempt: true,
    resumableFinish: true,
    stopOnHumanGate: true,
  };

  if (position.phase === 'terminal') {
    const { allowedPaths, forbiddenPaths } = resolveTaskScope(change, effectiveTask, context);
    const routingIndex = context.routingIndex !== undefined ? context.routingIndex : loadRoutingIndex();
    const relevantDocs = resolveRelevantDocs(allowedPaths, routingIndex);
    const taskDefinition = resolveTaskDefinition(change, effectiveTask, context);
    const requiredContext = resolveRequiredContext(change, effectiveTask, context);

    return {
      change: changeId,
      task: effectiveTask.id,
      taskDefinition,
      requiredContext,
      workflowMode: 'deterministic',
      currentStep: null,
      attempt: position.attempt,
      stepStatus: 'complete',
      runtimeState: 'completed',
      semanticStatus: resolveSemanticStatus(definition, effectiveTask),
      instructions: 'Workflow complete; all steps finished.',
      protocol,
      entryState: { blockers: [] },
      expectedWork: {
        allowedPaths,
        forbiddenPaths,
      },
      relevantDocs,
      context: {},
      finishContract: {
        parameters: {},
        // D24: requiredInputs is intentionally identical to parameters (kept for backward-compatibility with external callers).
        requiredInputs: {},
        gates: [],
      },
    };
  }

  const stepName = position.step;
  const step = definition.steps[stepName];
  // D29: gate inspection needs the resolved step identity in context so a
  // HumanVerificationGate can build its query with real stepId/gateId identity.
  const gateContext = { ...context, stepId: stepName, attempt: position.attempt };
  const entryGateResults = await inspectGates(step.entryGates, gateContext, { gateRegistry });
  const exitGateResults = await inspectGates(step.exitGates, gateContext, { gateRegistry });
  const actionContext = { ...context, sourceControl: context.sourceControl ?? definition.sourceControl };
  const finalizeCheck = await aggregateFinalizeCheck(step, actionContext, { engine, actionRegistry });
  const parameters = buildFinishContract(finalizeCheck, step);
  // Only a definitively 'blocked'/'failed' gate blocks — 'pending' (a command gate that
  // simply hasn't been verify()'d yet) must not, or planning could never reach the
  // execution that would actually run and record it (see the identical reasoning in
  // finish-operation.mjs's planFinish).
  const blockers = entryGateResults.filter(g => g.status === 'blocked' || g.status === 'failed');
  const sourceControlContext = normalizeSourceControlFacts(finalizeCheck.actions['commit-and-push']?.context);
  const agentFacingSourceControl = pickAgentFacingSourceControl(sourceControlContext);

  const { allowedPaths, forbiddenPaths } = resolveTaskScope(change, effectiveTask, context);
  const instructions = deriveInstructions(allowedPaths, blockers);
  const routingIndex = context.routingIndex !== undefined ? context.routingIndex : loadRoutingIndex();
  const relevantDocs = resolveRelevantDocs(allowedPaths, routingIndex);
  const stepContract = buildStepContract(step);
  const previousTransition = extractPreviousTransition(effectiveTask);
  const taskDefinition = resolveTaskDefinition(change, effectiveTask, context);
  const requiredContext = resolveRequiredContext(change, effectiveTask, context);

  return {
    change: changeId,
    task: effectiveTask.id,
    taskDefinition,
    requiredContext,
    workflowMode: 'deterministic',
    currentStep: stepName,
    attempt: position.attempt,
    stepStatus: blockers.length ? 'blocked' : 'in-progress',
    runtimeState: 'active',
    semanticStatus: resolveSemanticStatus(definition, effectiveTask),
    instructions,
    protocol,
    entryState: { blockers },
    expectedWork: {
      allowedPaths,
      forbiddenPaths,
    },
    relevantDocs,
    ...(stepContract !== undefined ? { stepContract } : {}),
    ...(previousTransition !== undefined ? { previousTransition } : {}),
    context: agentFacingSourceControl ? { sourceControl: agentFacingSourceControl } : {},
    finishContract: {
      parameters,
      // D24: requiredInputs is intentionally identical to parameters (kept for backward-compatibility with external callers).
      requiredInputs: parameters,
      // Enriched with inspected status (not just static id/type descriptors) so a blocking
      // human-verification (or other unmet exit gate) state is visible directly on
      // StepContext, matching the requirement that both `step start` and a `step finish`
      // attempt report the same blocking state (D9 clarification).
      gates: exitGateResults,
    },
  };
}

/**
 * Shared runtime context helper between CLI and HTTP transport.
 * Constructs the standard execution context from change, task, and definition.
 */
export function buildWorkflowRuntimeContext(change, task, definition, { repoRoot, activeDir, changeSlug } = {}) {
  const resolvedChangeSlug = changeSlug || change._slug || change.id;
  const scope = resolveTaskScope(change, task, { activeDir, repoRoot });
  const workflowOwnedPaths = resolveWorkflowOwnedPaths({ activeDir, repoRoot, changeSlug: resolvedChangeSlug });

  return {
    repoRoot,
    activeDir,
    taskId: task.id,
    task,
    changeId: change.id,
    changeSlug: resolvedChangeSlug,
    sourceControl: definition.sourceControl,
    baseBranch: 'main',
    taskAllowedPaths: scope.allowedPaths,
    allowedPaths: scope.allowedPaths,
    workflowOwnedPaths,
  };
}
