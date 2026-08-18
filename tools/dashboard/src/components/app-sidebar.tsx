import {
  Archive,
  FileText,
  LayoutDashboard,
  Plus,
  Search,
  MessagesSquare,
  X,
} from 'lucide-react';

import type { AiSession, DashboardChange } from '@/lib/types';
import { cn, formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StageProgress } from '@/components/stage-progress';
import { AiSessionRow, sortSessionsByRecency } from '@/components/ai-session-list';
import { StatusCard, RetryButton } from '@/components/ui/status-card';
import { useDeleteAiSession } from '@/hooks/use-dashboard-data';

export type DashboardMode = 'active' | 'archive';

interface AppSidebarProps {
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  active: DashboardChange[];
  archive: DashboardChange[];
  selectedSlug: string | null;
  onSelect: (change: DashboardChange) => void;
  sessions: AiSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  onSessionsRetry: () => void;
  onOpenSession: (session: AiSession) => void;
  onOpenCreateSpec?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  open: boolean;
  onClose: () => void;
}

function SpecNavigationItem({
  change,
  selected,
  onClick,
}: {
  change: DashboardChange;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group w-full rounded-xl border p-3.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        selected
          ? 'border-[color-mix(in_srgb,var(--accent)_36%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-raised))]'
          : 'border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-raised)]',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-[var(--muted)]',
            selected
              ? 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface)]',
          )}
        >
          <FileText className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--foreground)]">
            {change.title}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span>{change.metrics.total} {pluralizeTasks(change.metrics.total)}</span>
            {change.source === 'active' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatStatus(change.status)}</span>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <StageProgress change={change} className="flex-1" />
            <span className="text-[10px] font-bold tabular-nums text-[var(--muted)]">
              {change.metrics.progress}%
            </span>
          </div>
          {change.source === 'archive' && (
            <p className="mt-2 text-[10px] text-[var(--muted)]">{formatDate(change.updatedAt)}</p>
          )}
        </div>
      </div>
    </button>
  );
}

export function AppSidebar({
  mode,
  onModeChange,
  active,
  archive,
  selectedSlug,
  onSelect,
  sessions,
  sessionsLoading,
  sessionsError,
  onSessionsRetry,
  onOpenSession,
  onOpenCreateSpec,
  search,
  onSearchChange,
  open,
  onClose,
}: AppSidebarProps) {
  const source = mode === 'active' ? active : archive;
  const query = search.trim().toLocaleLowerCase('pl');
  const visible = source.filter(change =>
    !query || change.title.toLocaleLowerCase('pl').includes(query) || change.slug.includes(query),
  );
  const activeSpecIds = new Set(active.map(change => change.specId).filter(Boolean));
  const recentSessions = sortSessionsByRecency(sessions.filter(session => activeSpecIds.has(session.specId))).slice(0, 5);
  const activeTasks = active.flatMap(change => change.tasks);

  const deleteMutation = useDeleteAiSession();
  const handleDeleteSession = async (session: AiSession) => {
    await deleteMutation.deleteSession({
      provider: session.provider,
      sessionId: session.providerSessionId || session.sessionId,
    });
  };

  return (
    <>
      <button
        aria-label="Zamknij menu"
        type="button"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-label="Nawigacja specyfikacji"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(90vw,370px)] flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_94%,transparent)] shadow-[30px_0_80px_rgba(0,0,0,.28)] backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 lg:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="border-b border-[var(--border)] px-5 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">NEvo Flow</p>
              <p className="mt-1 text-base font-semibold text-[var(--foreground)]">Specyfikacje</p>
            </div>
            <div className="flex items-center gap-1.5">
              {onOpenCreateSpec && (
                <Button
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[color-mix(in_srgb,var(--accent)_85%,black)]"
                  onClick={onOpenCreateSpec}
                  aria-label="Nowa specyfikacja"
                >
                  <Plus className="size-3.5" />
                  <span>Nowa</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Zamknij menu">
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            <button
              type="button"
              onClick={() => onModeChange('active')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                mode === 'active' ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              <LayoutDashboard className="size-3.5" />
              Aktualne
              <Badge className="border-0 bg-white/6 px-1.5 py-0 text-[9px]">{active.length}</Badge>
            </button>
            <button
              type="button"
              onClick={() => onModeChange('archive')}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                mode === 'archive' ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              <Archive className="size-3.5" />
              Archiwum
              <Badge className="border-0 bg-white/6 px-1.5 py-0 text-[9px]">{archive.length}</Badge>
            </button>
          </div>

          <label className="relative mt-3 block">
            <span className="sr-only">Szukaj specyfikacji</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              placeholder={mode === 'active' ? 'Szukaj aktualnych…' : 'Szukaj w archiwum…'}
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {mode === 'active' && (
            <section className="mb-4 border-b border-[var(--border)] px-2 pb-4" aria-label="Ostatnie sesje AI">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]"><MessagesSquare className="size-3" />Ostatnie sesje</span>
                {sessionsError && (
                  <RetryButton
                    size="icon"
                    onClick={onSessionsRetry}
                    label="Ponów pobieranie sesji"
                  />
                )}
              </div>
              {sessionsLoading ? <p className="py-2 text-[11px] text-[var(--muted)]">Wczytywanie sesji…</p>
                : sessionsError ? (
                  <div className="my-1">
                    <StatusCard
                      variant="warning"
                      size="sm"
                      title="Nie udało się wczytać sesji"
                      description={sessionsError}
                      onRetry={onSessionsRetry}
                    />
                  </div>
                )
                : recentSessions.length ? <div className="space-y-1.5">{recentSessions.map(session => <AiSessionRow key={`${session.provider}:${session.sessionId}`} session={session} tasks={activeTasks} onOpen={onOpenSession} onDelete={handleDeleteSession} compact />)}</div>
                : <p className="py-2 text-[11px] text-[var(--muted)]">Brak sesji dla aktywnych specyfikacji.</p>}
            </section>
          )}
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {mode === 'active' ? 'W toku' : 'Zakończone'}
            </span>
            <span className="text-[10px] text-[var(--muted)]">{visible.length}</span>
          </div>
          <div className="space-y-1">
            {visible.map(change => (
              <SpecNavigationItem
                key={`${change.source}:${change.slug}`}
                change={change}
                selected={selectedSlug === change.slug}
                onClick={() => onSelect(change)}
              />
            ))}
            {visible.length === 0 && (
              <div className="mx-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
                <Archive className="mx-auto size-5 text-[var(--muted)]" />
                <p className="mt-3 text-xs font-semibold text-[var(--foreground)]">Brak wyników</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">Zmień wyszukiwaną frazę.</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
