import {
  ArrowUpRight,
  CheckCircle2,
  CircleDotDashed,
  Layers3,
  ListChecks,
  MessageSquarePlus,
  Play,
} from 'lucide-react';

import type {
  AiSession,
  DashboardChange,
  DashboardTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
  TaskNavigationTarget,
} from '@/lib/types';
import { cn, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AiSessionList } from '@/components/ai-session-list';
import { StatusBoard } from '@/components/status-board';

function MetricCard({
  icon,
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper: string;
  tone?: 'neutral' | 'accent' | 'warning' | 'success';
}) {
  const toneClass = {
    neutral: 'text-[var(--accent)]',
    accent: 'text-[var(--accent)]',
    warning: 'text-[var(--warning)]',
    success: 'text-[var(--success)]',
  }[tone];

  return (
    <Card className="relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
          <p className={cn('mt-2 text-xl font-semibold tracking-tight', tone === 'neutral' ? 'text-[var(--foreground)]' : toneClass)}>{value}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{helper}</p>
        </div>
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]', toneClass)}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function OverviewPanel({
  change,
  onTaskSelect,
  sessions,
  sessionsLoading,
  sessionsError,
  onSessionsRetry,
  onOpenSession,
  actions,
  taskActions,
  onDirectTaskAction,
  onBatchTaskAction,
  onCreateSession,
  onOpenTask,
}: {
  change: DashboardChange;
  onTaskSelect: (task: DashboardTask, trigger: HTMLElement) => void;
  sessions: AiSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  onSessionsRetry: () => void;
  onOpenSession: (session: AiSession) => void;
  actions: React.ReactNode;
  taskActions?: Record<string, SpecificationTaskActionGate>;
  onDirectTaskAction?: (task: DashboardTask, action: SpecificationOwnerAction) => void;
  onBatchTaskAction?: (tasks: DashboardTask[], action: SpecificationOwnerAction) => void;
  onCreateSession: () => void;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
}) {
  return (
    <>
      <section className="mb-9" aria-label="Ostatnie sesje specyfikacji">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Sesje AI</p><h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">Ostatnie rozmowy</h2></div>{change.source === 'active' && change.specId && <Button size="sm" onClick={onCreateSession}><MessageSquarePlus className="mr-1.5 size-3.5" />Nowa sesja</Button>}</div>
        <AiSessionList sessions={sessions} tasks={change.tasks} loading={sessionsLoading} error={sessionsError} onRetry={onSessionsRetry} onOpen={onOpenSession} onOpenTask={onOpenTask} limit={8} emptyLabel="Brak sesji dla tej specyfikacji." />
      </section>
      {actions}
      <section aria-label="Podsumowanie specyfikacji" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<ListChecks className="size-4" />}
          label="Zakres"
          value={`${change.metrics.total} ${pluralizeTasks(change.metrics.total)}`}
          helper={`${change.metrics.abandoned} porzuconych`}
        />
        <MetricCard
          icon={<Play className="size-4" />}
          label="W toku"
          value={String(change.metrics.inImplementation)}
          helper={`${change.metrics.ready} gotowych do startu`}
          tone="accent"
        />
        <MetricCard
          icon={<CircleDotDashed className="size-4" />}
          label="Review"
          value={String(change.metrics.inReview)}
          helper="zadań oczekuje na weryfikację"
          tone="warning"
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4" />}
          label="Gotowe"
          value={String(change.metrics.completed)}
          helper="zadań zweryfikowanych"
          tone="success"
        />
      </section>

      {change.nextTask && (
        <Card className="mt-3 overflow-hidden">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                {change.nextTask.status === 'in-implementation' ? 'Aktualnie realizowane' : 'Następne gotowe zadanie'}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{change.nextTask.title}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Layers3 className="size-3.5 text-[var(--accent)]" />
              {formatStatus(change.nextTask.status)}
            </div>
          </div>
        </Card>
      )}

      <div className="mt-11">
        <StatusBoard
          change={change}
          actions={taskActions}
          onTaskSelect={onTaskSelect}
          onTaskAction={onDirectTaskAction}
          onBatchAction={onBatchTaskAction}
        />
      </div>
    </>
  );
}
