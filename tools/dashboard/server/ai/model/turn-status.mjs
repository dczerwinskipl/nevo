import { AiValidationError, normalizeTimestamp } from '../contracts.mjs';

export const TURN_STATUSES = Object.freeze([
  'active',
  'waiting',
  'requiresAttention',
  'cancelling',
  'terminal',
  'unknown',
]);

export const ACTIVE_DETAILS = Object.freeze(['startup', 'processing', 'commentary', 'reasoning', 'tool_execution']);

export const WAITING_REASONS = Object.freeze(['provider_response', 'tool_result']);

export const ATTENTION_REASONS = Object.freeze(['permission', 'question', 'confirmation']);

export const TERMINAL_OUTCOMES = Object.freeze(['completed', 'failed', 'cancelled', 'interrupted']);

export const TERMINAL_INITIATORS = Object.freeze(['user', 'provider', 'runtime', 'system', 'shutdown', 'restart']);

export const CANCELLING_INITIATORS = Object.freeze(['user', 'runtime', 'system', 'shutdown']);

export const MAPPING_CONFIDENCES = Object.freeze(['authoritative', 'derived', 'unknown']);

function requiredString(value, field, max = 256) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  return value.trim();
}

function optionalString(value, field, max = 512) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new AiValidationError(`'${field}' must be a string of at most ${max} characters.`, { field });
  }
  return value;
}

export function validateTurnStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('TurnStatus must be an object.');
  }

  if (!TURN_STATUSES.includes(value.status)) {
    throw new AiValidationError(`TurnStatus 'status' must be one of: ${TURN_STATUSES.join(', ')}.`, {
      field: 'status',
      value: value.status,
    });
  }

  const since = normalizeTimestamp(value.since ?? new Date().toISOString(), 'since');
  const source = requiredString(value.source ?? 'coordinator', 'source', 100);

  switch (value.status) {
    case 'active': {
      const detail = value.detail !== undefined ? requiredString(value.detail, 'status.detail', 100) : 'processing';
      return {
        status: 'active',
        detail,
        ...(value.subjectId ? { subjectId: requiredString(value.subjectId, 'status.subjectId') } : {}),
        since,
        source,
      };
    }

    case 'waiting': {
      const reason = requiredString(value.reason ?? 'provider_response', 'status.reason', 100);
      return {
        status: 'waiting',
        reason,
        ...(value.subjectId ? { subjectId: requiredString(value.subjectId, 'status.subjectId') } : {}),
        since,
        source,
      };
    }

    case 'requiresAttention': {
      const reason = requiredString(value.reason, 'status.reason', 100);
      const interactionId = requiredString(value.interactionId, 'status.interactionId');
      return {
        status: 'requiresAttention',
        reason,
        interactionId,
        since,
        source,
      };
    }

    case 'cancelling': {
      const initiator = requiredString(value.initiator ?? 'user', 'status.initiator', 100);
      const requestedAt = normalizeTimestamp(value.requestedAt ?? since, 'status.requestedAt');
      return {
        status: 'cancelling',
        initiator,
        requestedAt,
        since,
        source,
      };
    }

    case 'terminal': {
      if (!TERMINAL_OUTCOMES.includes(value.outcome)) {
        throw new AiValidationError(`Terminal TurnStatus 'outcome' must be one of: ${TERMINAL_OUTCOMES.join(', ')}.`, {
          field: 'status.outcome',
          value: value.outcome,
        });
      }
      const initiator = requiredString(value.initiator ?? 'provider', 'status.initiator', 100);
      return {
        status: 'terminal',
        outcome: value.outcome,
        initiator,
        ...(value.cause ? { cause: requiredString(value.cause, 'status.cause', 200) } : {}),
        ...(value.finishReason ? { finishReason: optionalString(value.finishReason, 'status.finishReason', 100) } : {}),
        ...(value.error
          ? {
              error: {
                code: requiredString(value.error.code, 'status.error.code', 100),
                message: requiredString(value.error.message, 'status.error.message', 2000),
              },
            }
          : {}),
        since,
        source,
      };
    }

    case 'unknown': {
      return {
        status: 'unknown',
        reason: requiredString(value.reason ?? 'unproven_state', 'status.reason', 200),
        since,
        source,
      };
    }

    default:
      throw new AiValidationError(`Unknown TurnStatus '${value.status}'.`, { field: 'status' });
  }
}

export function createTurnStatus(status, details = {}) {
  return validateTurnStatus({
    status,
    since: new Date().toISOString(),
    source: 'coordinator',
    ...details,
  });
}
