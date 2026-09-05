import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentCapabilities,
  AgentExecutionMode,
  AgentSessionChatV2Payload,
  AgentSessionStatus,
  CanonicalTurnV2,
  LiveConnectionStatus,
  SessionReadinessV2,
} from '../types.ts';
import { connectAgentEventStream, resolveEventSeq } from './agent-event-source.ts';
import { fetchAgentSessionChatV2 } from './agent-session-v2-transport.ts';
import { classifySessionLoadError, AgentSessionLoadError } from './agent-session-transport.ts';
import { postCancelTurn, postRespondInteraction, postStartTurn } from './agent-turn-transport.ts';
import { createTurnIdempotencyKey } from './agent-event-reducer.ts';

export interface UseAgentSessionRuntimeV2Options {
  provider: string;
  providerSessionId: string;
  onTurnCompleted?: () => void;
  onError?: (error: Error) => void;
}

function latestTurn(turns: CanonicalTurnV2[]): CanonicalTurnV2 | null {
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/**
 * Applies one `turn.updated` SSE event to the current turns list — an identity-keyed
 * full-snapshot replace (append if unseen), never a delta merge. Exported as a pure
 * function so the correlation invariant (one turn.id, one entry, always current) is
 * independently testable without mounting the hook.
 */
export function applyTurnUpdatedV2(turns: CanonicalTurnV2[], updatedTurn: CanonicalTurnV2): CanonicalTurnV2[] {
  const idx = turns.findIndex((t) => t.id === updatedTurn.id);
  if (idx === -1) return [...turns, updatedTurn];
  if (turns[idx] === updatedTurn) return turns;
  const next = [...turns];
  next[idx] = updatedTurn;
  return next;
}

/**
 * Session-level activity, derived only from the latest Turn's own canonical `status`
 * field (owner-decisions.md D7 vocabulary) — never inferred from event absence or
 * elapsed time. Mirrors `sessions/service.mjs#resolveSessionActivity`'s coarse shape so
 * V1/V2 composer and header controls stay consistent.
 */
export function deriveActivity(turns: CanonicalTurnV2[]): AgentSessionStatus {
  const turn = latestTurn(turns);
  if (!turn || turn.status.status === 'terminal') return 'idle';
  if (turn.status.status === 'requiresAttention') return 'waitingForUser';
  return 'running';
}

/**
 * Semantic Work chat V2 runtime (task 11 / owner-decisions.md D11). Reads only the
 * server's canonical projection (`GET .../chat`, SSE `turn.updated`) — it never
 * reconstructs Work from raw provider events the way the V1 reducer does. A live
 * `turn.updated` event carries the *entire* current Turn snapshot, so applying it is a
 * simple identity-keyed replace, which is idempotent under SSE reconnect replay
 * (areas/persistence-and-server-projection.md § "Live and reload equivalence") — unlike
 * V1's delta-merge reducer, this hook needs no per-event-type branching logic.
 */
export function useAgentSessionRuntimeV2({
  provider,
  providerSessionId,
  onTurnCompleted,
  onError,
}: UseAgentSessionRuntimeV2Options) {
  const currentIdentity = provider && providerSessionId ? `${provider}:${providerSessionId}` : '';
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [loadErrorIdentity, setLoadErrorIdentity] = useState<string | null>(null);

  const [turns, setTurns] = useState<CanonicalTurnV2[]>([]);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [readiness, setReadiness] = useState<SessionReadinessV2 | null>(null);
  const [sessionMeta, setSessionMeta] = useState<AgentSessionChatV2Payload['session'] | null>(null);
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
  const turnsRef = useRef<CanonicalTurnV2[]>([]);
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
      if (!provider || !providerSessionId) return;
      const identity = `${provider}:${providerSessionId}`;
      setLoadError(null);
      setLoadErrorIdentity(null);
      setConnectionStatus('unknown');

      try {
        const payload = await fetchAgentSessionChatV2(provider, providerSessionId);
        if (cancelled) return;

        setSessionMeta(payload.session);
        // One atomic commit for the already-materialized historical transcript — never
        // an empty start followed by event-by-event reconstruction.
        setTurns(payload.turns || []);
        setCapabilities(payload.session.capabilities || null);
        setReadiness(payload.readiness || payload.session.readiness || null);
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
          const classified = classifySessionLoadError(err, provider, providerSessionId);
          setSessionMeta(null);
          setTurns([]);
          setCapabilities(null);
          setReadiness(null);
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
  }, [provider, providerSessionId, reloadTrigger]);

  // 2. Live SSE — the only event this hook acts on is `turn.updated`, whose payload is
  // the full canonical Turn (never a delta), so applying it is an identity-keyed replace.
  useEffect(() => {
    if (!provider || !providerSessionId) return;
    const identity = `${provider}:${providerSessionId}`;
    if (loadedIdentity !== identity || loadError) return;

    const url = `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/events?after=${lastSeqRef.current}`;
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

        if (event.type !== 'turn.updated' || !event.turn) return;
        const updatedTurn = event.turn;

        setTurns((prev) => applyTurnUpdatedV2(prev, updatedTurn));
        setOptimisticPending(null);
        setContentRevision((r) => r + 1);

        if (updatedTurn.status.status === 'terminal' && !terminalTurnIdsRef.current.has(updatedTurn.id)) {
          terminalTurnIdsRef.current.add(updatedTurn.id);
          onTurnCompletedRef.current?.();
          const error = updatedTurn.status.error;
          if (updatedTurn.status.outcome === 'failed' && error && error.code !== 'AI_TURN_CANCELLED') {
            onErrorRef.current?.(new Error(error.message));
          }
        }
      },
    });

    return () => {
      active = false;
      disconnect();
    };
  }, [provider, providerSessionId, loadedIdentity, loadError]);

  // 3. Send Turn
  const handleSendTurn = useCallback(
    async (
      messageText: string,
      options?: { mode?: AgentExecutionMode; idempotencyKey?: string; userMessage?: string },
    ) => {
      const trimmed = messageText ? messageText.trim() : '';
      if (!trimmed) throw new Error('Cannot start turn with an empty message.');
      if (!provider || !providerSessionId)
        throw new Error('Cannot start turn without an active provider and session ID.');
      if (loadedIdentity !== `${provider}:${providerSessionId}`) {
        throw new Error('Cannot start turn while the session snapshot is loading.');
      }
      if (loadError) throw new Error('Cannot start turn on a session with a load error.');
      if (deriveActivity(turnsRef.current) !== 'idle') {
        throw new Error(`Cannot start turn while session is ${deriveActivity(turnsRef.current)}.`);
      }

      const idempotencyKey = options?.idempotencyKey || createTurnIdempotencyKey();
      const displayText = options?.userMessage?.trim() || trimmed;
      setOptimisticPending({ text: displayText });

      try {
        await postStartTurn(provider, providerSessionId, {
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
    [provider, providerSessionId, loadedIdentity, loadError],
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turn = latestTurn(turnsRef.current);
    if (!turn || turn.status.status === 'terminal') return;
    if (!provider || !providerSessionId) return;
    if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

    try {
      const { response, errorData } = await postCancelTurn(provider, providerSessionId, turn.id);
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
  }, [provider, providerSessionId, loadedIdentity]);

  // 5. Respond Interaction
  const handleRespondInteraction = useCallback(
    async (interactionId: string, responsePayload: unknown) => {
      if (!provider || !providerSessionId) return;
      if (loadedIdentity !== `${provider}:${providerSessionId}`) return;
      try {
        await postRespondInteraction(provider, providerSessionId, interactionId, responsePayload);
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, loadedIdentity],
  );

  const baseActivity = isSnapshotLoaded ? deriveActivity(exposedTurns) : 'idle';
  const exposedActivity: AgentSessionStatus = optimisticPending && baseActivity === 'idle' ? 'running' : baseActivity;
  const exposedIsRunning = exposedActivity === 'running';
  const exposedActiveTurn = isSnapshotLoaded
    ? (() => {
        const turn = latestTurn(exposedTurns);
        return turn && turn.status.status !== 'terminal' ? turn : null;
      })()
    : null;
  const exposedActiveTurnId = exposedActiveTurn?.id ?? null;
  const exposedCapabilities = isSnapshotLoaded ? capabilities : null;
  const exposedReadiness = isSnapshotLoaded ? readiness : null;
  const exposedSessionMeta = isSnapshotLoaded ? sessionMeta : null;
  const exposedLoadError = isErrorForCurrentIdentity ? loadError : null;
  const exposedConnectionStatus: LiveConnectionStatus =
    isSnapshotLoaded && !exposedLoadError ? connectionStatus : exposedLoadError ? 'disconnected' : 'unknown';
  const exposedLive = exposedConnectionStatus === 'connected';
  const exposedIsLoading = isSnapshotLoaded ? false : Boolean(provider && providerSessionId && !exposedLoadError);
  const exposedCanStartTurn = Boolean(isSnapshotLoaded && !exposedLoadError && exposedActivity === 'idle');
  const latest = latestTurn(exposedTurns);
  const hasActiveTurn = Boolean(
    (latest && latest.status.status !== 'terminal') ||
    exposedActiveTurnId ||
    exposedActivity === 'running' ||
    exposedActivity === 'waitingForUser' ||
    exposedReadiness?.status === 'busy' ||
    exposedReadiness?.status === 'requiresAttention',
  );
  const exposedCanCancelTurn = Boolean(
    exposedCapabilities?.cancelTurn &&
    hasActiveTurn &&
    latest?.status.status !== 'cancelling' &&
    exposedReadiness?.status !== 'unavailable',
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
    contentRevision: isSnapshotLoaded ? contentRevision : 0,
    isLoading: exposedIsLoading,
    live: exposedLive,
    connectionStatus: exposedConnectionStatus,
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
