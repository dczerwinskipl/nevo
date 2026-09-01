import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  AgentCapabilities,
  AgentExecutionMode,
  AgentSessionSnapshot,
  AgentSessionStatus,
  AgentInteraction,
  CanonicalTurnV2,
  LiveConnectionStatus,
  NormalizedMessage,
} from '../types.ts';
import {
  applyAgentEvent,
  applyCancelTurnResponse,
  createTurnIdempotencyKey,
  eventModifiesTranscriptContent,
  resolveSnapshotActivity,
  shouldSurfaceCancelError,
  shouldSurfaceTurnError,
} from './agent-event-reducer.ts';
import { connectAgentEventStream, resolveEventSeq } from './agent-event-source.ts';
import { classifySessionLoadError, fetchAgentSessionSnapshot, AgentSessionLoadError } from './agent-session-transport.ts';
import { postCancelTurn, postRespondInteraction, postStartTurn } from './agent-turn-transport.ts';
import { useAssistantUiBridge } from './assistant-ui-bridge.ts';
import { applyTurnUpdatedV2 } from './agent-session-runtime-v2.ts';

export interface UseAgentSessionRuntimeOptions {
  provider: string;
  providerSessionId: string;
  onTurnCompleted?: () => void;
  onError?: (error: Error) => void;
}

export function useAgentSessionRuntime({
  provider,
  providerSessionId,
  onTurnCompleted,
  onError,
}: UseAgentSessionRuntimeOptions) {
  const currentIdentity = provider && providerSessionId ? `${provider}:${providerSessionId}` : '';
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [loadErrorIdentity, setLoadErrorIdentity] = useState<string | null>(null);

  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [turns, setTurns] = useState<CanonicalTurnV2[]>([]);
  const [pendingInteraction, setPendingInteraction] = useState<AgentInteraction | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [activity, setActivity] = useState<AgentSessionStatus>('idle');
  const [contentRevision, setContentRevision] = useState<number>(0);
  const [lastEventSeq, setLastEventSeq] = useState<number>(0);
  const [sessionDetails, setSessionDetails] = useState<AgentSessionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<AgentSessionLoadError | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  const [live, setLive] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('unknown');
  const [optimisticPending, setOptimisticPending] = useState<{ text: string } | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onTurnCompletedRef = useRef(onTurnCompleted);
  onTurnCompletedRef.current = onTurnCompleted;

  const lastSeqRef = useRef<number>(0);

  const activityRef = useRef<AgentSessionStatus>('idle');
  activityRef.current = activity;

  const activeTurnIdRef = useRef<string | null>(null);
  activeTurnIdRef.current = activeTurnId;

  const terminalTurnIdsRef = useRef<Set<string>>(new Set());

  // Identity match check: only expose state if it belongs to the current provider + providerSessionId
  const isSnapshotLoaded = Boolean(currentIdentity && loadedIdentity === currentIdentity);
  const isErrorForCurrentIdentity = Boolean(currentIdentity && loadErrorIdentity === currentIdentity);

  // Sync cursor ref with state
  lastSeqRef.current = isSnapshotLoaded ? lastEventSeq : 0;

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
        const snapshot = await fetchAgentSessionSnapshot(provider, providerSessionId);
        if (cancelled) return;

        setSessionDetails(snapshot);
        setMessages(snapshot.messages || []);
        setTurns(snapshot.turns || []);
        setPendingInteraction(snapshot.pendingInteraction || null);
        setCapabilities(snapshot.capabilities || null);
        setOptimisticPending(null);
        const seq = snapshot.lastEventSeq || 0;
        setLastEventSeq(seq);
        lastSeqRef.current = seq;

        // Authoritative activity resolution from snapshot (supports reload while waitingForUser, running, or idle)
        const snapshotActivity = resolveSnapshotActivity(snapshot);

        setActivity(snapshotActivity);
        activityRef.current = snapshotActivity;

        if (snapshot.activeTurn) {
          setActiveTurnId(snapshot.activeTurn.turnId);
          activeTurnIdRef.current = snapshot.activeTurn.turnId;
        } else {
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
        }

        setContentRevision((r) => r + 1);
        setLoadedIdentity(identity);
        setLoadErrorIdentity(null);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          const classified = classifySessionLoadError(err, provider, providerSessionId);
          // Clear all snapshot-derived state so stale session data is never retained
          setSessionDetails(null);
          setMessages([]);
          setTurns([]);
          setPendingInteraction(null);
          setCapabilities(null);
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
          setActivity('idle');
          activityRef.current = 'idle';
          setLastEventSeq(0);
          lastSeqRef.current = 0;
          setOptimisticPending(null);

          // Do NOT set loadedIdentity on failure; record loadErrorIdentity instead
          setLoadedIdentity(null);
          setLoadErrorIdentity(identity);
          setLoadError(classified);
          setConnectionStatus('disconnected');
          setLive(false);
          // Note: Handled snapshot load failures do not invoke onError (separated error domain)
        }
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [provider, providerSessionId, reloadTrigger]);

  // 2. Live SSE connection & event deduplication — connection lifecycle itself lives in
  // connectAgentEventStream (agent-event-source.ts); this effect only decides what a
  // received event means for this hook's own React state.
  useEffect(() => {
    if (!provider || !providerSessionId) return;
    const identity = `${provider}:${providerSessionId}`;
    // Only connect SSE if snapshot for current identity is loaded and there is no load error
    if (loadedIdentity !== identity || loadError) return;

    const cursor = lastSeqRef.current;
    const url = `/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}/events?after=${cursor}`;

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
        if (seq <= lastSeqRef.current) return; // Deduplication cursor check

        setLastEventSeq(seq);
        lastSeqRef.current = seq;

        setMessages((prev) => applyAgentEvent(prev, event));
        if (eventModifiesTranscriptContent(event)) {
          setContentRevision((r) => r + 1);
        }

        if (event.type === 'turn.updated' && event.turn) {
          setTurns((prev) => applyTurnUpdatedV2(prev, event.turn));
          setOptimisticPending(null);
        }

        switch (event.type) {
          case 'turn.started':
            setActivity('running');
            activityRef.current = 'running';
            if (event.turnId) {
              setActiveTurnId(event.turnId);
              activeTurnIdRef.current = event.turnId;
            }
            break;

          case 'interaction.requested':
            setPendingInteraction(event.interaction || null);
            setActivity('waitingForUser');
            activityRef.current = 'waitingForUser';
            break;

          case 'interaction.resolved':
            setPendingInteraction(null);
            setActivity('running');
            activityRef.current = 'running';
            break;

          case 'turn.completed':
            if (event.turnId) {
              terminalTurnIdsRef.current.add(event.turnId);
            }
            setActivity('idle');
            activityRef.current = 'idle';
            setActiveTurnId(null);
            activeTurnIdRef.current = null;
            setPendingInteraction(null);
            setOptimisticPending(null);
            onTurnCompletedRef.current?.();
            break;

          case 'turn.failed':
            if (event.turnId) {
              terminalTurnIdsRef.current.add(event.turnId);
            }
            setActivity('idle');
            activityRef.current = 'idle';
            setActiveTurnId(null);
            activeTurnIdRef.current = null;
            setPendingInteraction(null);
            setOptimisticPending(null);
            if (event.error && shouldSurfaceTurnError(event.error)) {
              onErrorRef.current?.(new Error(event.error.message));
            }
            break;
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
    async (messageText: string, options?: { mode?: AgentExecutionMode; idempotencyKey?: string; userMessage?: string }) => {
      const trimmed = messageText ? messageText.trim() : '';
      if (!trimmed) {
        throw new Error('Cannot start turn with an empty message.');
      }
      if (!provider || !providerSessionId) {
        throw new Error('Cannot start turn without an active provider and session ID.');
      }
      if (!isSnapshotLoaded || loadedIdentity !== `${provider}:${providerSessionId}`) {
        throw new Error('Cannot start turn while the session snapshot is loading.');
      }
      if (loadError) {
        throw new Error('Cannot start turn on a session with a load error.');
      }
      if (activityRef.current !== 'idle') {
        throw new Error(`Cannot start turn while session is ${activityRef.current}.`);
      }

      const idempotencyKey = options?.idempotencyKey || createTurnIdempotencyKey();
      // The optimistic bubble shows the clean, user-visible text (never an
      // enriched/injected prompt) — authoritative once the real Turn/message arrives.
      const displayText = options?.userMessage?.trim() || trimmed;
      setOptimisticPending({ text: displayText });
      const optimisticUserMessage: NormalizedMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: displayText,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);
      setContentRevision((r) => r + 1);
      setActivity('running');
      activityRef.current = 'running';
      setActiveTurnId(null);
      activeTurnIdRef.current = null;

      try {
        const { turnId: returnedTurnId } = await postStartTurn(provider, providerSessionId, {
          message: trimmed,
          idempotencyKey,
          mode: options?.mode,
          userMessage: options?.userMessage,
        });

        // Race-safety check: If terminal SSE arrived before this POST response completed,
        // or the activity is no longer running, do not overwrite the cleared activeTurnId.
        if (returnedTurnId && !terminalTurnIdsRef.current.has(returnedTurnId) && activityRef.current === 'running') {
          setActiveTurnId(returnedTurnId);
          activeTurnIdRef.current = returnedTurnId;
        }
      } catch (err) {
        setOptimisticPending(null);
        setActivity('idle');
        activityRef.current = 'idle';
        setActiveTurnId(null);
        activeTurnIdRef.current = null;
        const normalized = err instanceof Error ? err : new Error(String(err));
        onErrorRef.current?.(normalized);
        throw normalized;
      }
    },
    [provider, providerSessionId, isSnapshotLoaded, loadedIdentity, loadError]
  );

  // 4. Cancel Turn
  const handleCancelTurn = useCallback(async () => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || activityRef.current !== 'running' || !provider || !providerSessionId) return;
    if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

    try {
      const { response, errorData } = await postCancelTurn(provider, providerSessionId, turnId);
      const result = applyCancelTurnResponse({
        turnId,
        response,
        errorData,
        currentActiveTurnId: activeTurnIdRef.current,
        currentActivity: activityRef.current,
        terminalTurnIds: terminalTurnIdsRef.current,
      });

      if (result.error) {
        throw result.error;
      }

      if (result.nextActivity !== activityRef.current) {
        setActivity(result.nextActivity);
        activityRef.current = result.nextActivity;
      }
      if (result.nextActiveTurnId !== activeTurnIdRef.current) {
        setActiveTurnId(result.nextActiveTurnId);
        activeTurnIdRef.current = result.nextActiveTurnId;
      }
      setContentRevision((r) => r + 1);
    } catch (err) {
      // If the turn already became terminal (e.g. via SSE) while fetch was in flight or rejected,
      // suppress late errors so they don't produce confusing user-facing alerts.
      if (!shouldSurfaceCancelError(turnId, terminalTurnIdsRef.current)) {
        return;
      }
      // On failed cancel DO NOT mutate terminalTurnIds, activity, activeTurnId, or pending turn ownership.
      // The turn remains running and cancellation remains retryable.
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [provider, providerSessionId, loadedIdentity, onError]);

  // 5. Respond Interaction
  const handleRespondInteraction = useCallback(
    async (interactionId: string, responsePayload: unknown) => {
      if (!provider || !providerSessionId) return;
      if (loadedIdentity !== `${provider}:${providerSessionId}`) return;

      try {
        await postRespondInteraction(provider, providerSessionId, interactionId, responsePayload);
        setPendingInteraction(null);
        setContentRevision((r) => r + 1);
        setActivity('running');
        activityRef.current = 'running';
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [provider, providerSessionId, loadedIdentity, onError]
  );

  const exposedMessages = isSnapshotLoaded ? messages : [];
  const exposedTurns = isSnapshotLoaded ? turns : [];
  const exposedPendingInteraction = isSnapshotLoaded ? pendingInteraction : null;
  const exposedCapabilities = isSnapshotLoaded ? capabilities : null;
  const exposedActivity: AgentSessionStatus = isSnapshotLoaded ? activity : 'idle';
  const exposedIsRunning = isSnapshotLoaded ? (activity === 'running') : false;
  const exposedActiveTurnId = isSnapshotLoaded ? activeTurnId : null;
  const exposedContentRevision = isSnapshotLoaded ? contentRevision : 0;
  const exposedSessionDetails = isSnapshotLoaded && sessionDetails
    ? { ...sessionDetails, status: exposedActivity }
    : null;
  const exposedLoadError = isErrorForCurrentIdentity ? loadError : null;
  const exposedConnectionStatus: LiveConnectionStatus = isSnapshotLoaded && !exposedLoadError
    ? connectionStatus
    : exposedLoadError
      ? 'disconnected'
      : 'unknown';
  const exposedLive = exposedConnectionStatus === 'connected';
  const exposedIsLoading = isSnapshotLoaded ? false : Boolean(provider && providerSessionId && !exposedLoadError);
  const exposedIsReady = Boolean(isSnapshotLoaded && !exposedLoadError && activity === 'idle');
  const exposedCanStartTurn = exposedIsReady;

  // 6. Bind to @assistant-ui/react — sole responsibility of useAssistantUiBridge.
  const runtime = useAssistantUiBridge({
    messages: exposedMessages,
    isRunning: exposedIsRunning,
    onSendText: handleSendTurn,
    onCancel: handleCancelTurn,
  });

  return {
    runtime,
    messages: exposedMessages,
    turns: exposedTurns,
    optimisticUserMessage: isSnapshotLoaded ? optimisticPending?.text ?? null : null,
    pendingInteraction: exposedPendingInteraction,
    capabilities: exposedCapabilities,
    sessionDetails: exposedSessionDetails,
    activity: exposedActivity,
    isRunning: exposedIsRunning,
    activeTurnId: exposedActiveTurnId,
    contentRevision: exposedContentRevision,
    isLoading: exposedIsLoading,
    live: exposedLive,
    connectionStatus: exposedConnectionStatus,
    isReady: exposedIsReady,
    canStartTurn: exposedCanStartTurn,
    isSnapshotLoaded,
    loadError: exposedLoadError,
    reload,
    sendTurn: handleSendTurn,
    cancelTurn: handleCancelTurn,
    respondInteraction: handleRespondInteraction,
  };
}
