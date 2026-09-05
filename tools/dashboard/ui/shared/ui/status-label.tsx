import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { statusTextTone, type StatusTone } from '@/shared/status-tone';

export interface StatusLabelProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusLabel({ tone, children, className }: StatusLabelProps) {
  return (
    <span className={cn('text-[10px] font-bold tracking-[0.1em] uppercase', statusTextTone({ tone }), className)}>
      {children}
    </span>
  );
}
