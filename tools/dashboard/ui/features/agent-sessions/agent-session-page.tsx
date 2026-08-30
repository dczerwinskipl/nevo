import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AgentSessionHeader } from './agent-session-header';
import { formatSessionStatus } from '@/components/status-label';
import { AgentSessionDetails } from './agent-session-details';
import { AgentSessionComposer } from './composer/agent-session-composer';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAgentSessionRuntime } from './runtime/agent-session-runtime';
import { TranscriptMessage } from './transcript/transcript-message';
import { PermissionPrompt, QuestionPrompt } from './interactions/interaction-prompt';
import { useDeleteAgentSession } from './queries';
import { AI_PROVIDERS_CONFIG_PATH } from './provider-config';
import { projectTranscript } from './transcript/projection';
import { useScrollFollow } from './transcript/use-scroll-follow';
import { useInitialDispatch } from './runtime/use-initial-dispatch';
import { TaskDialog } from '@/components/task-dialog';
import type {
  AgentExecutionMode,
  AgentInteraction,
  AgentQuestionInteraction,
  AgentSession,
  TaskNavigationTarget,
} from './types';
import type { DashboardChange } from '@/lib/types';
import { cn } from '@/lib/utils';

import { useAgentProviders } from './queries';
import { useVisualViewport } from './transcript/use-visual-viewport';

export function AgentSessionPage({
  spec,
  session,
  onBack,
  backLabel = 'Wróć do specyfikacji',
  onSwitchSession,
}: {
  spec: DashboardChange;
  session: AgentSession;
  onBack: () => void;
  backLabel?: string;
  onSwitchSession: (session: AgentSession) => void;
}) {
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatViewport = useVisualViewport();

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

  const scrollContentKey = `${assistant.contentRevision}|${assistant.messages.length}|${assistant.isLoading}|${displayError ?? ''}`;

  const {
    containerRef: transcriptRef,
    isFollowing,
    hasUnseenContent,
    scrollToBottom,
  } = useScrollFollow({
    contentKey: scrollContentKey,
  });

  const [isSessionDetailsOpen, setIsSessionDetailsOpen] = useState(false);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);

  const change = spec;

  const handleInspectTask = useCallback((target: TaskNavigationTarget | string) => {
    const taskId = typeof target === 'string' ? target : target.taskId;
    const task = change?.tasks?.find((t) => t.id === taskId);
    if (task) {
      setIsSessionDetailsOpen(false);
      setInspectedTaskId(taskId);
    }
  }, [change?.tasks]);

  const rawTaskIds = sessionDetails?.taskIds && sessionDetails.taskIds.length > 0
    ? sessionDetails.taskIds
    : (sessionDetails?.taskId ? [sessionDetails.taskId] : []);
  const sessionTaskItems = useMemo(() => {
    if (!rawTaskIds.length) return [];
    return rawTaskIds.map((taskId) => {
      const matchedTask = change?.tasks?.find((t) => t.id === taskId);
      return {
        id: taskId,
        title: matchedTask?.title || taskId,
        isClickable: Boolean(matchedTask),
      };
    });
  }, [rawTaskIds, change?.tasks]);

  const workByTurnId = useMemo(() => {
    const projection = projectTranscript(assistant.messages, { activeTurnId: assistant.activeTurnId });
    return new Map(projection.workByTurn.map(work => [work.turnId, work]));
  }, [assistant.messages, assistant.activeTurnId]);

  useEffect(() => {
    setRuntimeError(null);
  }, [provider, sessionId]);

  useEffect(() => {
    if (!chatViewport.keyboardOpen || !isFollowing) return;
    window.scrollTo(0, 0);
    scrollToBottom('auto');
  }, [chatViewport.height, chatViewport.keyboardOpen, isFollowing, scrollToBottom]);

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
    scrollToBottom('auto');
    try {
      await assistant.sendTurn(trimmed, { mode: currentMode });
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant.canStartTurn, assistant.sendTurn, currentMode, isProviderAvailable, scrollToBottom]);

  const shellClassName = 'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--background)]';
  const shellStyle = chatViewport.height
    ? {
        height: `${chatViewport.height}px`,
        transform: `translateY(${chatViewport.offsetTop}px)`,
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

  const header = (
    <AgentSessionHeader
      title={headerTitle}
      status={session ? formatSessionStatus(assistant.activity) : undefined}
      live={assistant.live}
      onBack={onBack}
      backLabel={backLabel}
      onOpenDetails={() => setIsSessionDetailsOpen(true)}
    />
  );

  return (
    <AssistantRuntimeProvider runtime={assistant.runtime}>
      <div className={shellClassName} style={shellStyle}>
        {header}

        <Sheet open={isSessionDetailsOpen} onOpenChange={setIsSessionDetailsOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Szczegóły sesji</SheetTitle>
              <SheetDescription>
                Kontekst wykonania i powiązania aktywnej sesji AI
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <AgentSessionDetails
                specTitle={change?.title}
                specId={session?.specId}
                specSlug={change?.slug}
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
            </div>
          </SheetContent>
        </Sheet>

        {!providersQuery.loading && providersQuery.data && !isProviderAvailable && (
          <div className="shrink-0 border-b border-[var(--warning-border)] bg-[var(--warning-muted)] px-3 py-2.5 sm:px-6">
            <div className="mx-auto flex max-w-4xl items-start gap-2.5 text-xs text-[var(--warning-strong)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Provider {providerInfo?.label || provider} nie jest dostępny</p>
                <p className="mt-0.5 text-[11px] text-[color-mix(in_srgb,var(--warning-strong)_80%,transparent)]">
                  {providerUnavailableReason}
                </p>
              </div>
            </div>
          </div>
        )}

        <div
          ref={transcriptRef}
          onPointerDown={handleTranscriptPointerDown}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
        >
          <div className="mx-auto max-w-4xl space-y-5">
            {assistant.loadError && !assistant.sessionDetails && (
              <div className="py-16 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger)]">
                  <AlertTriangle className="size-6" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-[var(--foreground)]">
                  {'title' in assistant.loadError && typeof (assistant.loadError as any).title === 'string'
                    ? (assistant.loadError as any).title
                    : 'Nie można wczytać sesji'}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-xs text-[var(--muted)]">
                  {assistant.loadError.message || 'Wystąpił nieoczekiwany błąd podczas wczytywania sesji.'}
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <Button variant="default" size="sm" onClick={() => void handleReload()}>
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Spróbuj ponownie
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="mr-1.5 size-3.5" />
                    Wróć do specyfikacji
                  </Button>
                </div>
              </div>
            )}
            {assistant.isLoading && !assistant.sessionDetails && !assistant.loadError && (
              <div className="py-20 text-center">
                <LoaderCircle className="mx-auto size-7 animate-spin text-[var(--accent)]" />
                <p className="mt-3 text-xs text-[var(--muted)]">Wczytywanie sesji czatu...</p>
              </div>
            )}
            {!assistant.isLoading && !assistant.loadError && !assistant.messages.length && !assistant.isRunning && (
              <div className="py-20 text-center text-xs text-[var(--muted)]">
                <p className="font-semibold text-[var(--foreground)]">Brak wiadomości w sesji</p>
                <p className="mt-1">Wpisz pierwszą wiadomość, aby rozpocząć konwersację z agentem.</p>
              </div>
            )}
            {assistant.messages.map((message) => {
              const turnWork = message.turnId ? workByTurnId.get(message.turnId) : undefined;
              const work = turnWork?.messageId === message.id ? turnWork : undefined;
              return <TranscriptMessage key={message.id} message={message} work={work} />;
            })}
            {assistant.pendingInteraction?.kind === 'permission' && (
              <PermissionPrompt
                interaction={assistant.pendingInteraction as Extract<AgentInteraction, { kind: 'permission' }>}
                disabled={false}
                onResolve={response => void handleRespondInteraction(assistant.pendingInteraction!.id, response)}
              />
            )}
            {assistant.pendingInteraction?.kind === 'question' && (
              <QuestionPrompt
                interaction={assistant.pendingInteraction as AgentQuestionInteraction}
                disabled={false}
                onResolve={response => void handleRespondInteraction(assistant.pendingInteraction!.id, response)}
              />
            )}
            {displayError && (
              <div className={cn(
                'flex items-start gap-3 rounded-xl p-3.5 text-xs',
                displayError.toLowerCase().includes('cancelled')
                  ? 'border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
                  : 'border border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger-strong)]'
              )}>
                <AlertTriangle className={cn(
                  'mt-0.5 size-4 shrink-0',
                  displayError.toLowerCase().includes('cancelled') ? 'text-[var(--muted)]' : 'text-[var(--danger)]'
                )} />
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'font-semibold',
                    displayError.toLowerCase().includes('cancelled') ? 'text-[var(--foreground)]' : 'text-[var(--danger-strong)]'
                  )}>
                    {displayError.toLowerCase().includes('cancelled') ? 'Generowanie przerwane' : 'Komunikat agenta'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] opacity-90">{displayError}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canRetryInitial && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleRetryInitial()}
                      className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                    >
                      <RefreshCw className="size-3" />
                      Ponów próbę
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={handleDismissError}
                    className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:opacity-100 hover:bg-white/10"
                  >
                    Zamknij
                  </button>
                </div>
              </div>
            )}
            {hasUnseenContent && !isFollowing && (
              <div className="sticky bottom-3 z-20 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => scrollToBottom('smooth')}
                  className="gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)]/95 px-3.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-lg backdrop-blur-sm transition-all hover:bg-[var(--surface-hover)]"
                >
                  <ChevronDown className="size-3.5" />
                  Nowe wiadomości
                </Button>
              </div>
            )}
          </div>
        </div>

        <footer className={cn('shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 sm:px-6', chatViewport.keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]')}>
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

        {inspectedTaskId && change && (
          <TaskDialog
            change={change}
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
