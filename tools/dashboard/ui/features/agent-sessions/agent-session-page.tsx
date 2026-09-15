import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentSessionHeader } from './agent-session-header';
import { formatSessionStatus, sessionStatusTone } from './status';
import { AgentSessionDetailsSheet } from './agent-session-details-sheet';
import { resolveSessionTaskItems } from './session-tasks';
import { ProviderUnavailableBanner } from './provider-unavailable-banner';
import { AgentSessionChatSurface, type AgentSessionChatSurfaceHandle } from './agent-session-chat-surface';
import { useAgentSessionRuntime } from './runtime/agent-session-runtime';
import { useAgentProviders, useDeleteAgentSession, useSetSessionActiveTask } from './queries';
import { AI_PROVIDERS_CONFIG_PATH } from './provider-config';
import { useInitialDispatch } from './runtime/use-initial-dispatch';
import { useVisualViewport } from './transcript/use-visual-viewport';
import { pendingActionModeStore, type PendingActionModeIntent } from './runtime/pending-action-mode-store';
import type { BoundTaskInfo } from './agent-session-workflow-bar';
import type { AgentExecutionMode, AgentSession, TaskNavigationTarget, AgentSessionTaskRef } from './types';

export interface AgentSessionPageSpecContext {
  title?: string;
  slug?: string;
  tasks?: AgentSessionTaskRef[];
}

/**
 * Minimal, locally-defined shape of a task's authoritative workflow projection — kept
 * structural rather than importing `SpecificationTaskActionGate` from the sibling
 * `specifications` feature, since the feature layer must not directly depend on another
 * feature (see tests/architecture-boundaries.test.mjs). The real, richer type is owned by
 * `features/specifications/types`; `ui/screens/agent-session/agent-session-screen.tsx`
 * (a screens-layer composition point) fetches that data and passes it down here.
 */
export interface AgentSessionPageTaskAction {
  availableActions?: string[];
  status?: string | null;
  currentStep?: string | null;
  attempt?: number | null;
}

export interface AgentSessionPageProps {
  spec?: AgentSessionPageSpecContext | null;
  session: AgentSession;
  onBack: () => void;
  backLabel?: string;
  onSwitchSession: (session: AgentSession) => void;
  onInspectTask?: (target: TaskNavigationTarget | string) => void;
  taskOverlay?: React.ReactNode;
  /** Presentation-only toggle (D10, C12) — owned by the screens layer's localStorage helper. */
  experienceMode: 'classic' | 'deterministic';
  /** Authoritative per-task workflow projection (`GET /api/specs/:source/:slug/actions`), server-owned. */
  taskActions?: Record<string, AgentSessionPageTaskAction> | null;
  /** Refreshes `taskActions` — called at workflow boundaries (turn completion, human decisions). */
  onRefreshTaskActions?: () => Promise<unknown> | unknown;
}

export function AgentSessionPage({
  spec,
  session,
  onBack,
  backLabel = 'Wróć do specyfikacji',
  onSwitchSession,
  onInspectTask,
  taskOverlay,
  experienceMode,
  taskActions,
  onRefreshTaskActions,
}: AgentSessionPageProps) {
  const chatSurfaceRef = useRef<AgentSessionChatSurfaceHandle>(null);
  const visualViewport = useVisualViewport();

  const provider = session.provider;
  // The canonical Nevo sessionId is the sole application identity — it is required on
  // every AgentSession and is never combined with providerSessionId as a fallback chain
  // (see owner-decisions.md D9). providerSessionId is optional provider-native metadata,
  // never a substitute identity.
  const sessionId = session.sessionId;

  const [selectedModeOverride, setSelectedModeOverride] = useState<AgentExecutionMode | null>(null);
  const providersQuery = useAgentProviders();
  const providerInfo = providersQuery.data?.providers.find((p) => p.id === provider);
  const isProviderAvailable = Boolean(providerInfo && providerInfo.available !== false);
  const providerUnavailableReason = providerInfo
    ? providerInfo.unavailableReason ||
      'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH. Nie można wysyłać kolejnych wiadomości.'
    : `Provider '${provider}' nie jest włączony w ${AI_PROVIDERS_CONFIG_PATH}. Włącz go i uruchom dashboard ponownie.`;

  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const assistant = useAgentSessionRuntime({
    sessionId,
    onTurnCompleted: () => {
      setRuntimeError(null);
      // Workflow boundary: a turn just went terminal (e.g. implementation finished,
      // review passed/failed). Refresh the authoritative availableActions/workflow
      // projection immediately rather than waiting for the next poll interval, so the
      // next action (e.g. "Start review") appears without a stale ~30s delay.
      void onRefreshTaskActions?.();
    },
    onError: (err) => {
      setRuntimeError(err.message);
    },
  });

  const sessionDetails = assistant.sessionDetails || session;
  const currentMode: AgentExecutionMode = selectedModeOverride ?? sessionDetails?.mode ?? session?.mode ?? 'edit';

  const initialDispatch = useInitialDispatch({
    provider,
    sessionId,
    assistant,
    isProviderAvailable,
    currentMode,
    onBeforeDispatch: useCallback(() => {
      setRuntimeError(null);
    }, []),
  });

  const displayError = initialDispatch.displayError || runtimeError || null;
  const canRetryInitial = initialDispatch.canRetryInitial;

  const handleDismissError = useCallback(() => {
    initialDispatch.handleDismissError();
    setRuntimeError(null);
  }, [initialDispatch]);

  const handleRetryInitial = useCallback(async () => {
    setRuntimeError(null);
    return initialDispatch.handleRetryInitial();
  }, [initialDispatch]);

  const handleCancelTurn = useCallback(async () => {
    setRuntimeError(null);
    try {
      await assistant.cancelTurn();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant.cancelTurn]);

  const handleRespondInteraction = useCallback(
    async (interactionId: string, response: unknown) => {
      setRuntimeError(null);
      try {
        await assistant.respondInteraction(interactionId, response);
      } catch (err) {
        setRuntimeError(err instanceof Error ? err.message : String(err));
      }
    },
    [assistant.respondInteraction],
  );

  const handleReload = useCallback(async () => {
    setRuntimeError(null);
    await assistant.reload();
  }, [assistant.reload]);

  const [isSessionDetailsOpen, setIsSessionDetailsOpen] = useState(false);
  const handleInspectTask = useCallback(
    (target: TaskNavigationTarget | string) => {
      setIsSessionDetailsOpen(false);
      onInspectTask?.(target);
    },
    [onInspectTask],
  );

  const sessionTaskItems = useMemo(
    () => resolveSessionTaskItems(sessionDetails, spec?.tasks),
    [sessionDetails, spec?.tasks],
  );

  useEffect(() => {
    setRuntimeError(null);
  }, [provider, sessionId]);

  const { deleteSession, deleting } = useDeleteAgentSession();

  const handleDeleteSession = async () => {
    if (!window.confirm('Czy na pewno chcesz usunąć tę sesję z dysku?')) return;
    try {
      await deleteSession({ sessionId });
      onBack();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  };

  const boundTaskIds = useMemo(() => {
    const ids: string[] = [];
    if (session.taskIds && session.taskIds.length > 0) {
      ids.push(...session.taskIds);
    } else if (session.taskId) {
      ids.push(session.taskId);
    }
    return Array.from(new Set(ids));
  }, [session.taskIds, session.taskId]);

  // activeTaskId is exclusively server-owned (D9 §7, C10): it is the session's own
  // `taskId` projection (the backend's `activeTaskId` field), never local React state
  // defaulted to the first bound task. Falling back to `boundTaskIds[0]` only applies
  // when the server genuinely has no active task recorded at all.
  const activeTaskId: string | null = sessionDetails?.taskId ?? (boundTaskIds.length > 0 ? boundTaskIds[0] : null);

  const { setActiveTask } = useSetSessionActiveTask();
  const [taskSwitchError, setTaskSwitchError] = useState<string | null>(null);

  const handleSelectActiveTask = useCallback(
    async (taskId: string) => {
      if (!taskId || taskId === activeTaskId) return;
      setTaskSwitchError(null);
      try {
        // Authoritative server command — the UI never commits the switch locally. Only a
        // successful PATCH (reflected back through session/session-details refresh) moves
        // `activeTaskId`; a failure leaves the previously active task in place.
        await setActiveTask({ sessionId, taskId });
        await assistant.reload();
      } catch (err) {
        setTaskSwitchError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeTaskId, setActiveTask, sessionId, assistant.reload],
  );

  // A one-shot navigation intent (e.g. a task card's "Request changes" button) consumed
  // exactly once per session mount — see pending-action-mode-store.ts.
  const [pendingActionModeIntent] = useState<PendingActionModeIntent | null>(() =>
    sessionId ? pendingActionModeStore.takePending(sessionId) : null,
  );

  useEffect(() => {
    if (!pendingActionModeIntent) return;
    if (!boundTaskIds.includes(pendingActionModeIntent.taskId)) return;
    if (activeTaskId === pendingActionModeIntent.taskId) return;
    void handleSelectActiveTask(pendingActionModeIntent.taskId);
  }, [pendingActionModeIntent, boundTaskIds, activeTaskId, handleSelectActiveTask]);

  const initialActionMode =
    pendingActionModeIntent &&
    boundTaskIds.includes(pendingActionModeIntent.taskId) &&
    activeTaskId === pendingActionModeIntent.taskId
      ? pendingActionModeIntent.action
      : null;

  const boundTasks: BoundTaskInfo[] = useMemo(() => {
    return boundTaskIds.map((id) => {
      const specTask = spec?.tasks?.find((t) => t.id === id);
      const taskAction = taskActions?.[id];
      return {
        id,
        title: specTask?.title,
        // Authoritative server projection only — absent/undefined renders as "unknown" in
        // the workflow bar rather than fabricating `in-implementation`/`attempt 1`.
        status: taskAction?.status ?? null,
        currentStep: taskAction?.currentStep ?? null,
        attempt: taskAction?.attempt ?? null,
      };
    });
  }, [boundTaskIds, spec?.tasks, taskActions]);

  const activeTaskProjection = activeTaskId ? taskActions?.[activeTaskId] : null;
  const activeTaskActions = activeTaskProjection?.availableActions || [];
  const activeTaskAttempt = activeTaskProjection?.attempt ?? null;

  const handleApproveTask = useCallback(async (taskId: string) => {
    if (!spec?.slug) return;
    setRuntimeError(null);
    try {
      const response = await fetch(`/api/specs/${encodeURIComponent(spec.slug)}/tasks/${encodeURIComponent(taskId)}/workflow/human-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Nie udało się zatwierdzić zadania (${response.status})`);
      }
      await onRefreshTaskActions?.();
      await assistant.reload();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [spec?.slug, onRefreshTaskActions, assistant]);

  const handleStartReviewTask = useCallback(async (taskId: string) => {
    if (!assistant.canStartTurn) return;
    setRuntimeError(null);
    try {
      const prompt = `Review task ${taskId}`;
      await assistant.sendTurn(prompt, { mode: 'agent', userMessage: prompt });
      await onRefreshTaskActions?.();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant, onRefreshTaskActions]);

  const handleRequestChangesSubmit = useCallback(async (taskId: string, feedback: string) => {
    if (!spec?.slug) return;
    setRuntimeError(null);
    try {
      const response = await fetch(`/api/specs/${encodeURIComponent(spec.slug)}/tasks/${encodeURIComponent(taskId)}/workflow/human-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'request-changes', feedback }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Nie udało się odrzucić zadania (${response.status})`);
      }
      await onRefreshTaskActions?.();
      await assistant.reload();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [spec?.slug, onRefreshTaskActions, assistant]);

  const handleComposerSubmit = useCallback(
    async (promptText: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || !isProviderAvailable || !assistant.canStartTurn) return;
      setRuntimeError(null);
      chatSurfaceRef.current?.scrollToBottom('auto');
      try {
        await assistant.sendTurn(trimmed, { mode: currentMode });
      } catch (err) {
        setRuntimeError(err instanceof Error ? err.message : String(err));
      }
    },
    [assistant.canStartTurn, assistant.sendTurn, currentMode, isProviderAvailable],
  );

  const shellClassName =
    'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-background';
  const shellStyle = visualViewport.height
    ? {
        height: `${visualViewport.height}px`,
        transform: `translateY(${visualViewport.offsetTop}px)`,
      }
    : undefined;

  const isTurnBusyOrAttention = Boolean(
    assistant.hasActiveTurn ||
      assistant.isRunning ||
      assistant.readiness?.status === 'busy' ||
      assistant.readiness?.status === 'requiresAttention',
  );

  const activeRuntime = {
    activity: assistant.activity,
    isRunning: assistant.isRunning,
    capabilities: assistant.capabilities,
    activeTurnId: assistant.activeTurnId,
    canStartTurn: assistant.canStartTurn,
    canCancelTurn: assistant.canCancelTurn,
    hasActiveTurn: assistant.hasActiveTurn,
    readiness: assistant.readiness,
    loadError: assistant.loadError,
  };

  const headerTitle =
    session?.title?.trim() ||
    (session?.purpose?.trim() && session.purpose !== 'attached' && session.purpose !== 'interactive'
      ? session.purpose.trim()
      : '') ||
    (session?.taskId ? `Zadanie: ${session.taskId}` : '') ||
    (session?.purpose?.trim() ? session.purpose.trim() : '') ||
    (session ? `Sesja ${sessionId.slice(0, 12)}` : `${provider} sesja`);

  return (
    <div className={shellClassName} style={shellStyle}>
      <AgentSessionHeader
        title={headerTitle}
        status={session ? formatSessionStatus(assistant.activity) : undefined}
        statusTone={session ? sessionStatusTone(assistant.activity) : undefined}
        live={assistant.live}
        connectionStatus={assistant.connectionStatus}
        onBack={onBack}
        backLabel={backLabel}
        onOpenDetails={() => setIsSessionDetailsOpen(true)}
      />

      <AgentSessionDetailsSheet
        open={isSessionDetailsOpen}
        onOpenChange={setIsSessionDetailsOpen}
        spec={spec}
        session={session}
        tasks={sessionTaskItems}
        provider={provider}
        mode={currentMode}
        onOpenTask={handleInspectTask}
        onDelete={() => {
          setIsSessionDetailsOpen(false);
          void handleDeleteSession();
        }}
        deleting={deleting}
        disabled={isTurnBusyOrAttention}
      />

      {!providersQuery.loading && providersQuery.data && !isProviderAvailable && (
        <ProviderUnavailableBanner
          providerLabel={providerInfo?.label || provider}
          reason={providerUnavailableReason}
        />
      )}

      <AgentSessionChatSurface
        key={sessionId}
        ref={chatSurfaceRef}
        turns={assistant.turns}
        optimisticUserMessage={assistant.optimisticUserMessage}
        isLoading={assistant.isLoading}
        hasSessionDetails={Boolean(assistant.sessionDetails)}
        loadError={assistant.loadError}
        contentRevision={assistant.contentRevision}
        displayError={displayError || taskSwitchError}
        canRetryInitial={canRetryInitial}
        currentMode={currentMode}
        onModeChange={(m) => setSelectedModeOverride(m)}
        onSend={(text) => handleComposerSubmit(text)}
        onCancel={() => void handleCancelTurn()}
        isRunning={activeRuntime.isRunning}
        hasActiveTurn={activeRuntime.hasActiveTurn}
        canCancel={activeRuntime.canCancelTurn}
        isProviderAvailable={isProviderAvailable}
        unavailableReason={providerInfo?.unavailableReason}
        disabled={!activeRuntime.canStartTurn || !isProviderAvailable}
        placeholder={
          activeRuntime.readiness?.status === 'requiresAttention' || activeRuntime.activity === 'waitingForUser'
            ? 'Odpowiedz na pytanie powyżej…'
            : undefined
        }
        experienceMode={experienceMode}
        boundTasks={boundTasks}
        activeTaskId={activeTaskId}
        onSelectActiveTask={(taskId) => void handleSelectActiveTask(taskId)}
        availableActions={activeTaskActions}
        activeTaskAttempt={activeTaskAttempt}
        onApproveTask={handleApproveTask}
        onStartReviewTask={handleStartReviewTask}
        onRequestChangesSubmit={handleRequestChangesSubmit}
        initialActionMode={initialActionMode}
        keyboardOpen={visualViewport.keyboardOpen}
        onReload={() => void handleReload()}
        onBack={onBack}
        onRespondInteraction={handleRespondInteraction}
        onRetryInitial={() => void handleRetryInitial()}
        onDismissError={handleDismissError}
      />

      {taskOverlay}
    </div>
  );
}
