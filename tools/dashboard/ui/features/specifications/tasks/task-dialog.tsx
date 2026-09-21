import { useCallback, useEffect, useRef } from 'react';
import { MessagesSquare, LoaderCircle, X, AlertCircle } from 'lucide-react';
import type { SpecificationSummary, SpecificationTask, SpecificationTaskDocument, WorkflowStepDescriptor } from '../types';
import { formatStatus } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { TaskActionFooter } from '../actions/spec-actions';
import { useSpecificationDocument, useSpecificationActions } from '../detail/spec-detail-queries';
import { HumanStepSurface } from '@/shared/workflow/human-step-surface';
import { useSpecificationHumanStepMutation } from './human-step-mutations';

export interface TaskDialogProps {
  specification: SpecificationSummary;
  taskId: string;
  onClose: () => void;
  onOperationStarted?: (operationId: string, label: string) => void;
  sessionsContent?: React.ReactNode;
  onStartStep?: (task: SpecificationTask, stepDescriptor: WorkflowStepDescriptor) => void;
}

export function TaskDialog({ specification, taskId, onClose, onOperationStarted, sessionsContent, onStartStep }: TaskDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const task = specification.tasks.find((t) => t.id === taskId);
  const taskDocId = taskId ? `task:${taskId}` : null;
  const taskDocumentQuery = useSpecificationDocument(specification, taskDocId, Boolean(taskId));
  const taskDocument = taskId ? (taskDocumentQuery.data as SpecificationTaskDocument | null) : null;

  const actionsQuery = useSpecificationActions(specification, specification.source === 'active');
  const actionGate = taskId && actionsQuery.data?.tasks ? (actionsQuery.data.tasks[taskId] ?? null) : null;

  const isDeterministic =
    actionsQuery.data?.workflowMode === 'deterministic' ||
    (specification as any).workflowMode === 'deterministic';

  const humanStepMutation = useSpecificationHumanStepMutation({
    source: specification.source,
    slug: specification.slug,
    taskId: task?.id ?? '',
    onSuccess: async () => {
      await actionsQuery.refresh();
      onClose();
    },
  });

  const executeTaskAction = useCallback(async () => {
    if (!actionGate || !task) return;
    try {
      const actionName = actionGate.action;
      const res = await actionsQuery.execute({ action: actionName, taskId: task.id });
      onClose();
      if (res?.operationId && onOperationStarted) {
        onOperationStarted(
          res.operationId,
          actionName === 'approve' ? `Zatwierdzanie zadania: ${task.id}` : `Weryfikacja zadania: ${task.id}`,
        );
      }
    } catch {
      // The mutation exposes its sanitized error in the dialog footer via actionsQuery.executionError
    }
  }, [actionGate, actionsQuery, onClose, onOperationStarted, task]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!task) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-backdrop p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{formatStatus(task.status)}</Badge>
              <span className="text-[10px] text-fg-muted">#{String(task.order ?? '—').padStart(2, '0')}</span>
            </div>
            <h2 id="task-dialog-title" className="mt-3 text-lg font-semibold text-fg-primary sm:text-xl">
              {task.title}
            </h2>
            {task.file && <p className="mt-1 truncate text-[10px] text-fg-muted">{task.file}</p>}
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Zamknij szczegóły zadania"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <div className="mb-7 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 text-fg-secondary">
              Zależności: {task.dependsOn.length ? task.dependsOn.join(', ') : 'brak'}
            </span>
            {task.blockedBy.length > 0 && (
              <span className="rounded-md border border-status-warning/25 bg-status-warning/10 px-2.5 py-1 text-status-warning">
                Blokowane przez: {task.blockedBy.join(', ')}
              </span>
            )}
          </div>

          {sessionsContent && (
            <section className="mb-7" aria-label="Sesje powiązane z zadaniem">
              <div className="mb-3 flex items-center gap-2">
                <MessagesSquare className="size-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg-primary">Powiązane sesje</h3>
              </div>
              {sessionsContent}
            </section>
          )}

          {taskDocumentQuery.loading ? (
            <div className="flex items-center gap-3 py-12 text-sm text-fg-muted" role="status">
              <LoaderCircle className="size-4 animate-spin text-accent" /> Wczytywanie opisu zadania…
            </div>
          ) : taskDocumentQuery.error ? (
            <div className="rounded-xl border border-status-error/25 bg-status-error/10 p-4 text-xs text-status-error">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="size-4 text-status-error" />
                <span>Nie udało się wczytać treści zadania</span>
              </div>
              <p className="mt-1 text-[11px] text-status-error/80">{taskDocumentQuery.error}</p>
              <Button size="sm" variant="secondary" onClick={() => void taskDocumentQuery.refresh()} className="mt-3">
                Spróbuj ponownie
              </Button>
            </div>
          ) : taskDocument?.available ? (
            <MarkdownContent markdown={taskDocument.markdown} />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-fg-muted">
              <p className="font-semibold text-fg-primary">Brak treści zadania</p>
              <p className="mt-1">Plik zadania nie jest obecnie dostępny w specyfikacji.</p>
            </div>
          )}
        </div>

        {!isDeterministic && (
          <TaskActionFooter
            gate={actionGate}
            loading={actionsQuery.loading}
            executing={actionsQuery.executing}
            error={actionsQuery.executionError}
            onExecute={() => void executeTaskAction()}
          />
        )}

        {isDeterministic && actionGate?.humanInteraction && (
          <div className="border-t border-border bg-surface px-5 py-4 sm:px-7">
            <HumanStepSurface
              interaction={actionGate.humanInteraction}
              loading={humanStepMutation.loading}
              error={humanStepMutation.error}
              onSubmit={async (result, feedback, artifacts) => {
                await humanStepMutation.submit(result, feedback, artifacts);
              }}
            />
          </div>
        )}

        {isDeterministic && !actionGate?.humanInteraction && actionGate?.availableActions?.includes('start-step') && (
          <div className="border-t border-border bg-surface px-5 py-4 sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {(() => {
                  const stepDescriptor = actionGate.stepDescriptor || actionGate.currentStepDescriptor || actionGate.nextStepDescriptor;
                  return (
                    <span className="text-xs font-medium text-fg-secondary">
                      {stepDescriptor?.purpose || stepDescriptor?.id || 'Kolejny krok oczekuje na rozpoczęcie'}
                    </span>
                  );
                })()}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const stepDescriptor = actionGate.stepDescriptor || actionGate.currentStepDescriptor || actionGate.nextStepDescriptor;
                  if (stepDescriptor && task) onStartStep?.(task, stepDescriptor);
                }}
                className="h-8 cursor-pointer px-4 text-xs font-semibold"
                aria-label="Start"
              >
                Start
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
