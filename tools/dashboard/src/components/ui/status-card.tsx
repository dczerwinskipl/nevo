import React, { forwardRef, type ButtonHTMLAttributes } from 'react';
import { AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface RetryButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  loading?: boolean;
  size?: 'sm' | 'default' | 'icon';
  variant?: 'secondary' | 'ghost' | 'default';
  label?: string;
}

export const RetryButton = forwardRef<HTMLButtonElement, RetryButtonProps>(function RetryButton(
  { loading = false, size = 'sm', variant = 'secondary', label = 'Ponów', className, disabled, ...props },
  ref,
) {
  if (size === 'icon') {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || loading}
        aria-label={label}
        title={label}
        className={cn('size-8 shrink-0 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)]', className)}
        {...props}
      >
        <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
      </Button>
    );
  }

  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size === 'default' ? 'default' : 'sm'}
      disabled={disabled || loading}
      className={cn('h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-medium', className)}
      {...props}
    >
      <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
      <span>{label}</span>
    </Button>
  );
});

export interface StatusCardProps {
  variant?: 'error' | 'warning' | 'info';
  size?: 'sm' | 'default';
  title: string;
  description?: string | null;
  onRetry?: () => void | Promise<void>;
  retryLoading?: boolean;
  retryLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

function normalizeErrorMessage(desc?: string | null): string | undefined {
  if (!desc) return undefined;
  const trimmed = desc.trim();
  if (trimmed === 'Failed to fetch' || trimmed === 'TypeError: Failed to fetch') {
    return 'Brak połączenia z lokalnym serwerem dashboardu.';
  }
  return trimmed;
}

export function StatusCard({
  variant = 'error',
  size = 'default',
  title,
  description,
  onRetry,
  retryLoading = false,
  retryLabel = 'Ponów',
  className,
  children,
}: StatusCardProps) {
  const isError = variant === 'error';
  const isWarning = variant === 'warning';

  const friendlyDesc = normalizeErrorMessage(description);

  const containerStyles = cn(
    'group relative flex min-w-0 items-center justify-between gap-4 rounded-xl border transition-colors',
    isError && 'border-rose-500/20 bg-rose-500/5 text-rose-200',
    isWarning && 'border-amber-500/20 bg-amber-500/5 text-amber-200',
    variant === 'info' && 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
    size === 'sm' ? 'p-3 text-xs' : 'p-4 sm:p-5 text-sm',
    className,
  );

  const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : Info;
  const iconColor = isError ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-[var(--accent)]';
  const iconBadgeStyles = cn(
    'flex size-8 shrink-0 items-center justify-center rounded-lg border',
    isError && 'border-rose-500/20 bg-rose-500/10',
    isWarning && 'border-amber-500/20 bg-amber-500/10',
    variant === 'info' && 'border-[var(--border)] bg-[var(--surface-raised)]',
  );

  return (
    <div className={containerStyles}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className={iconBadgeStyles}>
          <Icon className={cn('size-4 shrink-0', iconColor)} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-xs font-semibold text-[var(--foreground)] sm:text-sm">{title}</p>
          {friendlyDesc && (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)] sm:text-xs">{friendlyDesc}</p>
          )}
          {children}
        </div>
      </div>
      {onRetry && (
        <div className="shrink-0">
          <RetryButton
            size="sm"
            onClick={onRetry}
            loading={retryLoading}
            label={retryLabel}
          />
        </div>
      )}
    </div>
  );
}
