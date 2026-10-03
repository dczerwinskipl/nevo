// Resolves ActorRef identities for the Activity history's three v1 actor kinds:
// `user` (local git identity), `agent-session` (a caller-supplied session id), and
// `system` (a fixed constant). Identity refs only — presentation/display-name
// rendering is a separate, later concern (see overview.md § Historical integrity).
//
// This module does not itself resolve a session id from AgentSessionBindingService
// or readAgentExecutionContext — callers (the producers area) resolve `sessionId`
// themselves and pass it in, keeping this module's dependency surface small
// (2026-09-16 review, Blocking 3).

import { getLocalUserIdentity } from '../../lib/git.mjs';

const UNKNOWN_USER_ID = 'unknown-user';

export const SYSTEM_ACTOR = Object.freeze({ type: 'system', id: 'nevo-workflow-engine' });

/**
 * Resolves the local human identity as a `user` ActorRef, preferring the configured
 * email over the name; falls back to a fixed placeholder id when neither is configured.
 *
 * @param {string} root
 * @returns {{ type: 'user', id: string }}
 */
export function resolveUserActor(root) {
  const { name, email } = getLocalUserIdentity(root);
  return { type: 'user', id: email || name || UNKNOWN_USER_ID };
}

/**
 * Wraps an already-resolved session id into an `agent-session` ActorRef.
 *
 * @param {string} sessionId
 * @returns {{ type: 'agent-session', id: string }}
 */
export function resolveAgentSessionActor(sessionId) {
  return { type: 'agent-session', id: sessionId };
}
