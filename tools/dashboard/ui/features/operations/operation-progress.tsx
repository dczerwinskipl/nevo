import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, LoaderCircle } from 'lucide-react';

import type { OperationSnapshot, OperationStep, OperationStepStatus } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StepStatusIcon({ status }: { status: OperationStepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 shrink-0 text-status-success" />;
    case 'running':
      return <LoaderCircle className="size-4 shrink-0 animate-spin text-status-active" />;
    case 'failed':
      return <AlertCircle className="size-4 shrink-0 text-status-error" />;
    case 'pending':
    default:
      return <Circle className="size-3.5 shrink-0 text-fg-muted opacity-50" />;
  }
}

export function OperationStepRow({ step }: { step: OperationStep }) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg px-3 py-2.5 text-xs transition-colors',
        step.status === 'running' && 'border border-status-active/35 bg-status-active/10',
        step.status === 'failed' && 'border border-status-error/25 bg-status-error/10',
        step.status === 'completed' && 'border border-border bg-surface-raised',
        step.status === 'pending' && 'opacity-60',
      )}
    >
      <div className="mt-0.5">
        <StepStatusIcon status={step.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate font-medium',
              step.status === 'running' && 'font-semibold text-status-active',
              step.status === 'failed' && 'font-semibold text-status-error',
              step.status === 'completed' && 'text-fg-secondary',
              step.status === 'pending' && 'text-fg-muted',
            )}
          >
            {step.label}
          </span>
          {typeof step.current === 'number' && typeof step.total === 'number' && (
            <span className="font-mono text-[10px] text-fg-muted">
              {step.current}/{step.total}
            </span>
          )}
        </div>
        {step.detail && <p className="mt-0.5 text-[11px] leading-relaxed break-words text-fg-muted">{step.detail}</p>}
        {step.error && (
          <p className="mt-1 rounded border border-status-error/30 bg-status-error/15 px-2 py-1 font-mono text-[11px] leading-normal text-status-error">
            {step.error.message}
          </p>
        )}
      </div>
    </li>
  );
}

export function formatOperationType(type: string): string {
  switch (type) {
    case 'spec-action-approve':
      return 'Zatwierdzanie zadania';
    case 'spec-action-verify':
      return 'Weryfikacja implementacji';
    case 'spec-action-finalize':
      return 'Finalizacja specyfikacji';
    case 'batch-review':
      return 'Przegląd batcha zadań';
    case 'task-verification':
      return 'Self-check zadania';
    default:
      return type.replace(/^spec-action-/, '').replace(/-/g, ' ');
  }
}

export function OperationProgressView({
  snapshot,
  loading,
  error,
  onDismiss,
}: {
  snapshot: OperationSnapshot | null;
  loading: boolean;
  error: string | null;
  onDismiss?: () => void;
}) {
  if (loading && !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 p-8 text-center" role="status">
        <LoaderCircle className="size-6 animate-spin text-accent" />
        <p className="text-xs text-fg-muted">Inicjalizacja operacji…</p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-2.5 rounded-lg border border-status-error/25 bg-status-error/10 p-3 text-xs text-status-error">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
        {onDismiss && (
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              Zamknij
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!snapshot) return null;

  const isCompleted = snapshot.status === 'completed';
  const isFailed = snapshot.status === 'failed';
  const isRunning = snapshot.status === 'running';
  const resultSummary =
    typeof (snapshot.result as { summary?: string })?.summary === 'string'
      ? (snapshot.result as { summary: string }).summary
      : null;

  return (
    <div className="space-y-4 p-5 text-xs sm:p-6">
      {snapshot.steps.length > 0 && (
        <ul className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
          {snapshot.steps.map((step) => (
            <OperationStepRow key={step.id} step={step} />
          ))}
        </ul>
      )}

      {isFailed && snapshot.error && (
        <div className="space-y-1 rounded-lg border border-status-error/25 bg-status-error/10 p-3 text-status-error">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <AlertTriangle className="size-3.5 text-status-error" /> Operacja nie powiodła się
          </p>
          <p className="font-mono text-[11px] leading-relaxed text-status-error">{snapshot.error.message}</p>
        </div>
      )}

      {isCompleted && resultSummary && <p className="px-1 text-[11px] text-fg-muted italic">{resultSummary}</p>}

      {onDismiss && !isRunning && (
        <div className="flex justify-end border-t border-border pt-2">
          <Button size="sm" variant={isCompleted ? 'default' : 'secondary'} onClick={onDismiss}>
            Zamknij
          </Button>
        </div>
      )}
    </div>
  );
}
