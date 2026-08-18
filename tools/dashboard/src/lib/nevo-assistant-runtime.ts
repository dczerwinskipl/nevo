import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentExecutionMode,
  AgentSessionSnapshot,
  AiInteraction,
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
      const msgId = event.messageId || `msg-${event.turnId || 'current'}`;
      const existingIdx = prevMessages.findIndex((m) => m.id === msgId);
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
          id: msgId,
          role: 'assistant',
          text,
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'reasoning.delta': {
      const reasoning = event.text ?? '';
      const msgId = event.messageId || `msg-${event.turnId || 'current'}`;
      const existingIdx = prevMessages.findIndex((m) => m.id === msgId);
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
          id: msgId,
          role: 'assistant',
          text: '',
          reasoning,
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'tool.started': {
      const msgId = `msg-${event.turnId || 'current'}`;
      const toolCall = {
        id: event.toolId || `tool-${Date.now()}`,
        name: event.toolName || 'tool',
        input: event.input,
        status: 'running' as const,
      };
      const existingIdx = prevMessages.findIndex((m) => m.id === msgId);
      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        const calls = [...(updated[existingIdx].toolCalls || []), toolCall];
        updated[existingIdx] = { ...updated[existingIdx], toolCalls: calls };
        return updated;
      }
      return [
        ...prevMessages,
        {
          id: msgId,
          role: 'assistant',
          text: '',
          toolCalls: [toolCall],
          createdAt: event.timestamp || new Date().toISOString(),
        },
      ];
    }

    case 'tool.updated': {
      const msgId = event.messageId || (event.turnId ? `msg-${event.turnId}` : null);
      let targetIdx = msgId ? prevMessages.findIndex((m) => m.id === msgId) : -1;
      if (targetIdx === -1 && event.toolId) {
        targetIdx = prevMessages.findIndex((m) => m.toolCalls?.some((tc) => tc.id === event.toolId));
      }
      if (targetIdx >= 0) {
        const updated = [...prevMessages];
        const calls = (updated[targetIdx].toolCalls || []).map((tc) =>
          tc.id === event.toolId
            ? { ...tc, input: event.input ?? tc.input, status: (event.status as any) || tc.status }
            : tc
        );
        updated[targetIdx] = { ...updated[targetIdx], toolCalls: calls };
        return updated;
      }
      return prevMessages;
    }

    case 'tool.completed': {
      const msgId = event.messageId || (event.turnId ? `msg-${event.turnId}` : null);
      let targetIdx = msgId ? prevMessages.findIndex((m) => m.id === msgId) : -1;
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
                status: (event.status as any) || 'completed',
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
      return prevMessages.map((m) => {
        if (!m.toolCalls || !m.toolCalls.some((tc) => tc.status === 'running')) return m;
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'completed' as const } : tc)),
        };
      });
    }

    default:
      return prevMessages;
  }
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
  const [isRunning, setIsRunning] = useState<boolean>(false);
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

  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;

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

        if (snapshot.activeTurn) {
          setActiveTurnId(snapshot.activeTurn.turnId);
          setIsRunning(true);
        } else {
          setActiveTurnId(null);
          setIsRunning(false);
        }

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
          setIsRunning(false);
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

      switch (event.type) {
        case 'turn.started':
          setIsRunning(true);
          if (event.turnId) setActiveTurnId(event.turnId);
          break;

        case 'interaction.requested':
          setPendingInteraction(event.interaction || null);
          setIsRunning(false);
          break;

        case 'interaction.resolved':
          setPendingInteraction(null);
          setIsRunning(true);
          break;

        case 'turn.completed':
          setIsRunning(false);
          setActiveTurnId(null);
          setPendingInteraction(null);
          onTurnCompletedRef.current?.();
          break;

        case 'turn.failed':
          setIsRunning(false);
          setActiveTurnId(null);
          setPendingInteraction(null);
          if (event.error) {
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
      if (!messageText.trim() || isRunning || !provider || !providerSessionId) return;
      if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

      const idempotencyKey = createTurnIdempotencyKey();
      const userMessage: NormalizedMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: messageText,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsRunning(true);

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
        setActiveTurnId(data.turnId);
      } catch (err) {
        setIsRunning(false);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, isRunning, loadedIdentity, onError]
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || !provider || !providerSessionId) return;
    if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

    try {
      await fetch(
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
      setIsRunning(false);
      setActiveTurnId(null);
    } catch (err) {
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
        setIsRunning(true);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, loadedIdentity, onError]
  );

  const exposedMessages = isSnapshotLoaded ? messages : [];
  const exposedPendingInteraction = isSnapshotLoaded ? pendingInteraction : null;
  const exposedCapabilities = isSnapshotLoaded ? capabilities : null;
  const exposedSessionDetails = isSnapshotLoaded ? sessionDetails : null;
  const exposedIsRunning = isSnapshotLoaded ? isRunning : false;
  const exposedActiveTurnId = isSnapshotLoaded ? activeTurnId : null;
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
    isRunning: exposedIsRunning,
    activeTurnId: exposedActiveTurnId,
    isLoading: exposedIsLoading,
    loadError: exposedLoadError,
    reload,
    sendTurn: handleSendTurn,
    cancelTurn: handleCancelTurn,
    respondInteraction: handleRespondInteraction,
  };
}
