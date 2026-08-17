import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenText,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleDotDashed,
  ClipboardCheck,
  FileCode2,
  FileText,
  Folder,
  GitPullRequest,
  Layers3,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Play,
  MessagesSquare,
  MessageSquarePlus,
  RefreshCw,
  Scale,
  Workflow,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DashboardChange,
  DashboardTask,
  AiSession,
  SpecificationManifestSection,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
  SpecificationTaskDocument,
} from '@/lib/types';
import { cn, formatDate, formatStatus, pluralizeTasks } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MarkdownContent } from '@/components/markdown-content';
import { FinalizeDialog, RepositoryActionsCard, TaskActionFooter } from '@/components/spec-actions';
import { OperationModal } from '@/components/operation-progress';
import { StageProgress } from '@/components/stage-progress';
import { StatusBoard } from '@/components/status-board';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSpecificationActions,
  useSpecificationDocument,
  useSpecificationManifest,
  useAiSessions,
  invalidateDashboardQueries,
} from '@/hooks/use-dashboard-data';
import { AiSessionList } from '@/components/ai-session-list';
import { DocumentSectionPanel } from '@/components/document-section-panel';
import { DirectorySectionPanel } from '@/components/directory-section-panel';

const ChangesPanel = lazy(() => import('@/components/changes-panel').then(module => ({ default: module.ChangesPanel })));

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  BookOpenText,
  Boxes,
  GitPullRequest,
  Workflow,
  Scale,
  ClipboardCheck,
  FileCode2,
  FileText,
  Folder,
};

function resolveTabIcon(iconName?: string, type?: string): ComponentType<{ className?: string }> {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName];
  return type === 'directory' ? Boxes : BookOpenText;
}

export interface SpecTabItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  section?: SpecificationManifestSection;
}

function MetricCard({ icon, label, value, helper }: { icon: React.ReactNode; label: string; value: string; helper: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--foreground)]">{value}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{helper}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent)]">
          {icon}
        </div>
      </div>
    </Card>
  );
}

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
        Wczytywanie treści z plików specyfikacji…
      </div>
      <div className="mt-7 space-y-3 animate-pulse">
        <div className="h-7 w-2/5 rounded bg-white/8" />
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-5/6 rounded bg-white/5" />
        <div className="h-24 rounded-xl bg-white/4" />
      </div>
    </Card>
  );
}

function ContentError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-red-400/20 p-8">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" />
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Nie udało się wczytać treści</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{message}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
            <RefreshCw className="mr-2 size-3.5" /> Spróbuj ponownie
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmptyDocument({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <FileCode2 className="size-6 text-[var(--muted)]" />
      <h2 className="mt-4 text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </Card>
  );
}

function TaskDialog({
  task,
  document: taskDocument,
  loading,
  error,
  actionGate,
  actionLoading,
  actionExecuting,
  actionError,
  onRetry,
  onAction,
  sessions,
  sessionsLoading,
  sessionsError,
  onSessionsRetry,
  onOpenSession,
  onClose,
}: {
  task: DashboardTask;
  document: SpecificationTaskDocument | null;
  loading: boolean;
  error: string | null;
  actionGate: SpecificationTaskActionGate | null;
  actionLoading: boolean;
  actionExecuting: boolean;
  actionError: string | null;
  onRetry: () => void;
  onAction: () => void;
  sessions: AiSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  onSessionsRetry: () => void;
  onOpenSession: (session: AiSession) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
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
            <h2 id="task-dialog-title" className="mt-3 text-lg font-semibold text-[var(--foreground)] sm:text-xl">{task.title}</h2>
            {task.file && <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{task.file}</p>}
          </div>
          <Button ref={closeButtonRef} variant="ghost" size="icon" onClick={onClose} aria-label="Zamknij szczegóły zadania">
            <X className="size-4" />
          </Button>
        </div>

        <div className="overflow-y-auto px-5 py-6 sm:px-7 sm:py-8">
          <div className="mb-6 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1">Status: {formatStatus(task.status)}</span>
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1">
              Zależności: {task.dependsOn.length ? task.dependsOn.join(', ') : 'brak'}
            </span>
            {task.blockedBy.length > 0 && (
              <span className="rounded-md border border-amber-300/20 bg-amber-300/8 px-2.5 py-1 text-amber-200">
                Blokowane przez: {task.blockedBy.join(', ')}
              </span>
            )}
          </div>

          <section className="mb-7" aria-label="Sesje powiązane z zadaniem">
            <div className="mb-3 flex items-center gap-2"><MessagesSquare className="size-4 text-[var(--accent)]" /><h3 className="text-sm font-semibold text-[var(--foreground)]">Powiązane sesje</h3></div>
            <AiSessionList sessions={sessions} tasks={[task]} loading={sessionsLoading} error={sessionsError} onRetry={onSessionsRetry} onOpen={onOpenSession} emptyLabel="To zadanie nie ma jeszcze powiązanych sesji." />
          </section>

          {loading ? (
            <div className="flex items-center gap-3 py-12 text-sm text-[var(--muted)]" role="status">
              <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" /> Wczytywanie opisu zadania…
            </div>
          ) : error ? (
            <ContentError message={error} onRetry={onRetry} />
          ) : taskDocument?.available ? (
            <MarkdownContent markdown={taskDocument.markdown} />
          ) : (
            <EmptyDocument title="Brak treści zadania" detail="Plik zadania nie jest obecnie dostępny w specyfikacji." />
          )}
        </div>
        <TaskActionFooter
          gate={actionGate}
          loading={actionLoading}
          executing={actionExecuting}
          error={actionError}
          onExecute={onAction}
        />
      </div>
    </div>
  );
}

function OverviewPanel({
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
}) {
  return (
    <>
      <section className="mb-9" aria-label="Ostatnie sesje specyfikacji">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Sesje AI</p><h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">Ostatnie rozmowy</h2></div>{change.source === 'active' && change.specId && <Button size="sm" onClick={onCreateSession}><MessageSquarePlus className="mr-1.5 size-3.5" />Nowa sesja</Button>}</div>
        <AiSessionList sessions={sessions} tasks={change.tasks} loading={sessionsLoading} error={sessionsError} onRetry={onSessionsRetry} onOpen={onOpenSession} limit={8} emptyLabel="Brak sesji dla tej specyfikacji." />
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
        />
        <MetricCard
          icon={<CircleDotDashed className="size-4" />}
          label="Review"
          value={String(change.metrics.inReview)}
          helper="zadań oczekuje na weryfikację"
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4" />}
          label="Gotowe"
          value={String(change.metrics.completed)}
          helper="zadań zweryfikowanych"
        />
      </section>

      {change.nextTask && (
        <Card className="mt-3 overflow-hidden">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[#121705]">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                {change.nextTask.status === 'in-implementation' ? 'Aktualnie realizowane' : 'Następne gotowe zadanie'}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{change.nextTask.title}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Layers3 className="size-3.5" />
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

export function SpecDetail({ change, initialTaskId, onOpenSession, onCreateSession }: { change: DashboardChange; initialTaskId: string | null; onOpenSession: (session: AiSession, taskId?: string) => void; onCreateSession: () => void }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => initialTaskId && change.tasks.some(task => task.id === initialTaskId) ? initialTaskId : null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(() => {
    try {
      return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op:${change.slug}`) : null;
    } catch {
      return null;
    }
  });
  const [operationTitle, setOperationTitle] = useState<string>(() => {
    try {
      return (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op-title:${change.slug}`) : '') || 'Przebieg operacji';
    } catch {
      return 'Przebieg operacji';
    }
  });
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const taskTriggerRef = useRef<HTMLElement | null>(null);
  const manifestQuery = useSpecificationManifest(change, true);
  const taskDocId = selectedTaskId ? `task:${selectedTaskId}` : null;
  const taskDocumentQuery = useSpecificationDocument(change, taskDocId, Boolean(selectedTaskId));
  const actionsQuery = useSpecificationActions(change, change.source === 'active');
  const sessionsQuery = useAiSessions({ specId: change.specId || undefined, enabled: change.source === 'active' && Boolean(change.specId) });
  const selectedTask = selectedTaskId ? change.tasks.find(task => task.id === selectedTaskId) ?? null : null;
  const selectedTaskDocument = (selectedTaskId ? taskDocumentQuery.data as SpecificationTaskDocument | null : null);
  const selectedTaskAction = selectedTaskId ? actionsQuery.data?.tasks[selectedTaskId] ?? null : null;
  const selectedTaskHasOwnerAction = selectedTask?.status === 'draft' || selectedTask?.status === 'implemented';

  const visibleTabs = useMemo<SpecTabItem[]>(() => {
    const tabs: SpecTabItem[] = [
      { id: 'overview', label: 'Przegląd', icon: LayoutDashboard },
    ];

    if (manifestQuery.data?.sections && manifestQuery.data.sections.length > 0) {
      for (const section of manifestQuery.data.sections) {
        if (section.available) {
          tabs.push({
            id: section.id,
            label: section.label,
            icon: resolveTabIcon(section.icon, section.type),
            section,
          });
        }
      }
    } else if (manifestQuery.data) {
      if (manifestQuery.data.overview?.available) {
        tabs.push({ id: 'specification', label: 'Specyfikacja', icon: BookOpenText });
      }
      if (manifestQuery.data.areas && manifestQuery.data.areas.length > 0) {
        tabs.push({ id: 'areas', label: 'Obszary', icon: Boxes });
      }
    }

    tabs.push({ id: 'changes', label: 'Zmiany', icon: GitPullRequest });
    return tabs;
  }, [manifestQuery.data]);

  const updateActiveOperation = useCallback((opId: string | null, title?: string) => {
    setActiveOperationId(opId);
    if (title) setOperationTitle(title);
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (opId) {
          sessionStorage.setItem(`nevo:active-op:${change.slug}`, opId);
          if (title) sessionStorage.setItem(`nevo:active-op-title:${change.slug}`, title);
        } else {
          sessionStorage.removeItem(`nevo:active-op:${change.slug}`);
          sessionStorage.removeItem(`nevo:active-op-title:${change.slug}`);
        }
      }
    } catch {}
  }, [change.slug]);

  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['overview']));

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    setActiveTab('overview');
    setVisitedTabs(new Set(['overview']));
    setSelectedTaskId(initialTaskId && change.tasks.some(task => task.id === initialTaskId) ? initialTaskId : null);
    setFinalizeOpen(false);
    try {
      const savedOp = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op:${change.slug}`) : null;
      const savedTitle = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op-title:${change.slug}`) : '';
      setActiveOperationId(savedOp);
      setOperationTitle(savedTitle || 'Przebieg operacji');
    } catch {
      setActiveOperationId(null);
    }
  }, [change.slug, initialTaskId]);

  const openTask = useCallback((task: DashboardTask, trigger: HTMLElement) => {
    taskTriggerRef.current = trigger;
    actionsQuery.resetExecution();
    setSelectedTaskId(task.id);
  }, [actionsQuery]);

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    requestAnimationFrame(() => taskTriggerRef.current?.focus());
  }, []);

  const handleOperationTerminal = useCallback(async () => {
    await invalidateDashboardQueries(queryClient);
  }, [queryClient]);

  const executeTaskAction = useCallback(async () => {
    if (!selectedTaskAction || !selectedTask) return;
    try {
      const taskId = selectedTask.id;
      const actionName = selectedTaskAction.action;
      const res = await actionsQuery.execute({ action: actionName, taskId });
      closeTask();
      if (res?.operationId) {
        updateActiveOperation(
          res.operationId,
          actionName === 'approve' ? `Zatwierdzanie zadania: ${taskId}` : `Weryfikacja zadania: ${taskId}`
        );
      }
    } catch {
      // The mutation exposes its sanitized error in the dialog footer.
    }
  }, [actionsQuery, closeTask, selectedTask, selectedTaskAction, updateActiveOperation]);

  const executeDirectTaskAction = useCallback(async (task: DashboardTask, actionName: SpecificationOwnerAction) => {
    try {
      const taskId = task.id;
      const res = await actionsQuery.execute({ action: actionName, taskId });
      if (res?.operationId) {
        updateActiveOperation(
          res.operationId,
          actionName === 'approve' ? `Zatwierdzanie zadania: ${taskId}` : `Weryfikacja zadania: ${taskId}`
        );
      }
    } catch {
      // Handled in mutation state
    }
  }, [actionsQuery, updateActiveOperation]);

  const executeBatchTaskAction = useCallback(async (tasks: DashboardTask[], actionName: SpecificationOwnerAction) => {
    for (const task of tasks) {
      try {
        const taskId = task.id;
        const res = await actionsQuery.execute({ action: actionName, taskId });
        if (res?.operationId) {
          updateActiveOperation(
            res.operationId,
            actionName === 'approve' ? `Zatwierdzanie zadania: ${taskId}` : `Weryfikacja zadania: ${taskId}`
          );
        }
      } catch {
        break;
      }
    }
  }, [actionsQuery, updateActiveOperation]);

  const executeFinalize = useCallback(async () => {
    try {
      const res = await actionsQuery.execute({ action: 'finalize', confirmed: true });
      setFinalizeOpen(false);
      if (res?.operationId) {
        updateActiveOperation(res.operationId, 'Finalizacja specyfikacji');
      }
    } catch {
      // The mutation exposes its sanitized error in the confirmation dialog.
    }
  }, [actionsQuery, updateActiveOperation]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % visibleTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    setActiveTab(nextTab.id);
    requestAnimationFrame(() => document.getElementById(`spec-tab-${nextTab.id}`)?.focus());
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-16 pt-7 sm:px-7 lg:px-9">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
        <span>NEvo</span><span>/</span>
        <span>{change.source === 'active' ? 'Aktualne' : 'Archiwum'}</span><span>/</span>
        <span className="max-w-[240px] truncate text-[var(--foreground)]">{change.slug}</span>
      </div>

      <header className="mt-7 grid gap-7 xl:grid-cols-[1fr_340px] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]">
              <span className="mr-1.5 size-1.5 rounded-full bg-current" />{formatStatus(change.status)}
            </Badge>
            {change.priority !== null && <Badge>Priorytet {change.priority}</Badge>}
            <Badge>{change.source === 'active' ? 'Aktualna' : 'Archiwalna'}</Badge>
          </div>
          <h1 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-[var(--foreground)] sm:text-5xl">{change.title}</h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--muted-strong)] sm:text-[15px]">{change.summary}</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" /> {formatDate(change.updatedAt)}</span>
            {change.path && <span className="inline-flex items-center gap-1.5"><FileCode2 className="size-3.5" /> {change.path}</span>}
          </div>
        </div>

        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Postęp ukończenia</p>
                <p className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">{change.metrics.progress}%</p>
              </div>
              <div className="text-right text-[11px] text-[var(--muted)]"><p>{change.metrics.completed}/{change.metrics.actionable}</p><p>w „Gotowe”</p></div>
            </div>
            <StageProgress change={change} className="mt-5" legend />
          </Card>
        </div>
      </header>

      <nav className="mt-9 overflow-x-auto border-b border-[var(--border)]" aria-label="Widoki specyfikacji">
        <div className="flex min-w-max gap-1" role="tablist">
          {visibleTabs.map((tab, index) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`spec-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`spec-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  'relative inline-flex h-11 items-center gap-2 px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] sm:px-4',
                  selected ? 'text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]',
                )}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={event => handleTabKeyDown(event, index)}
              >
                <Icon className="size-3.5" />{tab.label}
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-7">
        <div
          id="spec-panel-overview"
          role="tabpanel"
          aria-labelledby="spec-tab-overview"
          className={cn(activeTab !== 'overview' && 'hidden')}
        >
          <OverviewPanel
            change={change}
            onTaskSelect={openTask}
            sessions={sessionsQuery.sessions}
            sessionsLoading={sessionsQuery.loading}
            sessionsError={sessionsQuery.error}
            onSessionsRetry={() => void sessionsQuery.refresh()}
            onOpenSession={onOpenSession}
            onCreateSession={onCreateSession}
            taskActions={actionsQuery.data?.tasks}
            onDirectTaskAction={executeDirectTaskAction}
            onBatchTaskAction={executeBatchTaskAction}
            actions={
              change.source === 'active' ? (
                <div className="mb-9 max-w-xl">
                  <RepositoryActionsCard
                    data={actionsQuery.data}
                    loading={actionsQuery.loading}
                    refreshing={actionsQuery.refreshing}
                    error={actionsQuery.error}
                    executing={actionsQuery.executing}
                    onRefresh={() => void actionsQuery.refresh()}
                    onFinalize={() => {
                      actionsQuery.resetExecution();
                      setFinalizeOpen(true);
                    }}
                  />
                </div>
              ) : null
            }
          />
        </div>

        {visibleTabs.filter(t => t.id !== 'overview' && t.id !== 'changes').map(tab => {
          if (!visitedTabs.has(tab.id)) return null;
          const section = tab.section;
          return (
            <div
              key={tab.id}
              id={`spec-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`spec-tab-${tab.id}`}
              className={cn(activeTab !== tab.id && 'hidden')}
            >
              {section ? (
                section.type === 'directory' ? (
                  <DirectorySectionPanel
                    change={change}
                    section={section}
                    enabled={visitedTabs.has(tab.id)}
                  />
                ) : (
                  <DocumentSectionPanel
                    change={change}
                    docId={section.document?.docId || (section.id === 'specification' ? 'overview' : section.id)}
                    fallbackPath={section.document?.path}
                    fallbackTitle={section.label}
                    enabled={visitedTabs.has(tab.id)}
                  />
                )
              ) : tab.id === 'specification' ? (
                <DocumentSectionPanel
                  change={change}
                  docId="overview"
                  fallbackPath={manifestQuery.data?.overview?.path || 'overview.md'}
                  fallbackTitle="Specyfikacja"
                  enabled={visitedTabs.has(tab.id)}
                />
              ) : tab.id === 'areas' ? (
                <DirectorySectionPanel
                  change={change}
                  section={{
                    id: 'areas',
                    type: 'directory',
                    label: 'Obszary',
                    singularLabel: 'Obszar',
                    available: (manifestQuery.data?.areas?.length ?? 0) > 0,
                    documents: manifestQuery.data?.areas || [],
                  }}
                  enabled={visitedTabs.has(tab.id)}
                />
              ) : null}
            </div>
          );
        })}

        {visitedTabs.has('changes') && (
          <div
            id="spec-panel-changes"
            role="tabpanel"
            aria-labelledby="spec-tab-changes"
            className={cn(activeTab !== 'changes' && 'hidden')}
          >
            <Suspense fallback={<ContentLoading />}>
              <ChangesPanel change={change} />
            </Suspense>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDialog
          task={selectedTask}
          document={selectedTaskDocument}
          loading={taskDocumentQuery.loading}
          error={taskDocumentQuery.error}
          actionGate={selectedTaskAction}
          actionLoading={Boolean(selectedTaskHasOwnerAction && actionsQuery.loading)}
          actionExecuting={actionsQuery.executing}
          actionError={actionsQuery.executionError}
          onRetry={() => void taskDocumentQuery.refresh()}
          onAction={() => void executeTaskAction()}
          sessions={sessionsQuery.sessions.filter(session => session.taskIds.includes(selectedTask.id))}
          sessionsLoading={sessionsQuery.loading}
          sessionsError={sessionsQuery.error}
          onSessionsRetry={() => void sessionsQuery.refresh()}
          onOpenSession={session => onOpenSession(session, selectedTask.id)}
          onClose={closeTask}
        />
      )}

      <FinalizeDialog
        open={finalizeOpen}
        executing={actionsQuery.executing}
        error={actionsQuery.executionError}
        onClose={() => { if (!actionsQuery.executing) setFinalizeOpen(false); }}
        onConfirm={() => void executeFinalize()}
      />

      <OperationModal
        operationId={activeOperationId}
        open={Boolean(activeOperationId)}
        title={operationTitle}
        onClose={() => updateActiveOperation(null)}
        onTerminal={handleOperationTerminal}
      />
    </div>
  );
}
