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
  const sessionId = session.providerSessionId || session.sessionId;

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
    (session ? `Sesja ${session.providerSessionId.slice(0, 12)}` : `${provider} sesja`);

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
        disabled={!activeRuntime.canStartTurn || !isProviderAvailable}
        placeholder={
          activeRuntime.readiness?.status === 'requiresAttention' || activeRuntime.activity === 'waitingForUser'
            ? 'Odpowiedz na pytanie powyżej…'
            : undefined
        }
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

