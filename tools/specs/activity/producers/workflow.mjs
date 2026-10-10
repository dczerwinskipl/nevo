// Producer contract for workflow step lifecycle activities:
// `workflow.step.started` and `workflow.step.completed`.
//
// D10 / D15 / D17 / D18 / D19:
// - Deterministic IDs derived from stable identifiers `${type}:${specId}:${taskId}:${step}:${attempt}`.
// - Read-side deduplication in store.mjs collapses duplicate appends on read.
// - Observational only: failures to record activity are wrapped and never fail or roll back
//   workflow operations.

import { recordActivity, resolveSpecId } from '../store.mjs';
import { SYSTEM_ACTOR } from '../actor-resolver.mjs';

export const WORKFLOW_STEP_STARTED = 'workflow.step.started';
export const WORKFLOW_STEP_COMPLETED = 'workflow.step.completed';

/**
 * Builds the deterministic ID for a `workflow.step.started` activity.
 *
 * @param {string} specId
 * @param {string} taskId
 * @param {string} step
 * @param {number} attempt
 * @returns {string}
 */
export function stepStartedActivityId(specId, taskId, step, attempt) {
  return `${WORKFLOW_STEP_STARTED}:${specId}:${taskId}:${step}:${attempt}`;
}

/**
 * Builds the deterministic ID for a `workflow.step.completed` activity.
 *
 * @param {string} specId
 * @param {string} taskId
 * @param {string} step
 * @param {number} attempt
 * @returns {string}
 */
export function stepCompletedActivityId(specId, taskId, step, attempt) {
  return `${WORKFLOW_STEP_COMPLETED}:${specId}:${taskId}:${step}:${attempt}`;
}

/**
 * Validates the `data` payload for a `workflow.step.started` activity.
 *
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateStepStartedData(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ field: 'data', message: 'Step started data must be a plain object' });
    return { valid: false, errors };
  }

  if (typeof data.step !== 'string' || !data.step.trim()) {
    errors.push({ field: 'data.step', message: 'Field step must be a non-empty string' });
  }

  if (!Number.isInteger(data.attempt) || data.attempt < 1) {
    errors.push({ field: 'data.attempt', message: 'Field attempt must be a positive integer' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates the `data` payload for a `workflow.step.completed` activity.
 *
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateStepCompletedData(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ field: 'data', message: 'Step completed data must be a plain object' });
    return { valid: false, errors };
  }

  if (!Number.isInteger(data.attempt) || data.attempt < 1) {
    errors.push({ field: 'data.attempt', message: 'Field attempt must be a positive integer' });
  }

  if (data.step !== undefined && (typeof data.step !== 'string' || !data.step.trim())) {
    errors.push({ field: 'data.step', message: 'Field step, when present, must be a non-empty string' });
  }

  if (data.transitioned_to !== undefined && (typeof data.transitioned_to !== 'string' || !data.transitioned_to.trim())) {
    errors.push({ field: 'data.transitioned_to', message: 'Field transitioned_to, when present, must be a non-empty string' });
  }

  if (data.artifacts !== undefined && !Array.isArray(data.artifacts)) {
    errors.push({ field: 'data.artifacts', message: 'Field artifacts, when present, must be an array' });
  }

  if (data.feedback !== undefined && typeof data.feedback !== 'string') {
    errors.push({ field: 'data.feedback', message: 'Field feedback, when present, must be a string' });
  }

  if (data.findings !== undefined && !Array.isArray(data.findings)) {
    errors.push({ field: 'data.findings', message: 'Field findings, when present, must be an array' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Emits a `workflow.step.started` activity.
 * Wrapped in try/catch so observational failures never block or throw.
 *
 * @param {object} params
 * @param {string|object} params.specId
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @param {object} [params.actor]
 * @param {object} [params.initiatedBy]
 * @param {string} [params.triggeredBy]
 * @param {object} [options]
 * @returns {object|null}
 */
export function recordWorkflowStepStarted({ specId, taskId, step, attempt, actor, initiatedBy, triggeredBy }, options = {}) {
  try {
    const canonicalSpecId = resolveSpecId(specId, options);
    const data = { step, attempt };
    const id = stepStartedActivityId(canonicalSpecId, taskId, step, attempt);

    return recordActivity({
      id,
      type: WORKFLOW_STEP_STARTED,
      actor: actor || SYSTEM_ACTOR,
      scope: { specId: canonicalSpecId, taskId },
      data,
      ...(initiatedBy ? { initiatedBy } : {}),
      ...(triggeredBy ? { triggeredBy } : {}),
    }, options);
  } catch {
    return null;
  }
}

/**
 * Emits a `workflow.step.completed` activity built from a durable operation record.
 * Shared by the main call site in finishStep and both already-completed short-circuits (D15, D18).
 *
 * Actor attribution comes from `record.actor` (captured once at operation creation, D17),
 * never from any per-call parameter.
 *
 * @param {object} params
 * @param {string|object} [params.specId]
 * @param {string} [params.taskId]
 * @param {object} params.record - Operation record (durable or in-memory)
 * @param {object} [options]
 * @returns {object|null}
 */
export function recordWorkflowStepCompletedFromRecord({ specId, taskId, record }, options = {}) {
  if (!record) return null;
  try {
    const canonicalSpecId = resolveSpecId(specId || record.change, options);
    const effectiveTaskId = taskId || record.task;
    const step = record.step;
    const attempt = record.attempt;
    const actor = record.actor || SYSTEM_ACTOR;

    const updateTaskStage = record.operations?.find(o => o.id === 'update-task');
    const transitionedTo = updateTaskStage?.result?.toStep
      || updateTaskStage?.result?.toState
      || updateTaskStage?.intent?.transitioned_to
      || updateTaskStage?.intent?.terminalStatus;

    const resolvedInputs = record.resolvedInputs || {};
    const data = {
      attempt,
      ...(step ? { step } : {}),
      ...(resolvedInputs.result !== undefined ? { result: resolvedInputs.result } : {}),
      ...(transitionedTo !== undefined ? { transitioned_to: transitionedTo } : {}),
      ...(resolvedInputs.artifacts !== undefined ? { artifacts: resolvedInputs.artifacts } : {}),
      ...(resolvedInputs.feedback !== undefined ? { feedback: resolvedInputs.feedback } : {}),
      ...(resolvedInputs.findings !== undefined ? { findings: resolvedInputs.findings } : {}),
    };

    const id = stepCompletedActivityId(canonicalSpecId, effectiveTaskId, step, attempt);

    return recordActivity({
      id,
      type: WORKFLOW_STEP_COMPLETED,
      actor,
      scope: { specId: canonicalSpecId, taskId: effectiveTaskId },
      data,
    }, options);
  } catch {
    return null;
  }
}
