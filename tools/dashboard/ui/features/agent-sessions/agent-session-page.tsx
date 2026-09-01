import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';

import { AgentSessionHeader } from './agent-session-header';
import { formatSessionStatus } from '@/shared/ui/status-label';
import { AgentSessionDetailsSheet } from './agent-session-details-sheet';
import { resolveSessionTaskItems } from './session-tasks';
import { ProviderUnavailableBanner } from './provider-unavailable-banner';
import { AgentSessionComposer } from './composer/agent-session-composer';
import {
  AgentSessionTranscript,
  type AgentSessionTranscriptHandle,
} from './transcript/agent-session-transcript';
import {
  AgentSessionTranscriptV2,
  type AgentSessionTranscriptV2Handle,
} from './work-v2/agent-session-transcript-v2';
import { useAgentSessionRuntime } from './runtime/agent-session-runtime';
import { useAgentSessionRuntimeV2 } from './runtime/agent-session-runtime-v2';
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
  const transcriptHandleRefV2 = useRef<AgentSessionTranscriptV2Handle>(null);
  const visualViewport = useVisualViewport();

  const provider = session.provider;
  const sessionId = session.providerSessionId || session.sessionId;

  // Temporary Chat V1/V2 selector (task 11 / owner-decisions.md D11): purely local UI
  // representation state, never persisted, never provider/session domain state.
  // Switching never restarts, cancels, or mutates the Turn — both runtimes below stay
  // mounted and read-only regardless of which one is currently displayed.
  const [representation, setRepresentation] = useState<'v1' | 'v2'>('v1');

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
  const [runtimeErrorV2, setRuntimeErrorV2] = useState<string | null>(null);

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

  const assistantV2 = useAgentSessionRuntimeV2({
    provider,
    providerSessionId: sessionId,
    onTurnCompleted: () => {
      setRuntimeErrorV2(null);
    },
    onError: (err) => {
      setRuntimeErrorV2(err.message);
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

  const displayError = initialDispatch.displayError || (representation === 'v2' ? runtimeErrorV2 : runtimeError) || null;
  const canRetryInitial = initialDispatch.canRetryInitial;

  const handleDismissError = useCallback(() => {
    initialDispatch.handleDismissError();
    setRuntimeError(null);
    setRuntimeErrorV2(null);
  }, [initialDispatch]);

  const handleRetryInitial = useCallback(async () => {
    setRuntimeError(null);
    return initialDispatch.handleRetryInitial();
  }, [initialDispatch]);

  const handleCancelTurn = useCallback(async () => {
    if (representation === 'v2') {
      setRuntimeErrorV2(null);
      try {
        await assistantV2.cancelTurn();
      } catch (err) {
        setRuntimeErrorV2(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setRuntimeError(null);
    try {
      await assistant.cancelTurn();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [representation, assistant.cancelTurn, assistantV2.cancelTurn]);

  const handleRespondInteraction = useCallback(async (interactionId: string, response: unknown) => {
    if (representation === 'v2') {
      setRuntimeErrorV2(null);
      try {
        await assistantV2.respondInteraction(interactionId, response);
      } catch (err) {
        setRuntimeErrorV2(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setRuntimeError(null);
    try {
      await assistant.respondInteraction(interactionId, response);
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [representation, assistant.respondInteraction, assistantV2.respondInteraction]);

  const handleReload = useCallback(async () => {
    setRuntimeError(null);
    setRuntimeErrorV2(null);
    await Promise.all([assistant.reload(), assistantV2.reload()]);
  }, [assistant.reload, assistantV2.reload]);

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
    setRuntimeErrorV2(null);
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
    if (!trimmed || !isProviderAvailable) return;
    if (representation === 'v2') {
      if (!assistantV2.canStartTurn) return;
      setRuntimeErrorV2(null);
      transcriptHandleRefV2.current?.scrollToBottom('auto');
      try {
        await assistantV2.sendTurn(trimmed, { mode: currentMode });
      } catch (err) {
        setRuntimeErrorV2(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (!assistant.canStartTurn) return;
    setRuntimeError(null);
    transcriptHandleRef.current?.scrollToBottom('auto');
    try {
      await assistant.sendTurn(trimmed, { mode: currentMode });
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [representation, assistant.canStartTurn, assistant.sendTurn, assistantV2.canStartTurn, assistantV2.sendTurn, currentMode, isProviderAvailable]);

  const shellClassName = 'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--background)]';
  const shellStyle = visualViewport.height
    ? {
        height: `${visualViewport.height}px`,
        transform: `translateY(${visualViewport.offsetTop}px)`,
      }
    : undefined;

  // Composer/cancel/delete/session controls are driven from whichever representation's
  // semantic readiness/Turn state is currently displayed (task 11 requirement) — both
  // runtimes stay mounted, but only the active one's state reaches these controls.
  const activeRuntime = representation === 'v2'
    ? {
        activity: assistantV2.activity,
        isRunning: assistantV2.isRunning,
        capabilities: assistantV2.capabilities,
        activeTurnId: assistantV2.activeTurnId,
        canStartTurn: assistantV2.canStartTurn,
        loadError: assistantV2.loadError,
      }
    : {
        activity: assistant.activity,
        isRunning: assistant.isRunning,
        capabilities: assistant.capabilities,
        activeTurnId: assistant.activeTurnId,
        canStartTurn: assistant.canStartTurn,
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

        <div className="flex shrink-0 justify-center border-b border-[var(--border)] bg-[var(--background)] py-1">
          <div role="radiogroup" aria-label="Wersja czatu" className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[10px] font-medium">
            {(['v1', 'v2'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={representation === option}
                onClick={() => setRepresentation(option)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 uppercase tracking-wide transition-colors',
                  representation === option
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground,white)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]',
                )}
              >
                Czat {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

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
          disabled={activeRuntime.isRunning}
        />

        {!providersQuery.loading && providersQuery.data && !isProviderAvailable && (
          <ProviderUnavailableBanner
            providerLabel={providerInfo?.label || provider}
            reason={providerUnavailableReason}
          />
        )}

        {representation === 'v2' ? (
          <AgentSessionTranscriptV2
            ref={transcriptHandleRefV2}
            turns={assistantV2.turns}
            optimisticUserMessage={assistantV2.optimisticUserMessage}
            isLoading={assistantV2.isLoading}
            hasSessionDetails={Boolean(assistantV2.sessionMeta)}
            loadError={assistantV2.loadError}
            contentRevision={assistantV2.contentRevision}
            displayError={displayError}
            canRetryInitial={canRetryInitial}
            onReload={() => void handleReload()}
            onBack={onBack}
            onRespondInteraction={handleRespondInteraction}
            onRetryInitial={() => void handleRetryInitial()}
            onDismissError={handleDismissError}
            onPointerDown={handleTranscriptPointerDown}
          />
        ) : (
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
        )}

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
              isRunning={activeRuntime.isRunning}
              canCancel={Boolean(activeRuntime.capabilities?.cancelTurn && activeRuntime.isRunning && activeRuntime.activeTurnId)}
              isProviderAvailable={isProviderAvailable}
              disabled={!activeRuntime.canStartTurn || !isProviderAvailable}
              placeholder={activeRuntime.activity === 'waitingForUser' ? 'Odpowiedz na pytanie powyżej…' : undefined}
              loadError={activeRuntime.loadError}
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
