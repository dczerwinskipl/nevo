import { memo, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { AiToolView } from '@/components/ai-tool-view';
import { visibleWorkItemsWhenTerminal, visibleWorkItemsWhileRunning } from '@/components/work/work-visibility';
import type { TurnWork, WorkItem } from '@/lib/chat-projection';
import type { AgentToolCall } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface WorkSummaryProps {
  work: TurnWork;
}

function toToolCall(item: WorkItem): AgentToolCall {
  return {
    id: item.toolId,
    name: item.toolName,
    input: item.input,
    output: item.output,
    status: item.status,
    durationMs: item.durationMs,
  };
}

/**
 * The primary "what's happening right now" line — isolated into its own memoized
 * component so it can update on every streamed tool event without forcing the
 * lower-frequency collapsed summary to re-render (react-component-guidelines.md §9.1).
 */
const WorkCurrentActivity = memo(function WorkCurrentActivity({ item }: { item: WorkItem | null }) {
  if (!item) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]" role="status">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
      <span className="truncate font-mono">{item.toolName}</span>
    </div>
  );
});

/**
 * The collapsed "Work · N actions" row — memoized on primitive props only, so it does
 * not re-render merely because the current activity line above it changed
 * (react-component-guidelines.md §9.1).
 */
const WorkCollapsedSummary = memo(function WorkCollapsedSummary({
  count,
  hasFailed,
  expanded,
  onToggle,
}: {
  count: number;
  hasFailed: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors',
        hasFailed
          ? 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/15'
          : 'border-[var(--border)] bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-white/4'
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {hasFailed ? (
          <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-[var(--success)]" />
        )}
        <span className="truncate">
          Work · {count} {count === 1 ? 'action' : 'actions'} {hasFailed ? '— requires attention' : '✓'}
        </span>
      </span>
      {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
    </button>
  );
});

/**
 * Compact per-turn Work presentation (owner-decisions.md, replaces one `AiToolView`
 * card per tool call). Consumes Task 01's `TurnWork` projection directly — grouping
 * (current/completed/failed) is already decided by the projection; this component only
 * renders it (react-component-guidelines.md §6, §9.2).
 */
export function WorkSummary({ work }: WorkSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const currentItem = useMemo(() => work.items.find(item => item.status === 'running') ?? null, [work.items]);
  const priorCount = useMemo(() => work.items.filter(item => item.status !== 'running').length, [work.items]);
  const hasFailed = work.status === 'failed';

  if (work.status === 'current') {
    // A running turn never has a failed item yet (the projection resolves that turn to
    // 'failed' the moment one occurs) — only the current/prior split applies here.
    const visibleItems = visibleWorkItemsWhileRunning(work, expanded);
    return (
      <div className="my-2 space-y-1.5">
        {priorCount > 0 && (
          <WorkCollapsedSummary count={priorCount} hasFailed={false} expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />
        )}
        {visibleItems.map(item => <AiToolView key={item.toolId} toolCall={toToolCall(item)} />)}
        <WorkCurrentActivity item={currentItem} />
      </div>
    );
  }

  // Completed or failed: one collapsed row.
  const visibleItems = visibleWorkItemsWhenTerminal(work, expanded);

  return (
    <div className="my-2 space-y-1.5">
      <WorkCollapsedSummary count={work.items.length} hasFailed={hasFailed} expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />
      {visibleItems.length > 0 && (
        <div className="space-y-1.5">
          {visibleItems.map(item => <AiToolView key={item.toolId} toolCall={toToolCall(item)} />)}
        </div>
      )}
    </div>
  );
}
