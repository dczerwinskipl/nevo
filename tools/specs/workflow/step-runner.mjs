// Declarative step lifecycle evaluation — resolves the current step for a task's
// workflow state, and evaluates a step's gates. Action evaluation is not duplicated
// here: `WorkflowEngine.checkStep`/`executeStep` (Task 03) already aggregates actions
// correctly and is reused as-is by `step-context.mjs`/`finish-operation.mjs`.

import { defaultGateRegistry } from './registry.mjs';
import { WorkflowError } from './errors.mjs';

/**
 * Every step's one transition target (D27) that does *not* name another declared step —
 * i.e. every value this definition can legitimately write as a terminal task `status`
 * (D19 refined: each such value is already guaranteed, by schema validation, to be a
 * member of `TERMINAL_STATUSES`). Reused by resolution (below) and by the durable finish
 * operation to classify a transition as step-internal vs. terminal.
 *
 * @param {object} definition - Normalized workflow definition
 * @returns {Set<string>}
 */
export function collectTerminalTargets(definition) {
  const stepNames = new Set(Object.keys(definition?.steps || {}));
  const terminals = new Set();
  for (const step of Object.values(definition?.steps || {})) {
    const to = step.transitions?.[0]?.to;
    if (to && !stepNames.has(to)) terminals.add(to);
  }
  return terminals;
}

/**
 * Resolves the name of the current step for a task within a normalized, multi-step
 * workflow definition (`definitions/schema.mjs`'s `normalizeWorkflowDefinition` output),
 * per the explicit, ordered precedence D28 establishes:
 *
 * 1. If `task.status` already equals one of this definition's valid terminal transition
 *    targets (`collectTerminalTargets`), the workflow is complete — returns `null`. This
 *    is checked *before* `workflow_progress` is even consulted, so a task whose finish
 *    already reached a terminal status can never be mistaken for one that never started
 *    (`workflow_progress.current_step` is deliberately never cleared at completion — see
 *    D28 — so trusting it first would otherwise re-resolve a *stale*, no-longer-relevant
 *    step name here).
 * 2. Else, if `task.workflow_progress.current_step` names a real declared step, use it —
 *    an in-flight, not-yet-terminal task's own persisted position is authoritative.
 * 3. Else, resolve the definition's `entryStep` (D27) — a task that has never advanced
 *    within this workflow at all.
 *
 * @param {object} definition - Normalized workflow definition
 * @param {{status: string, workflow_progress?: {current_step?: string}}} task - The task
 *   whose current step is being resolved
 * @returns {string|null} The current step name, or `null` if the task has already
 *   reached a terminal transition target
 */
export function resolveCurrentStepName(definition, task) {
  const stepEntries = Object.entries(definition?.steps || {});
  if (stepEntries.length === 0) {
    throw new WorkflowError(`Workflow definition '${definition?.id}' has no steps`);
  }

  const terminalTargets = collectTerminalTargets(definition);
  if (terminalTargets.has(task?.status)) {
    return null;
  }

  const currentStep = task?.workflow_progress?.current_step;
  if (currentStep) {
    if (!Object.prototype.hasOwnProperty.call(definition.steps, currentStep)) {
      throw new WorkflowError(
        `Task's workflow_progress.current_step '${currentStep}' does not name a step declared in ` +
        `workflow definition '${definition?.id}'`
      );
    }
    return currentStep;
  }

  return definition.entryStep || stepEntries[0][0];
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
