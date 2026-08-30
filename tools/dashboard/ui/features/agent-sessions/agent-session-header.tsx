import { ArrowLeft, Info, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/status-label';
import { cn } from '@/lib/utils';

export interface AgentSessionHeaderProps {
  title: string;
  status?: string;
  live?: boolean;
  onBack: () => void;
  backLabel: string;
  onOpenDetails: () => void;
}

export function AgentSessionHeader({
  title,
  status,
  live,
  onBack,
  backLabel,
  onOpenDetails,
}: AgentSessionHeaderProps) {
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
          {live !== undefined && (
            <div
              role="status"
              tabIndex={0}
              aria-label={live ? 'Połączenie na żywo aktywne (SSE: Połączono)' : 'Brak połączenia na żywo (SSE: Rozłączono)'}
              title={live ? 'SSE: Połączono (aktualizacje na żywo aktywne)' : 'SSE: Rozłączono (ponawianie połączenia)'}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-default lg:hidden',
                live
                  ? 'border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]'
                  : 'border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]',
              )}
            >
              <span className="relative flex size-3.5 items-center justify-center">
                <Radio className="size-3.5" />
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current',
                    !live && 'animate-ping'
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
