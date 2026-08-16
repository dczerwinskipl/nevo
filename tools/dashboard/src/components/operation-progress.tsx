import React, { useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  LoaderCircle,
  X,
} from 'lucide-react';

import type { OperationSnapshot, OperationStep, OperationStepStatus } from '@/lib/types';
import { useOperationProgress } from '@/hooks/use-operation-progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StepStatusIcon({ status }: { status: OperationStepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />;
    case 'running':
      return <LoaderCircle className="size-4 text-sky-400 animate-spin shrink-0" />;
    case 'failed':
      return <AlertCircle className="size-4 text-rose-400 shrink-0" />;
    case 'pending':
    default:
      return <Circle className="size-3.5 text-zinc-500 shrink-0 opacity-50" />;
  }
}

export function OperationStepRow({ step }: { step: OperationStep }) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors text-xs',
        step.status === 'running' && 'bg-sky-500/10 border border-sky-500/20',
        step.status === 'failed' && 'bg-rose-500/10 border border-rose-500/20',
        step.status === 'completed' && 'bg-zinc-900/40 border border-zinc-800/40',
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
              step.status === 'running' && 'text-sky-200 font-semibold',
              step.status === 'failed' && 'text-rose-200 font-semibold',
              step.status === 'completed' && 'text-zinc-200',
              step.status === 'pending' && 'text-zinc-400',
            )}
          >
            {step.label}
          </span>
          {typeof step.current === 'number' && typeof step.total === 'number' && (
            <span className="text-[10px] font-mono text-zinc-400">
              {step.current}/{step.total}
            </span>
          )}
        </div>
        {step.detail && (
          <p className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed break-words">
            {step.detail}
          </p>
        )}
        {step.error && (
          <p className="mt-1 text-[11px] text-rose-300 font-mono bg-rose-950/40 border border-rose-800/40 rounded px-2 py-1 leading-normal">
            {step.error.message}
          </p>
        )}
      </div>
    </li>
  );
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
        <LoaderCircle className="size-6 animate-spin text-sky-400" />
        <p className="text-xs text-zinc-400">Inicjalizacja operacji…</p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2.5 text-rose-300 bg-rose-950/30 border border-rose-800/40 rounded-lg p-3 text-xs">
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

  return (
    <div className="space-y-4 p-5 sm:p-6 text-xs">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'capitalize font-mono text-[10px]',
              isRunning && 'border-sky-500/30 bg-sky-500/10 text-sky-300',
              isCompleted && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
              isFailed && 'border-rose-500/30 bg-rose-500/10 text-rose-300',
            )}
          >
            {snapshot.type || 'Operation'}
          </Badge>
          <span className="text-zinc-400 font-mono text-[11px]">#{snapshot.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge className="border-sky-500/40 text-sky-300 flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" /> W toku
            </Badge>
          )}
          {isCompleted && (
            <Badge className="border-emerald-500/40 text-emerald-300 flex items-center gap-1">
              <Check className="size-3" /> Zakończono pomyślnie
            </Badge>
          )}
          {isFailed && (
            <Badge className="border-rose-500/40 text-rose-300 flex items-center gap-1">
              <AlertCircle className="size-3" /> Błąd operacji
            </Badge>
          )}
        </div>
      </div>

      {snapshot.steps.length > 0 && (
        <ul className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
          {snapshot.steps.map((step) => (
            <OperationStepRow key={step.id} step={step} />
          ))}
        </ul>
      )}

      {isFailed && snapshot.error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-rose-200 space-y-1">
          <p className="font-semibold text-xs flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-rose-400" /> Operacja nie powiodła się
          </p>
          <p className="text-[11px] leading-relaxed font-mono text-rose-300">
            {snapshot.error.message}
          </p>
        </div>
      )}

      {isCompleted && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-emerald-200">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            {typeof (snapshot.result as { summary?: string })?.summary === 'string'
              ? (snapshot.result as { summary: string }).summary
              : 'Wszystkie kroki zostały pomyślnie wykonane.'}
          </p>
        </div>
      )}

      {onDismiss && (
        <div className="flex justify-end pt-2 border-t border-zinc-800/80">
          <Button
            size="sm"
            variant={isCompleted ? 'default' : 'secondary'}
            onClick={onDismiss}
          >
            {isRunning ? 'Ukryj (działa w tle)' : 'Zamknij'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function OperationModal({
  operationId,
  open,
  title,
  onClose,
  onTerminal,
}: {
  operationId: string | null;
  open: boolean;
  title?: string;
  onClose: () => void;
  onTerminal?: (snapshot: OperationSnapshot) => void;
}) {
  const { snapshot, loading, error, isTerminal } = useOperationProgress(operationId, onTerminal);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !operationId) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-sm p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 sm:px-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            {title || 'Przebieg operacji'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij podgląd operacji">
            <X className="size-4" />
          </Button>
        </div>

        <OperationProgressView
          snapshot={snapshot}
          loading={loading}
          error={error}
          onDismiss={onClose}
        />
      </div>
    </div>
  );
}
