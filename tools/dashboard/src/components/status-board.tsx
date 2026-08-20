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
      role="button"
      tabIndex={0}
      className={cn(
        'group relative block w-full cursor-pointer rounded-xl border bg-[var(--surface)] p-3.5 text-left transition-colors hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        tone.line,
      )}
      onClick={event => onSelect?.(task, event.currentTarget)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(task, event.currentTarget);
        }
      }}
      aria-label={`Otwórz szczegóły zadania: ${task.title}`}
    >
      <div className="flex items-start justify-between gap-3">
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
      <h3 className="mt-3 text-[13px] font-semibold leading-5 text-[var(--foreground)]">{task.title}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge className={cn('border-0 px-2 py-0.5 text-[9px]', tone.tint)}>{formatStatus(task.status)}</Badge>
        {task.dependsOn.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]" title={`Zależności: ${task.dependsOn.join(', ')}`}>
            <GitBranch className="size-3" />
            {task.dependsOn.length}
          </span>
        )}
      </div>

      {hasAction && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 w-full gap-1.5 text-xs font-semibold text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/10"
            onClick={e => {
              e.stopPropagation();
              onAction?.(task, actionGate.action);
            }}
          >
            {actionGate.action === 'approve' ? (
              <>
                <Play className="size-3" /> Zatwierdź zadanie
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3" /> Zaakceptuj
              </>
            )}
          </Button>
        </div>
      )}
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
            <div key={lane.id} className="min-w-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={cn('size-1.5 rounded-full', tone.dot)} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{lane.shortLabel}</span>
                </div>
                <span className="text-[10px] tabular-nums text-[var(--muted)]">{lane.tasks.length}</span>
              </div>
              <div className={cn('min-h-[88px] space-y-2 rounded-2xl border border-dashed p-2 sm:min-h-[160px] 2xl:min-h-[230px]', tone.line, tone.tint)}>
                {actionableTasks.length > 1 && firstAction && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 w-full gap-1.5 text-xs font-semibold text-[var(--accent)] border border-[var(--accent)]/40 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 shadow-xs"
                    onClick={() => onBatchAction?.(actionableTasks, firstAction)}
                  >
                    {firstAction === 'approve' ? (
                      <>
                        <Play className="size-3" /> Zatwierdź wszystkie ({actionableTasks.length})
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-3" /> Zaakceptuj wszystkie ({actionableTasks.length})
                      </>
                    )}
                  </Button>
                )}
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
