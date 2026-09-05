import type { HTMLAttributes } from 'react';

import { cn } from '@/shared/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.16)]', className)}
      {...props}
    />
  );
}
