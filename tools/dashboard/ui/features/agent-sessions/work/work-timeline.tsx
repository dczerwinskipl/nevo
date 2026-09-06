import { memo } from 'react';
import { Ban, XCircle } from 'lucide-react';
import {
  projectTimeline,
  type CommentaryPresentationRow,
  type TimelineRow,
  type ToolGroupPresentationRow,
} from './timeline-projection';
import { TOOL_KIND_ICONS } from './tool-kind-icons';
import { previewPlainText } from './text-preview';
import type { InteractionWorkItem, ReasoningWorkItem, ToolKind, ToolStatus, WorkItem } from '../types';
import { cn } from '@/shared/lib/utils';

const TOOL_STATUS_ICON: Partial<Record<ToolStatus, typeof XCircle>> = {
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
};

/**
 * One compact Level 2 row for a tool or grouped tool action.
 * Pure Tailwind: 12px text (text-xs leading-4), visually smaller icons than Level 1.
 * Compound actions remain nested under their ToolInvocation.
 */
const ToolGroupRow = memo(function ToolGroupRow({
  row,
  onSelect,
}: {
  row: ToolGroupPresentationRow;
  onSelect: (item: WorkItem) => void;
}) {
  const Icon = TOOL_KIND_ICONS[row.kind] || TOOL_KIND_ICONS.other;
  const StatusIcon = TOOL_STATUS_ICON[row.status];
  const countSuffix = row.count > 1 ? ` (${row.count})` : '';
  const primaryItem = row.items[0];
  const hasActions = Boolean(row.count === 1 && primaryItem.actions && primaryItem.actions.length > 0);

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={() => onSelect(primaryItem)}
        className="group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4 transition-colors hover:bg-fg-primary/4"
      >
        <div className="relative flex size-4 shrink-0 items-center justify-center">
          <span className="relative z-10 flex items-center justify-center bg-transparent">
            <Icon className="size-3.5 text-fg-muted group-hover:text-fg-muted" />
          </span>
        </div>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-normal text-fg-secondary group-hover:text-fg-primary">
            {row.title}
            {countSuffix}
          </span>
          {row.subject ? <span className="font-normal text-fg-muted"> · {row.subject}</span> : null}
        </span>
        {StatusIcon && <StatusIcon className="size-3.5 shrink-0 text-status-warning" />}
      </button>

      {hasActions && (
        <div className="flex flex-col gap-0.5 pr-1 pl-6">
          {primaryItem.actions.map((action) => {
            const ActionIcon = TOOL_KIND_ICONS[action.kind as ToolKind] || null;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => onSelect(primaryItem)}
                className="group/action flex w-full min-w-0 items-center gap-1.5 rounded py-0.5 text-left text-[11px] leading-3.5 text-fg-muted transition-colors hover:text-fg-secondary"
              >
                <span className="relative flex size-3 shrink-0 items-center justify-center">
                  {ActionIcon ? (
                    <ActionIcon className="size-2.5 text-fg-muted" />
                  ) : (
                    <span className="size-1 rounded-full bg-fg-muted/60" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-fg-secondary group-hover/action:text-fg-primary">{action.title}</span>
                  {action.target ? <span className="text-fg-muted"> · {action.target}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

/**
 * Level 2 preview for Commentary — text-first, compact, no bordered card, normally one line.
 */
const CommentaryRow = memo(function CommentaryRow({
  row,
  onSelect,
}: {
  row: CommentaryPresentationRow;
  onSelect: (item: WorkItem) => void;
}) {
  const preview = previewPlainText(row.item.text, 120);
  if (!preview) return null;
  const repeatSuffix = row.repeatCount && row.repeatCount > 1 ? ` (×${row.repeatCount})` : '';

  return (
    <button
      type="button"
      onClick={() => onSelect(row.item)}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4 transition-colors hover:bg-fg-primary/4"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1 rounded-full bg-fg-muted" />
      </div>
      <span className="min-w-0 flex-1 truncate text-fg-secondary group-hover:text-fg-primary">
        <span>{preview}</span>
        {repeatSuffix ? <span className="text-xs text-fg-muted"> {repeatSuffix}</span> : null}
      </span>
    </button>
  );
});

/**
 * Compact Level 2 preview for Reasoning — plain text with "Thinking" cue and distinct marker.
 */
const ReasoningRow = memo(function ReasoningRow({
  item,
  onSelect,
}: {
  item: ReasoningWorkItem;
  onSelect: (item: WorkItem) => void;
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

function interactionSummary(item: InteractionWorkItem): string {
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

const InteractionRow = memo(function InteractionRow({
  item,
  onSelect,
}: {
  item: InteractionWorkItem;
  onSelect: (item: WorkItem) => void;
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
const OlderHistoryRow = memo(function OlderHistoryRow({ hiddenCount }: { hiddenCount: number }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 px-1.5 py-0.5 text-xs text-fg-muted">
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 size-1.5 rounded-full bg-fg-muted" />
      </div>
      <span className="min-w-0 flex-1 truncate font-normal">(+{hiddenCount} hidden)</span>
    </div>
  );
});

function TimelineRowView({ row, onSelectItem }: { row: TimelineRow; onSelectItem: (item: WorkItem) => void }) {
  switch (row.row) {
    case 'commentary':
      return <CommentaryRow row={row} onSelect={onSelectItem} />;
    case 'reasoning':
      return <ReasoningRow item={row.item} onSelect={onSelectItem} />;
    case 'interaction':
      return <InteractionRow item={row.item} onSelect={onSelectItem} />;
    case 'tool_group':
      return <ToolGroupRow row={row} onSelect={onSelectItem} />;
    default:
      return null;
  }
}

export interface WorkTimelineProps {
  historicalWork: WorkItem[];
  onSelectItem: (item: WorkItem) => void;
  onOpenDetails?: () => void;
  maxRows?: number;
  embedded?: boolean;
}

/**
 * Level 2 — the expanded Work timeline (areas/work-ux-presentation.md § "Level 2").
 * Renders the pure presentation projection over `historicalWork` with adjacent tool
 * grouping and visible-history capping (newest actions visible), anchored along a central vertical rail.
 */
export const WorkTimeline = memo(function WorkTimeline({
  historicalWork,
  onSelectItem,
  maxRows,
  embedded = false,
}: WorkTimelineProps) {
  const projection = projectTimeline(historicalWork, { maxRows });
  if (projection.allRows.length === 0) return null;

  const content = (
    <>
      {projection.hasMore && <OlderHistoryRow hiddenCount={projection.hiddenCount} />}
      {projection.visibleRows.map((row) => (
        <TimelineRowView key={row.id} row={row} onSelectItem={onSelectItem} />
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
