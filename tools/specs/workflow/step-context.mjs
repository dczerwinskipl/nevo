// Compiles the agent-facing `StepContext` returned by `workflow step start` (D9/D10).
// Aggregates action/gate contracts already computed by `WorkflowEngine.checkStep`
// (Task 03) and `GateContract.inspect()` (Task 05) into one step-level payload —
// this module aggregates, it never re-implements, that underlying evaluation.

import { defaultWorkflowEngine } from './engine.mjs';
import { defaultActionRegistry } from './registry.mjs';
import { resolveCurrentStepName, inspectGates } from './step-runner.mjs';
import { WorkflowError } from './errors.mjs';

// `.nevo-ai/workflows/standard.yaml`'s `finalize` list still declares `verify-task-output`
// (a placeholder from the original design), but only `commit-and-push` (Task 04) has a
// registered ActionContract implementation in this foundation — the remaining
// specification classes are out of scope here (D7). Aggregating `WorkflowEngine.checkStep`
// over the raw finalize list would hard-fail on the unregistered action id via
// `ActionRegistry.require`; filtering to already-registered actions before aggregating
// keeps the one proven vertical path working without inventing a placeholder action
// outside this task's `allowed_paths`. Documented here as a deliberate implementation
// decision, not silent scope creep.
function registeredFinalizeActions(finalize, actionRegistry) {
  return (finalize || []).filter(entry => {
    const id = typeof entry === 'string' ? entry : entry?.id;
    return actionRegistry.has(id);
  });
}

/**
 * Runs `WorkflowEngine.checkStep` over a step's *registered* finalize actions only.
 * Shared by `StepContext` compilation and finish planning (`finish-operation.mjs`) so
 * both compute the exact same aggregation via the exact same code path — never two
 * independently maintained implementations that could drift.
 *
 * @param {object} step - Normalized step definition (`{ finalize, ... }`)
 * @param {object} context - Runtime environmental context passed through to actions
 * @param {object} [options]
 * @param {import('./engine.mjs').WorkflowEngine} [options.engine]
 * @param {import('./registry.mjs').ActionRegistry} [options.actionRegistry]
 * @returns {Promise<{ step: string, ready: boolean, actions: Record<string, object> }>}
 */
export async function aggregateFinalizeCheck(step, context, { engine = defaultWorkflowEngine, actionRegistry = defaultActionRegistry } = {}) {
  const finalize = registeredFinalizeActions(step?.finalize, actionRegistry);
  return engine.checkStep({ name: 'finalize', actions: finalize }, context);
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
  const entryGateResults = await inspectGates(step.entryGates, context, { gateRegistry });
  const exitGateResults = await inspectGates(step.exitGates, context, { gateRegistry });
  const finalizeCheck = await aggregateFinalizeCheck(step, context, { engine, actionRegistry });
  const requiredInputs = buildFinishContract(finalizeCheck);
  const blockers = entryGateResults.filter(g => g.status !== 'passed');
  const sourceControlContext = finalizeCheck.actions['commit-and-push']?.context ?? null;

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
