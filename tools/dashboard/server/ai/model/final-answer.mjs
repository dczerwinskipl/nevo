import { AiValidationError, normalizeTimestamp } from '../contracts.mjs';

export const FINAL_ANSWER_STATUSES = Object.freeze([
  'pending',
  'streaming',
  'completed',
  'absent',
]);

function rejectProviderFields(value, path = 'finalAnswer') {
  for (const [key, child] of Object.entries(value || {})) {
    if (/provider.*(?:request|event|payload).*id|providerRequestId|rawPayload/i.test(key)) {
      throw new AiValidationError(`Provider-private field '${key}' is not allowed in FinalAnswer.`, { field: `${path}.${key}` });
    }
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      rejectProviderFields(child, `${path}.${key}`);
    }
  }
}

function requiredString(value, field, max = 256) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  return value.trim();
}

export function validateFinalAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('FinalAnswer must be an object.');
  }
  rejectProviderFields(value);

  const now = new Date().toISOString();
  const id = requiredString(value.id ?? 'final-answer', 'finalAnswer.id');
  const text = typeof value.text === 'string' ? value.text : '';
  const status = value.status ?? 'streaming';
  if (!FINAL_ANSWER_STATUSES.includes(status)) {
    throw new AiValidationError(
      `FinalAnswer 'status' must be one of: ${FINAL_ANSWER_STATUSES.join(', ')}.`,
      { field: 'finalAnswer.status', value: status },
    );
  }

  return {
    id,
    text,
    status,
    ...(value.confidence ? { confidence: value.confidence } : {}),
    createdAt: normalizeTimestamp(value.createdAt ?? now, 'finalAnswer.createdAt'),
    updatedAt: normalizeTimestamp(value.updatedAt ?? now, 'finalAnswer.updatedAt'),
    ...(value.completedAt ? { completedAt: normalizeTimestamp(value.completedAt, 'finalAnswer.completedAt') } : {}),
  };
}

export function createFinalAnswer({ id = 'final-answer', text = '', status = 'streaming', confidence } = {}) {
  return validateFinalAnswer({
    id,
    text,
    status,
    confidence,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
