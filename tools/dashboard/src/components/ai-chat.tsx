import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  X,
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
import { ChatHeader } from '@/components/chat-header';
import { SessionDetails } from '@/components/session-details';
import { ChatComposer } from '@/components/composer';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useNevoAssistantRuntime } from '@/lib/nevo-assistant-runtime';
import { ChatMessage } from '@/components/conversation/chat-message';
import { PermissionPrompt, QuestionPrompt } from '@/components/ai-interaction-prompt';
import { WorkSummary } from '@/components/work/work-summary';
import { hasVisibleProse, shouldRenderChatMessage } from '@/components/work/work-visibility';
import {
  useAiProviders,
  useCreateAiSession,
  useDeleteAiSession,
} from '@/hooks/use-dashboard-data';
import { initialPromptWithTaskContext } from '@/lib/ai-chat-helpers';
import { AI_ADAPTERS_CONFIG_PATH } from '@/lib/ai-adapter-config';
import { projectChat } from '@/lib/chat-projection';
import { useScrollFollow } from '@/lib/use-scroll-follow';
import { TaskDialog } from '@/components/task-dialog';
import type {
  AgentExecutionMode,
  AiInteraction,
  AiMessage,
  AiQuestionInteraction,
  AiSession,
  DashboardChange,
  TaskNavigationTarget,
} from '@/lib/types';
import { cn } from '@/lib/utils';

import { pendingDispatchStore } from '@/lib/pending-dispatch-store';

function useChatVisualViewport() {
  const [viewport, setViewport] = useState<{ height: number | null; offsetTop: number; keyboardOpen: boolean }>({
    height: null,
    offsetTop: 0,
    keyboardOpen: false,
  });
  const baselineHeight = useRef(0);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
        const offsetTop = visualViewport ? Math.max(0, Math.round(visualViewport.offsetTop)) : 0;
        baselineHeight.current = Math.max(baselineHeight.current, height);
        const active = document.activeElement;
        const keyboard = Boolean(
          active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true') &&
          visualViewport &&
          visualViewport.height < baselineHeight.current - 80
        );
        setViewport({
          height: visualViewport ? Math.round(visualViewport.height) : null,
          offsetTop,
          keyboardOpen: keyboard,
        });
      });
    };

    const resetBaseline = () => {
      baselineHeight.current = 0;
      measure();
    };

    measure();
    visualViewport?.addEventListener('resize', measure);
    visualViewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', resetBaseline);
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    return () => {
      cancelAnimationFrame(frame);
      visualViewport?.removeEventListener('resize', measure);
      visualViewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', resetBaseline);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
    };
  }, []);

  return viewport;
}

export function AiChatPage({
  provider,
  sessionId,
  changes,
  initialTurnId,
  onTurnChange,
  onBack,
  backLabel,
  onSwitchSession,
  onOpenTask,
}: {
  provider: string;
  sessionId: string;
  changes: DashboardChange[];
  initialTurnId: string | null;
  onTurnChange: (turnId: string | null) => void;
  onBack: () => void;
  backLabel: string;
  onSwitchSession: (session: AiSession) => void;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
}) {
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatViewport = useChatVisualViewport();

  const handleTranscriptPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const isInteractive = target?.closest('button, a, input, textarea, select, [role="button"], summary, details, [data-interactive="true"]');
    if (!isInteractive && composerTextareaRef.current && document.activeElement === composerTextareaRef.current) {
      composerTextareaRef.current.blur();
    }
  };

  const assistant = useNevoAssistantRuntime({
    provider,
    providerSessionId: sessionId,
    onTurnCompleted: () => {
      onTurnChange(null);
      setSubmissionError(null);
    },
    onError: (err) => {
      setSubmissionError(err.message);
    },
  });

  const scrollContentKey = `${assistant.contentRevision}|${assistant.messages.length}|${assistant.isLoading}|${submissionError ?? ''}`;

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

  const session = assistant.sessionDetails;
  const change = changes.find(item => item.specId === session?.specId) ?? null;

  const handleInspectTask = useCallback((target: TaskNavigationTarget | string) => {
    const taskId = typeof target === 'string' ? target : target.taskId;
    const targetSlug = typeof target === 'string' ? null : target.specSlug;
    setIsSessionDetailsOpen(false);
    if (!targetSlug || targetSlug === change?.slug) {
      setInspectedTaskId(taskId);
      return;
    }
    onOpenTask?.(target);
  }, [change, onOpenTask]);

  const rawTaskIds = session?.taskIds && session.taskIds.length > 0 ? session.taskIds : (session?.taskId ? [session.taskId] : []);
  const sessionTaskItems = useMemo(() => {
    if (!rawTaskIds.length) return [];
    return rawTaskIds.map((taskId) => {
      const matchedTask = change?.tasks?.find((t) => t.id === taskId);
      return {
        id: taskId,
        title: matchedTask?.title || taskId,
        isClickable: Boolean(change && matchedTask),
      };
    });
  }, [rawTaskIds, change]);

  const workByTurnId = useMemo(() => {
    const projection = projectChat(assistant.messages, { activeTurnId: assistant.activeTurnId });
    return new Map(projection.workByTurn.map(work => [work.turnId, work]));
  }, [assistant.messages, assistant.activeTurnId]);

  useEffect(() => {
    onTurnChange(assistant.activeTurnId);
  }, [assistant.activeTurnId, onTurnChange]);

  useEffect(() => {
    setSubmissionError(null);
  }, [provider, sessionId]);

  useEffect(() => {
    if (!chatViewport.keyboardOpen || !isFollowing) return;
    window.scrollTo(0, 0);
    scrollToBottom('auto');
  }, [chatViewport.height, chatViewport.keyboardOpen, isFollowing, scrollToBottom]);

  const [selectedModeOverride, setSelectedModeOverride] = useState<AgentExecutionMode | null>(null);
  const currentMode: AgentExecutionMode = selectedModeOverride ?? session?.mode ?? 'edit';
  const { deleteSession, deleting } = useDeleteAiSession();

  const handleDeleteSession = async () => {
    if (!window.confirm('Czy na pewno chcesz usunąć tę sesję z dysku?')) return;
    try {
      await deleteSession({ provider, sessionId });
      onBack();
    } catch (err) {
      setSubmissionError(err instanceof Error ? err.message : String(err));
    }
  };

  const providersQuery = useAiProviders();
  const providerInfo = providersQuery.data?.providers.find((p) => p.id === provider);
  const isProviderAvailable = Boolean(providerInfo && providerInfo.available !== false);
  const providerUnavailableReason = providerInfo
    ? (providerInfo.unavailableReason || 'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH. Nie można wysyłać kolejnych wiadomości.')
    : `Adapter '${provider}' nie jest włączony w ${AI_ADAPTERS_CONFIG_PATH}. Włącz go i uruchom dashboard ponownie.`;

  const submitMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !assistant.canStartTurn || !isProviderAvailable) return;
    setSubmissionError(null);
    scrollToBottom('auto');
    try {
      await assistant.sendTurn(trimmed, { mode: currentMode });
    } catch (err) {
      setSubmissionError(err instanceof Error ? err.message : String(err));
    }
  }, [assistant.canStartTurn, assistant.sendTurn, currentMode, isProviderAvailable, scrollToBottom]);

  const sessionKey = `${provider}:${sessionId}`;
  const activeSessionKeyRef = useRef(sessionKey);
  activeSessionKeyRef.current = sessionKey;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [retryTrigger, setRetryTrigger] = useState(0);

  const handleRetryInitialDispatch = useCallback(() => {
    const retried = pendingDispatchStore.retryPending(provider, sessionId);
    if (retried) {
      setSubmissionError(null);
      setRetryTrigger((c) => c + 1);
    }
  }, [provider, sessionId]);

  useEffect(() => {
    if (!isProviderAvailable || !assistant.isReady) return;
    const pending = pendingDispatchStore.getPending(provider, sessionId);
    if (!pending || pending.status === 'in-flight' || pending.status === 'completed') return;

    pendingDispatchStore.markInFlight(provider, sessionId);
    setSubmissionError(null);

    (async () => {
      try {
        await assistant.sendTurn(pending.prompt, {
          mode: currentMode,
          idempotencyKey: pending.idempotencyKey,
        });
        pendingDispatchStore.clearPending(provider, sessionId);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pendingDispatchStore.markFailed(provider, sessionId, errorMsg);
        if (isMountedRef.current && activeSessionKeyRef.current === sessionKey) {
          setSubmissionError(errorMsg);
        }
      }
    })();
  }, [assistant.isReady, assistant.sendTurn, currentMode, isProviderAvailable, provider, sessionId, sessionKey, retryTrigger]);

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
    <ChatHeader
      title={headerTitle}
      status={session ? assistant.activity : undefined}
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
              <SessionDetails
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
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2.5 sm:px-6">
            <div className="mx-auto flex max-w-4xl items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Provider {providerInfo?.label || provider} nie jest dostępny</p>
                <p className="mt-0.5 text-[11px] text-amber-200/80">
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
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-400">
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
                  <Button variant="default" size="sm" onClick={() => void assistant.reload()}>
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
              return <ChatMessage key={message.id} message={message} work={work} />;
            })}
            {assistant.pendingInteraction?.kind === 'permission' && (
              <PermissionPrompt
                interaction={assistant.pendingInteraction as Extract<AiInteraction, { kind: 'permission' }>}
                disabled={false}
                onResolve={response => void assistant.respondInteraction(assistant.pendingInteraction!.id, response)}
              />
            )}
            {assistant.pendingInteraction?.kind === 'question' && (
              <QuestionPrompt
                interaction={assistant.pendingInteraction as AiQuestionInteraction}
                disabled={false}
                onResolve={response => void assistant.respondInteraction(assistant.pendingInteraction!.id, response)}
              />
            )}
            {submissionError && (
              <div className={cn(
                'flex items-start gap-3 rounded-xl p-3.5 text-xs',
                submissionError.toLowerCase().includes('cancelled')
                  ? 'border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'
                  : 'border border-red-500/30 bg-red-500/10 text-red-200'
              )}>
                <AlertTriangle className={cn(
                  'mt-0.5 size-4 shrink-0',
                  submissionError.toLowerCase().includes('cancelled') ? 'text-[var(--muted)]' : 'text-red-400'
                )} />
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'font-semibold',
                    submissionError.toLowerCase().includes('cancelled') ? 'text-[var(--foreground)]' : 'text-red-300'
                  )}>
                    {submissionError.toLowerCase().includes('cancelled') ? 'Generowanie przerwane' : 'Komunikat agenta'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] opacity-90">{submissionError}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pendingDispatchStore.getPending(provider, sessionId)?.status === 'failed' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleRetryInitialDispatch}
                      className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                    >
                      <RefreshCw className="size-3" />
                      Ponów próbę
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubmissionError(null)}
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
            <ChatComposer
              key={sessionId}
              textareaRef={composerTextareaRef}
              currentMode={currentMode}
              onModeChange={(m) => setSelectedModeOverride(m)}
              onSend={(text) => submitMessage(text)}
              onCancel={() => void assistant.cancelTurn()}
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
              setInspectedTaskId(null);
              onSwitchSession(s);
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

export function CreateAiSessionDialog({ change, onClose, onCreated }: { change: DashboardChange; onClose: () => void; onCreated: (session: AiSession, initialMessage: string | null) => void }) {
  const providers = useAiProviders();
  const createSession = useCreateAiSession();
  const enabledProviders = providers.data?.providers.filter(provider => provider.enabled) ?? [];
  const [provider, setProvider] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  useEffect(() => { if (!provider && enabledProviders[0]) setProvider(enabledProviders[0].id); }, [enabledProviders, provider]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!change.specId || !provider) return;
    const session = await createSession.create({ provider, specId: change.specId, taskIds, ...(title.trim() ? { title: title.trim() } : {}) });
    const promptToSend = initialPromptWithTaskContext(initialMessage, taskIds, {
      slug: change.slug,
      title: change.title,
      tasks: change.tasks,
    });
    onCreated(session, promptToSend);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !createSession.creating) onClose(); }}>
      <form onSubmit={event => void submit(event)} className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{change.title}</p><h2 className="mt-2 text-xl font-semibold">Nowa sesja AI</h2></div><Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={createSession.creating} aria-label="Zamknij tworzenie sesji"><X className="size-4" /></Button></div>
        {providers.loading ? <div className="mt-6 flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin" />Wczytywanie providerów…</div> : providers.error ? <div className="mt-6 rounded-xl border border-red-400/20 p-4 text-sm text-red-200">Providerzy są niedostępni.</div> : !enabledProviders.length ? <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">Brak providera obsługującego tworzenie sesji.</div> : <>
          <label className="mt-6 block text-xs font-semibold">Provider<select value={provider} onChange={event => setProvider(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm">{enabledProviders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="mt-4 block text-xs font-semibold">Tytuł <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]" /></label>
          {change.tasks && change.tasks.length > 0 && <fieldset className="mt-5"><legend className="text-xs font-semibold">Kontekst zadań <span className="font-normal text-[var(--muted)]">(zero lub wiele)</span></legend><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Wybrane taski zostaną powiązane z sesją i dopisane do pierwszej wiadomości.</p><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] p-2">{change.tasks.map(task => <label key={task.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-xs hover:bg-white/4"><input type="checkbox" className="mt-0.5" checked={taskIds.includes(task.id)} onChange={event => setTaskIds(previous => event.target.checked ? [...previous, task.id] : previous.filter(id => id !== task.id))} /><span><span className="font-semibold text-[var(--foreground)]">{task.title}</span><span className="mt-0.5 block text-[10px] text-[var(--muted)]">{task.id}</span></span></label>)}</div>{taskIds.length > 0 && <code className="mt-2 block break-words rounded-lg border border-[var(--border)] bg-black/20 p-2 text-[10px] text-[var(--muted-strong)]">Context: tasks {taskIds.join(', ')}</code>}</fieldset>}
          <label className="mt-4 block text-xs font-semibold">Pierwsza wiadomość <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span><textarea value={initialMessage} onChange={event => setInitialMessage(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm outline-none focus:border-[var(--accent)]" placeholder="Zostaw puste, aby rozpocząć później." /></label>
          {createSession.error && <p className="mt-3 text-xs text-red-200">{createSession.error}</p>}
          <Button className="mt-6 w-full" type="submit" disabled={!provider || createSession.creating}>{createSession.creating ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <MessageSquarePlus className="mr-2 size-4" />}Utwórz i otwórz</Button>
        </>}
      </form>
    </div>
  );
}
