import { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cpu,
  LoaderCircle,
  MessagesSquare,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AiSession, DashboardTask, TaskNavigationTarget } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusCard } from '@/components/ui/status-card';
import { useAiProviders, useDeleteAiSession } from '@/hooks/use-dashboard-data';

function sessionTitle(session: AiSession) {
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

export function sortSessionsByRecency(sessions: AiSession[]): AiSession[] {
  return [...sessions].sort((a, b) => {
    const aTime = new Date(a.lastActivityAt || a.lastSeenAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.lastActivityAt || b.lastSeenAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function statusLabel(status: AiSession['status']) {
  if (status === 'running') return 'W toku';
  if (status === 'waitingForUser') return 'Czeka na Ciebie';
  return 'Bezczynna';
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

export function AiSessionRow({
  session,
  tasks = [],
  onOpen,
  onDelete,
  onOpenTask,
  compact = false,
  showSubtitle = true,
  showDelete = true,
}: {
  session: AiSession;
  tasks?: DashboardTask[];
  onOpen: (session: AiSession) => void;
  onDelete?: (session: AiSession) => void | Promise<void>;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
  compact?: boolean;
  showSubtitle?: boolean;
  showDelete?: boolean;
}) {
  const providersQuery = useAiProviders();
  const providerInfo = providersQuery.data?.providers.find((p) => p.id === session.provider);
  const isAvailable = providerInfo?.available !== false;
  const [isDeleting, setIsDeleting] = useState(false);

  const taskList = session.taskIds?.length
    ? session.taskIds
    : session.taskId
    ? [session.taskId]
    : [];
  const timeStr = session.lastActivityAt || session.lastSeenAt || session.createdAt;

  return (
    <div
      className={cn(
        'group relative flex min-w-0 w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_38%,var(--border))] hover:bg-[var(--surface-raised)]',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label={`Otwórz sesję: ${sessionTitle(session)}`}
      >
        <MessagesSquare className="size-4" />
      </button>
      <div className="min-w-0 flex-1 pr-6">
        <button
          type="button"
          onClick={() => onOpen(session)}
          className="flex w-full items-start justify-between gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
        >
          <p className="truncate text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">
            {sessionTitle(session)}
          </p>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide',
              session.status === 'running' || session.status === 'waitingForUser'
                ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
                : 'bg-white/6 text-[var(--muted)]'
            )}
          >
            {statusLabel(session.status)}
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
              <Clock3 className="size-3" />
              {formatDate(timeStr)}
            </span>
          )}
        </div>
        {showSubtitle && (
          <div className="mt-2 text-[10px] text-[var(--muted)]">
            {taskList.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {taskList.map((taskId, index) => {
                  const matchedTask = tasks.find((t) => t.id === taskId);
                  const label = matchedTask?.title || taskId;
                  return (
                    <span key={taskId} className="inline-flex items-center">
                      {index > 0 && <span className="mr-1 text-[var(--muted)]">·</span>}
                      {onOpenTask && matchedTask ? (
                        <button
                          type="button"
                          onClick={() => onOpenTask({ taskId })}
                          className="truncate text-left font-medium text-[var(--foreground)] transition-colors hover:text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded"
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
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
          className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-lg text-[var(--muted)] opacity-70 transition-all hover:bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] hover:text-[var(--danger)] hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-30"
        >
          {isDeleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export function AiSessionList({
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
  sessions: AiSession[];
  tasks?: DashboardTask[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (session: AiSession) => void;
  onDelete?: (session: AiSession) => void | Promise<void>;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
  emptyLabel?: string;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const deleteMutation = useDeleteAiSession();

  const handleDelete = onDelete || (async (session: AiSession) => {
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
      <StatusCard
        variant="warning"
        title="Nie udało się wczytać sesji AI"
        description={error}
        onRetry={onRetry}
      />
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
          <AiSessionRow
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAll((prev) => !prev)}
            className="text-xs"
          >
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
