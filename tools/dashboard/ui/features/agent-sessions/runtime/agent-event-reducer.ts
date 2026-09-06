import type { AgentSessionStatus, CanonicalTurn, SessionReadiness } from '../types.ts';
import { createTurnIdempotencyKey } from './idempotency-key.ts';

export { createTurnIdempotencyKey };

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
 * Derives canonical session readiness reactively from base session health,
 * current canonical turns, and optimistic send state.
 *
 * Precedence:
 * 1. Static base health (`unavailable` on corrupt persistence, `readOnly` on disabled provider)
 * 2. Optimistic send in progress (`busy`, `turn_in_progress`)
 * 3. Latest turn requiring attention (`requiresAttention`, `question_required` | `permission_required`)
 * 4. Latest turn active (`busy`, `turn_in_progress`)
 * 5. Idle / all turns terminal (`ready`, `idle`)
 */
export function deriveSessionReadiness(
  baseReadiness: SessionReadiness | null | undefined,
  turns: CanonicalTurn[],
  optimisticPending = false,
): SessionReadiness {
  if (baseReadiness?.status === 'unavailable' || baseReadiness?.status === 'readOnly') {
    return baseReadiness;
  }

  if (optimisticPending) {
    return {
      status: 'busy',
      reason: 'turn_in_progress',
    };
  }

  const turn = latestTurn(turns);
  if (!turn || !turn.status || turn.status.status === 'terminal') {
    return {
      status: 'ready',
      reason: 'idle',
    };
  }

  if (turn.status.status === 'requiresAttention') {
    const interactionWork = turn.work?.find(
      (w): w is Extract<typeof w, { type: 'interaction' }> => w.type === 'interaction' && w.status === 'pending',
    );
    const anyTurn = turn as unknown as { pendingInteraction?: { id?: string; kind?: string } };
    const interaction = anyTurn.pendingInteraction || interactionWork?.interaction;
    const isQuestion =
      turn.status.reason === 'question' || interaction?.kind === 'question';
    return {
      status: 'requiresAttention',
      reason: isQuestion ? 'question_required' : 'permission_required',
      details: {
        interactionId: turn.status.interactionId || interaction?.id,
        kind: interaction?.kind || (isQuestion ? 'question' : 'permission'),
      },
    };
  }

  return {
    status: 'busy',
    reason: 'turn_in_progress',
    details: { turnId: turn.id },
  };
}

/**
 * Checks whether a normal new turn may be started.
 * A new turn may only be started when the session readiness is 'ready'.
 */
export function canStartTurn(
  readinessOrActivity?: SessionReadiness | AgentSessionStatus | null,
  provider?: string,
  providerSessionId?: string,
  messageText?: string,
): boolean {
  if (messageText !== undefined && !messageText.trim()) return false;
  if (provider !== undefined && !provider) return false;
  if (providerSessionId !== undefined && !providerSessionId) return false;
  if (!readinessOrActivity) return false;
  if (typeof readinessOrActivity === 'string') {
    return readinessOrActivity === 'idle';
  }
  return readinessOrActivity.status === 'ready';
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
 * Resolves authoritative session activity from a snapshot.
 */
export function resolveSnapshotActivity(
  snapshot: { status?: AgentSessionStatus; pendingInteraction?: unknown; activeTurn?: unknown },
): AgentSessionStatus {
  if (snapshot.status === 'running' || snapshot.status === 'waitingForUser' || snapshot.status === 'idle') {
    return snapshot.status;
  }
  if (snapshot.pendingInteraction) return 'waitingForUser';
  if (snapshot.activeTurn) return 'running';
  return 'idle';
}

/**
 * Checks whether an error during cancellation should be surfaced.
 * If the turn already reached a terminal state, cancel errors are suppressed.
 */
export function shouldSurfaceCancelError(turnId: string, terminalTurnIds: Set<string>): boolean {
  return !terminalTurnIds.has(turnId);
}

