import { useState, useEffect } from 'react';
import { LoaderCircle, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { ProviderBadge } from './agent-session-list';
import { useAgentProviders, useCreateAgentSession } from './queries';
import { initialPromptWithTaskContext } from './create-agent-session-helpers';
import { AI_MODES } from './mode-meta';
import { AI_PROVIDERS_ENABLE_MESSAGE } from './provider-config';
import type { AgentSession, AgentExecutionMode } from './types';
import type { SpecificationSummary } from '@/features/specifications/types';
import { cn } from '@/lib/utils';

export interface CreateAgentSessionDialogProps {
  specification: SpecificationSummary;
  onClose: () => void;
  /** `promptToSend` is the enriched text actually sent to the provider; `userMessage` is
   * the clean, user-typed text alone (never Nevo-injected context) — the chat-bubble source. */
  onCreated: (session: AgentSession, promptToSend: string | null, userMessage: string | null) => void;
}

export function CreateAgentSessionDialog({ specification, onClose, onCreated }: CreateAgentSessionDialogProps) {
  const providers = useAgentProviders();
  const createSession = useCreateAgentSession();
  const enabledProviders = providers.data?.providers.filter((p) => p.enabled) ?? [];

  const availableProviders = enabledProviders.filter((p) => p.available !== false);

  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<AgentExecutionMode>('agent');
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [initialMessage, setInitialMessage] = useState('');

  useEffect(() => {
    if (!provider && availableProviders[0]) {
      const initP = availableProviders[0];
      setProvider(initP.id);
      const supported = initP.supportedModes || ['ask', 'edit', 'agent'];
      if (supported.includes('agent')) {
        setMode('agent');
      } else {
        setMode(initP.defaultMode || 'edit');
      }
    } else if (!provider && enabledProviders[0]) {
      const initP = enabledProviders[0];
      setProvider(initP.id);
      const supported = initP.supportedModes || ['ask', 'edit', 'agent'];
      if (supported.includes('agent')) {
        setMode('agent');
      } else {
        setMode(initP.defaultMode || 'edit');
      }
    }
  }, [availableProviders, enabledProviders, provider]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !createSession.creating) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createSession.creating, onClose]);

  const selectedProviderObj = enabledProviders.find((p) => p.id === provider);
  const isSelectedProviderAvailable = selectedProviderObj?.available !== false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!specification.specId || !provider || !isSelectedProviderAvailable) return;
    const session = await createSession.create({
      provider,
      specId: specification.specId,
      taskIds,
      mode,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    const promptToSend = initialPromptWithTaskContext(initialMessage, taskIds, {
      slug: specification.slug,
      title: specification.title,
      tasks: specification.tasks,
    });
    onCreated(session, promptToSend, initialMessage.trim() || null);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-backdrop backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !createSession.creating) onClose();
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-accent uppercase">{specification.title}</p>
            <h2 className="mt-2 text-xl font-semibold">Nowa sesja AI</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={createSession.creating}
            aria-label="Zamknij tworzenie sesji"
          >
            <X className="size-4" />
          </Button>
        </div>

        {providers.loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
            <LoaderCircle className="size-4 animate-spin text-accent" />
            Wczytywanie providerów…
          </div>
        ) : providers.error ? (
          <div className="mt-6 rounded-xl border border-status-error/25 bg-status-error/10 p-4 text-sm text-status-error">
            Providerzy są niedostępni.
          </div>
        ) : !enabledProviders.length ? (
          <div className="mt-6 rounded-xl border border-status-warning/25 bg-status-warning/10 p-4 text-sm text-status-warning">
            {AI_PROVIDERS_ENABLE_MESSAGE}
          </div>
        ) : (
          <>
            <fieldset className="mt-6">
              <legend className="text-xs font-semibold text-fg-primary">Provider</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {enabledProviders.map((p) => {
                  const selected = provider === p.id;
                  const isAvail = p.available !== false;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setProvider(p.id)}
                      title={!isAvail ? p.unavailableReason || 'Brak CLI w systemie' : undefined}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all',
                        selected && 'border-accent bg-accent/8 ring-1 ring-accent',
                        !selected &&
                          !isAvail &&
                          'border-dashed border-border bg-surface-raised/40 opacity-60 hover:border-status-warning/35 hover:opacity-100',
                        !selected && isAvail && 'border-border bg-surface hover:border-border-strong',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <ProviderBadge provider={p.id} />
                        {!isAvail && (
                          <span className="py-0.2 rounded bg-status-warning/10 px-1 text-[8px] font-bold tracking-wider text-status-warning uppercase">
                            Brak CLI
                          </span>
                        )}
                      </div>
                      <span className="mt-1 text-xs font-semibold text-fg-primary">{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-fg-primary">Tryb wykonania</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {AI_MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mode === item.id}
                    onClick={() => setMode(item.id)}
                    className={cn(
                      'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all',
                      mode === item.id && 'border-accent bg-accent/8 ring-1 ring-accent',
                      mode !== item.id && 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    <span className="text-xs font-semibold text-fg-primary">{item.label}</span>
                    <span className="mt-0.5 text-[10px] text-fg-muted">{item.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block text-xs font-semibold">
              Tytuł <span className="font-normal text-fg-muted">(opcjonalnie)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="np. Dyskusja nad architekturą sesji"
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
              />
            </label>

            {specification.tasks && specification.tasks.length > 0 && (
              <fieldset className="mt-5">
                <legend className="text-xs font-semibold">
                  Kontekst zadań <span className="font-normal text-fg-muted">(zero lub wiele)</span>
                </legend>
                <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface p-2">
                  {specification.tasks.map((task) => {
                    const checked = taskIds.includes(task.id);
                    return (
                      <label
                        key={task.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-fg-primary/5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setTaskIds((prev) => (checked ? prev.filter((id) => id !== task.id) : [...prev, task.id]))
                          }
                          className="rounded border-border text-accent focus:ring-0"
                        />
                        <span className="font-mono text-[10px] text-fg-muted">{task.id}</span>
                        <span className="truncate font-medium text-fg-primary">{task.title}</span>
                      </label>
                    );
                  })}
                </div>
                {taskIds.length > 0 && (
                  <code className="mt-2 block rounded-lg border border-border bg-surface-raised p-2 text-[10px] break-words text-fg-secondary">
                    Context: tasks {taskIds.join(', ')}
                  </code>
                )}
              </fieldset>
            )}

            <label className="mt-4 block text-xs font-semibold">
              Pierwsza wiadomość <span className="font-normal text-fg-muted">(opcjonalnie)</span>
              <textarea
                value={initialMessage}
                onChange={(event) => setInitialMessage(event.target.value)}
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-border bg-surface p-3 text-sm outline-none focus:border-accent"
                placeholder="Zostaw puste, aby rozpocząć później."
              />
            </label>

            {!isSelectedProviderAvailable && selectedProviderObj && (
              <div className="mt-3 rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
                <p className="font-semibold">Provider niedostępny w systemie</p>
                <p className="mt-0.5 text-[11px] text-status-warning/80">
                  {selectedProviderObj.unavailableReason ||
                    'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH.'}
                </p>
              </div>
            )}

            {createSession.error && <p className="mt-3 text-xs text-status-error">{createSession.error}</p>}

            <Button
              className="mt-6 w-full"
              type="submit"
              disabled={!provider || !isSelectedProviderAvailable || createSession.creating}
            >
              {createSession.creating ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="mr-2 size-4" />
              )}
              Utwórz i otwórz
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
