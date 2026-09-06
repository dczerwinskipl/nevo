import type { AgentSessionStatus, CanonicalTurn, SessionReadiness } from '../types.ts';

function latestTurn(turns: CanonicalTurn[]): CanonicalTurn | null {
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/**
 * Applies one `turn.updated` SSE event to the current turns list — an identity-keyed
 * full-snapshot replace (append if unseen), never a delta merge.
 */
export function applyTurnUpdated(turns: CanonicalTurn[], updatedTurn: CanonicalTurn): CanonicalTurn[] {
  const idx = turns.findIndex((t) => t.id === updatedTurn.id);
  if (idx === -1) return [...turns, updatedTurn];
  if (turns[idx] === updatedTurn) return turns;
  const next = [...turns];
  next[idx] = updatedTurn;
  return next;
}

/**
 * Session-level activity, derived only from the latest Turn's own canonical `status`
 * field — never inferred from event absence or elapsed time.
 */
export function deriveActivity(turns: CanonicalTurn[]): AgentSessionStatus {
  const turn = latestTurn(turns);
  if (!turn || !turn.status || turn.status.status === 'terminal') return 'idle';
  if (turn.status.status === 'requiresAttention') return 'waitingForUser';
  return 'running';
}

/**
 * Checks whether a normal new turn may be started.
 * A new turn may only be started when the session readiness is 'ready'.
 */
export function canStartTurn(
  readiness?: SessionReadiness | null,
  provider?: string,
  providerSessionId?: string,
  messageText?: string,
): boolean {
  if (messageText !== undefined && !messageText.trim()) return false;
  if (provider !== undefined && !provider) return false;
  if (providerSessionId !== undefined && !providerSessionId) return false;
  if (!readiness) return false;
  return readiness.status === 'ready';
}

/**
 * Checks whether a turn error should be surfaced to the user as an error toast.
 * Intentional user cancellations (AI_TURN_CANCELLED) are quiet terminations.
 */
export function shouldSurfaceTurnError(error?: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'AI_TURN_CANCELLED') return false;
  return true;
}

/**
 * Checks whether an error during cancellation should be surfaced.
 * If the turn already reached a terminal state, cancel errors are suppressed.
 */
export function shouldSurfaceCancelError(turnId: string, terminalTurnIds: Set<string>): boolean {
  return !terminalTurnIds.has(turnId);
}

