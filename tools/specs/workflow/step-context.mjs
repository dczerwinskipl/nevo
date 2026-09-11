// Compiles the agent-facing `StepContext` returned by `workflow step start` (D9/D10).
// Aggregates action/gate contracts already computed by `WorkflowEngine.checkStep`
// (Task 03) and `GateContract.inspect()` (Task 05) into one step-level payload —
// this module aggregates, it never re-implements, that underlying evaluation.

import { existsSync } from 'node:fs';
import { defaultWorkflowEngine } from './engine.mjs';
import { defaultActionRegistry } from './registry.mjs';
import { resolveWorkflowPosition, resolveSemanticStatus, inspectGates } from './step-runner.mjs';
import { WorkflowError } from './errors.mjs';
import { setTaskWorkflowState, ACTIVE_DIR } from '../store.mjs';
import { resolveWithinBase } from '../../lib/fs.mjs';
import { parseFrontMatterFile } from '../../lib/yaml.mjs';
import { loadRoutingIndex, pathGlobsOverlap } from '../context.mjs';
// D37 correction: read via `operation-record.mjs` directly (not `finish-operation.mjs`,
// which itself imports from this module — importing it here would create a cycle).
import { loadOperationRecord } from './operation-record.mjs';

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
 * Flattens per-action `requiredInputs` schemas (Task 03's `checkStep` aggregation) into
 * one step-level map keyed by parameter name (D10) — e.g. `commit.title` required,
 * `commit.message` optional. The finalize actions this foundation defines never declare
 * colliding names; a future step definition whose finalize actions do collide is out of
 * scope here and would need explicit per-action namespacing, not silent overwrite.
 *
 * @param {{ actions: Record<string, { requiredInputs: Array<object> }> }} finalizeCheckResult
 * @returns {Record<string, object>}
 */
export function buildFinishContract(finalizeCheckResult) {
  const requiredInputs = {};
  for (const actionResult of Object.values(finalizeCheckResult.actions)) {
    for (const schema of actionResult.requiredInputs) {
      requiredInputs[schema.name] = schema;
    }
  }
  return requiredInputs;
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
    const priorRecord = loadOperationRecord(context.repoRoot, changeSlug, task.id, position.step);
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

  const targetStep = position.phase === 'new' ? definition.entryStep : position.nextStep;
  // D37: starting the next step never appends a `history` entry — `history` records
  // completions only, never activations.
  const history = task.workflow_progress?.history || [];
  const workflowProgress = { current_step: targetStep, state: 'active', history };
  setTaskWorkflowState(change, task.id, { workflowProgress });

  return {
    task: { ...task, workflow_progress: workflowProgress },
    position: { phase: 'active', step: targetStep },
  };
}

/**
 * Resolves the task's declared scope (`allowedPaths` and `forbiddenPaths`).
 * Sourced deterministically from the task markdown file's frontmatter using the
 * same mechanism as the legacy context packet (`resolveWithinBase`, `parseFrontMatterFile`),
 * or directly from in-memory task properties when present (e.g. in test fixtures).
 *
 * @param {object} change
 * @param {object} task
 * @param {object} [context]
 * @returns {{ allowedPaths: string[], forbiddenPaths: string[] }}
 */
export function resolveTaskScope(change, task, context = {}) {
  let allowedPaths = task?.allowedPaths || task?.allowed_paths;
  let forbiddenPaths = task?.forbiddenPaths || task?.forbidden_paths;

  if ((allowedPaths === undefined || forbiddenPaths === undefined) && task?.file) {
    const changeDir = change?._dir
      || (context.activeDir ? resolveWithinBase(context.activeDir, change?.id || change?._slug) : null)
      || ((change?.id || change?._slug) ? resolveWithinBase(ACTIVE_DIR, change.id || change._slug) : null);

    if (changeDir && existsSync(changeDir)) {
      const taskFile = resolveWithinBase(changeDir, task.file);
      if (existsSync(taskFile)) {
        const taskFm = parseFrontMatterFile(taskFile);
        if (allowedPaths === undefined) allowedPaths = taskFm.allowed_paths;
        if (forbiddenPaths === undefined) forbiddenPaths = taskFm.forbidden_paths;
      }
    }
  }

  return {
    allowedPaths: Array.isArray(allowedPaths) ? allowedPaths : [],
    forbiddenPaths: Array.isArray(forbiddenPaths) ? forbiddenPaths : [],
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
 * Resolves relevant-docs hints by matching the task's `allowedPaths` against the
 * machine-readable routing rules index (`docs/routing.generated.json`), reusing
 * `tools/specs/context.mjs`'s deterministic `pathGlobsOverlap` logic (D22, AC3).
 *
 * @param {string[]} allowedPaths
 * @param {object|null} routingIndex
 * @returns {Array<{ ruleId: string, docRef: string, pathGlob: string }>}
 */
export function resolveRelevantDocs(allowedPaths = [], routingIndex = null) {
  if (!routingIndex || !Array.isArray(routingIndex.rules) || !allowedPaths.length) {
    return [];
  }
  const matched = routingIndex.rules.filter(rule =>
    allowedPaths.some(ap => pathGlobsOverlap(ap, rule.path_glob))
  );
  return matched.map(rule => {
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

  if (position.phase === 'terminal') {
    const { allowedPaths, forbiddenPaths } = resolveTaskScope(change, effectiveTask, context);
    const routingIndex = context.routingIndex !== undefined ? context.routingIndex : loadRoutingIndex();
    const relevantDocs = resolveRelevantDocs(allowedPaths, routingIndex);

    return {
      change: changeId,
      task: effectiveTask.id,
      workflowMode: 'deterministic',
      currentStep: null,
      stepStatus: 'complete',
      runtimeState: 'completed',
      semanticStatus: resolveSemanticStatus(definition, effectiveTask),
      instructions: 'Workflow complete; all steps finished.',
      entryState: { blockers: [] },
      expectedWork: {
        allowedPaths,
        forbiddenPaths,
      },
      relevantDocs,
      context: {},
      finishContract: { requiredInputs: {}, gates: [] },
      nextStepGuidance: null,
    };
  }

  const stepName = position.step;
  const step = definition.steps[stepName];
  // D29: gate inspection needs the resolved step identity in context so a
  // HumanVerificationGate can build its query with real stepId/gateId identity.
  const gateContext = { ...context, stepId: stepName };
  const entryGateResults = await inspectGates(step.entryGates, gateContext, { gateRegistry });
  const exitGateResults = await inspectGates(step.exitGates, gateContext, { gateRegistry });
  const finalizeCheck = await aggregateFinalizeCheck(step, context, { engine, actionRegistry });
  const requiredInputs = buildFinishContract(finalizeCheck);
  // Only a definitively 'blocked'/'failed' gate blocks — 'pending' (a command gate that
  // simply hasn't been verify()'d yet) must not, or planning could never reach the
  // execution that would actually run and record it (see the identical reasoning in
  // finish-operation.mjs's planFinish).
  const blockers = entryGateResults.filter(g => g.status === 'blocked' || g.status === 'failed');
  const sourceControlContext = normalizeSourceControlFacts(finalizeCheck.actions['commit-and-push']?.context);

  const { allowedPaths, forbiddenPaths } = resolveTaskScope(change, effectiveTask, context);
  const instructions = deriveInstructions(allowedPaths, blockers);
  const routingIndex = context.routingIndex !== undefined ? context.routingIndex : loadRoutingIndex();
  const relevantDocs = resolveRelevantDocs(allowedPaths, routingIndex);
  const stepContract = buildStepContract(step);

  return {
    change: changeId,
    task: effectiveTask.id,
    workflowMode: 'deterministic',
    currentStep: stepName,
    stepStatus: blockers.length ? 'blocked' : 'in-progress',
    runtimeState: 'active',
    semanticStatus: resolveSemanticStatus(definition, effectiveTask),
    instructions,
    entryState: { blockers },
    expectedWork: {
      allowedPaths,
      forbiddenPaths,
    },
    relevantDocs,
    ...(stepContract !== undefined ? { stepContract } : {}),
    context: sourceControlContext ? { sourceControl: sourceControlContext } : {},
    finishContract: {
      requiredInputs,
      // Enriched with inspected status (not just static id/type descriptors) so a blocking
      // human-verification (or other unmet exit gate) state is visible directly on
      // StepContext, matching the requirement that both `step start` and a `step finish`
      // attempt report the same blocking state (D9 clarification).
      gates: exitGateResults,
    },
    nextStepGuidance: step.transitions[0] ? { onSuccess: step.transitions[0].to } : null,
  };
}
