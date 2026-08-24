import type { AiSession } from './types';

type SessionIdentity = Pick<AiSession, 'sessionId' | 'providerSessionId'>;

export function aiSessionRouteId(session: SessionIdentity): string {
  return session.sessionId || session.providerSessionId;
}

export function matchesAiSessionRouteId(session: SessionIdentity, routeId: string): boolean {
  return session.sessionId === routeId || session.providerSessionId === routeId;
}
