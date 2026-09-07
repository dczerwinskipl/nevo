import type { StatusTone } from '@/shared/status-tone';
import type { CanonicalTurn, CurrentActivity, CurrentActivityKind, TurnStatus } from '../types';

/**
 * Maps a CanonicalTurn / TurnStatus lifecycle state to the canonical StatusTone (D2).
 * Explicitly maps requiresAttention -> 'attention'.
 */
export function turnStatusTone(status: TurnStatus): StatusTone {
  if (status.status === 'requiresAttention') {
    return 'attention';
  }

  if (status.status === 'terminal') {
    switch (status.outcome) {
      case 'failed':
        return 'error';
      case 'completed':
        return 'success';
      case 'cancelled':
      case 'interrupted':
      default:
        return 'neutral';
    }
  }

  if (status.status === 'cancelling') {
    return 'neutral';
  }

  if (status.status === 'active' || status.status === 'waiting') {
    return 'active';
  }

  return 'neutral';
}

/**
 * Maps a CurrentActivity (or display descriptor) to StatusTone.
 */
export function currentActivityTone(
  activity: CurrentActivity | { kind: CurrentActivityKind } | null,
): StatusTone {
  if (!activity) return 'neutral';
  if (activity.kind === 'requires_attention') {
    return 'attention';
  }
  if (activity.kind === 'cancelling') {
    return 'neutral';
  }
  return 'active';
}

/**
 * Convenience helper to map an entire CanonicalTurn to StatusTone.
 */
export function canonicalTurnTone(turn: CanonicalTurn): StatusTone {
  return turnStatusTone(turn.status);
}
