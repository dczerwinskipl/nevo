import type { AgentEvent } from '../types.ts';

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
  'turn.updated',
] as const;

export type SupportedAgentEventType = (typeof SUPPORTED_AGENT_EVENT_TYPES)[number];

export interface AgentEventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (event: MessageEvent) => void): void;
  onmessage?: ((event: MessageEvent) => void) | null;
  onopen?: ((event: Event) => void) | null;
  onerror?: ((event: Event) => void) | null;
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

/** `event.seq` is the primary cursor; `event.id` is the SSE fallback when a provider omits `seq`. */
export function resolveEventSeq(event: Pick<AgentEvent, 'seq' | 'id'>): number {
  return event.seq ?? event.id ?? 0;
}

export interface AgentEventStreamHandlers {
  onEvent: (event: AgentEvent) => void;
  onOpen?: () => void;
  onError?: (eventSource?: AgentEventSourceLike) => void;
}

/**
 * Opens one live agent-event connection and wires it end to end (open/error signaling,
 * named-event subscription via `subscribeAgentEventSource`, cleanup on disconnect).
 * Takes an injectable `createEventSource` so this — and thus the live-stream lifecycle
 * a session runtime depends on — is testable with a fake `AgentEventSourceLike` and no
 * real browser `EventSource`, `@assistant-ui/react`, or React at all (area
 * ai-assistant-chat-and-runtime-feature-slice, task 07).
 */
export function connectAgentEventStream(
  url: string,
  handlers: AgentEventStreamHandlers,
  createEventSource: (url: string) => AgentEventSourceLike = (u) => new EventSource(u),
): () => void {
  const eventSource = createEventSource(url);
  eventSource.onopen = () => handlers.onOpen?.();
  eventSource.onerror = () => handlers.onError?.(eventSource);
  return subscribeAgentEventSource(eventSource, handlers.onEvent);
}
