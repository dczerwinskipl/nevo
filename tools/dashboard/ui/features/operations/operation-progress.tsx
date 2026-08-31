import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  LoaderCircle,
} from 'lucide-react';

import type { OperationSnapshot, OperationStep, OperationStepStatus } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StepStatusIcon({ status }: { status: OperationStepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-[var(--success)] shrink-0" />;
    case 'running':
      return <LoaderCircle className="size-4 text-[var(--accent)] animate-spin shrink-0" />;
    case 'failed':
      return <AlertCircle className="size-4 text-[var(--danger)] shrink-0" />;
    case 'pending':
    default:
      return <Circle className="size-3.5 text-[var(--muted)] shrink-0 opacity-50" />;
  }
}

export function OperationStepRow({ step }: { step: OperationStep }) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors text-xs',
        step.status === 'running' && 'bg-[var(--accent-muted)] border border-[var(--accent-border)]',
        step.status === 'failed' && 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)]',
        step.status === 'completed' && 'bg-[var(--surface-raised)] border border-[var(--border)]',
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
              'font-medium truncate',
              step.status === 'running' && 'text-[var(--accent)] font-semibold',
              step.status === 'failed' && 'text-[var(--danger-strong)] font-semibold',
              step.status === 'completed' && 'text-[var(--muted-strong)]',
              step.status === 'pending' && 'text-[var(--muted)]',
            )}
          >
            {step.label}
          </span>
          {typeof step.current === 'number' && typeof step.total === 'number' && (
            <span className="text-[10px] font-mono text-[var(--muted)]">
              {step.current}/{step.total}
            </span>
          )}
        </div>
        {step.detail && (
          <p className="mt-0.5 text-[11px] text-[var(--muted)] leading-relaxed break-words">
            {step.detail}
          </p>
        )}
        {step.error && (
          <p className="mt-1 text-[11px] text-[var(--danger)] font-mono bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] rounded px-2 py-1 leading-normal">
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
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-3" role="status">
        <LoaderCircle className="size-6 animate-spin text-[var(--accent)]" />
        <p className="text-xs text-[var(--muted)]">Inicjalizacja operacji…</p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2.5 text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] rounded-lg p-3 text-xs">
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
  const resultSummary = typeof (snapshot.result as { summary?: string })?.summary === 'string'
    ? (snapshot.result as { summary: string }).summary
    : null;

  return (
    <div className="space-y-4 p-5 sm:p-6 text-xs">
      {snapshot.steps.length > 0 && (
        <ul className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
          {snapshot.steps.map((step) => (
            <OperationStepRow key={step.id} step={step} />
          ))}
        </ul>
      )}

      {isFailed && snapshot.error && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] p-3 text-[var(--danger-strong)] space-y-1">
          <p className="font-semibold text-xs flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-[var(--danger)]" /> Operacja nie powiodła się
          </p>
          <p className="text-[11px] leading-relaxed font-mono text-[var(--danger)]">
            {snapshot.error.message}
          </p>
        </div>
      )}

      {isCompleted && resultSummary && (
        <p className="text-[11px] text-[var(--muted)] italic px-1">
          {resultSummary}
        </p>
      )}

      {onDismiss && !isRunning && (
        <div className="flex justify-end pt-2 border-t border-[var(--border)]">
          <Button
            size="sm"
            variant={isCompleted ? 'default' : 'secondary'}
            onClick={onDismiss}
          >
            Zamknij
          </Button>
        </div>
      )}
    </div>
  );
}
