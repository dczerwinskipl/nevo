import { CheckCircle2, Eye, GitBranch, LockKeyhole, Play } from 'lucide-react';

import type {
  SpecificationSummary,
  SpecificationTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
} from '../types';
import { cn } from '@/shared/lib/utils';
import { lanePresentation } from './lane-presentation';
import { Button } from '@/shared/ui/button';
import { StatusLabel } from '@/shared/ui/status-label';
import { formatTaskStatus, taskStatusTone } from '../status';

function TaskCard({
  task,
  actionGate,
  isDeterministic = false,
  onSelect,
  onAction,
  onWorkflowAction,
}: {
  task: SpecificationTask;
  actionGate?: SpecificationTaskActionGate | null;
  /** Authoritative specification-level workflow mode (D15) — never a UI preference. */
  isDeterministic?: boolean;
  onSelect?: (task: SpecificationTask, trigger: HTMLElement) => void;
  onAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
  onWorkflowAction?: (task: SpecificationTask, action: string) => void;
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
      className="group relative block w-full cursor-pointer rounded-xl border border-border bg-surface-raised p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-wider text-fg-muted tabular-nums">
          #{String(task.order ?? '—').padStart(2, '0')}
        </span>
        <div className="flex min-w-0 items-center gap-2 text-[9px] font-medium text-fg-muted tabular-nums">
          <StatusLabel
            tone={taskStatusTone(task.status)}
            className="truncate text-[9px] font-semibold tracking-[0.08em]"
          >
            {formatTaskStatus(task.status)}
          </StatusLabel>
          {task.dependsOn.length > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1"
              title={`Zależności: ${task.dependsOn.join(', ')}`}
            >
              <GitBranch className="size-3 text-accent" />
              {task.dependsOn.length}
            </span>
          )}
          {task.blockedBy.length > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1"
              title={`Blokowane przez: ${task.blockedBy.join(', ')}`}
            >
              <LockKeyhole className="size-3 text-status-warning" />
              {task.blockedBy.length}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => onSelect?.(task, event.currentTarget)}
        aria-label={`Otwórz szczegóły zadania: ${task.title}`}
        className="mt-2.5 block w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <h3 className="text-[13px] leading-5 font-semibold text-fg-primary transition-colors hover:text-accent">
          {task.title}
        </h3>
      </button>
      {!isDeterministic ? (
        hasAction && (
          <div className="mt-3 flex justify-center border-t border-border pt-2.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 shrink-0 cursor-pointer border border-accent/40 px-2.5 text-[10px] font-semibold text-accent hover:bg-accent/15"
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
        )
      ) : (
        actionGate?.availableActions && actionGate.availableActions.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5 border-t border-border pt-2.5">
            {actionGate.availableActions.includes('start-implementation') && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 cursor-pointer border border-accent/40 px-2.5 text-[10px] font-semibold text-accent hover:bg-accent/15"
                onClick={() => onWorkflowAction?.(task, 'start-implementation')}
                aria-label={`Start implementation: ${task.title}`}
              >
                <Play className="mr-1 size-2.5" /> Start implementation
              </Button>
            )}
            {actionGate.availableActions.includes('start-review') && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 cursor-pointer border border-accent/40 px-2.5 text-[10px] font-semibold text-accent hover:bg-accent/15"
                onClick={() => onWorkflowAction?.(task, 'start-review')}
                aria-label={`Start review: ${task.title}`}
              >
                <Eye className="mr-1 size-2.5" /> Start review
              </Button>
            )}
            {actionGate.availableActions.includes('approve') && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 cursor-pointer border border-status-success/40 px-2.5 text-[10px] font-semibold text-status-success hover:bg-status-success/15"
                onClick={() => onWorkflowAction?.(task, 'approve')}
                aria-label={`Approve: ${task.title}`}
              >
                <CheckCircle2 className="mr-1 size-2.5" /> Approve
              </Button>
            )}
            {actionGate.availableActions.includes('request-changes') && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 cursor-pointer border border-status-warning/40 px-2.5 text-[10px] font-semibold text-status-warning hover:bg-status-warning/15"
                onClick={() => onWorkflowAction?.(task, 'request-changes')}
                aria-label={`Request changes: ${task.title}`}
              >
                Request changes
              </Button>
            )}
            {actionGate.availableActions.includes('operator-reconciliation') && (
              <span className="rounded bg-status-warning/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-status-warning uppercase">
                Operator reconciliation
              </span>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function StatusBoard({
  specification,
  actions,
  isDeterministic = false,
  onTaskSelect,
  onTaskAction,
  onBatchAction,
  onWorkflowAction,
}: {
  specification: SpecificationSummary;
  actions?: Record<string, SpecificationTaskActionGate>;
  /** Authoritative specification-level workflow mode (D15) — never a UI preference. */
  isDeterministic?: boolean;
  onTaskSelect?: (task: SpecificationTask, trigger: HTMLElement) => void;
  onTaskAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
  onBatchAction?: (tasks: SpecificationTask[], action: SpecificationOwnerAction) => void;
  onWorkflowAction?: (task: SpecificationTask, action: string) => void;
}) {
  return (
    <section aria-labelledby="workflow-heading">
      <div className="mb-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-accent uppercase">Przepływ</p>
          <h2 id="workflow-heading" className="mt-1 text-xl font-semibold tracking-tight text-fg-primary">
            Status zadań
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {specification.lanes.map((lane) => {
          const presentation = lanePresentation[lane.id];
          const actionableTasks = lane.tasks.filter((task) => actions?.[task.id]?.enabled);
          const firstAction = actionableTasks.length > 0 ? actions?.[actionableTasks[0].id]?.action : null;
          return (
            <div key={lane.id} className={cn('min-w-0', lane.tasks.length === 0 && 'hidden sm:block')}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className={cn('size-1.5 rounded-full', presentation.dotClassName)} />
                <span className="text-[10px] font-bold tracking-[0.1em] text-fg-secondary uppercase">
                  {lane.shortLabel}
                </span>
                <span className="ml-auto text-[10px] text-fg-muted tabular-nums">{lane.tasks.length}</span>
              </div>
              <div className="space-y-2 rounded-2xl border border-border bg-surface p-2 sm:min-h-[160px] 2xl:min-h-[230px]">
                {lane.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    actionGate={actions?.[task.id]}
                    isDeterministic={isDeterministic}
                    onSelect={onTaskSelect}
                    onAction={onTaskAction}
                    onWorkflowAction={onWorkflowAction}
                  />
                ))}
                {lane.tasks.length === 0 && <span className="sr-only">Brak zadań</span>}
                {!isDeterministic && actionableTasks.length > 1 && firstAction && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-full justify-center text-[10px] font-semibold text-accent hover:bg-accent/10"
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
