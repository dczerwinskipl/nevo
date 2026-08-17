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
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useNevoAssistantRuntime } from '@/lib/nevo-assistant-runtime';
import {
  useAiProviders,
  useCreateAiSession,
} from '@/hooks/use-dashboard-data';
import { initialPromptWithTaskContext } from '@/lib/ai-chat-helpers';
import type {
  AiInteraction,
  AiMessage,
  AiQuestionInteraction,
  AiSession,
  DashboardChange,
  NormalizedMessage,
} from '@/lib/types';
import { cn } from '@/lib/utils';

function ChatMessage({ message }: { message: Pick<AiMessage, 'id' | 'role' | 'text'> }) {
  const user = message.role === 'user';
  return (
    <div className={cn('flex gap-3', user && 'justify-end')}>
      {!user && <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]"><Bot className="size-4" /></div>}
      <div className={cn('max-w-[min(84%,760px)] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6', user ? 'bg-[var(--accent)] text-[#111604]' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]')}>
        {message.text}
      </div>
      {user && <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"><User className="size-4" /></div>}
    </div>
  );
}

function PermissionPrompt({ interaction, disabled, onResolve }: { interaction: Extract<AiInteraction, { kind: 'permission' }>; disabled: boolean; onResolve: (response: unknown) => void }) {
  return (
    <Card className="border-amber-300/25 bg-amber-300/5 p-4">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-200" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--foreground)]">Wymagana zgoda: {interaction.toolName}</p>
          {interaction.details && <p className="mt-1 text-xs text-[var(--muted)]">{interaction.details}</p>}
          {interaction.input && <pre className="mt-3 max-h-36 overflow-auto rounded-lg border border-[var(--border)] bg-black/20 p-3 text-[10px] text-[var(--muted-strong)]">{JSON.stringify(interaction.input, null, 2)}</pre>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled} onClick={() => onResolve({ decision: 'allow' })}><Check className="mr-1.5 size-3.5" />Zezwól</Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onResolve({ decision: 'deny' })}><X className="mr-1.5 size-3.5" />Odmów</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function QuestionPrompt({ interaction, disabled, onResolve }: { interaction: AiQuestionInteraction; disabled: boolean; onResolve: (response: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const ready = interaction.questions.every(question => {
    const value = answers[question.id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  });
  return (
    <Card className="border-[color-mix(in_srgb,var(--accent)_25%,var(--border))] p-4">
      <p className="text-sm font-semibold text-[var(--foreground)]">Pytania do Ciebie</p>
      <div className="mt-4 space-y-5">
        {interaction.questions.map(question => (
          <fieldset key={question.id}>
            <legend className="text-xs font-semibold text-[var(--foreground)]">{question.header ? `${question.header}: ` : ''}{question.question}</legend>
            {question.options?.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map(option => {
              const current = answers[question.id];
              const checked = Array.isArray(current) ? current.includes(option.label) : current === option.label;
              return <label key={option.label} className={cn('flex cursor-pointer gap-2 rounded-lg border p-3 text-xs', checked ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border)]')}>
                <input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id} checked={checked} onChange={() => { setCustomAnswers(previous => ({ ...previous, [question.id]: '' })); setAnswers(previous => {
                  if (!question.multiSelect) return { ...previous, [question.id]: option.label };
                  const values = Array.isArray(previous[question.id]) ? previous[question.id] as string[] : [];
                  return { ...previous, [question.id]: checked ? values.filter(value => value !== option.label) : [...values, option.label] };
                }); }} />
                <span><span className="font-semibold text-[var(--foreground)]">{option.label}</span>{option.description && <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">{option.description}</span>}</span>
              </label>;
            })}<label className={cn('rounded-lg border p-3 text-xs sm:col-span-2', customAnswers[question.id] ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border)]')}><span className="font-semibold text-[var(--foreground)]">Inna odpowiedź</span><input className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-xs" placeholder="Wpisz własną odpowiedź…" value={customAnswers[question.id] || ''} onChange={event => { const value = event.target.value; setCustomAnswers(previous => ({ ...previous, [question.id]: value })); setAnswers(previous => ({ ...previous, [question.id]: question.multiSelect ? (value.trim() ? [value] : []) : value })); }} /></label></div> : <input className="mt-2 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-sm" value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} />}
          </fieldset>
        ))}
      </div>
      <Button className="mt-5" size="sm" disabled={disabled || !ready} onClick={() => onResolve({ answers: interaction.questions.map(question => ({ questionId: question.id, value: answers[question.id] })) })}>Wyślij odpowiedzi</Button>
    </Card>
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
        const height = Math.round(visualViewport?.height ?? window.innerHeight);
        const offsetTop = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));
        baselineHeight.current = Math.max(baselineHeight.current, height);
        const active = document.activeElement;
        const textEntryFocused = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
        const keyboardOpen = textEntryFocused && height < baselineHeight.current - 80;
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
    },
    onError: (err) => {
      setSubmissionError(err.message);
    },
  });

  const session = assistant.sessionDetails;
  const change = changes.find(item => item.specId === session?.specId) ?? null;
  const linkedTasks = session?.taskId ? [session.taskId] : [];

  useEffect(() => {
    onTurnChange(assistant.activeTurnId);
  }, [assistant.activeTurnId, onTurnChange]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [assistant.messages, assistant.pendingInteraction]);

  useEffect(() => {
    if (!chatViewport.keyboardOpen) return;
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [chatViewport.height, chatViewport.keyboardOpen]);

  const submitMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || assistant.isRunning) return;
    setSubmissionError(null);
    setComposer('');
    await assistant.sendTurn(trimmed);
  }, [assistant]);

  useEffect(() => {
    if (!initialMessage || initialSent.current) return;
    initialSent.current = true;
    void submitMessage(initialMessage).finally(onInitialMessageConsumed);
  }, [initialMessage, onInitialMessageConsumed, submitMessage]);

  const shellStyle = chatViewport.height == null ? undefined : { height: `${chatViewport.height}px`, top: `${chatViewport.offsetTop}px` };
  const shellClassName = 'fixed inset-x-0 top-0 flex h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--background)]';

  const header = (
    <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-3 py-2.5 backdrop-blur-xl sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button variant="ghost" size="icon" className="size-8 shrink-0 sm:hidden" onClick={onBack} aria-label={backLabel} title={backLabel}><ArrowLeft className="size-4" /></Button>
          <Button variant="secondary" size="sm" className="hidden shrink-0 sm:inline-flex" onClick={onBack}><ArrowLeft className="mr-1.5 size-3.5" />{backLabel}</Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">{session?.title || (session ? `Sesja ${session.providerSessionId.slice(0, 12)}` : `${provider} sesja`)}</p>
              {session && <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[9px] text-[var(--muted)]">{assistant.isRunning ? 'running' : session.status}</span>}
            </div>
          </div>
          {assistant.isRunning && assistant.capabilities?.cancelTurn && (
            <Button variant="secondary" size="sm" onClick={() => void assistant.cancelTurn()}><CircleStop className="mr-1.5 size-3.5" />Przerwij</Button>
          )}
        </div>
        <p className="mt-1 truncate text-[10px] text-[var(--muted)]"><span className="text-[var(--muted-strong)]">{change?.title || session?.specId || 'Specyfikacja'}</span> · {session ? (linkedTasks.length ? linkedTasks.join(' · ') : 'cała specyfikacja') : 'sesja'} · {provider}</p>
      </div>
    </header>
  );

  return (
    <AssistantRuntimeProvider runtime={assistant.runtime}>
      <div className={shellClassName} style={shellStyle}>
        {header}

        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6">
          <div className="mx-auto max-w-4xl space-y-5">
            {!assistant.messages.length && !assistant.isRunning && (
              <div className="py-16 text-center">
                <Bot className="mx-auto size-7 text-[var(--accent)]" />
                <h2 className="mt-4 text-base font-semibold">Nowa rozmowa ({provider})</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Napisz wiadomość, aby rozpocząć pierwszy turn.</p>
              </div>
            )}
            {assistant.messages.map(message => <ChatMessage key={message.id} message={message} />)}
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
              <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">
                {submissionError}
              </div>
            )}
          </div>
        </div>

        <footer className={cn('shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 sm:px-6', chatViewport.keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]')}>
          <form className="mx-auto flex max-w-4xl items-end gap-2" onSubmit={event => { event.preventDefault(); void submitMessage(composer); }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Wiadomość</span>
              <textarea
                rows={1}
                value={composer}
                onChange={event => setComposer(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitMessage(composer);
                  }
                }}
                disabled={session?.status === 'completed'}
                placeholder={session?.status === 'completed' ? 'Ta sesja jest tylko do odczytu' : assistant.isRunning ? 'Turn trwa…' : 'Napisz wiadomość…'}
                className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              />
            </label>
            <Button
              size="icon"
              className="size-11 shrink-0"
              type="submit"
              disabled={!composer.trim() || assistant.isRunning || session?.status === 'completed'}
              aria-label="Wyślij wiadomość"
            >
              {assistant.isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </form>
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
    onCreated(session, initialPromptWithTaskContext(initialMessage, taskIds));
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !createSession.creating) onClose(); }}>
      <form onSubmit={event => void submit(event)} className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{change.title}</p><h2 className="mt-2 text-xl font-semibold">Nowa sesja AI</h2></div><Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={createSession.creating} aria-label="Zamknij tworzenie sesji"><X className="size-4" /></Button></div>
        {providers.loading ? <div className="mt-6 flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin" />Wczytywanie providerów…</div> : providers.error ? <div className="mt-6 rounded-xl border border-red-400/20 p-4 text-sm text-red-200">Providerzy są niedostępni.</div> : !enabledProviders.length ? <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">Brak providera obsługującego tworzenie sesji.</div> : <>
          <label className="mt-6 block text-xs font-semibold">Provider<select value={provider} onChange={event => setProvider(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm">{enabledProviders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="mt-4 block text-xs font-semibold">Tytuł <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]" /></label>
          <fieldset className="mt-5"><legend className="text-xs font-semibold">Kontekst zadań <span className="font-normal text-[var(--muted)]">(zero lub wiele)</span></legend><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Wybrane taski zostaną powiązane z sesją i dopisane do pierwszej wiadomości.</p><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] p-2">{change.tasks.map(task => <label key={task.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-xs hover:bg-white/4"><input type="checkbox" className="mt-0.5" checked={taskIds.includes(task.id)} onChange={event => setTaskIds(previous => event.target.checked ? [...previous, task.id] : previous.filter(id => id !== task.id))} /><span><span className="font-semibold text-[var(--foreground)]">{task.title}</span><span className="mt-0.5 block text-[10px] text-[var(--muted)]">{task.id}</span></span></label>)}</div>{taskIds.length > 0 && <code className="mt-2 block break-words rounded-lg border border-[var(--border)] bg-black/20 p-2 text-[10px] text-[var(--muted-strong)]">Context: tasks {taskIds.join(', ')}</code>}</fieldset>
          <label className="mt-4 block text-xs font-semibold">Pierwsza wiadomość <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span><textarea value={initialMessage} onChange={event => setInitialMessage(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm outline-none focus:border-[var(--accent)]" placeholder="Zostaw puste, aby rozpocząć później." /></label>
          {createSession.error && <p className="mt-3 text-xs text-red-200">{createSession.error}</p>}
          <Button className="mt-6 w-full" type="submit" disabled={!provider || createSession.creating}>{createSession.creating ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <MessageSquarePlus className="mr-2 size-4" />}Utwórz i otwórz</Button>
        </>}
      </form>
    </div>
  );
}
