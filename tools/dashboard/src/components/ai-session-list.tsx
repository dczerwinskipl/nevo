import { Bot, CheckCircle2, Clock3, LoaderCircle, MessagesSquare, RefreshCw } from 'lucide-react';

import type { AiSession, DashboardTask } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function sessionTitle(session: AiSession) {
  return session.title?.trim() || `Sesja ${session.sessionId.slice(0, 12)}`;
}

function statusLabel(status: AiSession['status']) {
  if (status === 'running') return 'W toku';
  if (status === 'waitingForUser') return 'Czeka na Ciebie';
  if (status === 'completed') return 'Zakończona';
  return 'Bezczynna';
}

export function AiSessionRow({
  session,
  tasks,
  onOpen,
  compact = false,
}: {
  session: AiSession;
  tasks: DashboardTask[];
  onOpen: (session: AiSession) => void;
  compact?: boolean;
}) {
  const linked = session.taskIds.map(taskId => tasks.find(task => task.id === taskId)?.title || taskId);
  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      className={cn(
        'group flex min-w-0 w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent)_38%,var(--border))] hover:bg-[var(--surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]">
        {session.status === 'completed' ? <CheckCircle2 className="size-4" /> : <MessagesSquare className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{sessionTitle(session)}</p>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide',
            session.status === 'running' || session.status === 'waitingForUser'
              ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
              : 'bg-white/6 text-[var(--muted)]',
          )}>{statusLabel(session.status)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1"><Bot className="size-3" />{session.provider}</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{formatDate(session.lastActivityAt)}</span>
        </div>
        <p className="mt-2 line-clamp-1 text-[10px] text-[var(--muted)]">
          {linked.length ? linked.join(' · ') : 'Kontekst całej specyfikacji'}
        </p>
      </div>
    </button>
  );
}

export function AiSessionList({
  sessions,
  tasks,
  loading,
  error,
  onRetry,
  onOpen,
  emptyLabel = 'Brak sesji w tym kontekście.',
  limit,
}: {
  sessions: AiSession[];
  tasks: DashboardTask[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (session: AiSession) => void;
  emptyLabel?: string;
  limit?: number;
}) {
  if (loading) return <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-4 text-xs text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin" />Wczytywanie sesji…</div>;
  if (error) return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs text-[var(--muted)]">
      <span>Sesje są chwilowo niedostępne.</span>
      <Button variant="ghost" size="sm" onClick={onRetry}><RefreshCw className="mr-1.5 size-3" />Ponów</Button>
    </div>
  );
  if (!sessions.length) return <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-[var(--muted)]">{emptyLabel}</div>;
  const visible = limit ? sessions.slice(0, limit) : sessions;
  const current = visible.filter(session => session.status !== 'completed');
  const completed = visible.filter(session => session.status === 'completed');
  return (
    <div className="space-y-5">
      {[{ label: 'Aktualne', values: current }, { label: 'Zakończone', values: completed }].map(group => group.values.length ? (
        <div key={group.label}>
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{group.label}</p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">{group.values.map(session => <AiSessionRow key={`${session.provider}:${session.sessionId}`} session={session} tasks={tasks} onOpen={onOpen} />)}</div>
        </div>
      ) : null)}
    </div>
  );
}
