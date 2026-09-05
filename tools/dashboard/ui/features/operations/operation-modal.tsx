import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';

import type { OperationSnapshot } from './types';
import { useOperationProgress } from './use-operation-progress';
import { formatOperationType, OperationProgressView } from './operation-progress';
import { Button } from '@/components/ui/button';

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

  const isCompleted = snapshot?.status === 'completed';
  const isFailed = snapshot?.status === 'failed';
  const isRunning = snapshot?.status === 'running';

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTerminal) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, isTerminal]);

  if (!open || !operationId) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-backdrop p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && isTerminal) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border bg-surface px-5 py-3.5 sm:px-6">
          <h2 className="truncate pr-3 text-sm font-semibold text-fg-primary" title={title}>
            {title || (snapshot ? formatOperationType(snapshot.type) : 'Przebieg operacji')}
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                <LoaderCircle className="size-3.5 animate-spin" /> W toku…
              </span>
            )}
            {isCompleted && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-success">
                <CheckCircle2 className="size-3.5" /> Ukończono
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-error">
                <AlertCircle className="size-3.5" /> Błąd
              </span>
            )}
            {!isRunning && (
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij podgląd operacji">
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <OperationProgressView snapshot={snapshot} loading={loading} error={error} onDismiss={onClose} />
      </div>
    </div>
  );
}
