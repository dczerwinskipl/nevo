import { pendingDispatchStore } from './runtime/pending-dispatch-store.ts';

export interface QueueAgentSessionInitialDispatchParams {
  provider: string;
  providerSessionId: string;
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
  providerSessionId,
  prompt,
  userMessage,
}: QueueAgentSessionInitialDispatchParams): void {
  pendingDispatchStore.setPending(provider, providerSessionId, prompt, userMessage ?? undefined);
}