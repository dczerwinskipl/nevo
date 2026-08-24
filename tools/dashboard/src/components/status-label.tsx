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
  status?: string;
  kind?: 'stage' | 'session' | 'task' | 'raw';
  children?: React.ReactNode;
  className?: string;
}

export function StatusLabel({ status, kind = 'raw', children, className }: StatusLabelProps) {
  let content: React.ReactNode = children;
  if (!content && status !== undefined) {
    if (kind === 'session') {
      content = formatSessionStatus(status);
    } else if (kind === 'stage' || kind === 'task') {
      content = formatStatus(status);
    } else {
      content = status;
    }
  }

  return (
    <span className={cn('text-[10px] font-bold uppercase tracking-[0.1em]', className)}>
      {content}
    </span>
  );
}

export { formatStatus };

