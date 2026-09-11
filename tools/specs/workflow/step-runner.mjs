// Declarative step lifecycle evaluation — resolves the current step for a task's
// workflow state, and evaluates a step's gates. Action evaluation is not duplicated
// here: `WorkflowEngine.checkStep`/`executeStep` (Task 03) already aggregates actions
// correctly and is reused as-is by `step-context.mjs`/`finish-operation.mjs`.

import { defaultGateRegistry } from './registry.mjs';
import { WorkflowError } from './errors.mjs';

/**
 * Resolves a task's exact position within a normalized, multi-step workflow definition
 * (D37) — a pure function of `(workflow_progress, definition)` alone. `task.status` is
 * never consulted (this corrects D28's original `task.status`-first precedence, which
 * existed only because `workflow_progress.current_step` alone couldn't distinguish "just
 * finished, about to advance" from "fresh" — the explicit `state` field below removes
 * that ambiguity structurally):
 *
 * - No `workflow_progress` at all → `{ phase: 'new' }` — the task has never touched this
 *   workflow; `workflow step start` resolves the definition's `entryStep` (D27).
 * - `state: 'active'` → `{ phase: 'active', step }` — `current_step` is in progress; not
 *   yet finished.
 * - `state: 'completed'` and the step's one transition (D27) names another declared step
 *   → `{ phase: 'completed', step, nextStep }` — `current_step`'s work is done, awaiting
 *   the *next* `workflow step start` call to activate `nextStep`.
 * - `state: 'completed'` and the step's one transition names no declared step (terminal,
 *   D19 refined) → `{ phase: 'terminal', step }` — the workflow is complete.
 *
 * `workflow_progress` is never cleared at terminal completion (D28) — `current_step`
 * keeps naming the final completed step, which is exactly what the `terminal` phase
 * above still reports.
 *
 * **Fail-closed on `state` (D37 correction):** the only two valid persisted values are
 * exactly `'active'` and `'completed'`. Anything else — missing, misspelled, or any
 * other value — is never silently treated as `'active'`; it throws. Repository-wide
 * `node tools/specs.mjs validate` already rejects a malformed `state` at the manifest
 * level (`tools/specs/validation.mjs`), but this runtime path must not depend on that
 * having already run — a hand-edited or corrupted `change.yaml` must fail closed here
 * too, the moment any workflow command actually resolves this task's position.
 *
 * @param {object} definition - Normalized workflow definition
 * @param {{workflow_progress?: {current_step?: string, state?: 'active'|'completed'}}} task
 * @returns {{phase: 'new'} | {phase: 'active', step: string} | {phase: 'completed', step: string, nextStep: string} | {phase: 'terminal', step: string}}
 * @throws {WorkflowError} if `current_step` is set but `state` is neither `'active'` nor `'completed'`
 */
export function resolveWorkflowPosition(definition, task) {
  const stepEntries = Object.entries(definition?.steps || {});
  if (stepEntries.length === 0) {
    throw new WorkflowError(`Workflow definition '${definition?.id}' has no steps`);
  }

  const currentStep = task?.workflow_progress?.current_step;
  if (!currentStep) {
    return { phase: 'new' };
  }

  if (!Object.prototype.hasOwnProperty.call(definition.steps, currentStep)) {
    throw new WorkflowError(
      `Task's workflow_progress.current_step '${currentStep}' does not name a step declared in ` +
      `workflow definition '${definition?.id}'`
    );
  }

  const state = task.workflow_progress.state;
  if (state === 'active') {
    return { phase: 'active', step: currentStep };
  }
  if (state !== 'completed') {
    throw new WorkflowError(
      `Task's workflow_progress.state must be 'active' or 'completed' for step '${currentStep}', got ${JSON.stringify(state)}`,
      { code: 'INVALID_WORKFLOW_PROGRESS_STATE', step: currentStep, state }
    );
  }

  const step = definition.steps[currentStep];
  const to = step.transitions[0].to; // exactly one, guaranteed by D27 schema validation
  const isInternalTransition = Object.prototype.hasOwnProperty.call(definition.steps, to);
  return isInternalTransition
    ? { phase: 'completed', step: currentStep, nextStep: to }
    : { phase: 'terminal', step: currentStep };
}

/**
 * The semantic status D37's four-case model resolves to — always derived, never a
 * separately persisted third field: `new` when the task has never touched this
 * workflow, else the current step's own declared `status.active`/`status.completed`
 * (`definitions/schema.mjs`'s required per-step `status` field), chosen by runtime
 * `state`.
 *
 * @param {object} definition - Normalized workflow definition
 * @param {object} task
 * @returns {string}
 */
export function resolveSemanticStatus(definition, task) {
  const position = resolveWorkflowPosition(definition, task);
  if (position.phase === 'new') return 'new';
  const step = definition.steps[position.step];
  return position.phase === 'active' ? step.status.active : step.status.completed;
}

/**
 * The step currently being worked on, if any — `null` when there is nothing active
 * (task never started, its current step already finished and is awaiting the next
 * `step start`, or the workflow is fully complete). Used by callers that only care
 * "is there an active step right now" (`finish`'s own resolution, the operator-facing
 * `verify-human` command) — never `resolveWorkflowPosition`'s richer phase distinction,
 * which those callers don't need.
 *
 * @param {object} definition - Normalized workflow definition
 * @param {object} task
 * @returns {string|null}
 */
export function resolveActiveStepName(definition, task) {
  const position = resolveWorkflowPosition(definition, task);
  return position.phase === 'active' ? position.step : null;
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
