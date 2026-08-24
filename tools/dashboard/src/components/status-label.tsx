import type { AiSessionStatus } from '@/lib/types';
import { cn, formatStatus } from '@/lib/utils';

export function formatSessionStatus(status?: AiSessionStatus | string | null): string {
  switch (status) {
    case 'running':
      return 'Aktywna';
    case 'waitingForUser':
      return 'Oczekuje';
    case 'idle':
    default:
      return 'Bezczynna';
  }
}

export interface StatusLabelProps {
  status: string;
  kind?: 'stage' | 'session' | 'task';
  className?: string;
}

export function StatusLabel({ status, kind = 'stage', className }: StatusLabelProps) {
  const label = kind === 'session' ? formatSessionStatus(status) : formatStatus(status);
  return (
    <span className={cn('text-[10px] font-bold uppercase tracking-[0.1em]', className)}>
      {label}
    </span>
  );
}

export { formatStatus };
