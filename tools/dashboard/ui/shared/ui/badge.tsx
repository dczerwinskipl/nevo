import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-semibold tracking-wide text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
