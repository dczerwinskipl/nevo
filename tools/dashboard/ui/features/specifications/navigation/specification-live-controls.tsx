import { Radio } from 'lucide-react';

import { RetryButton } from '@/shared/ui/status-card';
import { cn } from '@/shared/lib/utils';
import type { LiveConnectionStatus } from '../queries';

export type { LiveConnectionStatus };

export function SpecificationLiveControls({
  live,
  status,
  refreshing,
  onRefresh,
  className,
}: {
  live?: boolean;
  status?: LiveConnectionStatus;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const resolvedStatus: LiveConnectionStatus =
    status ?? (live !== undefined ? (live ? 'connected' : 'disconnected') : 'unknown');
  const isConnected = resolvedStatus === 'connected';
  const isReconnecting = resolvedStatus === 'reconnecting';
  const isDisconnected = resolvedStatus === 'disconnected';
  const isUnknown = resolvedStatus === 'unknown';

  return (
    <div className={cn('flex items-center gap-1', className)}>
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
          'flex size-8 cursor-default items-center justify-center rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
          isConnected && 'border-status-success/25 bg-status-success/10 text-status-success',
          isReconnecting && 'border-status-warning/25 bg-status-warning/10 text-status-warning',
          isDisconnected && 'border-status-error/25 bg-status-error/10 text-status-error',
          isUnknown && 'border-border bg-surface text-fg-muted',
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
      <RetryButton size="icon" onClick={onRefresh} loading={refreshing} label="Odśwież dashboard" />
    </div>
  );
}

// Backward-compat alias if needed
export const ConnectivityControls = SpecificationLiveControls;
