import { memo } from 'react';
import { Ban, XCircle } from 'lucide-react';
import {
  buildTimelineRowsV2,
  type TimelineRowV2,
  type ToolGroupPresentationRowV2,
} from './timeline-projection-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { previewPlainText } from './text-preview-v2';
import type {
  CommentaryWorkItemV2,
  InteractionWorkItemV2,
  ReasoningWorkItemV2,
  ToolStatusV2,
  WorkItemV2,
} from '../types';
import { cn } from '@/lib/utils';

const TOOL_STATUS_ICON: Partial<Record<ToolStatusV2, typeof XCircle>> = {
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
};

/**
 * One compact Level 2 row for a tool or grouped tool action.
 * Positioned cleanly on the continuous vertical timeline rail.
 */
const ToolGroupRowV2 = memo(function ToolGroupRowV2({
  row,
  onSelect,
}: {
  row: ToolGroupPresentationRowV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const Icon = TOOL_KIND_ICONS_V2[row.kind];
  const StatusIcon = TOOL_STATUS_ICON[row.status];
  const countSuffix = row.count > 1 ? ` (${row.count})` : '';
  const primaryItem = row.items[0];

  return (
    <button
      type="button"
      onClick={() => onSelect(primaryItem)}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-white/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 flex items-center justify-center bg-[var(--card,var(--background))]">
          <Icon className="size-3.5 text-[var(--muted)] group-hover:text-[var(--foreground-muted)]" />
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-normal text-[var(--foreground-muted)]">
          {row.title}
          {countSuffix}
        </span>
        {row.subject ? <span className="text-[var(--muted)]"> · {row.subject}</span> : null}
      </span>
      {StatusIcon && <StatusIcon className="size-3.5 shrink-0 text-[var(--warning)]" />}
    </button>
  );
});

/**
 * Compact Level 2 preview for Commentary — plain text narration, no type icon,
 * participating on the timeline rail via a small neutral dot.
 */
const CommentaryRowV2 = memo(function CommentaryRowV2({
  item,
  onSelect,
}: {
  item: CommentaryWorkItemV2;
  onSelect: (item: WorkItemV2) => void;
}) {
  const preview = previewPlainText(item.text, 140);
  if (!preview) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-white/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1.5 rounded-full bg-[var(--muted)] ring-2 ring-[var(--card,var(--background))]" />
      </div>
      <span className="min-w-0 flex-1 truncate font-normal leading-relaxed text-[var(--foreground-muted)]">
        {preview}
      </span>
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
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-white/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1.5 rounded-full border border-[var(--muted-strong)] bg-[var(--card,var(--background))] ring-2 ring-[var(--card,var(--background))]" />
      </div>
      <span className="min-w-0 flex-1 truncate italic text-[var(--muted-strong)]">
        <span className="font-medium not-italic text-[var(--muted-strong)]">Thinking</span>
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
        'group flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-white/4',
        isPending ? 'font-medium text-[var(--warning-strong)]' : 'font-normal text-[var(--muted)]',
      )}
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            'relative z-10 size-1.5 rounded-full ring-2 ring-[var(--card,var(--background))]',
            isPending ? 'bg-[var(--warning)]' : 'bg-[var(--muted)]',
          )}
        />
      </div>
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
    case 'tool_group':
      return <ToolGroupRowV2 row={row} onSelect={onSelectItem} />;
    default:
      return null;
  }
}

export interface WorkTimelineV2Props {
  historicalWork: WorkItemV2[];
  onSelectItem: (item: WorkItemV2) => void;
  embedded?: boolean;
}

/**
 * Level 2 — the expanded Work timeline (areas/work-ux-presentation.md § "Level 2").
 * Renders the pure presentation projection over `historicalWork` with adjacent tool
 * grouping, anchored along a central vertical rail.
 */
export const WorkTimelineV2 = memo(function WorkTimelineV2({
  historicalWork,
  onSelectItem,
  embedded = false,
}: WorkTimelineV2Props) {
  const rows = buildTimelineRowsV2(historicalWork);
  if (rows.length === 0) return null;

  if (embedded) {
    return (
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <TimelineRow key={row.id} row={row} onSelectItem={onSelectItem} />
        ))}
      </div>
    );
  }

  return (
    <div className="relative w-full min-w-0 max-w-full pl-1">
      <div
        className="absolute bottom-2 left-[11px] top-2 w-px bg-[var(--border)]"
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-0.5">
        {rows.map((row) => (
          <TimelineRow key={row.id} row={row} onSelectItem={onSelectItem} />
        ))}
      </div>
    </div>
  );
});

