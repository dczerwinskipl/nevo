import { useState } from 'react';
import {
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cpu,
  LoaderCircle,
  MessagesSquare,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AgentSession, TaskNavigationTarget } from './types';
import type { SpecificationTask } from '@/features/specifications/types';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusCard } from '@/components/ui/status-card';
import { StatusLabel, formatSessionStatus } from '@/shared/ui/status-label';
import { statusTextTone, type StatusTone } from '@/shared/status-tone';
import { useAgentProviders, useDeleteAgentSession } from './queries';

function sessionStatusTone(status?: 'idle' | 'running' | 'waitingForUser' | string | null): StatusTone {
  switch (status) {
    case 'running':
      return 'active';
    case 'waitingForUser':
      return 'warning';
    case 'idle':
    default:
      return 'neutral';
  }
}

function sessionTitle(session: AgentSession) {
  if (session.title?.trim()) return session.title.trim();
  if (session.purpose?.trim() && session.purpose !== 'attached' && session.purpose !== 'interactive') {
    return session.purpose.trim();
  }
  if (session.taskId?.trim()) {
    return `Zadanie: ${session.taskId.trim()}`;
  }
  if (session.purpose?.trim()) {
    return session.purpose.trim();
  }
  const id = session.providerSessionId || session.sessionId || '';
  return `Sesja ${id.slice(0, 12)}`;
}

export function sortSessionsByRecency(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((a, b) => {
    const aTime = new Date(a.lastActivityAt || a.lastSeenAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.lastActivityAt || b.lastSeenAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

export function statusLabel(status: AgentSession['status']) {
  return formatSessionStatus(status);
}

export function ProviderBadge({ provider }: { provider: string }) {
  const norm = provider.toLowerCase();
  if (norm.includes('claude')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--cat-1)_10%,transparent)] px-1.5 py-0.5 font-medium text-[var(--cat-1)]">
        <Sparkles className="size-3" /> Claude
      </span>
    );
  }
  if (norm.includes('antigravity')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--cat-2)_10%,transparent)] px-1.5 py-0.5 font-medium text-[var(--cat-2)]">
        <Cpu className="size-3" /> Antigravity
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface)] px-1.5 py-0.5 font-medium text-[var(--muted-strong)]">
      <Bot className="size-3" /> {provider}
    </span>
  );
}

export function AgentSessionRow({
  session,
  tasks = [],
  onOpen,
  onDelete,
  onOpenTask,
  compact = false,
  showSubtitle = true,
  showDelete = true,
}: {
  session: AgentSession;
  tasks?: SpecificationTask[];
  onOpen: (session: AgentSession) => void;
  onDelete?: (session: AgentSession) => void | Promise<void>;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
  compact?: boolean;
  showSubtitle?: boolean;
  showDelete?: boolean;
}) {
  const providersQuery = useAgentProviders();
  const providerInfo = providersQuery.data?.providers.find((p) => p.id === session.provider);
  const isAvailable = providerInfo?.available !== false;
  const [isDeleting, setIsDeleting] = useState(false);

  const taskList = session.taskIds?.length ? session.taskIds : session.taskId ? [session.taskId] : [];
  const timeStr = session.lastActivityAt || session.lastSeenAt || session.createdAt;

  return (
    <div
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('button, a, input, textarea, select')) {
          onOpen(session);
        }
      }}
      className={cn(
        'group relative flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_38%,var(--border))] hover:bg-[var(--surface-raised)]',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
        aria-label={`Otwórz sesję: ${sessionTitle(session)}`}
      >
        <MessagesSquare className="size-4" />
      </button>
      <div className="min-w-0 flex-1 pr-6">
        <button
          type="button"
          onClick={() => onOpen(session)}
          className="flex w-full items-start justify-between gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <p className="truncate text-sm font-semibold text-[var(--foreground)] transition-colors hover:text-[var(--accent)]">
            {sessionTitle(session)}
          </p>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5',
              session.status === 'running' && 'bg-[var(--accent-muted)]',
              session.status === 'waitingForUser' && 'bg-[var(--warning-muted)]',
              session.status !== 'running' && session.status !== 'waitingForUser' && 'bg-white/6',
              statusTextTone({ tone: sessionStatusTone(session.status) }),
            )}
          >
            {/* <StatusLabel kind="session" status={session.status} /> */}
            <StatusLabel kind="session" status={session.status} tone={sessionStatusTone(session.status)} />
          </span>
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
          <ProviderBadge provider={session.provider} />
          {!isAvailable && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--warning)]">
              CLI niedostępne
            </span>
          )}
          {timeStr && (
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3 text-[var(--accent)]" />
              {formatDate(timeStr)}
            </span>
          )}
        </div>
        {showSubtitle && (
          <div className="mt-2 text-[10px] text-[var(--muted)]">
            {taskList.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {taskList.map((taskId) => {
                  const matchedTask = tasks.find((t) => t.id === taskId);
                  const label = matchedTask?.title || taskId;
                  return onOpenTask && matchedTask ? (
                    <button
                      key={taskId}
                      type="button"
                      onClick={() => onOpenTask({ taskId })}
                      className="inline-flex max-w-[240px] cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-[var(--accent)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                      title={`Otwórz szczegóły zadania: ${label}`}
                    >
                      <CheckSquare className="size-2.5 shrink-0 text-[var(--accent)]" />
                      <span className="truncate">{label}</span>
                    </button>
                  ) : (
                    <span
                      key={taskId}
                      className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-transparent bg-white/4 px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
                    >
                      <span className="truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="line-clamp-1">Kontekst całej specyfikacji</p>
            )}
          </div>
        )}
      </div>
      {showDelete && onDelete && (
        <button
          type="button"
          title="Usuń sesję z dysku"
          aria-label="Usuń sesję z dysku"
          onClick={async () => {
            if (isDeleting) return;
            if (!window.confirm('Czy na pewno chcesz usunąć tę sesję z dysku?')) return;
            setIsDeleting(true);
            try {
              await onDelete(session);
            } finally {
              setIsDeleting(false);
            }
          }}
          disabled={isDeleting}
          className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-lg text-[var(--muted)] opacity-70 transition-all hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:outline-none disabled:opacity-30"
        >
          {isDeleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export function AgentSessionList({
  sessions,
  tasks = [],
  loading,
  error,
  onRetry,
  onOpen,
  onDelete,
  onOpenTask,
  emptyLabel = 'Brak sesji w tym kontekście.',
  limit,
}: {
  sessions: AgentSession[];
  tasks?: SpecificationTask[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (session: AgentSession) => void;
  onDelete?: (session: AgentSession) => void | Promise<void>;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
  emptyLabel?: string;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const deleteMutation = useDeleteAgentSession();

  const handleDelete =
    onDelete ||
    (async (session: AgentSession) => {
      await deleteMutation.deleteSession({
        provider: session.provider,
        sessionId: session.providerSessionId || session.sessionId,
      });
    });

  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-4 text-xs text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
        Wczytywanie sesji…
      </div>
    );
  if (error)
    return (
      <StatusCard variant="warning" title="Nie udało się wczytać sesji AI" description={error} onRetry={onRetry} />
    );
  if (!sessions.length)
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-[var(--muted)]">
        {emptyLabel}
      </div>
    );
  const sorted = sortSessionsByRecency(sessions);
  const visible = limit && !showAll ? sorted.slice(0, limit) : sorted;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
        {visible.map((session) => (
          <AgentSessionRow
            key={`${session.provider}:${session.providerSessionId || session.sessionId}`}
            session={session}
            tasks={tasks}
            onOpen={onOpen}
            onDelete={handleDelete}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      {limit && sorted.length > limit && (
        <div className="pt-1">
          <Button variant="secondary" size="sm" onClick={() => setShowAll((prev) => !prev)} className="text-xs">
            {showAll ? (
              <>
                <ChevronUp className="mr-1.5 size-3.5" />
                Zwiń do {limit}
              </>
            ) : (
              <>
                <ChevronDown className="mr-1.5 size-3.5" />
                Pokaż wszystkie sesje ({sorted.length})
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
