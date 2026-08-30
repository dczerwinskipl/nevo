import { pendingDispatchStore } from './runtime/pending-dispatch-store.ts';

export interface QueueAgentSessionInitialDispatchParams {
  provider: string;
  providerSessionId: string;
  prompt: string;
}

/**
 * Public Agent Sessions integration API for enqueuing an initial prompt
 * before navigating to a newly created agent session.
 */
export function queueAgentSessionInitialDispatch({
  provider,
  providerSessionId,
  prompt,
}: QueueAgentSessionInitialDispatchParams): void {
  pendingDispatchStore.setPending(provider, providerSessionId, prompt);
}