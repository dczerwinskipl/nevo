import { useState, useEffect } from 'react';
import { Bot, FilePlus2, LoaderCircle, Sparkles, X, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProviderBadge } from '@/components/ai-session-list';
import { useAiProviders, useCreateAiSession, useCreateSpecification, type CreateSpecificationResult } from '@/hooks/use-dashboard-data';
import { slugifyTitle, generateInitialPrompt, SPEC_TYPES_OPTIONS } from '@/lib/spec-create-helpers';
import type { AiSession, AgentExecutionMode } from '@/lib/types';

export interface SpecCreateModalProps {
  onClose: () => void;
  onCreated: (spec: CreateSpecificationResult, session?: AiSession | null, initialPrompt?: string | null) => void;
}

export function SpecCreateModal({ onClose, onCreated }: SpecCreateModalProps) {
  const providers = useAiProviders();
  const specMutation = useCreateSpecification();
  const createAiSession = useCreateAiSession();

  const enabledProviders = (providers.data?.providers.filter((p) => p.enabled) ?? []).sort((a, b) => {
    if (a.id === 'mock') return 1;
    if (b.id === 'mock') return -1;
    return 0;
  });
  const availableProviders = enabledProviders.filter((p) => p.available !== false);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [type, setType] = useState<'standard' | 'architectural' | 'small' | 'exploratory'>('standard');
  const [goal, setGoal] = useState('');

  // AI planning state
  const [startAiSession, setStartAiSession] = useState(false);
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<AgentExecutionMode>('agent');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [promptManuallyEdited, setPromptManuallyEdited] = useState(false);

  // Two-phase execution state
  const [createdSpec, setCreatedSpec] = useState<CreateSpecificationResult | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-generate slug when title changes unless manually touched (or if slug is empty)
  const handleTitleChange = (val: string) => {
    setTitle(val);
    const newSlug = (!slugManuallyEdited || !slug.trim()) ? slugifyTitle(val) : slug;
    if (!slugManuallyEdited || !slug.trim()) {
      setSlug(newSlug);
    }
    if (!promptManuallyEdited) {
      setInitialPrompt(generateInitialPrompt(val, goal, newSlug));
    }
  };

  const handleSlugChange = (val: string) => {
    setSlug(val);
    if (!val.trim()) {
      setSlugManuallyEdited(false);
      const autoSlug = slugifyTitle(title);
      if (!promptManuallyEdited) {
        setInitialPrompt(generateInitialPrompt(title, goal, autoSlug));
      }
    } else {
      setSlugManuallyEdited(true);
      if (!promptManuallyEdited) {
        setInitialPrompt(generateInitialPrompt(title, goal, val));
      }
    }
  };

  const handleSyncSlugWithTitle = () => {
    const autoSlug = slugifyTitle(title);
    setSlug(autoSlug);
    setSlugManuallyEdited(false);
    if (!promptManuallyEdited) {
      setInitialPrompt(generateInitialPrompt(title, goal, autoSlug));
    }
  };

  const handleGoalChange = (val: string) => {
    setGoal(val);
    if (!promptManuallyEdited) {
      setInitialPrompt(generateInitialPrompt(title, val, slug));
    }
  };

  // Initialize provider and mode when available
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
    }
  }, [availableProviders, provider]);

  // When selected provider changes, revalidate supported modes
  const handleProviderChange = (newProviderId: string) => {
    setProvider(newProviderId);
    const pObj = enabledProviders.find((p) => p.id === newProviderId);
    if (pObj) {
      const supported = pObj.supportedModes || ['ask', 'edit', 'agent'];
      if (supported.includes('agent')) {
        setMode('agent');
      } else {
        setMode(pObj.defaultMode || 'edit');
      }
    }
  };

  const selectedProviderObj = enabledProviders.find((p) => p.id === provider);
  const isSelectedProviderAvailable = selectedProviderObj?.available !== false;
  const supportedModes = selectedProviderObj?.supportedModes || ['ask', 'edit', 'agent'];

  const executeAiSessionKickoff = async (spec: CreateSpecificationResult) => {
    const session = await createAiSession.create({
      provider,
      specId: spec.specId,
      mode,
      title: 'Planowanie specyfikacji',
    });

    onCreated(spec, session, initialPrompt);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSpecError(null);
    setAiError(null);
    setIsSubmitting(true);

    try {
      let specResult = createdSpec;

      // Phase 1: Create spec skeleton if not already created
      if (!specResult) {
        specResult = await specMutation.createSpecification({
          slug: slug.trim(),
          title: title.trim(),
          type,
          goal: goal.trim(),
        });
        setCreatedSpec(specResult);
      }

      // Phase 2: Optional AI planning session
      if (startAiSession) {
        if (!provider || !isSelectedProviderAvailable) {
          throw new Error('Wybrany provider AI jest niedostępny.');
        }
        try {
          await executeAiSessionKickoff(specResult);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setAiError(msg);
          setIsSubmitting(false);
          return;
        }
      } else {
        onCreated(specResult, null, null);
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpecError(msg);
      setIsSubmitting(false);
    }
  };

  const handleOpenSpecWithoutAi = () => {
    if (createdSpec) {
      onCreated(createdSpec, null, null);
      onClose();
    }
  };

  const handleRetryAi = async () => {
    if (!createdSpec) return;
    setAiError(null);
    setIsSubmitting(true);
    try {
      await executeAiSessionKickoff(createdSpec);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiError(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]">
              <FilePlus2 className="size-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                Workflow Specyfikacji
              </p>
              <h2 className="mt-1 text-xl font-semibold">Nowa specyfikacja</h2>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Zamknij tworzenie specyfikacji"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Phase 1 Spec Creation Error */}
        {specError && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="font-semibold">Błąd tworzenia specyfikacji</p>
              <p className="mt-0.5 text-red-300/90">{specError}</p>
            </div>
          </div>
        )}

        {/* Phase 2 AI Session Error with 2-action recovery */}
        {aiError && createdSpec && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="font-semibold">Specyfikacja została utworzona pomyślnie</p>
                <p className="mt-1 text-amber-300/90">
                  Uruchomienie sesji AI nie powiodło się: {aiError}
                </p>
              </div>
            </div>
            <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-amber-500/20 pt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleOpenSpecWithoutAi}
                className="h-8 gap-1.5 text-xs"
              >
                Otwórz specyfikację
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRetryAi()}
                disabled={isSubmitting}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                {isSubmitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Spróbuj ponownie
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="spec-title" className="block text-xs font-semibold">
              Tytuł specyfikacji <span className="text-red-400">*</span>
            </label>
            <input
              id="spec-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              disabled={Boolean(createdSpec)}
              required
              maxLength={200}
              placeholder="np. Multi-provider local agent chat"
              className="mt-1.5 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
          </div>

          {/* Slug */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="spec-slug" className="block text-xs font-semibold">
                Identyfikator / Slug <span className="text-red-400">*</span>
              </label>
              {slugManuallyEdited && title.trim() && slug !== slugifyTitle(title) && (
                <button
                  type="button"
                  onClick={handleSyncSlugWithTitle}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
                >
                  <RefreshCw className="size-3" />
                  Zsynchronizuj z tytułem
                </button>
              )}
            </div>
            <input
              id="spec-slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              disabled={Boolean(createdSpec)}
              required
              pattern="^[a-z0-9][a-z0-9._-]*$"
              placeholder="np. multi-provider-agent-sessions"
              className="mt-1.5 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-xs outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              Dozwolone: małe litery, cyfry, kropki, podkreślenia i myślniki (musi zaczynać się od litery lub cyfry).
            </p>
          </div>

          {/* Type / Class */}
          <div>
            <label className="block text-xs font-semibold">Klasa specyfikacji</label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SPEC_TYPES_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={Boolean(createdSpec)}
                  onClick={() => setType(item.id as typeof type)}
                  className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                    type === item.id
                      ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                  } disabled:opacity-60`}
                >
                  <span className="text-xs font-semibold text-[var(--foreground)]">{item.label}</span>
                  <span className="mt-0.5 text-[9px] text-[var(--muted)]">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Goal */}
          <div>
            <label htmlFor="spec-goal" className="block text-xs font-semibold">
              Cel / Opis <span className="font-normal text-[var(--muted)]">(opcjonalnie)</span>
            </label>
            <textarea
              id="spec-goal"
              value={goal}
              onChange={(e) => handleGoalChange(e.target.value)}
              disabled={Boolean(createdSpec)}
              rows={2}
              placeholder="Krótki opis celu biznesowego lub technicznego…"
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
          </div>

          {/* Step 2: Optional AI Planning Session Toggle */}
          <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] p-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-4 text-[var(--accent)]" />
                <div>
                  <p className="text-xs font-semibold text-[var(--foreground)]">
                    Rozpocznij sesję AI do zaplanowania specyfikacji
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    Uruchom agenta kodującego z kontekstem nowej specyfikacji zaraz po jej utworzeniu.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={startAiSession}
                onChange={(e) => setStartAiSession(e.target.checked)}
                disabled={Boolean(createdSpec)}
                className="size-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
            </label>

            {startAiSession && (
              <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
                {/* Providers */}
                <div>
                  <label className="block text-xs font-semibold">Wybierz agenta / providera</label>
                  {providers.loading ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
                      <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" />
                      Wczytywanie providerów…
                    </div>
                  ) : !enabledProviders.length ? (
                    <p className="mt-2 text-xs text-[var(--muted)]">Brak dostępnych providerów.</p>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {enabledProviders.map((p) => {
                        const isAvailable = p.available !== false;
                        const isSelected = provider === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!isAvailable}
                            onClick={() => handleProviderChange(p.id)}
                            className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                              !isAvailable
                                ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface)] opacity-40'
                                : isSelected
                                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                                : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <ProviderBadge provider={p.id} />
                              {!isAvailable && (
                                <span className="text-[9px] font-medium text-amber-300">Niedostępny</span>
                              )}
                            </div>
                            <span className="mt-1 text-xs font-semibold text-[var(--foreground)]">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Execution Mode */}
                <div>
                  <label className="block text-xs font-semibold">Tryb wykonania</label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { id: 'ask', label: 'Ask (Plan)', desc: 'Tylko analiza i planowanie' },
                      { id: 'edit', label: 'Edit (Domyślny)', desc: 'Standardowa edycja' },
                      { id: 'agent', label: 'Agent (Auto)', desc: 'Pełna autonomia' },
                    ]
                      .filter((m) => supportedModes.includes(m.id as AgentExecutionMode))
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setMode(item.id as AgentExecutionMode)}
                          className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                            mode === item.id
                              ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[var(--accent)]'
                              : 'border-[var(--border)] bg-[var(--surface)] hover:border-white/20'
                          }`}
                        >
                          <span className="text-xs font-semibold text-[var(--foreground)]">{item.label}</span>
                          <span className="mt-0.5 text-[9px] text-[var(--muted)]">{item.desc}</span>
                        </button>
                      ))}
                  </div>
                </div>

                {/* Initial Prompt */}
                <div>
                  <label htmlFor="initial-prompt" className="block text-xs font-semibold">
                    Początkowy prompt dla agenta
                  </label>
                  <textarea
                    id="initial-prompt"
                    value={initialPrompt}
                    onChange={(e) => {
                      setInitialPrompt(e.target.value);
                      setPromptManuallyEdited(true);
                    }}
                    rows={4}
                    className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        {!aiError && (
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Anuluj
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !title.trim() || !slug.trim() || (startAiSession && (!provider || !isSelectedProviderAvailable))}
              className="gap-2 font-semibold"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Tworzenie…
                </>
              ) : startAiSession ? (
                <>
                  <Bot className="size-4" />
                  Utwórz specyfikację i rozpocznij sesję
                </>
              ) : (
                <>
                  <FilePlus2 className="size-4" />
                  Utwórz specyfikację
                </>
              )}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
