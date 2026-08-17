import { useState, useEffect } from 'react';
import { Bot, LoaderCircle, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProviderBadge } from '@/components/ai-session-list';
import { useAiProviders, useCreateAiSession } from '@/hooks/use-dashboard-data';
import { initialPromptWithTaskContext } from '@/lib/ai-chat-helpers';
import type { AiSession, DashboardChange } from '@/lib/types';

export interface AiSessionCreateModalProps {
  change: DashboardChange;
  onClose: () => void;
  onCreated: (session: AiSession, initialMessage: string | null) => void;
}

export function AiSessionCreateModal({
  change,
  onClose,
  onCreated,
}: AiSessionCreateModalProps) {
  const providers = useAiProviders();
  const createSession = useCreateAiSession();
  const enabledProviders =
    providers.data?.providers.filter((p) => p.enabled) ?? [];

  const [provider, setProvider] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [initialMessage, setInitialMessage] = useState('');

  useEffect(() => {
    if (!provider && enabledProviders[0]) {
      setProvider(enabledProviders[0].id);
    }
  }, [enabledProviders, provider]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!change.specId || !provider) return;
    const session = await createSession.create({
      provider,
      specId: change.specId,
      taskIds,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    onCreated(session, initialPromptWithTaskContext(initialMessage, taskIds));
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
          <div className="mt-6 rounded-xl border border-red-400/20 p-4 text-sm text-red-200">
            Providerzy są niedostępni.
          </div>
        ) : !enabledProviders.length ? (
          <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
            Brak aktywnych agentów / providerów.
          </div>
        ) : (
          <>
            <label className="mt-6 block text-xs font-semibold">
              Provider
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {enabledProviders.map((p) => {
                  const selected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                          : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                      }`}
                    >
                      <ProviderBadge provider={p.id} />
                      <span className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </label>

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

            <fieldset className="mt-5">
              <legend className="text-xs font-semibold">
                Kontekst zadań <span className="font-normal text-[var(--muted)]">(zero lub wiele)</span>
              </legend>
              <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
                Wybrane taski zostaną powiązane z sesją i dołączone do pierwszego turnu.
              </p>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                {change.tasks.map((task) => (
                  <label
                    key={task.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-xs hover:bg-white/4"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={taskIds.includes(task.id)}
                      onChange={(event) =>
                        setTaskIds((prev) =>
                          event.target.checked
                            ? [...prev, task.id]
                            : prev.filter((id) => id !== task.id)
                        )
                      }
                    />
                    <span>
                      <span className="font-semibold text-[var(--foreground)]">{task.title}</span>
                      <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{task.id}</span>
                    </span>
                  </label>
                ))}
              </div>
              {taskIds.length > 0 && (
                <code className="mt-2 block break-words rounded-lg border border-[var(--border)] bg-black/20 p-2 text-[10px] text-[var(--muted-strong)]">
                  Context: tasks {taskIds.join(', ')}
                </code>
              )}
            </fieldset>

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

            {createSession.error && (
              <p className="mt-3 text-xs text-red-200">{createSession.error}</p>
            )}

            <Button
              className="mt-6 w-full"
              type="submit"
              disabled={!provider || createSession.creating}
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
