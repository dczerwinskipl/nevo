import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';

import { AgentSessionHeader } from './agent-session-header';
import { formatSessionStatus } from '@/shared/ui/status-label';
import { AgentSessionDetailsSheet } from './agent-session-details-sheet';
import { resolveSessionTaskItems } from './agent-session-details';
import { ProviderUnavailableBanner } from './provider-unavailable-banner';
import { AgentSessionComposer } from './composer/agent-session-composer';
import {
  AgentSessionTranscript,
  type AgentSessionTranscriptHandle,
} from './transcript/agent-session-transcript';
import { useAgentSessionRuntime } from './runtime/agent-session-runtime';
import { useAgentProviders, useDeleteAgentSession } from './queries';
import { AI_PROVIDERS_CONFIG_PATH } from './provider-config';
import { useInitialDispatch } from './runtime/use-initial-dispatch';
import { useVisualViewport } from './transcript/use-visual-viewport';
import { TaskDialog } from '@/features/specifications/tasks/task-dialog';
import type {
  AgentExecutionMode,
  AgentSession,
  TaskNavigationTarget,
} from './types';
import type { SpecificationSummary } from '@/features/specifications/types';
import { cn } from '@/lib/utils';

export function AgentSessionPage({
  spec,
  session,
  onBack,
  backLabel = 'Wróć do specyfikacji',
  onSwitchSession,
}: {
  spec: SpecificationSummary;
  session: AgentSession;
  onBack: () => void;
  backLabel?: string;
  onSwitchSession: (session: AgentSession) => void;
}) {
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptHandleRef = useRef<AgentSessionTranscriptHandle>(null);
  const visualViewport = useVisualViewport();

  const provider = session.provider;
  const sessionId = session.providerSessionId || session.sessionId;

  const handleTranscriptPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const isInteractive = target?.closest('button, a, input, textarea, select, [role="button"], summary, details, [data-interactive="true"]');
    if (!isInteractive && composerTextareaRef.current && document.activeElement === composerTextareaRef.current) {
      composerTextareaRef.current.blur();
    }
  };

  const [selectedModeOverride, setSelectedModeOverride] = useState<AgentExecutionMode | null>(null);
  const providersQuery = useAgentProviders();
  const providerInfo = providersQuery.data?.providers.find((p) => p.id === provider);
  const isProviderAvailable = Boolean(providerInfo && providerInfo.available !== false);
  const providerUnavailableReason = providerInfo
    ? (providerInfo.unavailableReason || 'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH. Nie można wysyłać kolejnych wiadomości.')
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

  const handleRespondInteraction = useCallback(async (interactionId: string, response: unknown) => {
    setRuntimeError(null);
    try {
      await assistant.respondInteraction(interactionId, response);
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant.respondInteraction]);

  const handleReload = useCallback(async () => {
    setRuntimeError(null);
    await assistant.reload();
  }, [assistant.reload]);

  const [isSessionDetailsOpen, setIsSessionDetailsOpen] = useState(false);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);

  const handleInspectTask = useCallback((target: TaskNavigationTarget | string) => {
    const taskId = typeof target === 'string' ? target : target.taskId;
    const task = spec?.tasks?.find((t) => t.id === taskId);
    if (task) {
      setIsSessionDetailsOpen(false);
      setInspectedTaskId(taskId);
    }
  }, [spec?.tasks]);

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

  const handleComposerSubmit = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || !isProviderAvailable || !assistant.canStartTurn) return;
    setRuntimeError(null);
    transcriptHandleRef.current?.scrollToBottom('auto');
    try {
      await assistant.sendTurn(trimmed, { mode: currentMode });
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant.canStartTurn, assistant.sendTurn, currentMode, isProviderAvailable]);

  const shellClassName = 'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--background)]';
  const shellStyle = visualViewport.height
    ? {
        height: `${visualViewport.height}px`,
        transform: `translateY(${visualViewport.offsetTop}px)`,
      }
    : undefined;

  const headerTitle =
    session?.title?.trim() ||
    (session?.purpose?.trim() && session.purpose !== 'attached' && session.purpose !== 'interactive'
      ? session.purpose.trim()
      : '') ||
    (session?.taskId ? `Zadanie: ${session.taskId}` : '') ||
    (session?.purpose?.trim() ? session.purpose.trim() : '') ||
    (session ? `Sesja ${session.providerSessionId.slice(0, 12)}` : `${provider} sesja`);

  return (
    <AssistantRuntimeProvider runtime={assistant.runtime}>
      <div className={shellClassName} style={shellStyle}>
        <AgentSessionHeader
          title={headerTitle}
          status={session ? formatSessionStatus(assistant.activity) : undefined}
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
          disabled={assistant.isRunning}
        />

        {!providersQuery.loading && providersQuery.data && !isProviderAvailable && (
          <ProviderUnavailableBanner
            providerLabel={providerInfo?.label || provider}
            reason={providerUnavailableReason}
          />
        )}

        <AgentSessionTranscript
          ref={transcriptHandleRef}
          messages={assistant.messages}
          activeTurnId={assistant.activeTurnId}
          pendingInteraction={assistant.pendingInteraction}
          isLoading={assistant.isLoading}
          isRunning={assistant.isRunning}
          hasSessionDetails={Boolean(assistant.sessionDetails)}
          loadError={assistant.loadError}
          contentRevision={assistant.contentRevision}
          displayError={displayError}
          canRetryInitial={canRetryInitial}
          keyboardOpen={visualViewport.keyboardOpen}
          visualViewportHeight={visualViewport.height}
          onReload={() => void handleReload()}
          onBack={onBack}
          onRespondInteraction={handleRespondInteraction}
          onRetryInitial={() => void handleRetryInitial()}
          onDismissError={handleDismissError}
          onPointerDown={handleTranscriptPointerDown}
        />

        <footer
          className={cn(
            'shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 sm:px-6',
            visualViewport.keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-4xl">
            <AgentSessionComposer
              key={sessionId}
              textareaRef={composerTextareaRef}
              currentMode={currentMode}
              onModeChange={(m) => setSelectedModeOverride(m)}
              onSend={(text) => handleComposerSubmit(text)}
              onCancel={() => void handleCancelTurn()}
              isRunning={assistant.isRunning}
              canCancel={Boolean(assistant.capabilities?.cancelTurn && assistant.isRunning && assistant.activeTurnId)}
              isProviderAvailable={isProviderAvailable}
              disabled={!assistant.canStartTurn || !isProviderAvailable}
              placeholder={assistant.activity === 'waitingForUser' ? 'Odpowiedz na pytanie powyżej…' : undefined}
              loadError={assistant.loadError}
            />
          </div>
        </footer>

        {inspectedTaskId && spec && (
          <TaskDialog
            specification={spec}
            taskId={inspectedTaskId}
            onOpenSession={(s) => {
              try {
                onSwitchSession(s);
                setInspectedTaskId(null);
              } catch (err) {
                setRuntimeError(err instanceof Error ? err.message : String(err));
              }
            }}
            onOpenTask={(target) => {
              const nextTaskId = typeof target === 'string' ? target : target.taskId;
              setInspectedTaskId(nextTaskId);
            }}
            onClose={() => setInspectedTaskId(null)}
          />
        )}
      </div>
    </AssistantRuntimeProvider>
  );
}
