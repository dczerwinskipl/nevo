import { ArrowLeft, Info, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/shared/ui/status-label';
import { cn } from '@/lib/utils';

import type { LiveConnectionStatus } from './types';

export interface AgentSessionHeaderProps {
  title: string;
  status?: string;
  live?: boolean;
  connectionStatus?: LiveConnectionStatus;
  onBack: () => void;
  backLabel: string;
  onOpenDetails: () => void;
}

export function AgentSessionHeader({
  title,
  status,
  live,
  connectionStatus,
  onBack,
  backLabel,
  onOpenDetails,
}: AgentSessionHeaderProps) {
  const resolvedStatus: LiveConnectionStatus | undefined =
    connectionStatus ?? (live !== undefined ? (live ? 'connected' : 'disconnected') : undefined);
  const isConnected = resolvedStatus === 'connected';
  const isReconnecting = resolvedStatus === 'reconnecting';
  const isDisconnected = resolvedStatus === 'disconnected';
  const isUnknown = resolvedStatus === 'unknown';

  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-3 py-2.5 backdrop-blur-xl sm:px-5 lg:pr-24">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-[var(--foreground)]" title={title}>
              {title}
            </h1>
            {status && (
              <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[var(--muted)]">
                <StatusLabel>{status}</StatusLabel>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {resolvedStatus !== undefined && (
            <div
              role="status"
              tabIndex={0}
              aria-label={
                isConnected
                  ? 'Połączenie na żywo aktywne (SSE: Połączono)'
                  : isReconnecting
                    ? 'Ponawianie połączenia na żywo (SSE: Ponawianie)'
                    : isDisconnected
                      ? 'Brak połączenia na żywo (SSE: Rozłączono)'
                      : 'Stan połączenia nieznany (SSE: Nieznany)'
              }
              title={
                isConnected
                  ? 'SSE: Połączono (aktualizacje na żywo aktywne)'
                  : isReconnecting
                    ? 'SSE: Rozłączono (ponawianie połączenia)'
                    : isDisconnected
                      ? 'SSE: Rozłączono (brak połączenia)'
                      : 'SSE: Stan nieznany (brak aktywnego połączenia)'
              }
              className={cn(
                'flex size-8 cursor-default items-center justify-center rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none lg:hidden',
                isConnected && 'border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]',
                isReconnecting && 'border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]',
                isDisconnected && 'border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger)]',
                isUnknown && 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]',
              )}
            >
              <span className="relative flex size-3.5 items-center justify-center">
                <Radio className="size-3.5" />
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current',
                    isReconnecting && 'animate-ping',
                  )}
                />
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            onClick={onOpenDetails}
            aria-label="Szczegóły sesji"
            title="Szczegóły sesji"
          >
            <Info className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
