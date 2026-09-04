import { cn, formatStatus } from '@/lib/utils';

// A generic shared status-label component (used for spec stages, tasks, and
// Agent Session status alike) — the session status literals are inlined here
// rather than imported from features/agent-sessions/types, since this file
// must stay usable independently of any one feature.
export function formatSessionStatus(status?: 'idle' | 'running' | 'waitingForUser' | string | null): string {
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

export function statusTone(status?: string | null): string {
  switch (status) {
    case 'approved':
    case 'verified':
    case 'archived':
    case 'completed':
      return 'text-[var(--success)]';
    case 'implemented':
    case 'waitingForUser':
    case 'review':
    case 'warning':
      return 'text-[var(--warning)]';
    case 'in-implementation':
    case 'running':
      return 'text-[var(--accent)]';
    case 'failed':
    case 'error':
      return 'text-[var(--danger)]';
    default:
      return 'text-[var(--muted)]';
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

  return <span className={cn('text-[10px] font-bold tracking-[0.1em] uppercase', className)}>{content}</span>;
}

export { formatStatus };
