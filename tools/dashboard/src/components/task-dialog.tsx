import { useCallback, useEffect, useRef } from 'react';
import { MessagesSquare, LoaderCircle, X, AlertCircle } from 'lucide-react';
import type {
  DashboardChange,
  AiSession,
  SpecificationTaskDocument,
  TaskNavigationTarget,
} from '@/lib/types';
import { formatStatus } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/markdown-content';
import { TaskActionFooter } from '@/components/spec-actions';
import { AiSessionList } from '@/components/ai-session-list';
import { useAiSessions } from '@/hooks/use-dashboard-data';
// Imported directly from the feature module, not the `@/components/spec-detail`
// barrel — that barrel also exports SpecDetail, which imports TaskDialog itself,
// and going through it here would create a circular module import.
import { useSpecificationDocument, useSpecificationActions } from '@/components/spec-detail/spec-detail-queries';

export interface TaskDialogProps {
  change: DashboardChange;
  taskId: string;
  onClose: () => void;
  onOpenSession?: (session: AiSession, taskId?: string | null) => void;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
  onOperationStarted?: (operationId: string, label: string) => void;
}

export function TaskDialog({
  change,
  taskId,
  onClose,
  onOpenSession,
  onOpenTask,
  onOperationStarted,
}: TaskDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const task = change.tasks.find((t) => t.id === taskId);
  const taskDocId = taskId ? `task:${taskId}` : null;
  const taskDocumentQuery = useSpecificationDocument(change, taskDocId, Boolean(taskId));
  const taskDocument = taskId ? (taskDocumentQuery.data as SpecificationTaskDocument | null) : null;

  const sessionsQuery = useAiSessions({
    specId: change.specId || undefined,
    enabled: Boolean(change.specId),
  });
  const actionsQuery = useSpecificationActions(change, change.source === 'active');
  const actionGate = taskId && actionsQuery.data?.tasks ? actionsQuery.data.tasks[taskId] ?? null : null;

  const executeTaskAction = useCallback(async () => {
    if (!actionGate || !task) return;
    try {
      const actionName = actionGate.action;
      const res = await actionsQuery.execute({ action: actionName, taskId: task.id });
      onClose();
      if (res?.operationId && onOperationStarted) {
        onOperationStarted(
          res.operationId,
          actionName === 'approve' ? `Zatwierdzanie zadania: ${task.id}` : `Weryfikacja zadania: ${task.id}`
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
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
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

  const filteredSessions = sessionsQuery.sessions.filter(
    (session) => (session.taskIds && session.taskIds.includes(task.id)) || session.taskId === task.id
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{formatStatus(task.status)}</Badge>
              <span className="text-[10px] text-[var(--muted)]">#{String(task.order ?? '—').padStart(2, '0')}</span>
            </div>
            <h2 id="task-dialog-title" className="mt-3 text-lg font-semibold text-[var(--foreground)] sm:text-xl">
              {task.title}
            </h2>
            {task.file && <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{task.file}</p>}
          </div>
          <Button ref={closeButtonRef} variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij szczegóły zadania">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <div className="mb-7 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--muted-strong)]">
              Zależności: {task.dependsOn.length ? task.dependsOn.join(', ') : 'brak'}
            </span>
            {task.blockedBy.length > 0 && (
              <span className="rounded-md border border-amber-300/20 bg-amber-300/8 px-2.5 py-1 text-amber-200">
                Blokowane przez: {task.blockedBy.join(', ')}
              </span>
            )}
          </div>

          <section className="mb-7" aria-label="Sesje powiązane z zadaniem">
            <div className="mb-3 flex items-center gap-2">
              <MessagesSquare className="size-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Powiązane sesje</h3>
            </div>
            <AiSessionList
              sessions={filteredSessions}
              tasks={change.tasks}
              loading={sessionsQuery.loading}
              error={sessionsQuery.error}
              onRetry={() => void sessionsQuery.refresh()}
              onOpen={(session) => onOpenSession?.(session, task.id)}
              onOpenTask={onOpenTask}
              emptyLabel="To zadanie nie ma jeszcze powiązanych sesji."
            />
          </section>

          {taskDocumentQuery.loading ? (
            <div className="flex items-center gap-3 py-12 text-sm text-[var(--muted)]" role="status">
              <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" /> Wczytywanie opisu zadania…
            </div>
          ) : taskDocumentQuery.error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="size-4 text-red-400" />
                <span>Nie udało się wczytać treści zadania</span>
              </div>
              <p className="mt-1 text-[11px] text-red-200/80">{taskDocumentQuery.error}</p>
              <Button size="sm" variant="secondary" onClick={() => void taskDocumentQuery.refresh()} className="mt-3">
                Spróbuj ponownie
              </Button>
            </div>
          ) : taskDocument?.available ? (
            <MarkdownContent markdown={taskDocument.markdown} />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              <p className="font-semibold text-[var(--foreground)]">Brak treści zadania</p>
              <p className="mt-1">Plik zadania nie jest obecnie dostępny w specyfikacji.</p>
            </div>
          )}
        </div>

        <TaskActionFooter
          gate={actionGate}
          loading={actionsQuery.loading}
          executing={actionsQuery.executing}
          error={actionsQuery.executionError}
          onExecute={() => void executeTaskAction()}
        />
      </div>
    </div>
  );
}
