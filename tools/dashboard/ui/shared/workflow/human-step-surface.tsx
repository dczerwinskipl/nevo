import { useState } from 'react';
import { LoaderCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

export interface HumanStepActionItem {
  result?: string;
  label?: string;
  feedbackRequired: boolean;
}

export interface HumanStepInteractionDescriptor {
  actions: HumanStepActionItem[];
}

export interface HumanStepSurfaceProps {
  interaction: HumanStepInteractionDescriptor;
  loading?: boolean;
  error?: string | null;
  onSubmit: (result?: string, feedback?: string, artifacts?: unknown) => void | Promise<void>;
  className?: string;
}

/**
 * Feature-neutral, presentational surface for active human workflow step interactions (Task 20, D11, D17, D19, D20).
 * Driven entirely by props. Imports only from shared/ui, shared/lib, and lucide-react.
 * Never fetches directly, never hardcodes review-specific action names or step IDs.
 */
export function HumanStepSurface({
  interaction,
  loading = false,
  error = null,
  onSubmit,
  className,
}: HumanStepSurfaceProps) {
  const [selectedAction, setSelectedAction] = useState<HumanStepActionItem | null>(null);
  const [feedback, setFeedback] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const actions = interaction?.actions || [];

  const handleActionClick = (action: HumanStepActionItem) => {
    setValidationError(null);
    if (action.feedbackRequired) {
      setSelectedAction(action);
      setFeedback('');
    } else {
      setSelectedAction(null);
      void onSubmit(action.result, undefined, undefined);
    }
  };

  const handleFeedbackSubmit = () => {
    if (!selectedAction) return;
    const trimmedFeedback = feedback.trim();
    if (selectedAction.feedbackRequired && !trimmedFeedback) {
      setValidationError('Wymagane jest podanie uzasadnienia.');
      return;
    }
    setValidationError(null);
    void onSubmit(selectedAction.result, trimmedFeedback || undefined, undefined);
  };

  const handleCancelFeedback = () => {
    setSelectedAction(null);
    setFeedback('');
    setValidationError(null);
  };

  const displayError = validationError || error;

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="human-step-surface">
      {displayError && (
        <div
          className="flex items-center gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span className="flex-1">{displayError}</span>
        </div>
      )}

      {selectedAction ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fg-primary">
              {selectedAction.label || selectedAction.result || 'Decyzja'}
            </span>
            <span className="text-[11px] text-fg-muted">Wymagana informacja zwrotna</span>
          </div>

          <textarea
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              if (validationError) setValidationError(null);
            }}
            disabled={loading}
            rows={3}
            placeholder="Wprowadź uwagi lub uzasadnienie..."
            className="w-full resize-none rounded-lg border border-border bg-background p-2.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            aria-label="Informacja zwrotna"
            autoFocus
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={handleCancelFeedback}
              className="h-7 text-xs"
            >
              Anuluj
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading || (selectedAction.feedbackRequired && !feedback.trim())}
              onClick={handleFeedbackSubmit}
              className="h-7 gap-1.5 text-xs font-semibold"
            >
              {loading && <LoaderCircle className="size-3 animate-spin" />}
              <span>Zatwierdź</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action, index) => {
            const label = action.label || action.result || 'Dalej';
            return (
              <Button
                key={`${action.result ?? 'unconditional'}-${index}`}
                type="button"
                size="sm"
                variant={action.feedbackRequired ? 'secondary' : 'default'}
                disabled={loading}
                onClick={() => handleActionClick(action)}
                className={cn('h-8 cursor-pointer gap-1.5 px-3 text-xs font-semibold', {
                  'border border-status-warning/40 text-status-warning hover:bg-status-warning/10': action.feedbackRequired,
                })}
              >
                {loading && <LoaderCircle className="size-3 animate-spin" />}
                <span>{label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
