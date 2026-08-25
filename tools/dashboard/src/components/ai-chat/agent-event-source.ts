import type { AgentEvent } from '@/lib/types';

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
