import { Trash2, LoaderCircle, FileText, CheckSquare, Cpu, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Kontekst sesji</h3>

        {/* Specification */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted-strong)]">
            <FileText className="size-3.5 text-[var(--accent)]" />
            <span>Specyfikacja</span>
          </div>
          <p className="text-sm font-semibold text-[var(--foreground)] break-words">
            {specTitle || specId || 'Brak powiązanej specyfikacji'}
          </p>
          {specId && specTitle && (
            <p className="text-[11px] font-mono text-[var(--muted)] break-all">{specId}</p>
          )}
        </div>

        {/* Associated Tasks */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted-strong)]">
              <CheckSquare className="size-3.5 text-[var(--accent)]" />
              <span>Powiązane zadania</span>
            </div>
            <span className="text-[11px] text-[var(--muted)] font-medium">
              {normalizedTasks.length > 0 ? `${normalizedTasks.length} ${normalizedTasks.length === 1 ? 'zadanie' : 'zadań'}` : 'Cała specyfikacja'}
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
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] text-left transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer"
                  >
                    <span className="size-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                ) : (
                  <div
                    key={taskItem.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-strong)] opacity-85"
                  >
                    <span className="size-1.5 rounded-full bg-[var(--muted)] shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] italic pt-1">Sesja obejmuje całą specyfikację (brak powiązania z pojedynczym zadaniem).</p>
          )}
        </div>

        {/* Provider and Mode */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-strong)]">
              <Cpu className="size-3.5 text-[var(--accent)]" />
              <span>Provider</span>
            </div>
            <p className="text-sm font-semibold capitalize text-[var(--foreground)]">{provider}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-strong)]">
              <Layers className="size-3.5 text-[var(--accent)]" />
              <span>Tryb</span>
            </div>
            <p className="text-sm font-semibold uppercase text-[var(--foreground)]">{mode}</p>
          </div>
        </div>
      </div>

      {/* Actions section — visually separated as destructive */}
      <div className="pt-4 border-t border-[var(--border)] space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--danger)]">Strefa niebezpieczna</h3>
        <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-muted)] p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">Usuń sesję</p>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              Usuwa historię sesji i powiązania z dysku lokalnego. Tej operacji nie można cofnąć.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={onDelete}
            disabled={disabled || deleting}
            className="w-full justify-center border border-[var(--danger-border)] bg-[var(--danger-muted)] text-xs font-semibold text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] hover:text-[var(--danger-strong)] focus-visible:ring-[var(--danger)]"
          >
            {deleting ? (
              <LoaderCircle className="mr-2 size-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-2 size-3.5" />
            )}
            Usuń sesję z dysku
          </Button>
        </div>
      </div>
    </div>
  );
}
