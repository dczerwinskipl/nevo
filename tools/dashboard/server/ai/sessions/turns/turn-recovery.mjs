import {
  AiError,
  validateAgentExecutionMode,
} from '../../contracts.mjs';
import { sessionKey } from './turn-event-stream.mjs';

/**
 * Reconstructs a canonical in-memory Agent Turn state object from a persisted
 * transcript record.
 */
export function reconstructTurnState({ cached, registry, clock }) {
  const restoredMode = cached.activeTurn.mode
    ? validateAgentExecutionMode(cached.activeTurn.mode, 'activeTurn.mode')
    : 'edit';

  return {
    turnId: cached.activeTurn.turnId,
    provider: cached.provider,
    providerSessionId: cached.providerSessionId,
    identity: { provider: cached.provider, providerSessionId: cached.providerSessionId },
    key: sessionKey(cached.provider, cached.providerSessionId),
    mode: restoredMode,
    status: 'waitingForUser',
    pendingInteraction: cached.pendingInteraction ? structuredClone(cached.pendingInteraction) : null,
    sequence: cached.lastEventSeq || 0,
    events: [],
    subscribers: new Set(),
    abortController: new AbortController(),
    agentProvider: registry.get(cached.provider).provider,
    privateOperation: undefined,
    startedAt: cached.activeTurn.startedAt,
    completedAt: undefined,
    lastActivityAt: clock ? (typeof clock === 'function' ? clock().getTime() : clock.getTime()) : Date.now(),
  };
}

/**
 * Searches the transcript cache for a persisted active turn matching the given
 * criteria (provider/providerSessionId, turnId, and/or interactionId).
 */
export async function findPersistedActiveTurn({
  transcriptCache,
  provider,
  providerSessionId,
  turnId,
  interactionId,
} = {}) {
  if (!transcriptCache) return null;

  if (provider && providerSessionId) {
    const cached = await transcriptCache.getTranscript(provider, providerSessionId);
    if (cached?.activeTurn) {
      if (interactionId && cached.pendingInteraction?.id !== interactionId) return null;
      if (turnId && cached.activeTurn.turnId !== turnId) return null;
      return cached;
    }
    return null;
  }

  if (turnId) {
    for (const [, cached] of transcriptCache.entries?.() || []) {
      if (cached?.activeTurn?.turnId === turnId) {
        if (interactionId && cached.pendingInteraction?.id !== interactionId) continue;
        return cached;
      }
    }
  }

  return null;
}

/**
 * Formats a snapshot object for a persisted active turn located in the transcript
 * cache when it does not exist in the in-memory runtime map.
 */
export function getPersistedTurnSnapshot({ transcriptCache, turnId } = {}) {
  if (!transcriptCache) return null;

  for (const [, cached] of transcriptCache.entries?.() || []) {
    if (cached?.activeTurn?.turnId === turnId) {
      return {
        turnId,
        provider: cached.provider,
        providerSessionId: cached.providerSessionId,
        status: 'waitingForUser',
        startedAt: cached.activeTurn.startedAt,
        lastEventId: cached.lastEventSeq || 0,
        pendingInteraction: cached.pendingInteraction ? structuredClone(cached.pendingInteraction) : null,
        events: [],
      };
    }
  }
  return null;
}

/**
 * Interrupts a stale live-operation interaction whose owning process/runtime
 * terminated before the user answered.
 */
export async function interruptStaleLiveInteraction(transcriptCache, provider, providerSessionId) {
  transcriptCache.markTurnInterrupted(provider, providerSessionId, {
    text: 'Interrupted by server restart.',
  });
  await transcriptCache.flush?.(provider, providerSessionId);
  throw new AiError(
    'AI_TURN_INTERRUPTED',
    'The interaction can no longer be answered because its live provider operation ended.',
    { status: 409 },
  );
}

/**
 * Boot-time reconciliation (D9): finalizes any persisted `activeTurn` left behind by a
 * session whose owning turn was never terminated (ungraceful restart), since the
 * in-memory `turnRuntime` always starts empty. Restart-resumable pending interactions
 * are left untouched; live-operation interactions are interrupted because their
 * provider correlation disappeared with the owning process.
 */
export async function reconcileOrphanedTurns(transcriptCache) {
  if (typeof transcriptCache?.listPersistedSessions !== 'function') return { reconciledCount: 0 };
  const sessions = await transcriptCache.listPersistedSessions();
  let reconciledCount = 0;
  for (const { provider, providerSessionId } of sessions) {
    const transcript = await transcriptCache.getTranscript(provider, providerSessionId);
    if (!transcript?.activeTurn) continue;
    if (transcript.pendingInteraction && transcript.pendingInteraction.resumePolicy !== 'live-operation') continue;
    transcriptCache.markTurnInterrupted(provider, providerSessionId, {
      text: 'Interrupted by server restart.',
    });
    reconciledCount += 1;
  }
  if (reconciledCount > 0 && typeof transcriptCache.flushAll === 'function') {
    await transcriptCache.flushAll();
  }
  return { reconciledCount };
}
