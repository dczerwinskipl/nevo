import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CircleStop,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useNevoAssistantRuntime } from '@/lib/nevo-assistant-runtime';
import { AiReasoningView } from '@/components/ai-reasoning-view';
import { MarkdownContent } from '@/components/markdown-content';
import { PermissionPrompt, QuestionPrompt } from '@/components/ai-interaction-prompt';
import { WorkSummary } from '@/components/work/work-summary';
import { hasVisibleProse, shouldRenderChatMessage } from '@/components/work/work-visibility';
import {
  useAiProviders,
  useCreateAiSession,
  useDeleteAiSession,
} from '@/hooks/use-dashboard-data';
import { initialPromptWithTaskContext } from '@/lib/ai-chat-helpers';
import { projectChat, type TurnWork } from '@/lib/chat-projection';
import type {
  AgentExecutionMode,
  AiInteraction,
  AiMessage,
  AiQuestionInteraction,
  AiSession,
  DashboardChange,
  NormalizedMessage,
} from '@/lib/types';
import { cn } from '@/lib/utils';

function ChatMessage({ message, work, isStreaming = false }: { message: NormalizedMessage; work?: TurnWork; isStreaming?: boolean }) {
  const user = message.role === 'user';
  const hasProse = hasVisibleProse(message);

  // Nothing to show yet (no prose, no Work) — e.g. the brief moment a turn has started
  // but no content has streamed in — render nothing rather than an empty bubble/circle;
  // the transcript's own "isRunning" indicator already covers this loading state.
  if (!shouldRenderChatMessage(message, Boolean(work))) return null;

  return (
    <div className={cn('flex gap-3', user && 'justify-end')}>
      {!user && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]">
          <Bot className="size-4" />
        </div>
      )}
      <div className={cn('min-w-0 space-y-1.5', user ? 'flex max-w-[min(88%,820px)] flex-col items-end' : 'flex-1')}>
        {/* Work is a flat transcript row, never nested inside the prose card below —
            a turn with no prose renders Work directly with no card around it at all. */}
        {work && <WorkSummary work={work} />}
        {hasProse && (
          <div className={cn(
            'max-w-[min(88%,820px)] rounded-2xl px-4 py-3 text-sm leading-6',
            user
              ? 'border border-[#2e3746] bg-[#161c24] text-[var(--foreground)]'
              : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]'
          )}>
            {message.reasoning && (
              <AiReasoningView reasoning={message.reasoning} isStreaming={isStreaming && !message.text} />
            )}
            {message.text && (
              user ? (
                <div className="whitespace-pre-wrap font-normal text-[var(--foreground)]">{message.text}</div>
              ) : (
                <MarkdownContent markdown={message.text} className="text-[var(--foreground)]" />
              )
            )}
          </div>
        )}
      </div>
      {user && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted-strong)]">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}



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
  const [composer, setComposer] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const initialSent = useRef(false);
  const chatViewport = useChatVisualViewport();

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

  const session = assistant.sessionDetails;
  const change = changes.find(item => item.specId === session?.specId) ?? null;
  const linkedTasks = session?.taskId ? [session.taskId] : [];

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
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [assistant.messages, assistant.pendingInteraction, submissionError]);

  useEffect(() => {
    if (!chatViewport.keyboardOpen) return;
    window.scrollTo(0, 0);
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [chatViewport.height, chatViewport.keyboardOpen]);

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
    if (!trimmed || assistant.isRunning || !isProviderAvailable) return;
    setSubmissionError(null);
    setComposer('');
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

  const header = (
    <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-3 py-2.5 backdrop-blur-xl sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onBack} aria-label={backLabel} title={backLabel}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                {session?.title?.trim() ||
                  (session?.purpose?.trim() && session.purpose !== 'attached' && session.purpose !== 'interactive'
                    ? session.purpose.trim()
                    : '') ||
                  (session?.taskId ? `Zadanie: ${session.taskId}` : '') ||
                  (session?.purpose?.trim() ? session.purpose.trim() : '') ||
                  (session ? `Sesja ${session.providerSessionId.slice(0, 12)}` : `${provider} sesja`)}
              </p>
              {session && <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[9px] text-[var(--muted)]">{assistant.isRunning ? 'running' : session.status}</span>}
              <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[10px]">
                {(['ask', 'edit', 'agent'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedModeOverride(m)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[9px] transition-colors',
                      currentMode === m
                        ? 'bg-[var(--accent)] text-[#111604]'
                        : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                    )}
                    title={
                      m === 'ask'
                        ? 'Tryb Ask (Plan) - tylko odczyt i analiza bez modyfikacji plików'
                        : m === 'edit'
                        ? 'Tryb Edit (Domyślny) - bezpieczna edycja kodu w workspace'
                        : 'Tryb Agent (Auto) - pełna autonomia z pominięciem pytań o uprawnienia'
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {assistant.isRunning && assistant.capabilities?.cancelTurn && (
              <Button variant="secondary" size="sm" onClick={() => void assistant.cancelTurn()}><CircleStop className="mr-1.5 size-3.5" />Przerwij</Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-[var(--muted)] hover:bg-red-500/15 hover:text-red-400"
              onClick={() => void handleDeleteSession()}
              disabled={deleting || assistant.isRunning}
              title="Usuń sesję z dysku"
            >
              {deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </div>
        </div>
        <p className="mt-1 truncate text-[10px] text-[var(--muted)]"><span className="text-[var(--muted-strong)]">{change?.title || session?.specId || 'Specyfikacja'}</span> · {session ? (linkedTasks.length ? linkedTasks.join(' · ') : 'cała specyfikacja') : 'sesja'} · {provider}</p>
      </div>
    </header>
  );

  return (
    <AssistantRuntimeProvider runtime={assistant.runtime}>
      <div className={shellClassName} style={shellStyle}>
        {header}

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

        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6">
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
              <div className="py-16 text-center">
                <Bot className="mx-auto size-7 text-[var(--accent)]" />
                <h2 className="mt-4 text-base font-semibold">Nowa rozmowa ({provider})</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Napisz wiadomość, aby rozpocząć pierwszy turn.</p>
              </div>
            )}
            {assistant.messages.map(message => {
              // Work is rendered exactly once per turn — at the anchor message
              // (TurnWork.messageId). Other messages in the same turn render prose only.
              const turnWork = message.turnId ? workByTurnId.get(message.turnId) : undefined;
              const work = turnWork?.messageId === message.id ? turnWork : undefined;
              return <ChatMessage key={message.id} message={message} work={work} />;
            })}
            {assistant.isRunning && !assistant.pendingInteraction && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]" role="status">
                <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" />
                {provider} generuje odpowiedź…
              </div>
            )}
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
          </div>
        </div>

        <footer className={cn('shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 sm:px-6', chatViewport.keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]')}>
          <div className="mx-auto max-w-4xl">
            <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void submitMessage(composer); }}>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Wiadomość</span>
                <textarea
                  rows={1}
                  value={composer}
                  onChange={event => setComposer(event.target.value)}
                  onFocus={() => {
                    window.scrollTo(0, 0);
                    setTimeout(() => {
                      transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
                    }, 100);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submitMessage(composer);
                    }
                  }}
                  disabled={session?.status === 'completed' || !isProviderAvailable || Boolean(assistant.loadError)}
                  placeholder={
                    assistant.loadError
                      ? ('kind' in assistant.loadError && (assistant.loadError as any).kind === 'not_found'
                          ? 'Sesja nie została znaleziona...'
                          : 'Serwer dashboardu jest niedostępny...')
                      : !isProviderAvailable
                      ? 'Provider CLI niedostępny (brak w PATH)'
                      : session?.status === 'completed'
                      ? 'Ta sesja jest tylko do odczytu'
                      : assistant.isRunning
                      ? 'Turn trwa…'
                      : 'Napisz wiadomość…'
                  }
                  className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                />
              </label>
              <Button
                size="icon"
                className="size-11 shrink-0"
                type={assistant.isRunning ? 'button' : 'submit'}
                onClick={assistant.isRunning ? () => void assistant.cancelTurn() : undefined}
                disabled={
                  assistant.isRunning
                    ? !assistant.capabilities?.cancelTurn
                    : !composer.trim() || session?.status === 'completed' || !isProviderAvailable || Boolean(assistant.loadError)
                }
                aria-label={assistant.isRunning ? 'Przerwij generowanie' : 'Wyślij wiadomość'}
                title={assistant.isRunning ? 'Przerwij generowanie' : assistant.loadError ? assistant.loadError.message : 'Wyślij wiadomość'}
              >
                {assistant.isRunning ? <CircleStop className="size-4" /> : <Send className="size-4" />}
              </Button>
            </form>
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
