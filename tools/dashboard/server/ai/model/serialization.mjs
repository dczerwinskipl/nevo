import { AiValidationError } from '../contracts.mjs';
import { validateCanonicalTurn, computeCurrentActivity } from './canonical-turn.mjs';

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

// NEvo's own initial-dispatch context-injection marker (see
// ui/features/agent-sessions/create-agent-session-helpers.ts#initialPromptWithTaskContext),
// recognized only as a one-time migration compatibility shim below — not general command
// or provider-text parsing.
const LEGACY_NEVO_CONTEXT_HEADER = /^(\[NEvo Context:|Context: tasks )/;

/**
 * One-time backward-compatibility fallback for Turns persisted before the canonical
 * `userMessage` field existed (they only carry the historical `prompt`, which may embed
 * NEvo's own injected task/spec context header). Strips that known, NEvo-authored marker
 * block so legacy turns still render a clean user-visible message; turns created after
 * this fix always carry an explicit `userMessage` and never reach this path.
 */
export function deriveLegacyUserMessageText(prompt) {
  if (typeof prompt !== 'string') return '';
  if (!LEGACY_NEVO_CONTEXT_HEADER.test(prompt)) return prompt;
  const separatorIndex = prompt.indexOf('\n\n');
  return separatorIndex === -1 ? prompt : prompt.slice(separatorIndex + 2);
}

export function serializePublicTurn(turn) {
  const validated = validateCanonicalTurn(turn);
  const clean = stripProviderPrivateFields(validated);
  const currentActivity = computeCurrentActivity(turn);
  const userMessage =
    clean.userMessage ||
    (clean.prompt ? { text: deriveLegacyUserMessageText(clean.prompt), createdAt: clean.createdAt } : undefined);

  // Exclude active/streaming work items from compact historical timeline so UI never duplicates current activity
  const activeSubjectIds = new Set(currentActivity?.subjectId ? [currentActivity.subjectId] : []);
  const historicalWork = clean.work.filter(
    (w) => !activeSubjectIds.has(w.id) && w.status !== 'streaming' && w.status !== 'active' && w.status !== 'queued',
  );

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
    historicalWork,
    activityCount: clean.activityCount,
    currentActivity,
    finalAnswer: clean.finalAnswer,
    // The user-visible chat message (never the enriched/private `prompt`) — the sole
    // authoritative source for rendering the turn's chat bubble, live or reloaded.
    ...(userMessage ? { userMessage } : {}),
    ...(clean.terminalOutcome ? { terminalOutcome: clean.terminalOutcome } : {}),
    ...(clean.usage ? { usage: clean.usage } : {}),
    createdAt: clean.createdAt,
    updatedAt: clean.updatedAt,
    ...(clean.completedAt ? { completedAt: clean.completedAt } : {}),
  };
}
