import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentCapabilities,
  AgentExecutionMode,
  AgentSessionChatPayload,
  AgentSessionSnapshot,
  AgentSessionStatus,
  CanonicalTurn,
  LiveConnectionStatus,
  SessionReadiness,
} from '../types.ts';
import { connectAgentEventStream, resolveEventSeq } from './agent-event-source.ts';
import { fetchAgentSessionChat, classifySessionLoadError, AgentSessionLoadError } from './agent-session-transport.ts';
import { postCancelTurn, postRespondInteraction, postStartTurn } from './agent-turn-transport.ts';
import { createTurnIdempotencyKey } from './idempotency-key.ts';
import { applyTurnUpdated, deriveActivity, resolveEffectiveReadiness } from './agent-event-reducer.ts';

export { applyTurnUpdated, deriveActivity };

export interface UseAgentSessionRuntimeOptions {
  /**
   * Canonical Nevo session UUID — the sole application identity this runtime operates
   * on. `providerSessionId` (optional provider-native metadata) is never accepted here;
   * every HTTP/SSE call this hook issues targets the canonical `/api/agent-sessions/:sessionId/...`
   * routes (see owner-decisions.md D9).
   */
  sessionId: string;
  onTurnCompleted?: () => void;
  onError?: (error: Error) => void;
}

function latestTurn(turns: CanonicalTurn[]): CanonicalTurn | null {
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/**
 * Canonical semantic Work chat runtime. Reads only the server's canonical projection
 * (`GET .../chat`, SSE `turn.updated`) — it never reconstructs Work from raw provider
 * events. A live `turn.updated` event carries the *entire* current Turn snapshot, so
 * applying it is a simple identity-keyed replace, idempotent under SSE reconnect replay.
 */
export function useAgentSessionRuntime({ sessionId, onTurnCompleted, onError }: UseAgentSessionRuntimeOptions) {
  const currentIdentity = sessionId || '';
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [loadErrorIdentity, setLoadErrorIdentity] = useState<string | null>(null);

  const [turns, setTurns] = useState<CanonicalTurn[]>([]);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [serverReadiness, setServerReadiness] = useState<SessionReadiness | null>(null);
  const [sessionMeta, setSessionMeta] = useState<AgentSessionChatPayload['session'] | null>(null);
  const [loadError, setLoadError] = useState<AgentSessionLoadError | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  const [live, setLive] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('unknown');
  const [contentRevision, setContentRevision] = useState<number>(0);
  // Bridges the gap between a successful POST /turns and the first authoritative
  // `turn.updated` snapshot for that turn — cleared as soon as any turn.updated arrives,
  // at which point `turns` state (and each turn's own canonical `userMessage`) is
  // authoritative again. This is the only client-side duplicate of server state this
  // hook keeps; it is never a substitute for the canonical per-turn `userMessage`.
  const [optimisticPending, setOptimisticPending] = useState<{ text: string } | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onTurnCompletedRef = useRef(onTurnCompleted);
  onTurnCompletedRef.current = onTurnCompleted;

  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const lastSeqRef = useRef<number>(0);

  const isSnapshotLoaded = Boolean(currentIdentity && loadedIdentity === currentIdentity);
  const isErrorForCurrentIdentity = Boolean(currentIdentity && loadErrorIdentity === currentIdentity);

  const exposedTurns = isSnapshotLoaded ? turns : [];
  const turnsRef = useRef<CanonicalTurn[]>([]);
  turnsRef.current = exposedTurns;

  const reload = useCallback(async () => {
    setLoadError(null);
    setLoadErrorIdentity(null);
    setReloadTrigger((n) => n + 1);
  }, []);

  // 1. Initial snapshot restoration
  useEffect(() => {
    let cancelled = false;
    async function loadSnapshot() {
      if (!sessionId) return;
      const identity = sessionId;
      setLoadError(null);
      setLoadErrorIdentity(null);
      setConnectionStatus('unknown');

      try {
        const payload = await fetchAgentSessionChat(sessionId);
        if (cancelled) return;

        setSessionMeta(payload.session);
        // One atomic commit for the already-materialized historical transcript — never
        // an empty start followed by event-by-event reconstruction.
        setTurns(payload.turns || []);
        setCapabilities(payload.session.capabilities || null);
        setServerReadiness(payload.readiness || payload.session.readiness || null);
        setOptimisticPending(null);
        // Resume SSE from the snapshot's own cursor, never 0 — otherwise the browser
        // replays the entire historical event stream and visibly rebuilds Work counts
        // that were already complete in the snapshot.
        lastSeqRef.current = payload.session.lastEventSeq || 0;

        setContentRevision((r) => r + 1);
        setLoadedIdentity(identity);
        setLoadErrorIdentity(null);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          const classified = classifySessionLoadError(err, undefined, sessionId);
          setSessionMeta(null);
          setTurns([]);
          setCapabilities(null);
          setServerReadiness(null);
          setOptimisticPending(null);

          setLoadedIdentity(null);
          setLoadErrorIdentity(identity);
          setLoadError(classified);
          setConnectionStatus('disconnected');
          setLive(false);
        }
      }
    }

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadTrigger]);

  // 2. Live SSE — the only event this hook acts on is `turn.updated`, whose payload is
  // the full canonical Turn (never a delta), so applying it is an identity-keyed replace.
  useEffect(() => {
    if (!sessionId) return;
    const identity = sessionId;
    if (loadedIdentity !== identity || loadError) return;

    const url = `/api/agent-sessions/${encodeURIComponent(sessionId)}/events?after=${lastSeqRef.current}`;
    let active = true;

    const disconnect = connectAgentEventStream(url, {
      onOpen: () => {
        if (active) {
          setLive(true);
          setConnectionStatus('connected');
        }
      },
      onError: (source) => {
        if (active) {
          setLive(false);
          const readyState = (source as { readyState?: number })?.readyState;
          setConnectionStatus(readyState === 2 ? 'disconnected' : 'reconnecting');
        }
      },
      onEvent: (event) => {
        if (!active) return;
        setLive(true);
        setConnectionStatus('connected');
        const seq = resolveEventSeq(event);
        if (seq > lastSeqRef.current) lastSeqRef.current = seq;

        if (event.type !== 'turn.updated') return;
        if (event.turn) {
          const updatedTurn = event.turn;

          setTurns((prev) => applyTurnUpdated(prev, updatedTurn));

          if (updatedTurn.status.status === 'terminal' && !terminalTurnIdsRef.current.has(updatedTurn.id)) {
            terminalTurnIdsRef.current.add(updatedTurn.id);
            onTurnCompletedRef.current?.();
            const error = updatedTurn.status.error;
            if (updatedTurn.status.outcome === 'failed' && error && error.code !== 'AI_TURN_CANCELLED') {
              onErrorRef.current?.(new Error(error.message));
            }
          }
        }

        // A canonical `turn.updated` event always carries authoritative readiness on
        // the wire contract — replace it unconditionally, even when the field is
        // missing/malformed, so a bad event can never leave a stale, possibly more
        // permissive readiness in place. `resolveEffectiveReadiness` fails closed to
        // `unavailable` on `null`, never re-derives `ready` from silence.
        setServerReadiness(event.readiness ?? null);
        setOptimisticPending(null);
        setContentRevision((r) => r + 1);
      },
    });

    return () => {
      active = false;
      disconnect();
    };
  }, [sessionId, loadedIdentity, loadError]);

  // 3. Send Turn
  const handleSendTurn = useCallback(
    async (
      messageText: string,
      options?: { mode?: AgentExecutionMode; idempotencyKey?: string; userMessage?: string },
    ) => {
      const trimmed = messageText ? messageText.trim() : '';
      if (!trimmed) throw new Error('Cannot start turn with an empty message.');
      if (!sessionId) throw new Error('Cannot start turn without an active session.');
      if (loadedIdentity !== sessionId) {
        throw new Error('Cannot start turn while the session snapshot is loading.');
      }
      if (loadError) throw new Error('Cannot start turn on a session with a load error.');
      const currentReadiness = resolveEffectiveReadiness(serverReadiness, Boolean(optimisticPending));
      if (currentReadiness.status !== 'ready') {
        throw new Error(`Cannot start turn while session is ${currentReadiness.status}.`);
      }

      const idempotencyKey = options?.idempotencyKey || createTurnIdempotencyKey();
      const displayText = options?.userMessage?.trim() || trimmed;
      setOptimisticPending({ text: displayText });

      try {
        await postStartTurn(sessionId, {
          message: trimmed,
          idempotencyKey,
          mode: options?.mode,
          userMessage: options?.userMessage,
        });
      } catch (err) {
        setOptimisticPending(null);
        const normalized = err instanceof Error ? err : new Error(String(err));
        onErrorRef.current?.(normalized);
        throw normalized;
      }
    },
    [sessionId, loadedIdentity, loadError, serverReadiness, optimisticPending],
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turn = latestTurn(turnsRef.current);
    if (!turn || turn.status.status === 'terminal') return;
    if (!sessionId) return;
    if (loadedIdentity !== sessionId) return;

    try {
      const { response, errorData } = await postCancelTurn(sessionId, turn.id);
      if (!response.ok && !terminalTurnIdsRef.current.has(turn.id)) {
        const message =
          errorData?.error?.message || errorData?.message || `Failed to cancel turn (${response.status || 'unknown'})`;
        throw new Error(message);
      }
    } catch (err) {
      if (!terminalTurnIdsRef.current.has(turn.id)) {
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [sessionId, loadedIdentity]);

  // 5. Respond Interaction
  const handleRespondInteraction = useCallback(
    async (interactionId: string, responsePayload: unknown) => {
      if (!sessionId) return;
      if (loadedIdentity !== sessionId) return;
      try {
        await postRespondInteraction(sessionId, interactionId, responsePayload);
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [sessionId, loadedIdentity],
  );

  const baseActivity = isSnapshotLoaded ? deriveActivity(exposedTurns) : 'idle';
  const exposedActivity: AgentSessionStatus = optimisticPending && baseActivity === 'idle' ? 'running' : baseActivity;
  const exposedIsRunning = exposedActivity === 'running';
  const exposedActiveTurn = isSnapshotLoaded
    ? (() => {
        const turn = latestTurn(exposedTurns);
        return turn && turn.status?.status !== 'terminal' ? turn : null;
      })()
    : null;
  const exposedActiveTurnId = exposedActiveTurn?.id ?? null;
  const exposedCapabilities = isSnapshotLoaded ? capabilities : null;
  const exposedReadiness: SessionReadiness | null = isSnapshotLoaded
    ? resolveEffectiveReadiness(serverReadiness, Boolean(optimisticPending))
    : null;
  const exposedSessionMeta = isSnapshotLoaded ? sessionMeta : null;
  const exposedSessionDetails: AgentSessionSnapshot | null =
    isSnapshotLoaded && sessionMeta
      ? ({
          ...sessionMeta,
          status: exposedActivity,
          readiness: exposedReadiness ?? sessionMeta.readiness,
          turns: exposedTurns,
          lastEventSeq: sessionMeta.lastEventSeq ?? 0,
          updatedAt: sessionMeta.lastActivityAt ?? sessionMeta.createdAt,
        } as AgentSessionSnapshot)
      : null;
  const exposedLoadError = isErrorForCurrentIdentity ? loadError : null;
  const exposedConnectionStatus: LiveConnectionStatus =
    isSnapshotLoaded && !exposedLoadError ? connectionStatus : exposedLoadError ? 'disconnected' : 'unknown';
  const exposedLive = exposedConnectionStatus === 'connected';
  const exposedIsLoading = isSnapshotLoaded ? false : Boolean(sessionId && !exposedLoadError);
  const exposedIsReady = Boolean(
    isSnapshotLoaded &&
      !exposedLoadError &&
      exposedReadiness?.status === 'ready',
  );
  const exposedCanStartTurn = exposedIsReady;
  const latest = latestTurn(exposedTurns);
  const hasActiveTurn = Boolean(
    optimisticPending ||
      (latest && latest.status?.status !== 'terminal') ||
      exposedActiveTurnId ||
      exposedActivity === 'running' ||
      exposedActivity === 'waitingForUser' ||
      exposedReadiness?.status === 'busy' ||
      exposedReadiness?.status === 'requiresAttention',
  );
  const exposedCanCancelTurn = Boolean(
    exposedCapabilities?.cancelTurn &&
      hasActiveTurn &&
      latest?.status?.status !== 'cancelling' &&
      exposedReadiness?.status !== 'unavailable' &&
      exposedReadiness?.status !== 'readOnly',
  );

  return {
    turns: exposedTurns,
    activeTurn: exposedActiveTurn,
    activeTurnId: exposedActiveTurnId,
    activity: exposedActivity,
    isRunning: exposedIsRunning,
    capabilities: exposedCapabilities,
    readiness: exposedReadiness,
    sessionMeta: exposedSessionMeta,
    sessionDetails: exposedSessionDetails,
    contentRevision: isSnapshotLoaded ? contentRevision : 0,
    isLoading: exposedIsLoading,
    live: exposedLive,
    connectionStatus: exposedConnectionStatus,
    isReady: exposedIsReady,
    canStartTurn: exposedCanStartTurn,
    canCancelTurn: exposedCanCancelTurn,
    hasActiveTurn,
    isSnapshotLoaded,
    loadError: exposedLoadError,
    /** Optimistic text for the brief gap between POST and the first turn.updated snapshot — never used once a real turn carries its own `userMessage`. */
    optimisticUserMessage: isSnapshotLoaded ? (optimisticPending?.text ?? null) : null,
    reload,
    sendTurn: handleSendTurn,
    cancelTurn: handleCancelTurn,
    respondInteraction: handleRespondInteraction,
  };
}
