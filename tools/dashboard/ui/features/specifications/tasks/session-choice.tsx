import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';
import type { WorkflowSessionChoice, WorkflowStepDescriptor, SpecificationTaskActionGate } from '@/features/specifications/types';

export interface SessionChoiceSelectorProps {
  sessionChoice: WorkflowSessionChoice;
  isReviewStep?: boolean;
  value: 'reuse' | 'fresh';
  onChange: (value: 'reuse' | 'fresh') => void;
  disabled?: boolean;
}

export function SessionChoiceSelector({
  sessionChoice,
  isReviewStep = false,
  value,
  onChange,
  disabled = false,
}: SessionChoiceSelectorProps) {
  const isReuseAllowed = sessionChoice.allowed.includes('reuse');
  const isFreshAllowed = sessionChoice.allowed.includes('fresh');
  const hasUnavailableReason = Boolean(sessionChoice.unavailableReason);
  const unavailableText = sessionChoice.unavailableReason
    ? (sessionChoice.unavailableReason.message || sessionChoice.unavailableReason.code)
    : null;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-xs font-semibold text-fg-primary">Wybór sesji</legend>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {isReuseAllowed && (
          <button
            type="button"
            aria-pressed={value === 'reuse'}
            disabled={disabled || hasUnavailableReason}
            onClick={() => onChange('reuse')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-all',
              value === 'reuse' && !hasUnavailableReason && 'border-accent bg-accent/8 ring-1 ring-accent',
              value !== 'reuse' && !hasUnavailableReason && 'border-border bg-surface hover:border-border-strong',
              hasUnavailableReason && 'cursor-not-allowed border-dashed border-border bg-surface-raised/40 opacity-60',
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-semibold text-fg-primary">Kontynuuj w sesji</span>
              {hasUnavailableReason && (
                <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-status-warning uppercase">
                  Niedostępne
                </span>
              )}
            </div>
            {sessionChoice.candidate ? (
              <span className="mt-0.5 text-[11px] text-fg-muted font-medium">
                {sessionChoice.candidate.label}
              </span>
            ) : null}
            {unavailableText && (
              <p className="mt-1.5 text-[11px] text-status-warning" role="status">
                {unavailableText}
              </p>
            )}
          </button>
        )}

        {isFreshAllowed && (
          <button
            type="button"
            aria-pressed={value === 'fresh'}
            disabled={disabled}
            onClick={() => onChange('fresh')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-all',
              value === 'fresh' && 'border-accent bg-accent/8 ring-1 ring-accent',
              value !== 'fresh' && 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <span className="text-xs font-semibold text-fg-primary">Nowa sesja</span>
            <span className="mt-0.5 text-[11px] text-fg-muted">Rozpocznij krok w świeżej sesji</span>
          </button>
        )}
      </div>

      {isReviewStep && value === 'reuse' && !hasUnavailableReason && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <div className="leading-snug">
            <span className="font-semibold">Ostrzeżenie:</span> Kontynuowanie sesji implementacji w kroku review zmniejsza niezależność przeglądu.
          </div>
        </div>
      )}
    </fieldset>
  );
}

export interface SessionChoiceDialogProps {
  open: boolean;
  specificationTitle: string;
  stepDescriptor?: WorkflowStepDescriptor | null;
  sessionChoice: WorkflowSessionChoice;
  isReviewStep?: boolean;
  onClose: () => void;
  onConfirm: (choice: { sessionPolicy: 'reuse' | 'fresh'; sessionId?: string }) => Promise<void> | void;
  confirming?: boolean;
  error?: string | null;
}

export function SessionChoiceDialog({
  open,
  specificationTitle,
  stepDescriptor,
  sessionChoice,
  isReviewStep = false,
  onClose,
  onConfirm,
  confirming = false,
  error = null,
}: SessionChoiceDialogProps) {
  const initialPolicy: 'reuse' | 'fresh' =
    sessionChoice.unavailableReason && sessionChoice.default === 'reuse'
      ? 'fresh'
      : (sessionChoice.default as 'reuse' | 'fresh') || 'fresh';

  const [selectedPolicy, setSelectedPolicy] = useState<'reuse' | 'fresh'>(initialPolicy);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const effectiveError = error || internalError;

  const handleConfirm = async () => {
    setInternalError(null);
    setSubmitting(true);
    try {
      await onConfirm({
        sessionPolicy: selectedPolicy,
        sessionId: selectedPolicy === 'reuse' ? sessionChoice.candidate?.sessionId : undefined,
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      setInternalError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-backdrop p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting && !confirming) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-choice-dialog-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <span className="text-[10px] font-bold tracking-wider text-fg-muted uppercase">
              {specificationTitle}
            </span>
            <h2 id="session-choice-dialog-title" className="mt-1 text-base font-semibold text-fg-primary sm:text-lg">
              {stepDescriptor?.purpose || stepDescriptor?.id || 'Rozpoczęcie kroku'}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={submitting || confirming}
            aria-label="Zamknij"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {effectiveError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-error/30 bg-status-error/10 p-3.5 text-xs text-status-error"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-error" />
              <div className="flex-1 leading-snug">{effectiveError}</div>
            </div>
          )}

          <SessionChoiceSelector
            sessionChoice={sessionChoice}
            isReviewStep={isReviewStep}
            value={selectedPolicy}
            onChange={setSelectedPolicy}
            disabled={submitting || confirming}
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={submitting || confirming}
          >
            Anuluj
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || confirming}
          >
            {submitting || confirming ? (
              <>
                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> Uruchamianie…
              </>
            ) : (
              'Start'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type BatchReviewMode = 'new-batch' | 'continue-each';

export interface BatchReviewChoiceSelectorProps {
  tasks: Array<{ id: string; title: string }>;
  taskActions?: Record<string, SpecificationTaskActionGate>;
  value: BatchReviewMode;
  onChange: (value: BatchReviewMode) => void;
  disabled?: boolean;
}

export function BatchReviewChoiceSelector({
  tasks,
  taskActions,
  value,
  onChange,
  disabled = false,
}: BatchReviewChoiceSelectorProps) {
  const continueEachCheck = React.useMemo(() => {
    for (const task of tasks) {
      const gate = taskActions?.[task.id];
      const sc = gate?.sessionChoice;
      const taskName = task.title || task.id;

      if (!sc?.candidate?.sessionId) {
        return {
          eligible: false,
          ineligibleTaskId: task.id,
          reason: `Zadanie '${taskName}' (${task.id}) nie posiada sesji kandydata. (Task '${taskName}' has no candidate session)`,
        };
      }

      if (sc.unavailableReason) {
        const msg = sc.unavailableReason.message || sc.unavailableReason.code;
        return {
          eligible: false,
          ineligibleTaskId: task.id,
          reason: `Zadanie '${taskName}' (${task.id}) ma niezgodnego wykonawcę: ${msg}`,
        };
      }

      if (Array.isArray(sc.allowed) && !sc.allowed.includes('reuse')) {
        return {
          eligible: false,
          ineligibleTaskId: task.id,
          reason: `Zadanie '${taskName}' (${task.id}) nie zezwala na ponowne użycie sesji.`,
        };
      }
    }
    return { eligible: true, ineligibleTaskId: null, reason: null };
  }, [tasks, taskActions]);

  const isContinueEachDisabled = disabled || !continueEachCheck.eligible;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-xs font-semibold text-fg-primary">Wybór trybu sesji batch review</legend>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={value === 'new-batch'}
          disabled={disabled}
          onClick={() => onChange('new-batch')}
          className={cn(
            'flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-all',
            value === 'new-batch' && 'border-accent bg-accent/8 ring-1 ring-accent',
            value !== 'new-batch' && 'border-border bg-surface hover:border-border-strong',
          )}
        >
          <span className="text-xs font-semibold text-fg-primary">
            Jedna nowa sesja grupowa (One new batch session)
          </span>
          <span className="mt-0.5 text-[11px] text-fg-muted">
            Wszystkie wybrane zadania zostaną ocenione wspólnie w jednej sesji.
          </span>
        </button>

        <button
          type="button"
          aria-pressed={value === 'continue-each'}
          disabled={isContinueEachDisabled}
          onClick={() => onChange('continue-each')}
          className={cn(
            'flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-all',
            value === 'continue-each' && !isContinueEachDisabled && 'border-accent bg-accent/8 ring-1 ring-accent',
            value !== 'continue-each' && !isContinueEachDisabled && 'border-border bg-surface hover:border-border-strong',
            isContinueEachDisabled && 'cursor-not-allowed border-dashed border-border bg-surface-raised/40 opacity-60',
          )}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-xs font-semibold text-fg-primary">
              Kontynuuj każde zadanie w jego sesji (Continue each task in its own session)
            </span>
            {!continueEachCheck.eligible && (
              <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-status-warning uppercase">
                Niedostępne
              </span>
            )}
          </div>
          <span className="mt-0.5 text-[11px] text-fg-muted">
            Zadania wykonywane są sekwencyjnie, jedno po drugim, w kolejności wyboru. (Tasks run one after another, in selection order.)
          </span>
          {!continueEachCheck.eligible && continueEachCheck.reason && (
            <p className="mt-1.5 text-[11px] text-status-warning" role="status">
              {continueEachCheck.reason}
            </p>
          )}
        </button>
      </div>

      {value === 'continue-each' && continueEachCheck.eligible && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <div className="leading-snug">
            <span className="font-semibold">Ostrzeżenie:</span> Kontynuowanie sesji implementacji w kroku review zmniejsza niezależność przeglądu.
          </div>
        </div>
      )}
    </fieldset>
  );
}

export interface BatchReviewSessionChoiceDialogProps {
  open: boolean;
  specificationTitle: string;
  tasks: Array<{ id: string; title: string }>;
  taskActions?: Record<string, SpecificationTaskActionGate>;
  onClose: () => void;
  onConfirm: (choice: { mode: BatchReviewMode; reviewTogether?: boolean; batchContinuation?: boolean }) => Promise<void> | void;
  confirming?: boolean;
  error?: string | null;
}

export function BatchReviewSessionChoiceDialog({
  open,
  specificationTitle,
  tasks,
  taskActions,
  onClose,
  onConfirm,
  confirming = false,
  error = null,
}: BatchReviewSessionChoiceDialogProps) {
  const [selectedMode, setSelectedMode] = useState<BatchReviewMode>('new-batch');
  const [internalError, setInternalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const effectiveError = error || internalError;

  const handleConfirm = async () => {
    setInternalError(null);
    setSubmitting(true);
    try {
      await onConfirm({
        mode: selectedMode,
        reviewTogether: selectedMode === 'new-batch',
        batchContinuation: selectedMode === 'continue-each',
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      setInternalError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-backdrop p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting && !confirming) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-review-session-choice-dialog-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <span className="text-[10px] font-bold tracking-wider text-fg-muted uppercase">
              {specificationTitle}
            </span>
            <h2 id="batch-review-session-choice-dialog-title" className="mt-1 text-base font-semibold text-fg-primary sm:text-lg">
              Batch Review: Wybór trybu sesji ({tasks.length} zadań)
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={submitting || confirming}
            aria-label="Zamknij"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {effectiveError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-xl border border-status-error/30 bg-status-error/10 p-3.5 text-xs text-status-error"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-error" />
              <div className="flex-1 leading-snug">{effectiveError}</div>
            </div>
          )}

          <BatchReviewChoiceSelector
            tasks={tasks}
            taskActions={taskActions}
            value={selectedMode}
            onChange={setSelectedMode}
            disabled={submitting || confirming}
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={submitting || confirming}
          >
            Anuluj
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || confirming}
          >
            {submitting || confirming ? (
              <>
                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> Uruchamianie…
              </>
            ) : (
              'Start'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

