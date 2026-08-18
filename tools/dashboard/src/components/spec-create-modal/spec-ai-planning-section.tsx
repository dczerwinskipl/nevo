import { LoaderCircle, Sparkles } from 'lucide-react';
import { ProviderBadge } from '@/components/ai-session-list';
import type { AgentExecutionMode, AiProviderDescriptor } from '@/lib/types';

export interface SpecAiPlanningSectionProps {
  startAiSession: boolean;
  onToggleAiSession: (enabled: boolean) => void;
  providersLoading: boolean;
  enabledProviders: AiProviderDescriptor[];
  selectedProviderId: string;
  onProviderChange: (providerId: string) => void;
  supportedModes: AgentExecutionMode[];
  selectedMode: AgentExecutionMode;
  onModeChange: (mode: AgentExecutionMode) => void;
  initialPrompt: string;
  onPromptChange: (prompt: string) => void;
  disabled: boolean;
}

export function SpecAiPlanningSection({
  startAiSession,
  onToggleAiSession,
  providersLoading,
  enabledProviders,
  selectedProviderId,
  onProviderChange,
  supportedModes,
  selectedMode,
  onModeChange,
  initialPrompt,
  onPromptChange,
  disabled,
}: SpecAiPlanningSectionProps) {
  return (
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
          onChange={(e) => onToggleAiSession(e.target.checked)}
          disabled={disabled}
          className="size-4 rounded border-[var(--border)] accent-[var(--accent)]"
        />
      </label>

      {startAiSession && (
        <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
          {/* Providers */}
          <div>
            <label className="block text-xs font-semibold">Wybierz agenta / providera</label>
            {providersLoading ? (
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
                  const isSelected = selectedProviderId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => onProviderChange(p.id)}
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
                { id: 'agent', label: 'Agent (Auto)', desc: 'Pełna autonomia (Domyślny)' },
                { id: 'edit', label: 'Edit', desc: 'Standardowa edycja' },
                { id: 'ask', label: 'Ask (Plan)', desc: 'Tylko analiza i planowanie' },
              ]
                .filter((m) => supportedModes.includes(m.id as AgentExecutionMode))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onModeChange(item.id as AgentExecutionMode)}
                    className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                      selectedMode === item.id
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
              onChange={(e) => onPromptChange(e.target.value)}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
