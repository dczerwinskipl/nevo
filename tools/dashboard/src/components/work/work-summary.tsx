import { memo, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { AiToolView } from '@/components/ai-tool-view';
import { visibleWorkItemsWhenTerminal, visibleWorkItemsWhileRunning } from '@/components/work/work-visibility';
import { activityLabelFor } from '@/lib/tool-activity-labels';
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
 * Uses Task 04's normalized activity label, never the raw provider tool name.
 */
const WorkCurrentActivity = memo(function WorkCurrentActivity({ item }: { item: WorkItem | null }) {
  if (!item) return null;
  const { label } = activityLabelFor(item.toolName, item.input);
  return (
    <div className="flex items-center gap-2 pl-1 text-xs text-[var(--muted)]" role="status">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
      <span className="truncate">{label}</span>
    </div>
  );
});

/**
 * The collapsed "Work · N actions" row. A lightweight transcript/activity row — no
 * card chrome (border/background/rounded container) — reads as metadata about the
 * turn, not as another chat bubble. Memoized on primitive props only, so it does not
 * re-render merely because the current activity line above it changed
 * (react-component-guidelines.md §9.1).
 */
const WorkCollapsedSummary = memo(function WorkCollapsedSummary({
  count,
  hasFailures,
  expanded,
  onToggle,
}: {
  count: number;
  hasFailures: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium transition-colors hover:bg-white/4',
        hasFailures ? 'text-red-300' : 'text-[var(--muted)]'
      )}
    >
      {hasFailures ? (
        <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-[var(--success)]" />
      )}
      <span className="min-w-0 flex-1 truncate">
        Work · {count} {count === 1 ? 'action' : 'actions'}
        {hasFailures ? ' · requires attention' : ''}
      </span>
      {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
    </button>
  );
});

/**
 * Lightweight turn-level error row, rendered below tool items inside expanded Work
 * when the turn ended via `turn.failed` (owner-decisions.md D6/D9). This is what makes
 * the reason for "requires attention" visible — the error is separate from per-tool
 * statuses (successful tools stay successful) and is never hidden inside raw event
 * details. No card chrome — just a compact inline row consistent with the rest of Work.
 */
const TurnErrorRow = memo(function TurnErrorRow({
  turnError,
}: {
  turnError: { code: string; message: string };
}) {
  return (
    <div className="flex items-start gap-2 rounded-md px-1 py-1.5 text-xs text-red-300" role="alert">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">Turn failed</span>
        {turnError.message && (
          <span className="ml-1 text-red-200/80">{turnError.message}</span>
        )}
        {turnError.code && (
          <span className="ml-1 font-mono text-[10px] text-red-200/50">({turnError.code})</span>
        )}
      </div>
    </div>
  );
});

/**
 * Compact per-turn Work presentation (owner-decisions.md, replaces one `AiToolView`
 * card per tool call). Consumes Task 01's `TurnWork` projection directly — grouping
 * (current/completed/failed, and the independent `hasFailures` signal) is already
 * decided by the projection; this component only renders it
 * (react-component-guidelines.md §6, §9.2). Renders as a flat transcript row, never a
 * nested card — the caller is responsible for not wrapping this in an assistant
 * message bubble when there is no accompanying prose.
 */
export function WorkSummary({ work }: WorkSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  // Stable across renders so WorkCollapsedSummary's memo() actually skips a re-render
  // when only work.items' object identity changed but count/hasFailures/expanded did
  // not (react-component-guidelines.md §9.1) — an inline arrow here would defeat that
  // memo on every streamed token.
  const toggleExpanded = useCallback(() => setExpanded(prev => !prev), []);

  const currentItem = useMemo(() => work.items.find(item => item.status === 'running') ?? null, [work.items]);
  const priorCount = useMemo(() => work.items.filter(item => item.status !== 'running').length, [work.items]);

  if (work.status === 'current') {
    // An active turn may already contain a failed historical action (e.g. `Read
    // failed`, `Bash completed`, `Edit running`) — lifecycle and outcome are
    // independent, so `hasFailures` is surfaced here even while still 'current'.
    const visibleItems = visibleWorkItemsWhileRunning(work, expanded);
    return (
      <div className="my-1.5 space-y-1">
        {priorCount > 0 && (
          <WorkCollapsedSummary count={priorCount} hasFailures={work.hasFailures} expanded={expanded} onToggle={toggleExpanded} />
        )}
        {visibleItems.length > 0 && (
          <div className="space-y-1.5 pl-1">
            {visibleItems.map(item => <AiToolView key={item.toolId} toolCall={toToolCall(item)} />)}
          </div>
        )}
        {/* Turn-level error exposed separately when expanded — successful tools stay successful. */}
        {expanded && work.turnError && (
          <TurnErrorRow turnError={work.turnError} />
        )}
        <WorkCurrentActivity item={currentItem} />
      </div>
    );
  }

  // Completed or failed: one collapsed row. Historical actions — including failed ones
  // — are only individually visible once expanded, never automatically alongside the
  // collapsed row (owner-decisions.md, Task 03 correction).
  const visibleItems = visibleWorkItemsWhenTerminal(work, expanded);

  return (
    <div className="my-1.5 space-y-1">
      <WorkCollapsedSummary count={work.items.length} hasFailures={work.hasFailures} expanded={expanded} onToggle={toggleExpanded} />
      {visibleItems.length > 0 && (
        <div className="space-y-1.5 pl-1">
          {visibleItems.map(item => <AiToolView key={item.toolId} toolCall={toToolCall(item)} />)}
        </div>
      )}
      {/* Turn-level error exposed separately when expanded — successful tools stay successful. */}
      {expanded && work.turnError && (
        <TurnErrorRow turnError={work.turnError} />
      )}
    </div>
  );
}
