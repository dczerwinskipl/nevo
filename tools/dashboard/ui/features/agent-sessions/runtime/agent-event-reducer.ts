import type { AgentEvent, AgentSessionSnapshot, AgentSessionStatus } from '../types.ts';

export function createTurnIdempotencyKey(prefix = 'turn'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}


/**
 * Determines whether an incoming AgentEvent changes visible transcript content.
 * Used to increment contentRevision for useScrollFollow without triggering on
 * telemetry (usage.updated) or metadata-only events.
 */
export function eventModifiesTranscriptContent(event: AgentEvent): boolean {
  switch (event.type) {
    case 'text.delta':
      return Boolean(event.text || event.delta);
    case 'reasoning.delta':
      return Boolean(event.text);
    case 'tool.started':
    case 'tool.updated':
    case 'tool.completed':
      return true;
    case 'turn.started':
      return Boolean(event.userMessage?.text || event.userPrompt);
    case 'turn.completed':
    case 'turn.failed':
    case 'interaction.requested':
    case 'interaction.resolved':
      return true;
    default:
      return false;
  }
}

/**
 * Resolves authoritative session activity from a snapshot.
 */
export function resolveSnapshotActivity(
  snapshot: Pick<AgentSessionSnapshot, 'status' | 'pendingInteraction' | 'activeTurn'>,
): AgentSessionStatus {
  if (snapshot.status === 'running' || snapshot.status === 'waitingForUser' || snapshot.status === 'idle') {
    return snapshot.status;
  }
  if (snapshot.pendingInteraction) return 'waitingForUser';
  if (snapshot.activeTurn) return 'running';
  return 'idle';
}

/**
 * Checks whether a normal new turn may be started via composer.
 * A new turn may only be started when the session is completely 'idle'.
 */
export function canStartTurn(
  activity: AgentSessionStatus,
  provider?: string,
  providerSessionId?: string,
  messageText?: string,
): boolean {
  if (!messageText || !messageText.trim()) return false;
  if (activity !== 'idle') return false;
  if (!provider || !providerSessionId) return false;
  return true;
}

export interface ApplyCancelTurnResponseParams {
  turnId: string;
  response: { ok: boolean; status?: number };
  errorData?: { error?: { message?: string }; message?: string } | null;
  currentActiveTurnId: string | null;
  currentActivity: 'idle' | 'running' | 'waitingForUser';
  terminalTurnIds: Set<string>;
}

export interface ApplyCancelTurnResponseResult {
  nextActivity: 'idle' | 'running' | 'waitingForUser';
  nextActiveTurnId: string | null;
  terminalTurnIds: Set<string>;
  error?: Error;
}

export function shouldSurfaceCancelError(turnId: string, terminalTurnIds: Set<string>): boolean {
  return !terminalTurnIds.has(turnId);
}

export function shouldSurfaceTurnError(error?: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Explicit cancellation by user (Stop) is an intentional termination, not an unexpected error toast
  if (error.code === 'AI_TURN_CANCELLED') return false;
  return true;
}

export function applyCancelTurnResponse({
  turnId,
  response,
  errorData,
  currentActiveTurnId,
  currentActivity,
  terminalTurnIds,
}: ApplyCancelTurnResponseParams): ApplyCancelTurnResponseResult {
  // If the turn already became terminal (e.g. terminal SSE arrived while cancel was in flight),
  // suppress any stale cancel responses (HTTP 200, 409, 500, etc.) without surfacing errors
  // or resurrecting/altering state.
  if (!shouldSurfaceCancelError(turnId, terminalTurnIds)) {
    return {
      nextActivity: currentActivity,
      nextActiveTurnId: currentActiveTurnId,
      terminalTurnIds,
    };
  }

  if (!response.ok) {
    const message =
      errorData?.error?.message || errorData?.message || `Failed to cancel turn (${response.status || 'unknown'})`;
    return {
      nextActivity: currentActivity,
      nextActiveTurnId: currentActiveTurnId,
      terminalTurnIds,
      error: new Error(message),
    };
  }

  terminalTurnIds.add(turnId);

  // Race-safety check: If terminal SSE arrived before this POST response completed,
  // currentActiveTurnId was already cleared / transitioned to idle.
  if (currentActiveTurnId === turnId && currentActivity === 'running') {
    return {
      nextActivity: 'idle',
      nextActiveTurnId: null,
      terminalTurnIds,
    };
  }

  return {
    nextActivity: currentActivity,
    nextActiveTurnId: currentActiveTurnId,
    terminalTurnIds,
  };
}
