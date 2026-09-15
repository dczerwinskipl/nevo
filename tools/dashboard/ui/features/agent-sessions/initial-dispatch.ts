import { pendingDispatchStore } from './runtime/pending-dispatch-store.ts';

export interface QueueAgentSessionInitialDispatchParams {
  provider: string;
  /** Canonical Nevo sessionId — the sole application identity (see owner-decisions.md D9). */
  sessionId: string;
  prompt: string;
  /** Clean, user-typed text alone (no Nevo-injected context) — the chat-bubble source. */
  userMessage?: string | null;
}

/**
 * Public Agent Sessions integration API for enqueuing an initial prompt
 * before navigating to a newly created agent session.
 */
export function queueAgentSessionInitialDispatch({
  provider,
  sessionId,
  prompt,
  userMessage,
}: QueueAgentSessionInitialDispatchParams): void {
  pendingDispatchStore.setPending(provider, sessionId, prompt, userMessage ?? undefined);
}
