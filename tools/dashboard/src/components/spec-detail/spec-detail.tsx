import {
  BookOpenText,
  CalendarClock,
  FileCode2,
  GitPullRequest,
  LayoutDashboard,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AiSession,
  DashboardChange,
  DashboardTask,
  OperationSnapshot,
  SpecificationOwnerAction,
  TaskNavigationTarget,
} from '@/lib/types';
import { cn, formatDate, formatStatus } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FinalizeDialog, RepositoryActionsCard, TaskActionFooter } from '@/components/spec-actions';
import { TaskDialog } from '@/components/task-dialog';
import { OperationModal } from '@/components/operation-progress';
import { StageProgress } from '@/components/stage-progress';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/hooks/use-dashboard-data';
import { useAiSessions } from '@/components/ai-chat/ai-chat-queries';
import { Link } from '@tanstack/react-router';

import { useSpecificationActions, useSpecificationManifest } from './spec-detail-queries';
import { computeVisibleTabs, type SpecTabId } from './documentation-projection';
import { OverviewPanel } from './overview-panel';
import { DocumentationPanel } from './documentation-panel';

const ChangesPanel = lazy(() => import('@/components/changes-panel').then(module => ({ default: module.ChangesPanel })));

const TAB_ICON: Record<SpecTabId, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  docs: BookOpenText,
  changes: GitPullRequest,
};

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        Wczytywanie…
      </div>
    </Card>
  );
}

export function SpecDetail({
  change,
  onOpenSession,
  onCreateSession,
  onNavigateMode,
}: {
  change: DashboardChange;
  onOpenSession: (session: AiSession) => void;
  onCreateSession: () => void;
  onNavigateMode?: (mode: 'active' | 'archive') => void;
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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
  const actionsQuery = useSpecificationActions(change, change.source === 'active');
  const sessionsQuery = useAiSessions({ specId: change.specId || undefined, enabled: Boolean(change.specId) });
  const selectedTask = selectedTaskId ? change.tasks.find(task => task.id === selectedTaskId) ?? null : null;

  const visibleTabs = useMemo(() => computeVisibleTabs(manifestQuery.data), [manifestQuery.data]);

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
    setFinalizeOpen(false);
    try {
      const savedOp = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op:${change.slug}`) : null;
      const savedTitle = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`nevo:active-op-title:${change.slug}`) : '';
      setActiveOperationId(savedOp);
      setOperationTitle(savedTitle || 'Przebieg operacji');
    } catch {
      setActiveOperationId(null);
    }
  }, [change.slug]);

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
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const taskId = task.id;
        const res = await actionsQuery.execute({ action: actionName, taskId });
        if (res?.operationId) {
          updateActiveOperation(
            res.operationId,
            actionName === 'approve'
              ? `Zatwierdzanie zadania (${i + 1}/${tasks.length}): ${taskId}`
              : `Weryfikacja zadania (${i + 1}/${tasks.length}): ${taskId}`
          );

          // Wait for the spawned operation to reach a terminal state before running next task
          const startTime = Date.now();
          let isTerminal = false;
          while (!isTerminal && Date.now() - startTime < 60000) {
            await new Promise(r => setTimeout(r, 350));
            try {
              const checkRes = await fetch(`/api/operations/${encodeURIComponent(res.operationId)}`, { cache: 'no-store' });
              if (checkRes.ok) {
                const snap = (await checkRes.json()) as OperationSnapshot;
                if (snap.status === 'completed') {
                  isTerminal = true;
                  // Allow Git and filesystem locks to settle before next task
                  await new Promise(r => setTimeout(r, 600));
                } else if (snap.status === 'failed') {
                  return; // Stop batch execution if a task fails
                }
              }
            } catch {
              // retry polling
            }
          }
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
      <nav aria-label="Okruszki nawigacji" className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
        <Link
          to="/"
          className="hover:text-[var(--foreground)] transition-colors"
        >
          NEvo
        </Link>
        <span>/</span>
        <Link
          to={change.source === 'archive' ? '/archive' : '/'}
          className="hover:text-[var(--foreground)] transition-colors"
        >
          {change.source === 'active' ? 'Aktualne' : 'Archiwum'}
        </Link>
        <span>/</span>
        <span className="max-w-[240px] truncate text-[var(--foreground)] font-medium">{change.slug}</span>
      </nav>

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
            const Icon = TAB_ICON[tab.id];
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
            onOpenTask={(target) => {
              const nextTaskId = typeof target === 'string' ? target : target.taskId;
              setSelectedTaskId(nextTaskId);
            }}
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

        {visitedTabs.has('docs') && (
          <div
            id="spec-panel-docs"
            role="tabpanel"
            aria-labelledby="spec-tab-docs"
            className={cn(activeTab !== 'docs' && 'hidden')}
          >
            <DocumentationPanel
              change={change}
              manifest={manifestQuery.data}
              enabled={visitedTabs.has('docs')}
            />
          </div>
        )}

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
          change={change}
          taskId={selectedTask.id}
          onOpenSession={onOpenSession}
          onOpenTask={(target) => {
            const nextTaskId = typeof target === 'string' ? target : target.taskId;
            setSelectedTaskId(nextTaskId);
          }}
          onOperationStarted={updateActiveOperation}
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
