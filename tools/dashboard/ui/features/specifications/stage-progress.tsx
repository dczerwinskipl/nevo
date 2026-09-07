import type { SpecificationSummary, StageId } from './types';
import { cn } from '@/shared/lib/utils';

const visibleStages: Array<{ id: StageId; label: string; color: string }> = [
  { id: 'done', label: 'Gotowe', color: 'bg-status-success' },
  { id: 'review', label: 'Review', color: 'bg-status-warning/60' },
  { id: 'implementation', label: 'Implementacja', color: 'bg-status-active' },
  { id: 'ready', label: 'Ready', color: 'bg-status-neutral/25' },
  { id: 'design', label: 'Projekt', color: 'bg-status-neutral/25' },
  { id: 'new', label: 'Nowe', color: 'bg-status-neutral/25' },
];

export function StageProgress({
  specification,
  className,
  legend = false,
}: {
  specification: SpecificationSummary;
  className?: string;
  legend?: boolean;
}) {
  const total = specification.metrics.actionable;
  const description = total
    ? visibleStages
        .filter((stage) => specification.metrics.stageCounts[stage.id] > 0)
        .map((stage) => `${stage.label}: ${specification.metrics.stageCounts[stage.id]}`)
        .join(', ')
    : 'Brak zadań';

  return (
    <div className={className}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-fg-primary/7"
        role="img"
        aria-label={`Rozkład etapów. ${description}.`}
      >
        {visibleStages.map((stage) => {
          const count = specification.metrics.stageCounts[stage.id];
          if (!count || !total) return null;

          return (
            <span
              key={stage.id}
              className={cn('h-full border-r border-background/25 last:border-r-0', stage.color)}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${stage.label}: ${count}/${total}`}
            />
          );
        })}
      </div>

      {legend && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {visibleStages.map((stage) => (
            <div key={stage.id} className="flex min-w-0 items-center gap-2 text-[9px] text-fg-muted">
              <span className={cn('size-1.5 shrink-0 rounded-full', stage.color)} />
              <span className="truncate text-[10px] font-bold tracking-[0.1em] text-fg-secondary uppercase">
                {stage.label}
              </span>
              <span className="ml-auto text-fg-secondary tabular-nums">
                {specification.metrics.stageCounts[stage.id]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
