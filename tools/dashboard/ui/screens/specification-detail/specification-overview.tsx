import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowUpRight, Layers3, MessageSquarePlus, ListChecks, Play, AlertTriangle, ShieldAlert } from 'lucide-react';

import type {
  SpecificationSummary,
  SpecificationTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
  WorkflowStepDescriptor,
} from '@/features/specifications/types';
import type { AgentSession, TaskNavigationTarget } from '@/features/agent-sessions/types';
import { formatStatus, cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { AgentSessionList } from '@/features/agent-sessions/agent-session-list';
import { StatusBoard } from '@/features/specifications/detail/status-board';

export interface SequentialQueueTaskPickerProps {
  tasks: SpecificationTask[];
  taskActions?: Record<string, SpecificationTaskActionGate>;
  onStartStep?: (task: SpecificationTask, stepDescriptor: WorkflowStepDescriptor, taskIds?: string[]) => void | Promise<void>;
  onTriggerRemediationReview?: (remediationTaskIds: string[]) => void | Promise<void>;
}

export function SequentialQueueTaskPicker({
  tasks,
  taskActions,
  onStartStep,
  onTriggerRemediationReview,
}: SequentialQueueTaskPickerProps) {
  // Pre-checks currently-ready tasks (D32, AC 104)
  const readyTaskIds = useMemo(() => {
    const ready = new Set<string>();
    for (const t of tasks) {
      const gate = taskActions?.[t.id];
      if (
        gate?.availableActions?.includes('start-step') ||
        gate?.state === 'ready' ||
        gate?.canPublish ||
        t.status === 'approved'
      ) {
        ready.add(t.id);
      }
    }
    return ready;
  }, [tasks, taskActions]);

  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(readyTaskIds);

  useEffect(() => {
    setSelectedTaskIds(readyTaskIds);
  }, [readyTaskIds]);

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  };

  const clearAll = () => {
    setSelectedTaskIds(new Set());
  };

  // Cross-selection dependency warnings (D32, AC 5)
  // Names specific blocking tasks that are not selected and not satisfied
  const dependencyWarnings = useMemo(() => {
    const warnings: Array<{ taskId: string; taskTitle: string; blockingTaskId: string }> = [];
    for (const task of tasks) {
      if (!selectedTaskIds.has(task.id)) continue;
      for (const depId of task.dependsOn || []) {
        const depTask = tasks.find((t) => t.id === depId);
        const depGate = taskActions?.[depId];
        const isSatisfied =
          depTask?.status === 'verified' ||
          depGate?.state === 'terminal' ||
          depGate?.terminalOutcome === 'success';
        if (!isSatisfied && !selectedTaskIds.has(depId)) {
          warnings.push({
            taskId: task.id,
            taskTitle: task.title,
            blockingTaskId: depId,
          });
        }
      }
    }
    return warnings;
  }, [selectedTaskIds, tasks, taskActions]);

  // Derived remediation group tasks (D31, AC 63)
  const remediationTaskIds = useMemo(() => {
    const ids: string[] = [];
    for (const t of tasks) {
      const gate = taskActions?.[t.id];
      if (
        gate?.state === 'blocked' ||
        (gate?.blockedBy && gate.blockedBy.length > 0) ||
        (t as any).suspensions?.length > 0
      ) {
        ids.push(t.id);
      }
    }
    return ids;
  }, [tasks, taskActions]);

  const handleSelectRemediationGroup = () => {
    if (remediationTaskIds.length > 0) {
      setSelectedTaskIds(new Set(remediationTaskIds));
      onTriggerRemediationReview?.(remediationTaskIds);
    }
  };

  // Submits the selection via server-side orchestration layer
  // Starts exactly ONE session (for the queue's first nextRunnable item), never more than one (D33, AC 2, AC 8)
  const handleStartBatch = useCallback(() => {
    if (selectedTaskIds.size === 0) return;
    const selectedTasks = tasks
      .filter((t) => selectedTaskIds.has(t.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const nextRunnable =
      selectedTasks.find((t) => taskActions?.[t.id]?.availableActions?.includes('start-step')) ||
      selectedTasks[0];

    if (nextRunnable) {
      const gate = taskActions?.[nextRunnable.id];
      const descriptor =
        gate?.stepDescriptor ||
        gate?.nextStepDescriptor ||
        gate?.currentStepDescriptor || {
          id: null,
          executor: gate?.executor || 'agent',
        };
      // Exactly ONE session start is initiated
      onStartStep?.(nextRunnable, descriptor, Array.from(selectedTaskIds));
    }
  }, [onStartStep, selectedTaskIds, tasks, taskActions]);

  if (!tasks || tasks.length === 0) return null;

  return (
    <Card className="mt-8 overflow-hidden border border-border bg-surface p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <ListChecks className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg-primary">Kolejka zadań (Sequential Queue)</h3>
              <Badge className="text-[10px]">
                {selectedTaskIds.size} / {tasks.length} wybranych
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">
              Wybierz zadania do uruchomienia w kolejce deterministycznej. Zadania wykonywane są sekwencyjnie (jedno na raz).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={selectAll} className="h-7 text-xs">
            Zaznacz wszystkie
          </Button>
          <Button size="sm" variant="secondary" onClick={clearAll} className="h-7 text-xs">
            Wyczyść
          </Button>
          {remediationTaskIds.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSelectRemediationGroup}
              className="h-7 border-status-warning/40 text-xs text-status-warning hover:bg-status-warning/10"
              title="Wybierz zadania wymagające naprawy (remediation group)"
            >
              <ShieldAlert className="mr-1 size-3" /> Grupa naprawcza ({remediationTaskIds.length})
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleStartBatch}
            disabled={selectedTaskIds.size === 0}
            className="h-7 cursor-pointer text-xs font-semibold"
            aria-label="Start batch"
          >
            <Play className="mr-1 size-3" /> Start batch
          </Button>
        </div>
      </div>

      {dependencyWarnings.length > 0 && (
        <div className="mt-4 space-y-1.5" role="alert" aria-label="Ostrzeżenia o zależnościach">
          {dependencyWarnings.map((w) => (
            <div
              key={`${w.taskId}-${w.blockingTaskId}`}
              className="flex items-center gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning"
            >
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>
                Ostrzeżenie: Zadanie <strong>{w.taskTitle}</strong> zależy od niezaznaczonego lub niespełnionego zadania <code>{w.blockingTaskId}</code>.
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((task) => {
          const isChecked = selectedTaskIds.has(task.id);
          const gate = taskActions?.[task.id];
          return (
            <label
              key={task.id}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors',
                isChecked
                  ? 'border-accent/50 bg-accent/5'
                  : 'border-border bg-surface-raised hover:bg-surface-hover',
              )}
            >
              <input
                type="checkbox"
                aria-label={`Wybierz zadanie ${task.title}`}
                className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                checked={isChecked}
                onChange={() => toggleTask(task.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-semibold text-fg-primary">
                    #{String(task.order ?? '—').padStart(2, '0')} {task.title}
                  </span>
                  {gate?.state && (
                    <span className="text-[10px] uppercase text-fg-muted">{gate.state}</span>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </Card>
  );
}

export function SpecificationOverview({
  specification,
  onTaskSelect,
  sessions,
  sessionsLoading,
  sessionsError,
  onSessionsRetry,
  onOpenSession,
  actions,
  taskActions,
  isDeterministic = false,
  onDirectTaskAction,
  onBatchTaskAction,
  onStartStep,
  onPublishTask,
  onBatchPublish,
  onCreateSession,
  onOpenTask,
}: {
  specification: SpecificationSummary;
  onTaskSelect: (task: SpecificationTask, trigger: HTMLElement) => void;
  sessions: AgentSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  onSessionsRetry: () => void;
  onOpenSession: (session: AgentSession) => void;
  actions: React.ReactNode;
  taskActions?: Record<string, SpecificationTaskActionGate>;
  /** Authoritative specification-level workflow mode (D15) — never a UI preference. */
  isDeterministic?: boolean;
  onDirectTaskAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
  onBatchTaskAction?: (tasks: SpecificationTask[], action: SpecificationOwnerAction) => void;
  onStartStep?: (task: SpecificationTask, stepDescriptor: WorkflowStepDescriptor, taskIds?: string[]) => void | Promise<void>;
  onPublishTask?: (task: SpecificationTask) => void | Promise<void>;
  onBatchPublish?: (tasks: SpecificationTask[]) => void | Promise<void>;
  onCreateSession: () => void;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
}) {
  return (
    <>
      <section className="mb-9" aria-label="Ostatnie sesje specyfikacji">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-accent uppercase">Sesje AI</p>
            <h2 className="mt-1 text-xl font-semibold text-fg-primary">Ostatnie rozmowy</h2>
          </div>
          {specification.source === 'active' && specification.specId && (
            <Button size="sm" onClick={onCreateSession}>
              <MessageSquarePlus className="mr-1.5 size-3.5" />
              Nowa sesja
            </Button>
          )}
        </div>
        <AgentSessionList
          sessions={sessions}
          tasks={specification.tasks}
          loading={sessionsLoading}
          error={sessionsError}
          onRetry={onSessionsRetry}
          onOpen={onOpenSession}
          onOpenTask={onOpenTask}
          limit={8}
          emptyLabel="Brak sesji dla tej specyfikacji."
        />
      </section>
      {actions}

      {specification.nextTask && (
        <Card className="mt-3 overflow-hidden">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-fg-on-accent">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-[0.16em] text-fg-muted uppercase">
                {specification.nextTask.status === 'in-implementation'
                  ? 'Aktualnie realizowane'
                  : 'Następne gotowe zadanie'}
              </p>
              <p className="mt-1 text-sm font-semibold text-fg-primary">{specification.nextTask.title}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-fg-muted">
              <Layers3 className="size-3.5 text-accent" />
              {formatStatus(specification.nextTask.status)}
            </div>
          </div>
        </Card>
      )}

      {isDeterministic && specification.tasks && specification.tasks.length > 0 && (
        <SequentialQueueTaskPicker
          tasks={specification.tasks}
          taskActions={taskActions}
          onStartStep={onStartStep}
        />
      )}

      <div className="mt-11">
        <StatusBoard
          specification={specification}
          actions={taskActions}
          isDeterministic={isDeterministic}
          onTaskSelect={onTaskSelect}
          onTaskAction={onDirectTaskAction}
          onBatchAction={onBatchTaskAction}
          onStartStep={onStartStep}
          onPublishTask={onPublishTask}
          onBatchPublish={onBatchPublish}
        />
      </div>
    </>
  );
}
