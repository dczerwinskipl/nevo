// Declarative step lifecycle evaluation — resolves the current step for a task's
// workflow state, and evaluates a step's gates. Action evaluation is not duplicated
// here: `WorkflowEngine.checkStep`/`executeStep` (Task 03) already aggregates actions
// correctly and is reused as-is by `step-context.mjs`/`finish-operation.mjs`.

import { defaultGateRegistry } from './registry.mjs';
import { WorkflowError } from './errors.mjs';

/**
 * Resolves the name of the current step for a task within a normalized workflow
 * definition (`definitions/schema.mjs`'s `normalizeWorkflowDefinition` output).
 *
 * This foundation's workflow definitions (`.nevo-ai/workflows/*.yaml`) declare exactly
 * one step; resolution is unambiguous by construction — a task not yet at that step's
 * own transition target is on that one step, and a task already at a transition target
 * has no further declared step. A future multi-step definition would extend this to
 * walk `transitions` against task state transitively; not needed for this foundation's
 * one proven vertical path (D7's remaining specification classes are out of scope here).
 *
 * @param {object} definition - Normalized workflow definition
 * @param {{status: string}} task - The task whose current step is being resolved
 * @returns {string|null} The current step name, or `null` if the task has already
 *   transitioned past every declared step
 */
export function resolveCurrentStepName(definition, task) {
  const stepEntries = Object.entries(definition?.steps || {});
  if (stepEntries.length === 0) {
    throw new WorkflowError(`Workflow definition '${definition?.id}' has no steps`);
  }
  const [firstStepName, firstStep] = stepEntries[0];
  const transitionTargets = new Set((firstStep.transitions || []).map(t => t.to));
  if (transitionTargets.has(task?.status)) {
    return null;
  }
  return firstStepName;
}

/** Deterministic, human-readable id for a gate config that has no explicit `id`. */
export function gateDisplayId(config) {
  if (config.id) return config.id;
  if (config.type === 'command') return config.action || config.command || 'command';
  if (config.type === 'human') return 'human-review';
  return config.type;
}

/**
 * Non-mutating inspection of every gate in a list — never `verify()`. Read-only calls
 * (StepContext compilation, finish planning) must never run verification commands
 * (C7/C8).
 *
 * @returns {Promise<Array<object>>} One `{ id, ...GateInspectionResult }` per gate
 */
export async function inspectGates(gateConfigs, context, { gateRegistry = defaultGateRegistry } = {}) {
  const results = [];
  for (const config of gateConfigs || []) {
    const gate = gateRegistry.require(config.type);
    const result = await gate.inspect(config, context);
    results.push({ id: gateDisplayId(config), ...result.toJSON() });
  }
  return results;
}

/** Explicit gate verification execution — only ever called from the mutating finish path. */
export async function verifyGates(gateConfigs, context, { gateRegistry = defaultGateRegistry } = {}) {
  const results = [];
  for (const config of gateConfigs || []) {
    const gate = gateRegistry.require(config.type);
    const result = await gate.verify(config, context);
    results.push({ id: gateDisplayId(config), ...result.toJSON() });
  }
  return results;
}

/** True only when every entry in an `inspectGates`/`verifyGates` result list passed. */
export function allGatesPassed(gateResults) {
  return (gateResults || []).every(g => g.status === 'passed');
}
