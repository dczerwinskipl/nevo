import { cn } from '@/shared/lib/utils';
import {
  type BoundTaskInfo,
  formatBoundTaskLabel,
  formatLegacyTaskLabel,
} from './agent-session-workflow-bar-helpers';

export {
  type BoundTaskInfo,
  formatBoundTaskLabel,
  formatLegacyTaskLabel,
};

export interface AgentSessionWorkflowBarProps {
  tasks: BoundTaskInfo[];
  activeTaskId: string | null;
  onSelectTask?: (taskId: string) => void;
  className?: string;
  /**
   * Authoritative specification-level workflow mode (D15). `false` (legacy) renders a
   * plain task-context selector (identity/title only) — never a fabricated deterministic
   * status/attempt/step ("(unknown)").
   */
  isDeterministic?: boolean;
}

export function AgentSessionWorkflowBar({
  tasks,
  activeTaskId,
  onSelectTask,
  className,
  isDeterministic = false,
}: AgentSessionWorkflowBarProps) {
  if (!tasks || tasks.length === 0) return null;

  return (
    <div
      className={cn(
        'mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-raised/80 px-3 py-1.5 text-xs',
        className,
      )}
      role="toolbar"
      aria-label={isDeterministic ? 'Bound workflow tasks' : 'Session task context'}
    >
      <span className="text-[10px] font-bold tracking-wider text-fg-muted uppercase">
        {isDeterministic ? 'Zadania:' : 'Kontekst:'}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {tasks.map((task) => {
          const isActive = task.id === activeTaskId;
          const label = isDeterministic ? formatBoundTaskLabel(task) : formatLegacyTaskLabel(task);
          const isVerified = isDeterministic && task.status === 'verified';

          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelectTask?.(task.id)}
              aria-pressed={isActive}
              aria-label={`Przełącz kontekst na zadanie ${task.id}`}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                isActive
                  ? 'border-accent bg-accent/15 font-semibold text-fg-primary ring-1 ring-accent'
                  : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg-primary',
                isVerified && !isActive && 'text-status-success/90',
              )}
            >
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
