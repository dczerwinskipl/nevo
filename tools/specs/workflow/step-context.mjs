// Compiles the agent-facing `StepContext` returned by `workflow step start` (D9/D10).
// Aggregates action/gate contracts already computed by `WorkflowEngine.checkStep`
// (Task 03) and `GateContract.inspect()` (Task 05) into one step-level payload —
// this module aggregates, it never re-implements, that underlying evaluation.

import { defaultWorkflowEngine } from './engine.mjs';
import { defaultActionRegistry } from './registry.mjs';
import { resolveCurrentStepName, inspectGates } from './step-runner.mjs';
import { WorkflowError } from './errors.mjs';

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
 * Compiles the full `StepContext` returned by `workflow step start` (D10): current step,
 * task/spec identity, workflow state, entry state/blockers, factual context (including
 * source-control context when enabled), the finish contract (`requiredInputs` aggregated
 * across finalize actions, plus the exit gates that must pass), and next-step guidance.
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
  const stepName = resolveCurrentStepName(definition, task);

  if (!stepName) {
    return {
      change: changeId,
      task: task.id,
      workflowMode: 'deterministic',
      currentStep: null,
      stepStatus: 'complete',
      entryState: { blockers: [] },
      context: {},
      finishContract: { requiredInputs: {}, gates: [] },
      nextStepGuidance: null,
    };
  }

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

  return {
    change: changeId,
    task: task.id,
    workflowMode: 'deterministic',
    currentStep: stepName,
    stepStatus: blockers.length ? 'blocked' : 'in-progress',
    entryState: { blockers },
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
