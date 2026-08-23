import { ArrowLeft, CircleStop, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ChatHeaderProps {
  title: string;
  status?: string;
  onBack: () => void;
  backLabel: string;
  onOpenDetails: () => void;
  isRunning?: boolean;
  canCancel?: boolean;
  onCancel?: () => void;
}

export function ChatHeader({
  title,
  status,
  onBack,
  backLabel,
  onOpenDetails,
  isRunning = false,
  canCancel = false,
  onCancel,
}: ChatHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-3 py-2.5 backdrop-blur-xl sm:px-5">
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
              <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[9px] text-[var(--muted)]">
                {status}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isRunning && canCancel && onCancel && (
            <Button variant="secondary" size="sm" onClick={onCancel} className="text-xs">
              <CircleStop className="mr-1.5 size-3.5" />
              Przerwij
            </Button>
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
