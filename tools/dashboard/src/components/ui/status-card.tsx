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
  { loading = false, size = 'default', variant, label, className, disabled, ...props },
  ref,
) {
  const defaultVariant = variant ?? (size === 'icon' ? 'ghost' : 'secondary');
  const defaultLabel = label ?? (size === 'sm' ? 'Ponów' : 'Spróbuj ponownie');

  if (size === 'icon') {
    return (
      <Button
        ref={ref}
        type="button"
        variant={defaultVariant}
        size="icon"
        disabled={disabled || loading}
        aria-label={defaultLabel}
        title={defaultLabel}
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
      variant={defaultVariant}
      size={size}
      disabled={disabled || loading}
      className={cn('shrink-0 gap-1.5', className)}
      {...props}
    >
      <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
      <span>{defaultLabel}</span>
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

export function StatusCard({
  variant = 'error',
  size = 'default',
  title,
  description,
  onRetry,
  retryLoading = false,
  retryLabel,
  className,
  children,
}: StatusCardProps) {
  const isError = variant === 'error';
  const isWarning = variant === 'warning';

  const containerStyles = cn(
    'rounded-xl border transition-colors',
    isError && 'border-rose-500/20 bg-rose-500/5 text-rose-200',
    isWarning && 'border-amber-500/20 bg-amber-500/5 text-amber-200',
    variant === 'info' && 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]',
    size === 'sm' ? 'p-3 text-xs' : 'p-5 sm:p-6 text-sm',
    className,
  );

  const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : Info;
  const iconColor = isError ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-[var(--accent)]';

  if (size === 'sm') {
    return (
      <div className={cn('flex items-center justify-between gap-3', containerStyles)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className={cn('size-4 shrink-0', iconColor)} />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-[var(--foreground)]">{title}</p>
            {description && (
              <p className="truncate text-[11px] text-[var(--muted)]">{description}</p>
            )}
          </div>
        </div>
        {onRetry && (
          <RetryButton
            size="sm"
            onClick={onRetry}
            loading={retryLoading}
            label={retryLabel}
          />
        )}
      </div>
    );
  }

  return (
    <div className={containerStyles}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className={cn('mt-0.5 rounded-lg border p-1.5', isError && 'border-rose-500/20 bg-rose-500/10', isWarning && 'border-amber-500/20 bg-amber-500/10', variant === 'info' && 'border-[var(--border)] bg-[var(--surface-raised)]')}>
            <Icon className={cn('size-4 shrink-0', iconColor)} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
            {description && (
              <p className="text-xs leading-5 text-[var(--muted)]">{description}</p>
            )}
            {children}
            {onRetry && (
              <div className="pt-2">
                <RetryButton
                  size="sm"
                  onClick={onRetry}
                  loading={retryLoading}
                  label={retryLabel}
                />
              </div>
            )}
          </div>
        </div>
        {onRetry && !description && !children && (
          <RetryButton
            size="sm"
            onClick={onRetry}
            loading={retryLoading}
            label={retryLabel}
          />
        )}
      </div>
    </div>
  );
}
