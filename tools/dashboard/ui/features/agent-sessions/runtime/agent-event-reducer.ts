import type {
  AgentEvent,
  AgentSessionSnapshot,
  AgentSessionStatus,
  NormalizedMessage,
} from '../types.ts';

export function createTurnIdempotencyKey(prefix = 'turn'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Finds this event's owning assistant message.
 *
 * Priority (owner-decisions.md D7):
 *  1. Explicit `messageId` — when the provider sends a distinct `messageId`, that
 *     identity is preserved so message-A and message-B within the same turn stay
 *     separate `NormalizedMessage` records.
 *  2. `turnId` fallback — for events that carry a `turnId` but no explicit `messageId`
 *     (e.g. `tool.started`/`tool.completed`, which must attach to the existing turn
 *     message regardless of which prose message owns the turn).
 *
 * Work de-duplication is NOT done here — the projection layer (`chat-projection.ts`)
 * aggregates all messages sharing a `turnId` into exactly one `TurnWork`.
 *
 * Returns the existing message index, or -1 if no message exists yet for this event.
 */
function findAssistantMessageIndex(messages: NormalizedMessage[], event: Pick<AgentEvent, 'turnId' | 'messageId'>): number {
  // Explicit messageId takes priority — preserves distinct message identity within a turn.
  // If the event carries an explicit messageId but it isn't in the list yet, return -1
  // to create a new message with that ID (do NOT fall through to the turnId fallback,
  // which would merge two distinct messages sharing only a turnId).
  if (event.messageId) {
    return messages.findIndex((m) => m.id === event.messageId);
  }
  // turnId fallback — tool events carry turnId but no messageId; they must land in the
  // existing assistant message for that turn, whichever message currently owns it.
  if (event.turnId) {
    return messages.findIndex((m) => m.role === 'assistant' && m.turnId === event.turnId);
  }
  return -1;
}

function canonicalAssistantMessageId(event: Pick<AgentEvent, 'turnId' | 'messageId'>): string {
  // Prefer the explicit messageId the provider assigned; fall back to a turnId-derived
  // synthetic ID for events that carry only a turnId (tool events, reasoning without
  // an explicit messageId, etc.).
  if (event.messageId) return event.messageId;
  if (event.turnId) return `msg-${event.turnId}`;
  return 'msg-current';
}

export function applyAgentEvent(
  prevMessages: NormalizedMessage[],
  event: AgentEvent,
): NormalizedMessage[] {
  switch (event.type) {
    case 'turn.started': {
      const userText = event.userMessage?.text || event.userPrompt;
      if (userText && typeof userText === 'string') {
        const alreadyHasUserMsg = prevMessages.some((m) => m.role === 'user' && m.text === userText);
        if (!alreadyHasUserMsg) {
          return [
            ...prevMessages,
            {
              id: event.userMessage?.id || `user-${event.turnId || Date.now()}`,
              role: 'user',
              text: userText,
              createdAt: event.userMessage?.createdAt || event.timestamp || new Date().toISOString(),
            },
          ];
        }
      }
      return prevMessages;
    }

    case 'text.delta': {
      const text = event.text ?? event.delta ?? '';
      const existingIdx = findAssistantMessageIndex(prevMessages, event);
      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        updated[existingIdx] = {
          ...updated[existingIdx],
          text: updated[existingIdx].text + text,
        };
        return updated;
      }
      return [
        ...prevMessages,
        {
          id: canonicalAssistantMessageId(event),
          role: 'assistant',
          text,
          turnId: event.turnId,
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'reasoning.delta': {
      const reasoning = event.text ?? '';
      const existingIdx = findAssistantMessageIndex(prevMessages, event);
      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        updated[existingIdx] = {
          ...updated[existingIdx],
          reasoning: (updated[existingIdx].reasoning || '') + reasoning,
        };
        return updated;
      }
      return [
        ...prevMessages,
        {
          id: canonicalAssistantMessageId(event),
          role: 'assistant',
          text: '',
          reasoning,
          turnId: event.turnId,
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'progress.delta':
      // Progress is intentionally not projected into the main assistant transcript.
      // Dedicated activity surfaces can consume the normalized event stream directly.
      return prevMessages;

    case 'tool.started': {
      const toolCall = {
        id: event.toolId || `tool-${Date.now()}`,
        name: event.toolName || 'tool',
        input: event.input,
        status: 'running' as const,
      };
      const existingIdx = findAssistantMessageIndex(prevMessages, event);
      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        const calls = [...(updated[existingIdx].toolCalls || []), toolCall];
        updated[existingIdx] = { ...updated[existingIdx], toolCalls: calls };
        return updated;
      }
      return [
        ...prevMessages,
        {
          id: canonicalAssistantMessageId(event),
          role: 'assistant',
          text: '',
          toolCalls: [toolCall],
          turnId: event.turnId,
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'tool.updated': {
      let targetIdx = findAssistantMessageIndex(prevMessages, event);
      if (targetIdx === -1 && event.toolId) {
        targetIdx = prevMessages.findIndex((m) => m.toolCalls?.some((tc) => tc.id === event.toolId));
      }
      if (targetIdx >= 0) {
        const updated = [...prevMessages];
        const calls = (updated[targetIdx].toolCalls || []).map((tc) =>
          tc.id === event.toolId
            ? {
                ...tc,
                input: event.input ?? tc.input,
                output: event.output ?? tc.output,
                status: (event.status === 'completed' || event.status === 'failed' || event.status === 'running')
                  ? event.status
                  : tc.status,
              }
            : tc
        );
        updated[targetIdx] = { ...updated[targetIdx], toolCalls: calls };
        return updated;
      }
      return prevMessages;
    }

    case 'tool.completed': {
      let targetIdx = findAssistantMessageIndex(prevMessages, event);
      if (targetIdx === -1 && event.toolId) {
        targetIdx = prevMessages.findIndex((m) => m.toolCalls?.some((tc) => tc.id === event.toolId));
      }
      if (targetIdx >= 0) {
        const updated = [...prevMessages];
        const calls = (updated[targetIdx].toolCalls || []).map((tc) =>
          tc.id === event.toolId
            ? {
                ...tc,
                output: event.output ?? tc.output,
                // tool.completed always carries a validated 'completed' | 'failed'
                // status on the wire (owner-decisions.md D6) — never default a
                // missing/malformed status to success.
                status: (event.status as 'completed' | 'failed' | undefined) ?? 'failed',
                durationMs: event.durationMs ?? tc.durationMs,
              }
            : tc
        );
        updated[targetIdx] = { ...updated[targetIdx], toolCalls: calls };
        return updated;
      }
      return prevMessages;
    }

    case 'turn.completed':
    case 'turn.failed': {
      // A tool still 'running' when the turn ends never received a real successful
      // terminal signal — resolves to 'failed', regardless of how the turn itself
      // ended (owner-decisions.md D6), matching the backend's completeRunningToolCalls.
      // Scoped strictly to this event's own turnId — a terminal event for one turn must
      // never resolve a still-running tool belonging to a different turn.
      let updated = prevMessages.map((m) => {
        if (m.turnId !== event.turnId) return m;
        if (!m.toolCalls || !m.toolCalls.some((tc) => tc.status === 'running')) return m;
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'failed' as const } : tc)),
        };
      });

      if (event.type === 'turn.failed' && event.error) {
        const turnError = event.error;
        const existingIdx = findAssistantMessageIndex(updated, event);
        if (existingIdx >= 0) {
          updated = [...updated];
          updated[existingIdx] = { ...updated[existingIdx], turnError };
        } else {
          // The turn failed before any content/tool event created its message — reload-safe
          // home for the error still needs a message shell to attach to (owner-decisions.md D6/D9).
          updated = [
            ...updated,
            {
              id: canonicalAssistantMessageId(event),
              role: 'assistant',
              text: '',
              turnId: event.turnId,
              turnError,
              createdAt: event.timestamp || new Date().toISOString(),
            },
          ];
        }
      }

      return updated;
    }

    default:
      return prevMessages;
  }
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

export function shouldSurfaceCancelError(
  turnId: string,
  terminalTurnIds: Set<string>
): boolean {
  return !terminalTurnIds.has(turnId);
}

export function shouldSurfaceTurnError(
  error?: { code?: string; message?: string } | null
): boolean {
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
      errorData?.error?.message ||
      errorData?.message ||
      `Failed to cancel turn (${response.status || 'unknown'})`;
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
