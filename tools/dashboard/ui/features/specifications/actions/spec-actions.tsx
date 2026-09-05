import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { SpecificationActionsPayload, SpecificationTaskActionGate } from '../types';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { StatusCard, RetryButton } from '@/shared/ui/status-card';

export function RepositoryActionsCard({
  data,
  loading,
  refreshing,
  error,
  executing,
  onRefresh,
  onFinalize,
}: {
  data: SpecificationActionsPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  executing: boolean;
  onRefresh: () => void;
  onFinalize: () => void;
}) {
  if (loading) {
    return (
      <Card className="p-5" role="status">
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <LoaderCircle className="size-4 animate-spin text-accent" /> Sprawdzanie bramek workflow…
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <StatusCard
        variant="warning"
        title="Nie udało się wczytać workflow"
        description={error || 'Brak danych bramek aktywnej specyfikacji.'}
        onRetry={onRefresh}
        retryLoading={refreshing}
      />
    );
  }

  const worktree = data.worktree;
  const synchronized = worktree.hasUpstream && worktree.ahead === 0 && worktree.behind === 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.18em] text-fg-muted uppercase">Workflow</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              className={
                worktree.clean
                  ? 'border-status-success/25 bg-status-success/10 text-status-success'
                  : 'border-status-warning/25 bg-status-warning/10 text-status-warning'
              }
            >
              {worktree.clean ? 'Worktree czysty' : `${worktree.total} zmian bez commita`}
            </Badge>
            <Badge className={synchronized ? 'text-fg-secondary' : 'border-status-warning/25 text-status-warning'}>
              {synchronized ? 'Branch zsynchronizowany' : 'Git wymaga uwagi'}
            </Badge>
          </div>
        </div>
        <RetryButton
          size="icon"
          onClick={onRefresh}
          loading={refreshing || executing}
          label="Odśwież bramki workflow"
        />
      </div>

      <div className="mt-4 space-y-2 text-[10px] leading-5 text-fg-muted">
        <p className="flex items-center gap-2">
          <GitBranch className="size-3.5 text-accent" />
          <span className="truncate font-mono">{worktree.branch}</span>
        </p>
        {!worktree.clean && (
          <p>
            <span className="text-fg-secondary">Staged:</span> {worktree.staged} ·{' '}
            <span className="text-fg-secondary">unstaged:</span> {worktree.unstaged} ·{' '}
            <span className="text-fg-secondary">untracked:</span> {worktree.untracked}
          </p>
        )}
        {worktree.hasUpstream ? (
          <p className="flex items-center gap-2">
            <GitCommitHorizontal className="size-3.5" />
            Ahead {worktree.ahead ?? 0} · behind {worktree.behind ?? 0}
          </p>
        ) : (
          <p className="text-status-warning/80">Branch nie ma upstreamu.</p>
        )}
      </div>

      {!worktree.clean && worktree.files.length > 0 && (
        <details className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-fg-secondary">
            Pokaż zmienione pliki
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[9px] leading-4 text-fg-muted">
            {worktree.files.slice(0, 8).map((file) => (
              <li key={`${file.status}:${file.path}`} className="break-all">
                {file.status} {file.path}
              </li>
            ))}
            {worktree.files.length > 8 && <li>…i {worktree.files.length - 8} więcej</li>}
          </ul>
        </details>
      )}

      <Button className="mt-4 w-full" size="sm" disabled={!data.finalize.enabled || executing} onClick={onFinalize}>
        {executing ? (
          <LoaderCircle className="mr-2 size-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="mr-2 size-3.5" />
        )}
        Finalizuj specyfikację
      </Button>
      {!data.finalize.enabled && data.finalize.reason && (
        <p className="mt-2 text-[10px] leading-4 text-fg-muted">{data.finalize.reason}</p>
      )}
    </Card>
  );
}

export function TaskActionFooter({
  gate,
  loading,
  executing,
  error,
  onExecute,
}: {
  gate: SpecificationTaskActionGate | null;
  loading: boolean;
  executing: boolean;
  error: string | null;
  onExecute: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-surface px-5 py-4 text-xs text-fg-muted sm:px-7">
        <LoaderCircle className="size-4 animate-spin text-accent" /> Sprawdzanie możliwości zatwierdzenia…
      </div>
    );
  }
  if (!gate) return null;

  const label = gate.action === 'approve' ? 'Zatwierdź zadanie' : 'Zaakceptuj implementację';
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-fg-primary">Akcja właściciela</p>
        <p className={cn('mt-1 text-[10px] leading-4', error ? 'text-status-error' : 'text-fg-muted')}>
          {error || gate.reason || 'Bramka workflow przeszła — akcja jest dostępna.'}
        </p>
      </div>
      <Button size="sm" disabled={!gate.enabled || executing} onClick={onExecute}>
        {executing ? (
          <LoaderCircle className="mr-2 size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-2 size-3.5" />
        )}
        {label}
      </Button>
    </div>
  );
}

export function FinalizeDialog({
  open,
  executing,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  executing: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !executing) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [executing, onClose, open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-backdrop p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !executing) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="finalize-dialog-title"
        className="w-full max-w-lg overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
          <div>
            <Badge className="border-status-warning/25 bg-status-warning/10 text-status-warning">
              Operacja końcowa
            </Badge>
            <h2 id="finalize-dialog-title" className="mt-3 text-lg font-semibold text-fg-primary">
              Finalizować specyfikację?
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={executing}
            onClick={onClose}
            aria-label="Zamknij dialog finalizacji"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="px-5 py-5 text-xs leading-6 text-fg-secondary sm:px-6">
          <p>Dashboard uruchomi istniejący flow NEvo bez zmian jego semantyki:</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-fg-muted">
            <li>ponownie sprawdzi wszystkie bramki,</li>
            <li>przeniesie specyfikację do archiwum,</li>
            <li>utworzy commit i wykona push,</li>
            <li>scali pull request,</li>
            <li>uruchomi kontrolę po merge i posprząta branch.</li>
          </ol>
          {error && (
            <div className="mt-4 flex gap-2 rounded-lg border border-status-error/25 bg-status-error/10 px-3 py-2 text-status-error">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <Button ref={cancelRef} variant="secondary" size="sm" disabled={executing} onClick={onClose}>
            Anuluj
          </Button>
          <Button size="sm" disabled={executing} onClick={onConfirm}>
            {executing ? (
              <LoaderCircle className="mr-2 size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 size-3.5" />
            )}
            {executing ? 'Finalizowanie…' : 'Finalizuj i wypchnij'}
          </Button>
        </div>
      </div>
    </div>
  );
}
