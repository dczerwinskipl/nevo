import type { AgentExecutionMode } from '../types.ts';

/**
 * Raw HTTP transport for the three turn/interaction mutations the assistant runtime
 * hook issues against an already-loaded session. Kept framework-free (no React, no
 * @assistant-ui/react) so each call's request shape and error-normalization can be
 * unit-tested independently of the hook's state orchestration (area
 * ai-assistant-chat-and-runtime-feature-slice, task 07).
 */

export async function postStartTurn(
  provider: string,
  providerSessionId: string,
  body: { message: string; idempotencyKey: string; mode?: AgentExecutionMode },
): Promise<{ turnId: string | undefined }> {
  const res = await fetch(
    `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/turns`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      body: JSON.stringify({
        message: body.message,
        idempotencyKey: body.idempotencyKey,
        ...(body.mode ? { mode: body.mode } : {}),
      }),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to start turn (${res.status})`);
  }

  const data = await res.json();
  return { turnId: data.turnId };
}

/** Response shape mirrors what `applyCancelTurnResponse` (agent-event-reducer.ts) already consumes. */
export async function postCancelTurn(
  provider: string,
  providerSessionId: string,
  turnId: string,
): Promise<{ response: { ok: boolean; status?: number }; errorData: { error?: { message?: string }; message?: string } | null }> {
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

  const errorData = !res.ok ? await res.json().catch(() => ({})) : null;
  return { response: res, errorData };
}

export async function postRespondInteraction(
  provider: string,
  providerSessionId: string,
  interactionId: string,
  responsePayload: unknown,
): Promise<void> {
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
}
