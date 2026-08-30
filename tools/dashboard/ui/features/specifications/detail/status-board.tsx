import { CheckCircle2, GitBranch, LockKeyhole, Play } from 'lucide-react';
import type { CSSProperties } from 'react';

import type {
  SpecificationSummary,
  SpecificationTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
} from '../types';
import { cn } from '@/lib/utils';
import { lanePresentation } from './lane-presentation';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/shared/ui/status-label';

function TaskCard({
  task,
  actionGate,
  onSelect,
  onAction,
}: {
  task: SpecificationTask;
  actionGate?: SpecificationTaskActionGate | null;
  onSelect?: (task: SpecificationTask, trigger: HTMLElement) => void;
  onAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
}) {
  const hasAction = actionGate?.enabled;

  return (
    <div
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('button, a, input, textarea, select')) {
          onSelect?.(task, e.currentTarget);
        }
      }}
      className="group relative block w-full cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tabular-nums tracking-wider text-[var(--muted)]">
          #{String(task.order ?? '—').padStart(2, '0')}
        </span>
        <div className="flex min-w-0 items-center gap-2 text-[9px] font-medium tabular-nums text-[var(--muted)]">
          <StatusLabel kind="task" status={task.status} className="truncate text-[9px] font-semibold tracking-[0.08em] text-[var(--muted)]" />
          {task.dependsOn.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1" title={`Zależności: ${task.dependsOn.join(', ')}`}>
              <GitBranch className="size-3 text-[var(--accent)]" />
              {task.dependsOn.length}
            </span>
          )}
          {task.blockedBy.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1" title={`Blokowane przez: ${task.blockedBy.join(', ')}`}>
              <LockKeyhole className="size-3 text-[var(--warning)]" />
              {task.blockedBy.length}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={event => onSelect?.(task, event.currentTarget)}
        aria-label={`Otwórz szczegóły zadania: ${task.title}`}
        className="mt-2.5 block w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <h3 className="text-[13px] font-semibold leading-5 text-[var(--foreground)] transition-colors hover:text-[var(--accent)]">
          {task.title}
        </h3>
      </button>
      {hasAction && (
        <div className="mt-3 flex justify-center border-t border-[var(--border)] pt-2.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 cursor-pointer border border-[var(--accent)]/40 px-2.5 text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/15"
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
  change: SpecificationSummary;
  actions?: Record<string, SpecificationTaskActionGate>;
  onTaskSelect?: (task: SpecificationTask, trigger: HTMLElement) => void;
  onTaskAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
  onBatchAction?: (tasks: SpecificationTask[], action: SpecificationOwnerAction) => void;
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
          const presentation = lanePresentation[lane.id];
          const actionableTasks = lane.tasks.filter(task => actions?.[task.id]?.enabled);
          const firstAction = actionableTasks.length > 0 ? actions?.[actionableTasks[0].id]?.action : null;
          return (
            <div
              key={lane.id}
              style={{ '--lane-accent': presentation.accent } as CSSProperties}
              className={cn('min-w-0', lane.tasks.length === 0 && 'hidden sm:block')}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="size-1.5 rounded-full bg-[var(--lane-accent)]" />
                <StatusLabel className="text-[var(--muted-strong)]">{lane.shortLabel}</StatusLabel>
                <span className="ml-auto text-[10px] tabular-nums text-[var(--muted)]">{lane.tasks.length}</span>
              </div>
              <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 sm:min-h-[160px] 2xl:min-h-[230px]">
                {lane.tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    actionGate={actions?.[task.id]}
                    onSelect={onTaskSelect}
                    onAction={onTaskAction}
                  />
                ))}
                {lane.tasks.length === 0 && (
                  <span className="sr-only">Brak zadań</span>
                )}
                {actionableTasks.length > 1 && firstAction && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-full justify-center text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-muted)]"
                    onClick={() => onBatchAction?.(actionableTasks, firstAction)}
                  >
                    {firstAction === 'approve'
                      ? `Zatwierdź (${actionableTasks.length})`
                      : `Zaakceptuj (${actionableTasks.length})`}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
