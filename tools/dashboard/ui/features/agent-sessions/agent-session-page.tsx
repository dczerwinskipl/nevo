import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentSessionHeader } from './agent-session-header';
import { formatSessionStatus, sessionStatusTone } from './status';
import { AgentSessionDetailsSheet } from './agent-session-details-sheet';
import { resolveSessionTaskItems } from './session-tasks';
import { ProviderUnavailableBanner } from './provider-unavailable-banner';
import { AgentSessionChatSurface, type AgentSessionChatSurfaceHandle } from './agent-session-chat-surface';
import { useAgentSessionRuntime } from './runtime/agent-session-runtime';
import { useAgentProviders, useDeleteAgentSession } from './queries';
import { AI_PROVIDERS_CONFIG_PATH } from './provider-config';
import { useInitialDispatch } from './runtime/use-initial-dispatch';
import { useVisualViewport } from './transcript/use-visual-viewport';
import { getStoredWorkflowExperienceMode } from '@/screens/specification-detail/workflow-experience';
import { useSpecificationActions } from '@/features/specifications/detail/spec-detail-queries';
import type { SpecificationSummary } from '@/features/specifications/types';
import type { BoundTaskInfo } from './agent-session-workflow-bar';
import type { AgentExecutionMode, AgentSession, TaskNavigationTarget, AgentSessionTaskRef } from './types';

export interface AgentSessionPageSpecContext {
  title?: string;
  slug?: string;
  tasks?: AgentSessionTaskRef[];
}

export interface AgentSessionPageProps {
  spec?: AgentSessionPageSpecContext | null;
  session: AgentSession;
  onBack: () => void;
  backLabel?: string;
  onSwitchSession: (session: AgentSession) => void;
  onInspectTask?: (target: TaskNavigationTarget | string) => void;
  taskOverlay?: React.ReactNode;
}

export function AgentSessionPage({
  spec,
  session,
  onBack,
  backLabel = 'Wróć do specyfikacji',
  onSwitchSession,
  onInspectTask,
  taskOverlay,
}: AgentSessionPageProps) {
  const chatSurfaceRef = useRef<AgentSessionChatSurfaceHandle>(null);
  const visualViewport = useVisualViewport();

  const provider = session.provider;
  const sessionId = session.sessionId || session.providerSessionId || '';

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
    provider,
    providerSessionId: sessionId,
    onTurnCompleted: () => {
      setRuntimeError(null);
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
      await deleteSession({ provider, sessionId });
      onBack();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  };

  const experienceMode = getStoredWorkflowExperienceMode();
  const boundTaskIds = useMemo(() => {
    const ids: string[] = [];
    if (session.taskIds && session.taskIds.length > 0) {
      ids.push(...session.taskIds);
    } else if (session.taskId) {
      ids.push(session.taskId);
    }
    return Array.from(new Set(ids));
  }, [session.taskIds, session.taskId]);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => boundTaskIds[0] || null);

  useEffect(() => {
    if (boundTaskIds.length > 0 && (!activeTaskId || !boundTaskIds.includes(activeTaskId))) {
      setActiveTaskId(boundTaskIds[0]);
    }
  }, [boundTaskIds, activeTaskId]);

  const actionsQuery = useSpecificationActions(
    { slug: spec?.slug || '', source: 'active' } as SpecificationSummary,
    Boolean(spec?.slug),
  );

  const boundTasks: BoundTaskInfo[] = useMemo(() => {
    return boundTaskIds.map((id) => {
      const specTask = spec?.tasks?.find((t) => t.id === id);
      const taskAction = actionsQuery.data?.tasks?.[id];
      const status = (taskAction as any)?.status || (specTask as any)?.status || 'in-implementation';
      const attempt = (taskAction as any)?.attempt || (specTask as any)?.attempt || 1;
      return {
        id,
        title: specTask?.title,
        status,
        attempt,
      };
    });
  }, [boundTaskIds, spec?.tasks, actionsQuery.data?.tasks]);

  const activeTaskActions = activeTaskId ? actionsQuery.data?.tasks?.[activeTaskId]?.availableActions || [] : [];
  const activeTaskGate = activeTaskId ? actionsQuery.data?.tasks?.[activeTaskId] : null;
  const activeTaskAttempt = (activeTaskGate as any)?.attempt || 1;

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
      await actionsQuery.refresh();
      await assistant.reload();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [spec?.slug, actionsQuery, assistant]);

  const handleStartReviewTask = useCallback(async (taskId: string) => {
    if (!assistant.canStartTurn) return;
    setRuntimeError(null);
    try {
      const prompt = `Review task ${taskId}`;
      await assistant.sendTurn(prompt, { mode: 'agent', userMessage: prompt });
      await actionsQuery.refresh();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant, actionsQuery]);

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
      await actionsQuery.refresh();
      await assistant.reload();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [spec?.slug, actionsQuery, assistant]);

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
        displayError={displayError}
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
        onSelectActiveTask={setActiveTaskId}
        availableActions={activeTaskActions}
        activeTaskAttempt={activeTaskAttempt}
        onApproveTask={handleApproveTask}
        onStartReviewTask={handleStartReviewTask}
        onRequestChangesSubmit={handleRequestChangesSubmit}
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

