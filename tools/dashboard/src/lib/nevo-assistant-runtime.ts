import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentExecutionMode,
  AgentSessionSnapshot,
  AiInteraction,
  AiSessionStatus,
  NormalizedMessage,
} from './types';

export interface UseNevoAssistantRuntimeOptions {
  provider: string;
  providerSessionId: string;
  onTurnCompleted?: () => void;
  onError?: (error: Error) => void;
}

export const SUPPORTED_AGENT_EVENT_TYPES = [
  'turn.started',
  'message.started',
  'text.delta',
  'progress.delta',
  'reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'interaction.requested',
  'interaction.resolved',
  'usage.updated',
  'turn.completed',
  'turn.failed',
] as const;

export type SupportedAgentEventType = (typeof SUPPORTED_AGENT_EVENT_TYPES)[number];

export interface AgentEventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (event: MessageEvent) => void): void;
  onmessage?: ((event: MessageEvent) => void) | null;
  close(): void;
}

/**
 * Subscribes to all supported named AgentEvent types as well as generic onmessage fallback.
 * Returns an unsubscribe / cleanup function.
 */
export function subscribeAgentEventSource(
  eventSource: AgentEventSourceLike,
  onEvent: (event: AgentEvent) => void,
): () => void {
  const handleRaw = (rawEvent: MessageEvent) => {
    try {
      const data = typeof rawEvent.data === 'string' ? JSON.parse(rawEvent.data) : rawEvent.data;
      if (data && typeof data === 'object' && typeof data.type === 'string') {
        onEvent(data as AgentEvent);
      }
    } catch (err) {
      console.warn('Failed to parse SSE agent event:', err);
    }
  };

  for (const type of SUPPORTED_AGENT_EVENT_TYPES) {
    eventSource.addEventListener(type, handleRaw);
  }
  eventSource.onmessage = handleRaw;

  return () => {
    for (const type of SUPPORTED_AGENT_EVENT_TYPES) {
      eventSource.removeEventListener?.(type, handleRaw);
    }
    if (eventSource.onmessage === handleRaw) {
      eventSource.onmessage = null;
    }
    eventSource.close();
  };
}

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
): AiSessionStatus {
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
  activity: AiSessionStatus,
  provider?: string,
  providerSessionId?: string,
  messageText?: string,
): boolean {
  if (!messageText || !messageText.trim()) return false;
  if (activity !== 'idle') return false;
  if (!provider || !providerSessionId) return false;
  return true;
}

export type AgentSessionLoadErrorKind = 'network' | 'not_found' | 'http';

export class AgentSessionLoadError extends Error {
  readonly kind: AgentSessionLoadErrorKind;
  readonly status?: number;
  readonly title: string;

  constructor(message: string, options: { kind: AgentSessionLoadErrorKind; status?: number; title: string }) {
    super(message);
    this.name = 'AgentSessionLoadError';
    this.kind = options.kind;
    this.status = options.status;
    this.title = options.title;
  }
}

export function classifySessionLoadError(
  err: unknown,
  provider?: string,
  sessionId?: string,
): AgentSessionLoadError {
  if (err instanceof AgentSessionLoadError) {
    return err;
  }

  if (
    err instanceof TypeError ||
    (err instanceof Error &&
      (err.name === 'FetchError' ||
        err.message.includes('fetch') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError')))
  ) {
    return new AgentSessionLoadError(
      'Nie udało się nawiązać połączenia z serwerem dashboardu. Upewnij się, że serwer NEvo jest uruchomiony.',
      {
        kind: 'network',
        title: 'Nie można połączyć z dashboardem',
      },
    );
  }

  if (err && typeof err === 'object' && 'status' in err && typeof (err as any).status === 'number') {
    const status = (err as any).status as number;
    const msg = (err as any).message || '';
    if (status === 404) {
      return new AgentSessionLoadError(
        msg || `Sesja ${sessionId || ''} dla providera ${provider || ''} nie została znaleziona lub jest niedostępna.`,
        {
          kind: 'not_found',
          status: 404,
          title: 'Sesja nie znaleziona',
        },
      );
    }
    return new AgentSessionLoadError(
      msg || `Serwer dashboardu zwrócił błąd HTTP ${status}.`,
      {
        kind: 'http',
        status,
        title: `Błąd serwera (${status})`,
      },
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('404')) {
    return new AgentSessionLoadError(
      `Sesja ${sessionId || ''} dla providera ${provider || ''} nie została znaleziona lub jest niedostępna.`,
      {
        kind: 'not_found',
        status: 404,
        title: 'Sesja nie znaleziona',
      },
    );
  }

  return new AgentSessionLoadError(
    message || 'Wystąpił nieoczekiwany błąd podczas wczytywania sesji.',
    {
      kind: 'http',
      title: 'Błąd wczytywania sesji',
    },
  );
}

export async function fetchAgentSessionSnapshot(
  provider: string,
  providerSessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<AgentSessionSnapshot> {
  let res: Response;
  try {
    res = await fetchFn(`/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}`);
  } catch (err) {
    throw classifySessionLoadError(err, provider, providerSessionId);
  }

  if (!res.ok) {
    let errorMsg = '';
    try {
      const errData = await res.json();
      errorMsg = errData?.error?.message || errData?.message || '';
    } catch {
      // ignore non-json response body
    }

    if (res.status === 404) {
      throw new AgentSessionLoadError(
        errorMsg || `Sesja "${providerSessionId}" dla providera "${provider}" nie została znaleziona lub została usunięta.`,
        {
          kind: 'not_found',
          status: 404,
          title: 'Sesja nie znaleziona',
        },
      );
    }

    throw new AgentSessionLoadError(
      errorMsg || `Serwer dashboardu zwrócił błąd: ${res.status} ${res.statusText}`,
      {
        kind: 'http',
        status: res.status,
        title: `Błąd serwera (${res.status})`,
      },
    );
  }

  const data = await res.json();
  return data.session as AgentSessionSnapshot;
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

export function useNevoAssistantRuntime({
  provider,
  providerSessionId,
  onTurnCompleted,
  onError,
}: UseNevoAssistantRuntimeOptions) {
  const currentIdentity = provider && providerSessionId ? `${provider}:${providerSessionId}` : '';
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [loadErrorIdentity, setLoadErrorIdentity] = useState<string | null>(null);

  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [pendingInteraction, setPendingInteraction] = useState<AiInteraction | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [activity, setActivity] = useState<AiSessionStatus>('idle');
  const [contentRevision, setContentRevision] = useState<number>(0);
  const [lastEventSeq, setLastEventSeq] = useState<number>(0);
  const [sessionDetails, setSessionDetails] = useState<AgentSessionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<AgentSessionLoadError | Error | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onTurnCompletedRef = useRef(onTurnCompleted);
  onTurnCompletedRef.current = onTurnCompleted;

  const lastSeqRef = useRef<number>(0);

  const activityRef = useRef<AiSessionStatus>('idle');
  activityRef.current = activity;

  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;

  const terminalTurnIdsRef = useRef<Set<string>>(new Set());

  // Identity match check: only expose state if it belongs to the current provider + providerSessionId
  const isSnapshotLoaded = Boolean(currentIdentity && loadedIdentity === currentIdentity);
  const isErrorForCurrentIdentity = Boolean(currentIdentity && loadErrorIdentity === currentIdentity);

  // Sync cursor ref with state
  lastSeqRef.current = isSnapshotLoaded ? lastEventSeq : 0;

  const reload = useCallback(async () => {
    setLoadError(null);
    setLoadErrorIdentity(null);
    setIsLoading(true);
    setReloadTrigger((n) => n + 1);
  }, []);

  // 1. Initial snapshot restoration
  useEffect(() => {
    let cancelled = false;
    async function loadSnapshot() {
      if (!provider || !providerSessionId) return;

      const identity = `${provider}:${providerSessionId}`;
      setIsLoading(true);
      setLoadError(null);
      setLoadErrorIdentity(null);

      try {
        const snapshot = await fetchAgentSessionSnapshot(provider, providerSessionId);
        if (cancelled) return;

        setSessionDetails(snapshot);
        setMessages(snapshot.messages || []);
        setPendingInteraction(snapshot.pendingInteraction || null);
        setCapabilities(snapshot.capabilities || null);
        const seq = snapshot.lastEventSeq || 0;
        setLastEventSeq(seq);
        lastSeqRef.current = seq;

        // Authoritative activity resolution from snapshot (supports reload while waitingForUser, running, or idle)
        const snapshotActivity = resolveSnapshotActivity(snapshot);

        setActivity(snapshotActivity);
        activityRef.current = snapshotActivity;

        if (snapshot.activeTurn) {
          setActiveTurnId(snapshot.activeTurn.turnId);
          activeTurnIdRef.current = snapshot.activeTurn.turnId;
        } else {
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
        }

        setContentRevision((r) => r + 1);
        setLoadedIdentity(identity);
        setLoadErrorIdentity(null);
        setLoadError(null);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          const classified = classifySessionLoadError(err, provider, providerSessionId);
          // Clear all snapshot-derived state so stale session data is never retained
          setSessionDetails(null);
          setMessages([]);
          setPendingInteraction(null);
          setCapabilities(null);
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
          setActivity('idle');
          activityRef.current = 'idle';
          setLastEventSeq(0);
          lastSeqRef.current = 0;

          // Do NOT set loadedIdentity on failure; record loadErrorIdentity instead
          setLoadedIdentity(null);
          setLoadErrorIdentity(identity);
          setIsLoading(false);
          setLoadError(classified);
          // Note: Handled snapshot load failures do not invoke onError (separated error domain)
        }
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [provider, providerSessionId, reloadTrigger]);

  // 2. Live SSE connection & event deduplication
  useEffect(() => {
    if (!provider || !providerSessionId) return;
    const identity = `${provider}:${providerSessionId}`;
    // Only connect SSE if snapshot for current identity is loaded and there is no load error
    if (loadedIdentity !== identity || loadError) return;

    const cursor = lastSeqRef.current;
    const url = `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/events?after=${cursor}`;
    const eventSource = new EventSource(url);

    let active = true;

    const handleAgentEvent = (event: AgentEvent) => {
      if (!active) return;
      const seq = event.seq ?? event.id ?? 0;
      if (seq <= lastSeqRef.current) return; // Deduplication cursor check

      setLastEventSeq(seq);
      lastSeqRef.current = seq;

      setMessages((prev) => applyAgentEvent(prev, event));
      if (eventModifiesTranscriptContent(event)) {
        setContentRevision((r) => r + 1);
      }

      switch (event.type) {
        case 'turn.started':
          setActivity('running');
          activityRef.current = 'running';
          if (event.turnId) {
            setActiveTurnId(event.turnId);
            activeTurnIdRef.current = event.turnId;
          }
          break;

        case 'interaction.requested':
          setPendingInteraction(event.interaction || null);
          setActivity('waitingForUser');
          activityRef.current = 'waitingForUser';
          break;

        case 'interaction.resolved':
          setPendingInteraction(null);
          setActivity('running');
          activityRef.current = 'running';
          break;

        case 'turn.completed':
          if (event.turnId) {
            terminalTurnIdsRef.current.add(event.turnId);
          }
          setActivity('idle');
          activityRef.current = 'idle';
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
          setPendingInteraction(null);
          onTurnCompletedRef.current?.();
          break;

        case 'turn.failed':
          if (event.turnId) {
            terminalTurnIdsRef.current.add(event.turnId);
          }
          setActivity('idle');
          activityRef.current = 'idle';
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
          setPendingInteraction(null);
          if (event.error && shouldSurfaceTurnError(event.error)) {
            onErrorRef.current?.(new Error(event.error.message));
          }
          break;
      }
    };

    const unsubscribe = subscribeAgentEventSource(eventSource, handleAgentEvent);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [provider, providerSessionId, loadedIdentity, loadError]);

  // 3. Send Turn
  const handleSendTurn = useCallback(
    async (messageText: string, options?: { mode?: AgentExecutionMode }) => {
      if (!canStartTurn(activityRef.current, provider, providerSessionId, messageText)) return;
      if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

      const idempotencyKey = createTurnIdempotencyKey();
      const userMessage: NormalizedMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: messageText,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setContentRevision((r) => r + 1);
      setActivity('running');
      activityRef.current = 'running';
      setActiveTurnId(null);
      activeTurnIdRef.current = null;

      try {
        const res = await fetch(
          `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/turns`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-nevo-dashboard-action': '1',
            },
            body: JSON.stringify({
              message: messageText,
              idempotencyKey,
              ...(options?.mode ? { mode: options.mode } : {}),
            }),
          }
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `Failed to start turn (${res.status})`);
        }

        const data = await res.json();
        const returnedTurnId = data.turnId;

        // Race-safety check: If terminal SSE arrived before this POST response completed,
        // or the activity is no longer running, do not overwrite the cleared activeTurnId.
        if (returnedTurnId && !terminalTurnIdsRef.current.has(returnedTurnId) && activityRef.current === 'running') {
          setActiveTurnId(returnedTurnId);
          activeTurnIdRef.current = returnedTurnId;
        }
      } catch (err) {
        setActivity('idle');
        activityRef.current = 'idle';
        setActiveTurnId(null);
        activeTurnIdRef.current = null;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, loadedIdentity, onError]
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || activityRef.current !== 'running' || !provider || !providerSessionId) return;
    if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

    try {
      const res = await fetch(
        `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/turns/${encodeURIComponent(turnId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-nevo-dashboard-action': '1',
          },
          body: JSON.stringify({}),
        }
      );

      const errData = !res.ok ? await res.json().catch(() => ({})) : null;
      const result = applyCancelTurnResponse({
        turnId,
        response: res,
        errorData: errData,
        currentActiveTurnId: activeTurnIdRef.current,
        currentActivity: activityRef.current,
        terminalTurnIds: terminalTurnIdsRef.current,
      });

      if (result.error) {
        throw result.error;
      }

      if (result.nextActivity !== activityRef.current) {
        setActivity(result.nextActivity);
        activityRef.current = result.nextActivity;
      }
      if (result.nextActiveTurnId !== activeTurnIdRef.current) {
        setActiveTurnId(result.nextActiveTurnId);
        activeTurnIdRef.current = result.nextActiveTurnId;
      }
      setContentRevision((r) => r + 1);
    } catch (err) {
      // If the turn already became terminal (e.g. via SSE) while fetch was in flight or rejected,
      // suppress late errors so they don't produce confusing user-facing alerts.
      if (!shouldSurfaceCancelError(turnId, terminalTurnIdsRef.current)) {
        return;
      }
      // On failed cancel DO NOT mutate terminalTurnIds, activity, activeTurnId, or pending turn ownership.
      // The turn remains running and cancellation remains retryable.
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [provider, providerSessionId, loadedIdentity, onError]);

  // 5. Respond Interaction
  const handleRespondInteraction = useCallback(
    async (interactionId: string, responsePayload: unknown) => {
      if (!provider || !providerSessionId) return;
      if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

      try {
        const res = await fetch(
          `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/interactions/${encodeURIComponent(interactionId)}/respond`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-nevo-dashboard-action': '1',
            },
            body: JSON.stringify(responsePayload),
          }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `Failed to respond to interaction (${res.status})`);
        }
        setPendingInteraction(null);
        setContentRevision((r) => r + 1);
        setActivity('running');
        activityRef.current = 'running';
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, loadedIdentity, onError]
  );

  const exposedMessages = isSnapshotLoaded ? messages : [];
  const exposedPendingInteraction = isSnapshotLoaded ? pendingInteraction : null;
  const exposedCapabilities = isSnapshotLoaded ? capabilities : null;
  const exposedActivity: AiSessionStatus = isSnapshotLoaded ? activity : 'idle';
  const exposedIsRunning = isSnapshotLoaded ? (activity === 'running') : false;
  const exposedActiveTurnId = isSnapshotLoaded ? activeTurnId : null;
  const exposedContentRevision = isSnapshotLoaded ? contentRevision : 0;
  const exposedSessionDetails = isSnapshotLoaded && sessionDetails
    ? { ...sessionDetails, status: exposedActivity }
    : null;
  const exposedLoadError = isErrorForCurrentIdentity ? loadError : null;
  const exposedIsLoading = isSnapshotLoaded ? false : Boolean(provider && providerSessionId && !exposedLoadError);

  // 6. Convert NormalizedMessages to Assistant UI ThreadMessageLike
  const assistantMessages: ThreadMessageLike[] = useMemo(() => {
    return exposedMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.text,
      createdAt: new Date(m.createdAt),
    }));
  }, [exposedMessages]);

  // 7. Initialize useExternalStoreRuntime
  const runtime = useExternalStoreRuntime({
    isRunning: exposedIsRunning,
    messages: assistantMessages,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async (msg) => {
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
      }
      await handleSendTurn(text);
    },
    onCancel: handleCancelTurn,
  });

  return {
    runtime,
    messages: exposedMessages,
    pendingInteraction: exposedPendingInteraction,
    capabilities: exposedCapabilities,
    sessionDetails: exposedSessionDetails,
    activity: exposedActivity,
    isRunning: exposedIsRunning,
    activeTurnId: exposedActiveTurnId,
    contentRevision: exposedContentRevision,
    isLoading: exposedIsLoading,
    loadError: exposedLoadError,
    reload,
    sendTurn: handleSendTurn,
    cancelTurn: handleCancelTurn,
    respondInteraction: handleRespondInteraction,
  };
}
