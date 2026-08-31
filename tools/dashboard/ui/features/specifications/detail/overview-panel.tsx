import {
  ArrowUpRight,
  Layers3,
  MessageSquarePlus,
} from 'lucide-react';

import type {
  SpecificationSummary,
  SpecificationTask,
  SpecificationOwnerAction,
  SpecificationTaskActionGate,
} from '../types';
import type { AgentSession, TaskNavigationTarget } from '@/features/agent-sessions/types';
import { formatStatus } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AgentSessionList } from '@/features/agent-sessions/agent-session-list';
import { StatusBoard } from './status-board';

export function OverviewPanel({
  specification,
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
  onDirectTaskAction?: (task: SpecificationTask, action: SpecificationOwnerAction) => void;
  onBatchTaskAction?: (tasks: SpecificationTask[], action: SpecificationOwnerAction) => void;
  onCreateSession: () => void;
  onOpenTask?: (target: TaskNavigationTarget | string) => void;
}) {
  return (
    <>
      <section className="mb-9" aria-label="Ostatnie sesje specyfikacji">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Sesje AI</p><h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">Ostatnie rozmowy</h2></div>{specification.source === 'active' && specification.specId && <Button size="sm" onClick={onCreateSession}><MessageSquarePlus className="mr-1.5 size-3.5" />Nowa sesja</Button>}</div>
        <AgentSessionList sessions={sessions} tasks={specification.tasks} loading={sessionsLoading} error={sessionsError} onRetry={onSessionsRetry} onOpen={onOpenSession} onOpenTask={onOpenTask} limit={8} emptyLabel="Brak sesji dla tej specyfikacji." />
      </section>
      {actions}

      {specification.nextTask && (
        <Card className="mt-3 overflow-hidden">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                {specification.nextTask.status === 'in-implementation' ? 'Aktualnie realizowane' : 'Następne gotowe zadanie'}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{specification.nextTask.title}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Layers3 className="size-3.5 text-[var(--accent)]" />
              {formatStatus(specification.nextTask.status)}
            </div>
          </div>
        </Card>
      )}

      <div className="mt-11">
        <StatusBoard
          specification={specification}
          actions={taskActions}
          onTaskSelect={onTaskSelect}
          onTaskAction={onDirectTaskAction}
          onBatchAction={onBatchTaskAction}
        />
      </div>
    </>
  );
}
