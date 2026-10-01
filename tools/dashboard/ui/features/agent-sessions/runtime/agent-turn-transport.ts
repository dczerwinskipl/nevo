import type { AgentExecutionMode } from '../types';

/**
 * Raw HTTP transport for the three turn/interaction mutations the assistant runtime
 * hook issues against an already-loaded session. Kept framework-free (no React)
 * so each call's request shape and error-normalization can be unit-tested
 * independently of the hook's state orchestration.
 *
 * All calls target the canonical `/api/agent-sessions/:sessionId/...` routes — the
 * canonical Nevo `sessionId` is the sole application identity for this transport.
 * `providerSessionId` is optional provider-native metadata and is never used as a
 * routing key or fallback identity here (see owner-decisions.md D9).
 */

export async function postStartTurn(
  sessionId: string,
  body: {
    message: string;
    idempotencyKey: string;
    mode?: AgentExecutionMode;
    model?: string | null;
    userMessage?: string;
    /**
     * Structured deterministic execution intent (owner-decisions.md ADR-0009). Only an
     * explicit task action (e.g. "Start agent step") may set this — never inferred from
     * the prompt text or from session metadata. Omitted entirely for ordinary chat, which
     * must always resolve as a generic turn server-side.
     */
    purpose?: 'execution';
    taskId?: string;
  },
): Promise<{ turnId: string | undefined }> {
  const res = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nevo-dashboard-action': '1',
    },
    body: JSON.stringify({
      message: body.message,
      idempotencyKey: body.idempotencyKey,
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.model === null ? { model: null } : body.model?.trim() ? { model: body.model.trim() } : {}),
      ...(body.userMessage ? { userMessage: body.userMessage } : {}),
      ...(body.purpose ? { purpose: body.purpose } : {}),
      ...(body.taskId ? { taskId: body.taskId } : {}),
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to start turn (${res.status})`);
  }

  const data = await res.json();
  return { turnId: data.turnId };
}

export async function postCancelTurn(
  sessionId: string,
  turnId: string,
): Promise<{
  response: { ok: boolean; status?: number };
  errorData: { error?: { message?: string }; message?: string } | null;
}> {
  const res = await fetch(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      body: JSON.stringify({}),
    },
  );

  const errorData = !res.ok ? await res.json().catch(() => ({})) : null;
  return { response: res, errorData };
}

export async function postRespondInteraction(
  sessionId: string,
  interactionId: string,
  responsePayload: unknown,
): Promise<void> {
  const res = await fetch(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(interactionId)}/respond`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      body: JSON.stringify(responsePayload),
    },
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to respond to interaction (${res.status})`);
  }
}
