import { memo } from 'react';
import { Ban, XCircle } from 'lucide-react';
import {
  projectTimelineV2,
  type CommentaryPresentationRowV2,
  type TimelineRowV2,
  type ToolGroupPresentationRowV2,
} from './timeline-projection-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { previewPlainText } from './text-preview-v2';
import type { InteractionWorkItemV2, ReasoningWorkItemV2, ToolStatusV2, WorkItemV2 } from '../types';
import { cn } from '@/shared/lib/utils';

const TOOL_STATUS_ICON: Partial<Record<ToolStatusV2, typeof XCircle>> = {
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
};

/**
 * One compact Level 2 row for a tool or grouped tool action.
 * Pure Tailwind: 12px text (text-xs leading-4), 16px icon (size-4).
 */
const ToolGroupRowV2 = memo(function ToolGroupRowV2({
  row,
  onSelect,
}: {
  row: ToolGroupPresentationRowV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const Icon = TOOL_KIND_ICONS_V2[row.kind] || TOOL_KIND_ICONS_V2.other;
  const StatusIcon = TOOL_STATUS_ICON[row.status];
  const countSuffix = row.count > 1 ? ` (${row.count})` : '';
  const primaryItem = row.items[0];

  return (
    <button
      type="button"
      onClick={() => onSelect(primaryItem)}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4 transition-colors hover:bg-fg-primary/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 flex items-center justify-center bg-transparent">
          <Icon className="size-4 text-fg-muted group-hover:text-fg-muted" />
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-normal text-fg-secondary group-hover:text-fg-primary">
          {row.title}
          {countSuffix}
        </span>
        {row.subject ? <span className="font-normal text-fg-muted"> · {row.subject}</span> : null}
      </span>
      {StatusIcon && <StatusIcon className="size-4 shrink-0 text-status-warning" />}
    </button>
  );
});

/**
 * Level 2 preview for Commentary — clean bordered cardlet with pure text,
 * no icon or redundant label.
 */
const CommentaryRowV2 = memo(function CommentaryRowV2({
  row,
  onSelect,
}: {
  row: CommentaryPresentationRowV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const preview = previewPlainText(row.item.text, 180);
  if (!preview) return null;
  const repeatSuffix = row.repeatCount && row.repeatCount > 1 ? ` (×${row.repeatCount})` : '';

  return (
    <button
      type="button"
      onClick={() => onSelect(row.item)}
      className="group my-0.5 flex w-full min-w-0 rounded border border-border/40 bg-fg-primary/[0.02] px-2.5 py-1.5 text-left text-xs leading-relaxed text-fg-secondary transition-colors hover:border-border hover:bg-fg-primary/[0.04] hover:text-fg-primary"
    >
      <p className="line-clamp-2">
        {preview}
        {repeatSuffix ? <span className="text-xs text-fg-muted"> {repeatSuffix}</span> : null}
      </p>
    </button>
  );
});

/**
 * Compact Level 2 preview for Reasoning — plain text with "Thinking" cue and distinct marker.
 */
const ReasoningRowV2 = memo(function ReasoningRowV2({
  item,
  onSelect,
}: {
  item: ReasoningWorkItemV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const preview = previewPlainText(item.text, 120);
  if (!preview) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4 transition-colors hover:bg-fg-primary/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1.5 rounded-full border border-fg-secondary bg-transparent" />
      </div>
      <span className="min-w-0 flex-1 truncate text-fg-muted italic group-hover:text-fg-secondary">
        <span className="font-medium text-fg-secondary not-italic">Thinking</span>
        {preview ? <span> · {preview}</span> : null}
      </span>
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
        'group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4 transition-colors hover:bg-fg-primary/4',
        isPending ? 'font-medium text-status-warning' : 'font-normal text-fg-muted',
      )}
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className={cn('relative z-10 size-1.5 rounded-full', isPending ? 'bg-status-warning' : 'bg-fg-muted')} />
      </div>
      <span className="min-w-0 flex-1 truncate">{interactionSummary(item)}</span>
    </button>
  );
});

/**
 * Older history disclosure indicator rendered at the TOP of Level 2 history.
 * Non-interactive, quiet indicator showing (+N hidden).
 */
const OlderHistoryRowV2 = memo(function OlderHistoryRowV2({ hiddenCount }: { hiddenCount: number }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 px-1.5 py-0.5 text-xs text-fg-muted">
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1.5 rounded-full bg-fg-muted" />
      </div>
      <span className="min-w-0 flex-1 truncate font-normal">(+{hiddenCount} hidden)</span>
    </div>
  );
});

function TimelineRow({ row, onSelectItem }: { row: TimelineRowV2; onSelectItem: (item: WorkItemV2) => void }) {
  switch (row.row) {
    case 'commentary':
      return <CommentaryRowV2 row={row} onSelect={onSelectItem} />;
    case 'reasoning':
      return <ReasoningRowV2 item={row.item} onSelect={onSelectItem} />;
    case 'interaction':
      return <InteractionRowV2 item={row.item} onSelect={onSelectItem} />;
    case 'tool_group':
      return <ToolGroupRowV2 row={row} onSelect={onSelectItem} />;
    default:
      return null;
  }
}

export interface WorkTimelineV2Props {
  historicalWork: WorkItemV2[];
  onSelectItem: (item: WorkItemV2) => void;
  onOpenDetails?: () => void;
  maxRows?: number;
  embedded?: boolean;
}

/**
 * Level 2 — the expanded Work timeline (areas/work-ux-presentation.md § "Level 2").
 * Renders the pure presentation projection over `historicalWork` with adjacent tool
 * grouping and visible-history capping (newest actions visible), anchored along a central vertical rail.
 */
export const WorkTimelineV2 = memo(function WorkTimelineV2({
  historicalWork,
  onSelectItem,
  maxRows,
  embedded = false,
}: WorkTimelineV2Props) {
  const projection = projectTimelineV2(historicalWork, { maxRows });
  if (projection.allRows.length === 0) return null;

  const content = (
    <>
      {projection.hasMore && <OlderHistoryRowV2 hiddenCount={projection.hiddenCount} />}
      {projection.visibleRows.map((row) => (
        <TimelineRow key={row.id} row={row} onSelectItem={onSelectItem} />
      ))}
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-0.5">{content}</div>;
  }

  return (
    <div className="relative w-full max-w-full min-w-0 pl-1">
      <div className="absolute top-2 bottom-2 left-[18px] w-px -translate-x-1/2 bg-border" aria-hidden="true" />
      <div className="relative flex flex-col gap-0.5">{content}</div>
    </div>
  );
});
