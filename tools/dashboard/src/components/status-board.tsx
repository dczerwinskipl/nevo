import { CheckCircle2, CircleDashed, GitBranch, LockKeyhole, Play } from 'lucide-react';

import type {
  DashboardChange,
  DashboardLane,
  DashboardTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
  StageId,
} from '@/lib/types';
import { cn, formatStatus } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const stageTone: Record<StageId, { dot: string; tint: string; line: string }> = {
  new: { dot: 'bg-[var(--muted)]', tint: 'bg-[color-mix(in_srgb,var(--muted)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--muted)_25%,transparent)]' },
  design: { dot: 'bg-[var(--muted)]', tint: 'bg-[color-mix(in_srgb,var(--muted)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--muted)_25%,transparent)]' },
  ready: { dot: 'bg-[var(--muted)]', tint: 'bg-[color-mix(in_srgb,var(--muted)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--muted)_25%,transparent)]' },
  implementation: { dot: 'bg-[var(--info)]', tint: 'bg-[color-mix(in_srgb,var(--info)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--info)_25%,transparent)]' },
  review: { dot: 'bg-[var(--warning)]', tint: 'bg-[color-mix(in_srgb,var(--warning)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--warning)_25%,transparent)]' },
  done: { dot: 'bg-[var(--accent)]', tint: 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)]' },
};

function TaskCard({
  task,
  lane,
  actionGate,
  onSelect,
  onAction,
}: {
  task: DashboardTask;
  lane: DashboardLane;
  actionGate?: SpecificationTaskActionGate | null;
  onSelect?: (task: DashboardTask, trigger: HTMLElement) => void;
  onAction?: (task: DashboardTask, action: SpecificationOwnerAction) => void;
}) {
  const tone = stageTone[lane.id];
  const isDone = lane.id === 'done';
  const hasAction = actionGate?.enabled;

  return (
    <div
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('button, a, input, textarea, select')) {
          onSelect?.(task, e.currentTarget);
        }
      }}
      className={cn(
        'group relative block w-full rounded-xl border bg-[var(--surface)] p-3.5 text-left transition-colors hover:bg-[var(--surface-raised)] cursor-pointer',
        tone.line,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tabular-nums tracking-wider text-[var(--muted)]">
          #{String(task.order ?? '—').padStart(2, '0')}
        </span>
        {isDone ? (
          <CheckCircle2 className="size-3.5 text-[var(--accent)]" />
        ) : task.blockedBy.length ? (
          <LockKeyhole className="size-3.5 text-[var(--muted)]" />
        ) : (
          <CircleDashed className="size-3.5 text-[var(--muted)]" />
        )}
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={event => onSelect?.(task, event.currentTarget)}
          aria-label={`Otwórz szczegóły zadania: ${task.title}`}
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded cursor-pointer"
        >
          <h3 className="text-[13px] font-semibold leading-5 text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">
            {task.title}
          </h3>
        </button>
        {hasAction && (
          <Button
            size="sm"
            variant="secondary"
            className="h-5 shrink-0 px-2 text-[10px] font-semibold text-[var(--accent)] border border-[var(--accent)]/40 hover:bg-[var(--accent)]/15 cursor-pointer"
            onClick={() => onAction?.(task, actionGate.action)}
            aria-label={`${actionGate.action === 'approve' ? 'Zatwierdź zadanie' : 'Zaakceptuj zadanie'}: ${task.title}`}
          >
            {actionGate.action === 'approve' ? (
              <>
                <Play className="mr-1 size-2.5" /> Zatwierdź
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-1 size-2.5" /> Zaakceptuj
              </>
            )}
          </Button>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge className={cn('border-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]', tone.tint)}>{formatStatus(task.status)}</Badge>
        {task.dependsOn.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]" title={`Zależności: ${task.dependsOn.join(', ')}`}>
            <GitBranch className="size-3" />
            {task.dependsOn.length}
          </span>
        )}
      </div>
    </div>
  );
}

export function StatusBoard({
  change,
  actions,
  onTaskSelect,
  onTaskAction,
  onBatchAction,
}: {
  change: DashboardChange;
  actions?: Record<string, SpecificationTaskActionGate>;
  onTaskSelect?: (task: DashboardTask, trigger: HTMLElement) => void;
  onTaskAction?: (task: DashboardTask, action: SpecificationOwnerAction) => void;
  onBatchAction?: (tasks: DashboardTask[], action: SpecificationOwnerAction) => void;
}) {
  return (
    <section aria-labelledby="workflow-heading">
      <div className="mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Przepływ</p>
          <h2 id="workflow-heading" className="mt-1 text-xl font-semibold tracking-tight text-[var(--foreground)]">
            Status zadań
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {change.lanes.map(lane => {
          const tone = stageTone[lane.id];
          const actionableTasks = lane.tasks.filter(task => actions?.[task.id]?.enabled);
          const firstAction = actionableTasks.length > 0 ? actions?.[actionableTasks[0].id]?.action : null;
          return (
            <div key={lane.id} className={cn('min-w-0', lane.tasks.length === 0 ? 'order-last sm:order-none' : 'order-first sm:order-none')}>
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={cn('size-1.5 rounded-full', tone.dot)} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{lane.shortLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {actionableTasks.length > 1 && firstAction && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10"
                      onClick={() => onBatchAction?.(actionableTasks, firstAction)}
                    >
                      {firstAction === 'approve'
                        ? `Zatwierdź (${actionableTasks.length})`
                        : `Zaakceptuj (${actionableTasks.length})`}
                    </Button>
                  )}
                  <span className="text-[10px] tabular-nums text-[var(--muted)]">{lane.tasks.length}</span>
                </div>
              </div>
              <div className={cn('space-y-2 rounded-2xl border border-dashed p-2 sm:min-h-[160px] 2xl:min-h-[230px]', tone.line, tone.tint, lane.tasks.length === 0 ? 'hidden sm:block min-h-0' : 'min-h-[88px]')}>
                {lane.tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    lane={lane}
                    actionGate={actions?.[task.id]}
                    onSelect={onTaskSelect}
                    onAction={onTaskAction}
                  />
                ))}
                {lane.tasks.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-xl border border-transparent text-[10px] text-[var(--muted)]">
                    Brak zadań
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
