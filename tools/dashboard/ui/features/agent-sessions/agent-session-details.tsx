import { Trash2, LoaderCircle, FileText, CheckSquare, Cpu, Layers } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import type { AgentExecutionMode, TaskNavigationTarget } from './types';
import type { SessionTaskItem } from './session-tasks';

export interface AgentSessionDetailsProps {
  specTitle?: string;
  specId?: string | null;
  specSlug?: string | null;
  tasks?: (string | SessionTaskItem)[];
  provider: string;
  mode?: AgentExecutionMode;
  onDelete: () => void;
  onOpenTask?: (target: TaskNavigationTarget) => void;
  deleting?: boolean;
  disabled?: boolean;
}

export function AgentSessionDetails({
  specTitle,
  specId,
  specSlug,
  tasks = [],
  provider,
  mode = 'edit',
  onDelete,
  onOpenTask,
  deleting = false,
  disabled = false,
}: AgentSessionDetailsProps) {
  const normalizedTasks: SessionTaskItem[] = tasks.map((t) => {
    if (typeof t === 'string') {
      return { id: t, title: t, isClickable: Boolean(onOpenTask) };
    }
    return t;
  });

  return (
    <div className="flex flex-col space-y-6">
      {/* Context section */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold tracking-wider text-fg-muted uppercase">Kontekst sesji</h3>

        {/* Specification */}
        <div className="space-y-1.5 rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center gap-2 text-xs font-medium text-fg-secondary">
            <FileText className="size-3.5 text-accent" />
            <span>Specyfikacja</span>
          </div>
          <p className="text-sm font-semibold break-words text-fg-primary">
            {specTitle || specId || 'Brak powiązanej specyfikacji'}
          </p>
          {specId && specTitle && <p className="font-mono text-[11px] break-all text-fg-muted">{specId}</p>}
        </div>

        {/* Associated Tasks */}
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-secondary">
              <CheckSquare className="size-3.5 text-accent" />
              <span>Powiązane zadania</span>
            </div>
            <span className="text-[11px] font-medium text-fg-muted">
              {normalizedTasks.length > 0
                ? `${normalizedTasks.length} ${normalizedTasks.length === 1 ? 'zadanie' : 'zadań'}`
                : 'Cała specyfikacja'}
            </span>
          </div>
          {normalizedTasks.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              {normalizedTasks.map((taskItem) => {
                const label = taskItem.title || taskItem.id;
                const canClick = Boolean(onOpenTask && taskItem.isClickable);
                return canClick ? (
                  <button
                    type="button"
                    key={taskItem.id}
                    onClick={() => onOpenTask?.({ taskId: taskItem.id, specSlug })}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-left text-xs font-medium text-fg-primary transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="truncate">{label}</span>
                  </button>
                ) : (
                  <div
                    key={taskItem.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-fg-secondary opacity-85"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-fg-muted" />
                    <span className="truncate">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="pt-1 text-xs text-fg-muted italic">
              Sesja obejmuje całą specyfikację (brak powiązania z pojedynczym zadaniem).
            </p>
          )}
        </div>

        {/* Provider and Mode */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
              <Cpu className="size-3.5 text-accent" />
              <span>Provider</span>
            </div>
            <p className="text-sm font-semibold text-fg-primary capitalize">{provider}</p>
          </div>
          <div className="space-y-1 rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
              <Layers className="size-3.5 text-accent" />
              <span>Tryb</span>
            </div>
            <p className="text-sm font-semibold text-fg-primary uppercase">{mode}</p>
          </div>
        </div>
      </div>

      {/* Actions section — visually separated as destructive */}
      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-bold tracking-wider text-action-destructive uppercase">Strefa niebezpieczna</h3>
        <div className="space-y-3 rounded-xl border border-action-destructive/30 bg-surface p-4">
          <div>
            <p className="text-xs font-semibold text-fg-primary">Usuń sesję</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              Usuwa historię sesji i powiązania z dysku lokalnego. Tej operacji nie można cofnąć.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={disabled || deleting}
            className="w-full justify-center text-xs font-semibold"
            data-testid="delete-session-btn"
          >
            {deleting ? <LoaderCircle className="mr-2 size-3.5 animate-spin" /> : <Trash2 className="mr-2 size-3.5" />}
            Usuń sesję z dysku
          </Button>
        </div>
      </div>
    </div>
  );
}
