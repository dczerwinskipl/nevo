// Producer contract for human-verification exit gate confirmation activity:
// `human.verification.confirmed`.
//
// D10 / D12 / D19:
// - Deterministic IDs derived from stable identifiers:
//   `${HUMAN_VERIFICATION_CONFIRMED}:${specId}:${taskId}:${stepId}:${attempt}:${gateId || 'default'}`
// - Emitted exclusively from `workflow verify-human --confirm` in `tools/specs/workflow/cli.mjs`.
// - First-class human workflow steps (`executor: human`) never emit this event type.
// - Observational only: failures to record activity are wrapped and never fail or roll back
//   operator confirmation.

import { recordActivity, resolveSpecId } from '../store.mjs';
import { resolveUserActor } from '../actor-resolver.mjs';

export const HUMAN_VERIFICATION_CONFIRMED = 'human.verification.confirmed';

/**
 * Builds the deterministic ID for a `human.verification.confirmed` activity.
 *
 * @param {string} specId
 * @param {string} taskId
 * @param {string} stepId
 * @param {number} attempt
 * @param {string|null} [gateId]
 * @returns {string}
 */
export function humanVerificationConfirmedActivityId(specId, taskId, stepId, attempt, gateId) {
  const effectiveGateId = gateId || 'default';
  return `${HUMAN_VERIFICATION_CONFIRMED}:${specId}:${taskId}:${stepId}:${attempt}:${effectiveGateId}`;
}

/**
 * Validates the `data` payload for a `human.verification.confirmed` activity.
 *
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateHumanVerificationConfirmedData(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ field: 'data', message: 'Human verification confirmed data must be a plain object' });
    return { valid: false, errors };
  }

  if (typeof data.scope !== 'string' || !data.scope.trim()) {
    errors.push({ field: 'data.scope', message: 'Field scope must be a non-empty string' });
  }

  if (typeof data.targetId !== 'string' || !data.targetId.trim()) {
    errors.push({ field: 'data.targetId', message: 'Field targetId must be a non-empty string' });
  }

  if (typeof data.role !== 'string' || !data.role.trim()) {
    errors.push({ field: 'data.role', message: 'Field role must be a non-empty string' });
  }

  if (data.stepId !== undefined && data.stepId !== null && (typeof data.stepId !== 'string' || !data.stepId.trim())) {
    errors.push({ field: 'data.stepId', message: 'Field stepId, when present, must be a non-empty string or null' });
  }

  if (!Number.isInteger(data.attempt) || data.attempt < 1) {
    errors.push({ field: 'data.attempt', message: 'Field attempt must be a positive integer' });
  }

  if (data.gateId !== undefined && data.gateId !== null && (typeof data.gateId !== 'string' || !data.gateId.trim())) {
    errors.push({ field: 'data.gateId', message: 'Field gateId, when present, must be a non-empty string or null' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Emits a `human.verification.confirmed` activity.
 * Wrapped in try/catch so observational failures never block or throw.
 *
 * @param {object} params
 * @param {string|object} params.specId
 * @param {string} params.taskId
 * @param {string} params.stepId
 * @param {number} params.attempt
 * @param {string|null} [params.gateId]
 * @param {string} params.scope
 * @param {string} params.targetId
 * @param {string} params.role
 * @param {object} [params.actor]
 * @param {object} [params.initiatedBy]
 * @param {string} [params.triggeredBy]
 * @param {object} [options]
 * @returns {object|null}
 */
export function recordHumanVerificationConfirmed({
  specId,
  taskId,
  stepId,
  attempt,
  gateId,
  scope,
  targetId,
  role,
  actor,
  initiatedBy,
  triggeredBy,
}, options = {}) {
  try {
    const canonicalSpecId = resolveSpecId(specId, options);
    const resolvedActor = actor || resolveUserActor(options.repoRoot);
    const effectiveGateId = gateId || null;
    const id = humanVerificationConfirmedActivityId(canonicalSpecId, taskId, stepId, attempt, effectiveGateId);
    const data = {
      scope,
      targetId,
      role,
      stepId: stepId || null,
      attempt,
      gateId: effectiveGateId,
    };

    return recordActivity({
      id,
      type: HUMAN_VERIFICATION_CONFIRMED,
      actor: resolvedActor,
      scope: { specId: canonicalSpecId, taskId },
      data,
      ...(initiatedBy ? { initiatedBy } : {}),
      ...(triggeredBy ? { triggeredBy } : {}),
    }, options);
  } catch {
    return null;
  }
}
