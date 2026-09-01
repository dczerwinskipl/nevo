import type { AgentSessionChatV2Payload } from '../types.ts';

/**
 * Fetches the V2 semantic chat projection (canonical Turn[] + workSummary + readiness)
 * from the dedicated `/chat` endpoint (tools/dashboard/server/ai/sessions/routes.mjs).
 * Kept framework-free like `agent-session-transport.ts`'s V1 equivalent, for the same
 * independent-testability reasons.
 */
export async function fetchAgentSessionChatV2(
  provider: string,
  providerSessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<AgentSessionChatV2Payload> {
  const res = await fetchFn(
    `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/chat`,
  );

  if (!res.ok) {
    let message = '';
    try {
      const errData = await res.json();
      message = errData?.error?.message || errData?.message || '';
    } catch {
      // ignore non-json response body
    }
    const error = new Error(message || `AI chat V2 API: ${res.status}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return (await res.json()) as AgentSessionChatV2Payload;
}
