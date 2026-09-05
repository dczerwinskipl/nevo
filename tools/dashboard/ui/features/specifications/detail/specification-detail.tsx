import { BookOpenText, CalendarClock, FileCode2, GitPullRequest, LayoutDashboard } from 'lucide-react';
import type { ComponentType } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SpecificationSummary, SpecificationTask, SpecificationSource } from '../types';
import type { AgentSession } from '@/features/agent-sessions/types';
import { cn, formatDate, formatStatus } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FinalizeDialog, RepositoryActionsCard } from '../actions/spec-actions';
import { TaskDialog } from '../tasks/task-dialog';
import { StageProgress } from '../stage-progress';
import { OperationModal } from '@/features/operations/operation-modal';
import { StatusLabel } from '@/shared/ui/status-label';
import { statusTextTone } from '@/shared/status-tone';
import { useAgentSessions } from '@/features/agent-sessions/queries';
import { formatSpecificationStatus, specStatusTone } from '../status';
import { Link } from '@tanstack/react-router';

import { useSpecificationActions, useSpecificationManifest } from './spec-detail-queries';
import { computeVisibleTabs, type SpecTabId } from './documentation-projection';
import { useSpecWorkflowActions } from '../actions/use-spec-workflow-actions';
import { OverviewPanel } from './overview-panel';
import { DocumentationPanel } from './documentation-panel';

const PullRequestsPanel = lazy(() =>
  import('@/features/pull-requests/panel/pull-requests-panel').then((module) => ({
    default: module.PullRequestsPanel,
  })),
);

const TAB_ICON: Record<SpecTabId, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  docs: BookOpenText,
  changes: GitPullRequest,
};

function ContentLoading() {
  return (
    <Card className="p-8" role="status">
      <div className="flex items-center gap-3 text-sm text-fg-muted">Wczytywanie…</div>
    </Card>
  );
}

export function SpecificationDetail({
  specification,
  onOpenSession,
  onCreateSession,
  onNavigateMode,
}: {
  specification: SpecificationSummary;
  onOpenSession: (session: AgentSession) => void;
  onCreateSession: () => void;
  onNavigateMode?: (mode: SpecificationSource) => void;
}) {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskTriggerRef = useRef<HTMLElement | null>(null);
  const manifestQuery = useSpecificationManifest(specification, true);
  const actionsQuery = useSpecificationActions(specification, specification.source === 'active');
  const sessionsQuery = useAgentSessions({
    specId: specification.specId || undefined,
    enabled: Boolean(specification.specId),
  });
  const workflow = useSpecWorkflowActions(specification, actionsQuery);
  const selectedTask = selectedTaskId ? (specification.tasks.find((task) => task.id === selectedTaskId) ?? null) : null;

  const visibleTabs = useMemo(() => computeVisibleTabs(manifestQuery.data), [manifestQuery.data]);

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
  }, [specification.slug]);

  const openTask = useCallback(
    (task: SpecificationTask, trigger: HTMLElement) => {
      taskTriggerRef.current = trigger;
      actionsQuery.resetExecution();
      setSelectedTaskId(task.id);
    },
    [actionsQuery],
  );

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    requestAnimationFrame(() => taskTriggerRef.current?.focus());
  }, []);

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
    <div className="mx-auto w-full max-w-[1500px] px-4 pt-7 pb-16 sm:px-7 lg:px-9">
      <nav aria-label="Okruszki nawigacji" className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
        <Link to="/" className="transition-colors hover:text-fg-primary">
          NEvo
        </Link>
        <span>/</span>
        <Link
          to={specification.source === 'archive' ? '/archive' : '/'}
          className="transition-colors hover:text-fg-primary"
        >
          {specification.source === 'active' ? 'Aktualne' : 'Archiwum'}
        </Link>
        <span>/</span>
        <span className="max-w-[240px] truncate font-medium text-fg-primary">{specification.slug}</span>
      </nav>

      <header className="mt-7 grid gap-7 xl:grid-cols-[1fr_340px] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                'bg-surface-raised',
                (specification.status === 'verified' || specification.status === 'archived') &&
                  'border-status-success/25 bg-status-success/10',
                specification.status === 'implemented' && 'border-status-warning/25 bg-status-warning/10',
                specification.status === 'in-implementation' && 'border-status-active/35 bg-status-active/10',
                statusTextTone({ tone: specStatusTone(specification.status) }),
              )}
            >
              <span className="mr-1.5 size-1.5 rounded-full bg-current" />
              <StatusLabel tone={specStatusTone(specification.status)}>
                {formatSpecificationStatus(specification.status)}
              </StatusLabel>
            </Badge>
            {specification.priority !== null && <Badge>Priorytet {specification.priority}</Badge>}
            <Badge>{specification.source === 'active' ? 'Aktualna' : 'Archiwalna'}</Badge>
          </div>
          <h1 className="mt-5 max-w-4xl text-3xl leading-tight font-semibold tracking-[-0.035em] text-fg-primary sm:text-5xl">
            {specification.title}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-fg-secondary sm:text-[15px]">{specification.summary}</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-accent" /> {formatDate(specification.updatedAt)}
            </span>
            {specification.path && (
              <span className="inline-flex items-center gap-1.5">
                <FileCode2 className="size-3.5 text-accent" /> {specification.path}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-fg-muted uppercase">Postęp ukończenia</p>
                <p className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-fg-primary">
                  {specification.metrics.progress}%
                </p>
              </div>
              <div className="text-right text-[11px] text-fg-muted">
                <p>
                  {specification.metrics.completed}/{specification.metrics.actionable}
                </p>
                <p>w „Gotowe”</p>
              </div>
            </div>
            <StageProgress specification={specification} className="mt-5" legend />
          </Card>
        </div>
      </header>

      <nav className="mt-9 overflow-x-auto border-b border-border" aria-label="Widoki specyfikacji">
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
                  'relative inline-flex h-11 items-center gap-2 px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset sm:px-4',
                  selected ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary',
                )}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <Icon className="size-3.5 text-accent" />
                {tab.label}
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
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
            specification={specification}
            onTaskSelect={openTask}
            sessions={sessionsQuery.sessions}
            sessionsLoading={sessionsQuery.loading}
            sessionsError={sessionsQuery.error}
            onSessionsRetry={() => void sessionsQuery.refresh()}
            onOpenSession={onOpenSession}
            onCreateSession={onCreateSession}
            taskActions={actionsQuery.data?.tasks}
            onDirectTaskAction={workflow.executeDirectTaskAction}
            onBatchTaskAction={workflow.executeBatchTaskAction}
            onOpenTask={(target) => {
              const nextTaskId = typeof target === 'string' ? target : target.taskId;
              setSelectedTaskId(nextTaskId);
            }}
            actions={
              specification.source === 'active' ? (
                <div className="mb-9 max-w-xl">
                  <RepositoryActionsCard
                    data={actionsQuery.data}
                    loading={actionsQuery.loading}
                    refreshing={actionsQuery.refreshing}
                    error={actionsQuery.error}
                    executing={actionsQuery.executing}
                    onRefresh={() => void actionsQuery.refresh()}
                    onFinalize={workflow.openFinalize}
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
              specification={specification}
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
              <PullRequestsPanel specification={specification} />
            </Suspense>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDialog
          specification={specification}
          taskId={selectedTask.id}
          onOpenSession={onOpenSession}
          onOpenTask={(target) => {
            const nextTaskId = typeof target === 'string' ? target : target.taskId;
            setSelectedTaskId(nextTaskId);
          }}
          onOperationStarted={workflow.updateActiveOperation}
          onClose={closeTask}
        />
      )}

      <FinalizeDialog
        open={workflow.finalizeOpen}
        executing={actionsQuery.executing}
        error={actionsQuery.executionError}
        onClose={workflow.closeFinalize}
        onConfirm={() => void workflow.executeFinalize()}
      />

      <OperationModal
        operationId={workflow.activeOperationId}
        open={Boolean(workflow.activeOperationId)}
        title={workflow.operationTitle}
        onClose={() => workflow.updateActiveOperation(null)}
        onTerminal={workflow.handleOperationTerminal}
      />
    </div>
  );
}
