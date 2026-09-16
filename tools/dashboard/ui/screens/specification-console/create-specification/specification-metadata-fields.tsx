import { RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { SPEC_TYPES_OPTIONS, slugifyTitle } from './create-specification-helpers';

export interface SpecificationMetadataFieldsProps {
  title: string;
  slug: string;
  type: 'standard' | 'architectural' | 'small' | 'exploratory';
  goal: string;
  workflowMode: 'legacy' | 'deterministic';
  slugManuallyEdited: boolean;
  disabled: boolean;
  onTitleChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSyncSlugWithTitle: () => void;
  onTypeChange: (type: 'standard' | 'architectural' | 'small' | 'exploratory') => void;
  onGoalChange: (value: string) => void;
  onWorkflowModeChange: (mode: 'legacy' | 'deterministic') => void;
}

export function SpecificationMetadataFields({
  title,
  slug,
  type,
  goal,
  workflowMode,
  slugManuallyEdited,
  disabled,
  onTitleChange,
  onSlugChange,
  onSyncSlugWithTitle,
  onTypeChange,
  onGoalChange,
  onWorkflowModeChange,
}: SpecificationMetadataFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <label htmlFor="spec-title" className="block text-xs font-semibold">
          Tytuł specyfikacji <span className="text-status-error">*</span>
        </label>
        <input
          id="spec-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={disabled}
          required
          maxLength={200}
          placeholder="np. Multi-provider local agent chat"
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-60"
        />
      </div>

      {/* Slug */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="spec-slug" className="block text-xs font-semibold">
            Identyfikator / Slug <span className="text-status-error">*</span>
          </label>
          {slugManuallyEdited && title.trim() && slug !== slugifyTitle(title) && (
            <button
              type="button"
              onClick={onSyncSlugWithTitle}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              <RefreshCw className="size-3" />
              Zsynchronizuj z tytułem
            </button>
          )}
        </div>
        <input
          id="spec-slug"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          disabled={disabled}
          required
          pattern="^[a-z0-9][a-z0-9._-]*$"
          placeholder="np. multi-provider-agent-sessions"
          className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3 font-mono text-xs outline-none focus:border-accent disabled:opacity-60"
        />
        <p className="mt-1 text-[10px] text-fg-muted">
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
              disabled={disabled}
              onClick={() => onTypeChange(item.id as typeof type)}
              className={cn(
                'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all disabled:opacity-60',
                type === item.id
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

      {/* Workflow (D15: execution mode is a specification-level decision, chosen once at
          creation — never a session/chat preference, never re-derived from task.status) */}
      <div>
        <label className="block text-xs font-semibold">Workflow</label>
        <div role="radiogroup" aria-label="Workflow" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            role="radio"
            aria-checked={workflowMode === 'legacy'}
            disabled={disabled}
            onClick={() => onWorkflowModeChange('legacy')}
            className={cn(
              'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all disabled:opacity-60',
              workflowMode === 'legacy'
                ? 'border-accent bg-accent/8 ring-1 ring-accent'
                : 'border-border bg-surface hover:border-fg-primary/20',
            )}
          >
            <span className="text-xs font-semibold text-fg-primary">Legacy</span>
            <span className="mt-0.5 text-[9px] text-fg-muted">Existing lifecycle behavior.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={workflowMode === 'deterministic'}
            disabled={disabled}
            onClick={() => onWorkflowModeChange('deterministic')}
            className={cn(
              'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all disabled:opacity-60',
              workflowMode === 'deterministic'
                ? 'border-accent bg-accent/8 ring-1 ring-accent'
                : 'border-border bg-surface hover:border-fg-primary/20',
            )}
          >
            <span className="text-xs font-semibold text-fg-primary">Deterministic</span>
            <span className="mt-0.5 text-[9px] text-fg-muted">
              Step-based workflow with implementation/review/human verification.
            </span>
          </button>
        </div>
        {workflowMode === 'deterministic' && (
          <p className="mt-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-[10px] text-fg-muted">
            {type === 'standard' ? (
              <>
                <span className="font-semibold text-fg-secondary">Standard workflow</span> · implementation → review
                → human verification
              </>
            ) : (
              <>Step-based workflow (implementation → review → human verification) for the '{type}' class.</>
            )}
          </p>
        )}
      </div>

      {/* Goal */}
      <div>
        <label htmlFor="spec-goal" className="block text-xs font-semibold">
          Cel / Opis <span className="font-normal text-fg-muted">(opcjonalnie)</span>
        </label>
        <textarea
          id="spec-goal"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder="Krótki opis celu biznesowego lub technicznego…"
          className="mt-1.5 w-full rounded-xl border border-border bg-surface p-3 text-xs outline-none focus:border-accent disabled:opacity-60"
        />
      </div>
    </div>
  );
}
