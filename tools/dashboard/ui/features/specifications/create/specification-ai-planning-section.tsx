import { LoaderCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProviderBadge } from '@/features/agent-sessions/agent-session-list';
import type { AgentExecutionMode, AgentProviderDescriptor } from '@/features/agent-sessions/types';
import { AI_PROVIDERS_ENABLE_MESSAGE } from '@/features/agent-sessions/provider-config';

export interface SpecificationAiPlanningSectionProps {
  startAiSession: boolean;
  onToggleAiSession: (enabled: boolean) => void;
  providersLoading: boolean;
  enabledProviders: AgentProviderDescriptor[];
  selectedProviderId: string;
  onProviderChange: (providerId: string) => void;
  supportedModes: AgentExecutionMode[];
  selectedMode: AgentExecutionMode;
  onModeChange: (mode: AgentExecutionMode) => void;
  initialPrompt: string;
  onPromptChange: (prompt: string) => void;
  disabled: boolean;
}

export function SpecificationAiPlanningSection({
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
}: SpecificationAiPlanningSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="size-4 text-accent" />
          <div>
            <p className="text-xs font-semibold text-fg-primary">Rozpocznij sesję AI do zaplanowania specyfikacji</p>
            <p className="text-[10px] text-fg-muted">
              Uruchom agenta kodującego z kontekstem nowej specyfikacji zaraz po jej utworzeniu.
            </p>
          </div>
        </div>
        <input
          type="checkbox"
          checked={startAiSession}
          onChange={(e) => onToggleAiSession(e.target.checked)}
          disabled={disabled}
          className="size-4 rounded border-border accent-accent"
        />
      </label>

      {startAiSession && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {/* Providers */}
          <div>
            <label className="block text-xs font-semibold">Wybierz agenta / providera</label>
            {providersLoading ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                <LoaderCircle className="size-3.5 animate-spin text-accent" />
                Wczytywanie providerów…
              </div>
            ) : !enabledProviders.length ? (
              <p className="mt-2 rounded-lg border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
                {AI_PROVIDERS_ENABLE_MESSAGE}
              </p>
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
                      className={cn(
                        'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all',
                        !isAvailable
                          ? 'cursor-not-allowed border-border bg-surface opacity-40'
                          : isSelected
                            ? 'border-accent bg-accent/8 ring-1 ring-accent'
                            : 'border-border bg-surface hover:border-fg-primary/20',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <ProviderBadge provider={p.id} />
                        {!isAvailable && (
                          <span className="text-[9px] font-medium text-status-warning">Niedostępny</span>
                        )}
                      </div>
                      <span className="mt-1 text-xs font-semibold text-fg-primary">{p.label}</span>
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
                { id: 'ask', label: 'Ask (Plan)', desc: 'Analiza i planowanie (Domyślny)' },
                { id: 'edit', label: 'Edit', desc: 'Standardowa edycja' },
                { id: 'agent', label: 'Agent (Auto)', desc: 'Pełna autonomia' },
              ]
                .filter((m) => supportedModes.includes(m.id as AgentExecutionMode))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onModeChange(item.id as AgentExecutionMode)}
                    className={cn(
                      'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all',
                      selectedMode === item.id
                        ? 'border-accent bg-accent/8 ring-1 ring-accent'
                        : 'border-border bg-surface hover:border-fg-primary/20',
                    )}
                  >
                    <span className="text-xs font-semibold text-fg-primary">{item.label}</span>
                    <span className="mt-0.5 text-[9px] text-fg-muted">{item.desc}</span>
                  </button>
                ))}
            </div>
          </div>

          {/* Initial Message */}
          <div>
            <label htmlFor="initial-prompt" className="block text-xs font-semibold">
              Pierwsza wiadomość <span className="font-normal text-fg-muted">(opcjonalnie)</span>
            </label>
            <textarea
              id="initial-prompt"
              value={initialPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={3}
              placeholder="Zostaw puste, aby rozpocząć od domyślnego promptu planowania."
              className="mt-1.5 w-full resize-y rounded-xl border border-border bg-surface p-3 text-xs outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
