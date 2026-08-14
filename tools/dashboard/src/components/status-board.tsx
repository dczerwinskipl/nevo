import { CheckCircle2, CircleDashed, GitBranch, LockKeyhole } from 'lucide-react';

import type { DashboardChange, DashboardLane, DashboardTask, StageId } from '@/lib/types';
import { cn, formatStatus } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const stageTone: Record<StageId, { dot: string; tint: string; line: string }> = {
  new: { dot: 'bg-slate-400', tint: 'bg-slate-400/7', line: 'border-slate-400/25' },
  design: { dot: 'bg-violet-400', tint: 'bg-violet-400/7', line: 'border-violet-400/25' },
  ready: { dot: 'bg-sky-400', tint: 'bg-sky-400/7', line: 'border-sky-400/25' },
  implementation: { dot: 'bg-amber-300', tint: 'bg-amber-300/7', line: 'border-amber-300/25' },
  review: { dot: 'bg-fuchsia-400', tint: 'bg-fuchsia-400/7', line: 'border-fuchsia-400/25' },
  done: { dot: 'bg-[var(--accent)]', tint: 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]', line: 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)]' },
};

function TaskCard({ task, lane }: { task: DashboardTask; lane: DashboardLane }) {
  const tone = stageTone[lane.id];
  const isDone = lane.id === 'done';
  return (
    <article className={cn('rounded-xl border bg-[var(--surface)] p-3.5 transition-colors hover:bg-[var(--surface-raised)]', tone.line)}>
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
    </article>
  );
}

export function StatusBoard({ change }: { change: DashboardChange }) {
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
                  {lane.tasks.map(task => <TaskCard key={task.id} task={task} lane={lane} />)}
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
