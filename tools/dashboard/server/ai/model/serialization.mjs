import { AiValidationError } from '../contracts.mjs';
import { validateCanonicalTurn } from './canonical-turn.mjs';

const PRIVATE_KEY_PATTERN = /provider.*(?:request|event|payload).*id|providerRequestId|rawPayload/i;

export function stripProviderPrivateFields(value) {
  if (value == null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(stripProviderPrivateFields);
  }

  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (PRIVATE_KEY_PATTERN.test(key)) {
      continue;
    }
    clean[key] = stripProviderPrivateFields(val);
  }
  return clean;
}

export function serializePublicTurn(turn) {
  const validated = validateCanonicalTurn(turn);
  const clean = stripProviderPrivateFields(validated);

  // Return strictly validated public turn DTO
  return {
    id: clean.id,
    turnId: clean.turnId,
    sessionId: clean.sessionId,
    provider: clean.provider,
    providerSessionId: clean.providerSessionId,
    mode: clean.mode,
    status: clean.status,
    work: clean.work,
    activityCount: clean.activityCount,
    finalAnswer: clean.finalAnswer,
    ...(clean.terminalOutcome ? { terminalOutcome: clean.terminalOutcome } : {}),
    ...(clean.usage ? { usage: clean.usage } : {}),
    createdAt: clean.createdAt,
    updatedAt: clean.updatedAt,
    ...(clean.completedAt ? { completedAt: clean.completedAt } : {}),
  };
}
