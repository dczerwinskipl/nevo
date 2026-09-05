import type { StatusTone } from '@/shared/status-tone';
import type { CanonicalTurnV2, CurrentActivityKindV2, CurrentActivityV2, TurnStatusV2 } from '../types';

/**
 * Maps a CanonicalTurnV2 / TurnStatusV2 lifecycle state to the canonical StatusTone (D2).
 * Explicitly maps requiresAttention -> 'attention' (fixing the confirmed mis-mapping).
 */
export function turnStatusToneV2(status: TurnStatusV2): StatusTone {
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
 * Maps a CurrentActivityV2 (or display descriptor) to StatusTone.
 */
export function currentActivityToneV2(
  activity: CurrentActivityV2 | { kind: CurrentActivityKindV2 } | null,
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
 * Convenience helper to map an entire CanonicalTurnV2 to StatusTone.
 */
export function canonicalTurnToneV2(turn: CanonicalTurnV2): StatusTone {
  return turnStatusToneV2(turn.status);
}
