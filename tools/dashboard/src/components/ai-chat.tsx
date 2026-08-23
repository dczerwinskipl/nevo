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
import { projectChat } from '@/lib/chat-projection';
import { useScrollFollow } from '@/lib/use-scroll-follow';
import type {
  AgentExecutionMode,
  AiInteraction,
  AiMessage,
  AiQuestionInteraction,
  AiSession,
  DashboardChange,
} from '@/lib/types';
import { cn } from '@/lib/utils';


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
        const textEntryFocused = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
        const keyboardOpen = textEntryFocused && height < baselineHeight.current - 80;

        if (textEntryFocused && window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }

        setViewport(previous => previous.height === height && previous.offsetTop === offsetTop && previous.keyboardOpen === keyboardOpen
          ? previous
          : { height, offsetTop, keyboardOpen });
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
  initialMessage,
  onInitialMessageConsumed,
  onTurnChange,
  onBack,
  backLabel,
  onSwitchSession,
}: {
  provider: string;
  sessionId: string;
  changes: DashboardChange[];
  initialTurnId: string | null;
  initialMessage: string | null;
  onInitialMessageConsumed: () => void;
  onTurnChange: (turnId: string | null) => void;
  onBack: () => void;
  backLabel: string;
  onSwitchSession: (session: AiSession) => void;
}) {
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const initialSent = useRef(false);
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

  const scrollContentKey = `${assistant.contentRevision}|${submissionError ?? ''}`;

  const {
    containerRef: transcriptRef,
    isFollowing,
    hasUnseenContent,
    scrollToBottom,
  } = useScrollFollow({
    contentKey: scrollContentKey,
  });

  const [isSessionDetailsOpen, setIsSessionDetailsOpen] = useState(false);

  const session = assistant.sessionDetails;
  const change = changes.find(item => item.specId === session?.specId) ?? null;
  const linkedTasks = session?.taskIds && session.taskIds.length > 0 ? session.taskIds : (session?.taskId ? [session.taskId] : []);

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
  const isProviderAvailable = providerInfo?.available !== false;

  const submitMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || assistant.activity !== 'idle' || !isProviderAvailable) return;
    setSubmissionError(null);
    await assistant.sendTurn(trimmed, { mode: currentMode });
  }, [assistant, isProviderAvailable, currentMode]);

  useEffect(() => {
    if (!initialMessage || initialSent.current) return;
    if (assistant.isLoading && !assistant.sessionDetails && !assistant.loadError) return;
    initialSent.current = true;
    void submitMessage(initialMessage).finally(onInitialMessageConsumed);
  }, [initialMessage, onInitialMessageConsumed, submitMessage, assistant.isLoading, assistant.sessionDetails, assistant.loadError]);

  const shellStyle = chatViewport.height == null ? undefined : { height: `${chatViewport.height}px`, top: `${chatViewport.offsetTop}px` };
  const shellClassName = 'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--background)]';

  if (assistant.isLoading && !assistant.sessionDetails && !assistant.loadError) {
    return (
      <div className={shellClassName} style={shellStyle}>
        <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-3 py-2.5 backdrop-blur-xl sm:px-5">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onBack} aria-label={backLabel} title={backLabel}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="text-xs text-[var(--muted)]">Ładowanie sesji...</span>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <LoaderCircle className="size-8 animate-spin text-[var(--accent)]" />
            <p className="text-sm font-medium text-[var(--muted)]">Wczytywanie historii i stanu rozmowy...</p>
          </div>
        </div>
      </div>
    );
  }

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
                tasks={linkedTasks}
                provider={provider}
                mode={currentMode}
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

        {!isProviderAvailable && providerInfo && (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2.5 sm:px-6">
            <div className="mx-auto flex max-w-4xl items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Provider {providerInfo.label} nie jest dostępny</p>
                <p className="mt-0.5 text-[11px] text-amber-200/80">
                  {providerInfo.unavailableReason || 'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH. Nie można wysyłać kolejnych wiadomości.'}
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
                <button
                  type="button"
                  onClick={() => setSubmissionError(null)}
                  className="rounded px-1.5 py-0.5 text-[10px] opacity-70 hover:opacity-100 hover:bg-white/10"
                >
                  Zamknij
                </button>
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
              disabled={assistant.activity !== 'idle' && !assistant.isRunning}
              placeholder={assistant.activity === 'waitingForUser' ? 'Odpowiedz na pytanie powyżej…' : undefined}
              loadError={assistant.loadError}
            />
          </div>
        </footer>
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
