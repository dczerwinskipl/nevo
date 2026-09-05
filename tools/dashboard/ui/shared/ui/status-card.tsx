import React, { forwardRef, type ButtonHTMLAttributes } from 'react';
import { AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/ui/button';

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
        className={cn('size-8 shrink-0 rounded-lg text-accent hover:text-accent', className)}
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

const statusCardVariants = cva(
  'group relative flex min-w-0 items-center justify-between gap-4 rounded-xl border transition-colors',
  {
    variants: {
      variant: {
        error: 'border-status-error/25 bg-status-error/5 text-status-error',
        warning: 'border-status-warning/25 bg-status-warning/5 text-status-warning',
        info: 'border-border bg-surface text-fg-primary',
      },
      size: {
        default: 'p-4 text-sm sm:p-5',
        sm: 'p-3 text-xs',
      },
    },
    defaultVariants: {
      variant: 'error',
      size: 'default',
    },
  },
);

const iconBadgeVariants = cva('flex size-8 shrink-0 items-center justify-center rounded-lg border', {
  variants: {
    variant: {
      error: 'border-status-error/25 bg-status-error/10',
      warning: 'border-status-warning/25 bg-status-warning/10',
      info: 'border-border bg-surface-raised',
    },
  },
  defaultVariants: {
    variant: 'error',
  },
});

const iconMap = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const iconColorMap = {
  error: 'text-status-error',
  warning: 'text-status-warning',
  info: 'text-accent',
} as const;

export interface StatusCardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof statusCardVariants> {
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
  ...props
}: StatusCardProps) {
  const activeVariant = variant ?? 'error';
  const Icon = iconMap[activeVariant];
  const friendlyDesc = normalizeErrorMessage(description);

  return (
    <div className={cn(statusCardVariants({ variant, size }), className)} {...props}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className={iconBadgeVariants({ variant })}>
          <Icon className={cn('size-4 shrink-0', iconColorMap[activeVariant])} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-xs font-semibold text-fg-primary sm:text-sm">{title}</p>
          {friendlyDesc && (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted sm:text-xs">{friendlyDesc}</p>
          )}
          {children}
        </div>
      </div>
      {onRetry && (
        <div className="shrink-0">
          <RetryButton size="sm" onClick={onRetry} loading={retryLoading} label={retryLabel} />
        </div>
      )}
    </div>
  );
}
