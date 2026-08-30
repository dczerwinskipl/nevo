import { useState, useEffect } from 'react';
import { LoaderCircle, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProviderBadge } from './agent-session-list';
import { useAgentProviders, useCreateAgentSession } from './queries';
import { initialPromptWithTaskContext } from './create-agent-session-helpers';
import { AI_MODES } from './mode-meta';
import { AI_PROVIDERS_ENABLE_MESSAGE } from './provider-config';
import type { AgentSession, AgentExecutionMode } from './types';
import type { SpecificationSummary } from '@/features/specifications/types';

export interface CreateAgentSessionDialogProps {
  change: SpecificationSummary;
  onClose: () => void;
  onCreated: (session: AgentSession, initialMessage: string | null) => void;
}

export function CreateAgentSessionDialog({
  change,
  onClose,
  onCreated,
}: CreateAgentSessionDialogProps) {
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
    if (!change.specId || !provider || !isSelectedProviderAvailable) return;
    const session = await createSession.create({
      provider,
      specId: change.specId,
      taskIds,
      mode,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    const promptToSend = initialPromptWithTaskContext(initialMessage, taskIds, {
      slug: change.slug,
      title: change.title,
      tasks: change.tasks,
    });
    onCreated(session, promptToSend);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !createSession.creating) onClose();
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              {change.title}
            </p>
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
          <div className="mt-6 flex items-center gap-2 text-sm text-[var(--muted)]">
            <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
            Wczytywanie providerów…
          </div>
        ) : providers.error ? (
          <div className="mt-6 rounded-xl border border-[var(--danger-border)] p-4 text-sm text-[var(--danger-strong)]">
            Providerzy są niedostępni.
          </div>
        ) : !enabledProviders.length ? (
          <div className="mt-6 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-muted)] p-4 text-sm text-[var(--warning-strong)]">
            {AI_PROVIDERS_ENABLE_MESSAGE}
          </div>
        ) : (
          <>
            <fieldset className="mt-6">
              <legend className="text-xs font-semibold text-[var(--foreground)]">
                Provider
              </legend>
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
                      title={!isAvail ? (p.unavailableReason || 'Brak CLI w systemie') : undefined}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                          : !isAvail
                          ? 'border-dashed border-[var(--border)] bg-black/10 opacity-60 hover:opacity-100 hover:border-[var(--warning-border)]'
                          : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <ProviderBadge provider={p.id} />
                        {!isAvail && (
                          <span className="rounded bg-[var(--warning-muted)] px-1 py-0.2 text-[8px] font-bold uppercase tracking-wider text-[var(--warning)]">
                            Brak CLI
                          </span>
                        )}
                      </div>
                      <span className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-[var(--foreground)]">
                Tryb wykonania
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {AI_MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mode === item.id}
                    onClick={() => setMode(item.id)}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                      mode === item.id
                        ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                    }`}
                  >
                    <span className="text-xs font-semibold text-[var(--foreground)]">{item.label}</span>
                    <span className="mt-0.5 text-[10px] text-[var(--muted)]">{item.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block text-xs font-semibold">
              Tytuł <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="np. Dyskusja nad architekturą sesji"
                className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>

            {change.tasks && change.tasks.length > 0 && (
              <fieldset className="mt-5">
                <legend className="text-xs font-semibold">
                  Kontekst zadań <span className="font-normal text-[var(--muted)]">(zero lub wiele)</span>
                </legend>
                <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  {change.tasks.map((task) => {
                    const checked = taskIds.includes(task.id);
                    return (
                      <label
                        key={task.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setTaskIds((prev) =>
                              checked ? prev.filter((id) => id !== task.id) : [...prev, task.id]
                            )
                          }
                          className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-0"
                        />
                        <span className="font-mono text-[10px] text-[var(--muted)]">{task.id}</span>
                        <span className="truncate font-medium text-[var(--foreground)]">{task.title}</span>
                      </label>
                    );
                  })}
                </div>
                {taskIds.length > 0 && (
                  <code className="mt-2 block break-words rounded-lg border border-[var(--border)] bg-black/20 p-2 text-[10px] text-[var(--muted-strong)]">
                    Context: tasks {taskIds.join(', ')}
                  </code>
                )}
              </fieldset>
            )}

            <label className="mt-4 block text-xs font-semibold">
              Pierwsza wiadomość <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span>
              <textarea
                value={initialMessage}
                onChange={(event) => setInitialMessage(event.target.value)}
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="Zostaw puste, aby rozpocząć później."
              />
            </label>

            {!isSelectedProviderAvailable && selectedProviderObj && (
              <div className="mt-3 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-muted)] p-3 text-xs text-[var(--warning-strong)]">
                <p className="font-semibold">Provider niedostępny w systemie</p>
                <p className="mt-0.5 text-[11px] text-[color-mix(in_srgb,var(--warning-strong)_80%,transparent)]">
                  {selectedProviderObj.unavailableReason || 'Brak wymaganego narzędzia CLI w zmiennej środowiskowej PATH.'}
                </p>
              </div>
            )}

            {createSession.error && (
              <p className="mt-3 text-xs text-[var(--danger-strong)]">{createSession.error}</p>
            )}

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
