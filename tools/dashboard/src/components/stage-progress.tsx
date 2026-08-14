import type { DashboardChange, StageId } from '@/lib/types';
import { cn } from '@/lib/utils';

const visibleStages: Array<{ id: StageId; label: string; color: string }> = [
  { id: 'done', label: 'Gotowe', color: 'bg-[var(--accent)]' },
  { id: 'review', label: 'Review', color: 'bg-fuchsia-400/60' },
  { id: 'implementation', label: 'Implementacja', color: 'bg-amber-300/60' },
  { id: 'ready', label: 'Ready', color: 'bg-sky-400/60' },
  { id: 'design', label: 'Projekt', color: 'bg-violet-400/60' },
  { id: 'new', label: 'Nowe', color: 'bg-slate-400/25' },
];

export function StageProgress({
  change,
  className,
  legend = false,
}: {
  change: DashboardChange;
  className?: string;
  legend?: boolean;
}) {
  const total = change.metrics.actionable;
  const description = total
    ? visibleStages
      .filter(stage => change.metrics.stageCounts[stage.id] > 0)
      .map(stage => `${stage.label}: ${change.metrics.stageCounts[stage.id]}`)
      .join(', ')
    : 'Brak zadań';

  return (
    <div className={className}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-white/7"
        role="img"
        aria-label={`Rozkład etapów. ${description}.`}
      >
        {visibleStages.map(stage => {
          const count = change.metrics.stageCounts[stage.id];
          if (!count || !total) return null;
          return (
            <span
              key={stage.id}
              className={cn('h-full border-r border-black/25 last:border-r-0', stage.color)}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${stage.label}: ${count}/${total}`}
            />
          );
        })}
      </div>

      {legend && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {visibleStages.map(stage => (
            <div key={stage.id} className="flex min-w-0 items-center gap-2 text-[9px] text-[var(--muted)]">
              <span className={cn('size-1.5 shrink-0 rounded-full', stage.color)} />
              <span className="truncate uppercase tracking-[0.08em]">{stage.label}</span>
              <span className="ml-auto tabular-nums text-[var(--muted-strong)]">{change.metrics.stageCounts[stage.id]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
