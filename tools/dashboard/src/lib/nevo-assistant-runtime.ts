import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type {
  AgentCapabilities,
  AgentEvent,
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

export function createTurnIdempotencyKey(prefix = 'turn'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}

export function useNevoAssistantRuntime({
  provider,
  providerSessionId,
  onTurnCompleted,
  onError,
}: UseNevoAssistantRuntimeOptions) {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [pendingInteraction, setPendingInteraction] = useState<AiInteraction | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastEventSeq, setLastEventSeq] = useState<number>(0);
  const [sessionDetails, setSessionDetails] = useState<AgentSessionSnapshot | null>(null);

  const lastSeqRef = useRef<number>(0);
  lastSeqRef.current = lastEventSeq;

  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;

  // 1. Initial snapshot restoration
  useEffect(() => {
    let cancelled = false;
    async function loadSnapshot() {
      if (!provider || !providerSessionId) return;
      try {
        const res = await fetch(`/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}`);
        if (!res.ok) throw new Error(`Failed to load session: ${res.statusText}`);
        const data = await res.json();
        if (cancelled) return;
        const snapshot: AgentSessionSnapshot = data.session;
        setSessionDetails(snapshot);
        setMessages(snapshot.messages || []);
        setPendingInteraction(snapshot.pendingInteraction || null);
        setCapabilities(snapshot.capabilities || null);
        setLastEventSeq(snapshot.lastEventSeq || 0);
        lastSeqRef.current = snapshot.lastEventSeq || 0;

        if (snapshot.activeTurn) {
          setActiveTurnId(snapshot.activeTurn.turnId);
          setIsRunning(true);
        } else {
          setActiveTurnId(null);
          setIsRunning(false);
        }
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [provider, providerSessionId, onError]);

  // 2. Live SSE connection & event deduplication
  useEffect(() => {
    if (!provider || !providerSessionId) return;

    const controller = new AbortController();
    const cursor = lastSeqRef.current;
    const url = `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/events?after=${cursor}`;

    const eventSource = new EventSource(url);

    eventSource.onmessage = (rawEvent) => {
      try {
        const event: AgentEvent = JSON.parse(rawEvent.data);
        const seq = event.seq ?? event.id ?? 0;
        if (seq <= lastSeqRef.current) return; // Deduplication cursor check

        setLastEventSeq(seq);
        lastSeqRef.current = seq;

        switch (event.type) {
          case 'turn.started':
            setIsRunning(true);
            if (event.turnId) setActiveTurnId(event.turnId);
            break;

          case 'text.delta': {
            const text = event.text ?? event.delta ?? '';
            const msgId = event.messageId || `msg-${event.turnId || 'current'}`;
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === msgId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  text: updated[existingIdx].text + text,
                };
                return updated;
              }
              return [
                ...prev,
                {
                  id: msgId,
                  role: 'assistant',
                  text,
                  createdAt: event.timestamp || new Date().toISOString(),
                },
              ];
            });
            break;
          }

          case 'reasoning.delta': {
            const reasoning = event.text ?? '';
            const msgId = event.messageId || `msg-${event.turnId || 'current'}`;
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === msgId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  reasoning: (updated[existingIdx].reasoning || '') + reasoning,
                };
                return updated;
              }
              return [
                ...prev,
                {
                  id: msgId,
                  role: 'assistant',
                  text: '',
                  reasoning,
                  createdAt: event.timestamp || new Date().toISOString(),
                },
              ];
            });
            break;
          }

          case 'tool.started': {
            const msgId = `msg-${event.turnId || 'current'}`;
            const toolCall = {
              id: event.toolId || `tool-${Date.now()}`,
              name: event.toolName || 'tool',
              input: event.input,
              status: 'running' as const,
            };
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === msgId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                const calls = [...(updated[existingIdx].toolCalls || []), toolCall];
                updated[existingIdx] = { ...updated[existingIdx], toolCalls: calls };
                return updated;
              }
              return [
                ...prev,
                {
                  id: msgId,
                  role: 'assistant',
                  text: '',
                  toolCalls: [toolCall],
                  createdAt: event.timestamp || new Date().toISOString(),
                },
              ];
            });
            break;
          }

          case 'tool.completed': {
            const msgId = `msg-${event.turnId || 'current'}`;
            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === msgId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                const calls = (updated[existingIdx].toolCalls || []).map((tc) =>
                  tc.id === event.toolId
                    ? { ...tc, output: event.output, status: 'completed' as const, durationMs: event.durationMs }
                    : tc
                );
                updated[existingIdx] = { ...updated[existingIdx], toolCalls: calls };
                return updated;
              }
              return prev;
            });
            break;
          }

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
            onTurnCompleted?.();
            break;

          case 'turn.failed':
            setIsRunning(false);
            setActiveTurnId(null);
            setPendingInteraction(null);
            if (event.error) {
              onError?.(new Error(event.error.message));
            }
            break;
        }
      } catch (err) {
        console.warn('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      // Reconnection handled automatically by browser EventSource
    };

    return () => {
      controller.abort();
      eventSource.close();
    };
  }, [provider, providerSessionId, onTurnCompleted, onError]);

  // 3. Send Turn
  const handleSendTurn = useCallback(
    async (messageText: string) => {
      if (!messageText.trim() || isRunning) return;
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
            body: JSON.stringify({ message: messageText, idempotencyKey }),
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
    [provider, providerSessionId, isRunning, onError]
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;
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
  }, [provider, providerSessionId, onError]);

  // 5. Respond Interaction
  const handleRespondInteraction = useCallback(
    async (interactionId: string, responsePayload: unknown) => {
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
    [provider, providerSessionId, onError]
  );

  // 6. Convert NormalizedMessages to Assistant UI ThreadMessageLike
  const assistantMessages: ThreadMessageLike[] = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.text,
      createdAt: new Date(m.createdAt),
    }));
  }, [messages]);

  // 7. Initialize useExternalStoreRuntime
  const runtime = useExternalStoreRuntime({
    isRunning,
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
    messages,
    pendingInteraction,
    capabilities,
    sessionDetails,
    isRunning,
    activeTurnId,
    sendTurn: handleSendTurn,
    cancelTurn: handleCancelTurn,
    respondInteraction: handleRespondInteraction,
  };
}
