import { memo } from 'react';
import { Ban, XCircle } from 'lucide-react';
import { buildTimelineRowsV2, type TimelineRowV2 } from './timeline-projection-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { previewPlainText } from './text-preview-v2';
import type { CommentaryWorkItemV2, InteractionWorkItemV2, ReasoningWorkItemV2, ToolInvocationWorkItemV2, WorkItemV2 } from '../types';
import { cn } from '@/lib/utils';

const TOOL_STATUS_ICON: Partial<Record<ToolInvocationWorkItemV2['status'], typeof XCircle>> = {
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
};

const ROW_BUTTON_CLASSES = 'flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-white/4';

/**
 * One compact Level 2 row for a single tool invocation — small secondary icon, semantic
 * title, and at most one short target (areas/work-ux-presentation.md § "Row density and
 * grouping"). Never inlines input/output/command; that belongs to Work Details only.
 * One canonical top-level WorkItem always renders as exactly one row here — independent
 * invocations are never merged, even when several share the same kind in a row.
 */
const ToolRowV2 = memo(function ToolRowV2({
  item,
  onSelect,
}: {
  item: ToolInvocationWorkItemV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const Icon = TOOL_KIND_ICONS_V2[item.kind];
  const StatusIcon = TOOL_STATUS_ICON[item.status];
  const subject = item.subject;

  return (
    <button type="button" onClick={() => onSelect(item)} className={`${ROW_BUTTON_CLASSES} text-[var(--muted)]`}>
      <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-normal text-[var(--foreground-muted)]">{item.title}</span>
        {subject ? <span className="text-[var(--muted)]"> · {subject}</span> : null}
      </span>
      {StatusIcon && <StatusIcon className="size-3.5 shrink-0 text-[var(--warning)]" />}
    </button>
  );
});

/**
 * Compact Level 2 preview for Commentary — plain text, no type icon, whitespace/Markdown
 * collapsed to one line (previewPlainText). Indented subtly to read as narration between
 * operations. Selecting it opens the full Markdown in Work Details.
 */
const CommentaryRowV2 = memo(function CommentaryRowV2({ item, onSelect }: { item: CommentaryWorkItemV2; onSelect: (item: WorkItemV2) => void }) {
  const preview = previewPlainText(item.text);
  if (!preview) return null;
  return (
    <button type="button" onClick={() => onSelect(item)} className="flex w-full min-w-0 items-start rounded py-0.5 pl-5 pr-1.5 text-left text-xs font-normal leading-relaxed text-[var(--muted)] transition-colors hover:bg-white/4 hover:text-[var(--foreground-muted)]">
      <span className="min-w-0 flex-1 truncate">{preview}</span>
    </button>
  );
});

const ReasoningRowV2 = memo(function ReasoningRowV2({ item, onSelect }: { item: ReasoningWorkItemV2; onSelect: (item: WorkItemV2) => void }) {
  const preview = previewPlainText(item.text);
  if (!preview) return null;
  return (
    <button type="button" onClick={() => onSelect(item)} className="flex w-full min-w-0 items-start rounded py-0.5 pl-5 pr-1.5 text-left text-xs font-normal leading-relaxed text-[var(--muted)] transition-colors hover:bg-white/4 hover:text-[var(--foreground-muted)]">
      <span className="min-w-0 flex-1 truncate">{preview}</span>
    </button>
  );
});

function interactionSummary(item: InteractionWorkItemV2): string {
  const kind = item.interaction.kind;
  const label = kind === 'permission' ? 'Permission' : kind === 'question' ? 'Question' : 'Interaction';
  switch (item.status) {
    case 'resolved':
      return `${label} · resolved`;
    case 'denied':
      return `${label} · denied`;
    case 'rejected':
      return `${label} · rejected`;
    case 'cancelled':
      return `${label} · cancelled`;
    case 'expired':
      return `${label} · expired`;
    default:
      return label;
  }
}

const InteractionRowV2 = memo(function InteractionRowV2({
  item,
  onSelect,
}: {
  item: InteractionWorkItemV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const isPending = item.status === 'pending';
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'flex w-full min-w-0 items-start rounded py-0.5 pl-5 pr-1.5 text-left text-xs transition-colors hover:bg-white/4',
        isPending ? 'font-medium text-[var(--warning-strong)]' : 'font-normal text-[var(--muted)]',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{interactionSummary(item)}</span>
    </button>
  );
});

function TimelineRow({ row, onSelectItem }: { row: TimelineRowV2; onSelectItem: (item: WorkItemV2) => void }) {
  switch (row.row) {
    case 'commentary':
      return <CommentaryRowV2 item={row.item} onSelect={onSelectItem} />;
    case 'reasoning':
      return <ReasoningRowV2 item={row.item} onSelect={onSelectItem} />;
    case 'interaction':
      return <InteractionRowV2 item={row.item} onSelect={onSelectItem} />;
    case 'tool':
      return <ToolRowV2 item={row.item} onSelect={onSelectItem} />;
    default:
      return null;
  }
}

export interface WorkTimelineV2Props {
  historicalWork: WorkItemV2[];
  onSelectItem: (item: WorkItemV2) => void;
}

/**
 * Level 2 — the expanded Work timeline (areas/work-ux-presentation.md § "Level 2").
 * Renders only historical (already-terminal) items; the current activity is a separate
 * projection rendered by the caller below this timeline, never inside it — see "No
 * duplicate active activity". Tight vertical rhythm on purpose: this level carries the
 * least data of the three by design.
 */
export const WorkTimelineV2 = memo(function WorkTimelineV2({ historicalWork, onSelectItem }: WorkTimelineV2Props) {
  const rows = buildTimelineRowsV2(historicalWork);
  if (rows.length === 0) return null;

  return (
    <div className="w-full min-w-0 max-w-full border-l border-[var(--border)] pl-2">
      {rows.map((row) => (
        <TimelineRow key={row.id} row={row} onSelectItem={onSelectItem} />
      ))}
    </div>
  );
});
