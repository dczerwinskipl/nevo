import { memo } from 'react';
import { Ban, CheckCircle2, XCircle } from 'lucide-react';
import { buildTimelineRowsV2, type TimelineRowV2 } from './timeline-projection-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { TOOL_KIND_LABELS_V2 } from './activity-model-v2';
import type { ToolInvocationWorkItemV2, WorkItemV2 } from '../types';
import { cn } from '@/lib/utils';

const TOOL_STATUS_ICON: Partial<Record<ToolInvocationWorkItemV2['status'], typeof CheckCircle2>> = {
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
};

/**
 * One compact Level 2 row for a single tool invocation — small secondary icon, semantic
 * title, and at most one short target (areas/work-ux-presentation.md § "Row density and
 * grouping"). Never inlines input/output/command; that belongs to Work Details only.
 */
const ToolRowV2 = memo(function ToolRowV2({
  item,
  onSelect,
}: {
  item: ToolInvocationWorkItemV2;
  onSelect: (item: ToolInvocationWorkItemV2) => void;
}) {
  const Icon = TOOL_KIND_ICONS_V2[item.kind];
  const StatusIcon = TOOL_STATUS_ICON[item.status];
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-5 text-[var(--muted-strong)] hover:bg-white/4"
    >
      <Icon className="size-3 shrink-0 text-[var(--muted)]" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-[var(--foreground)]">{item.title}</span>
        {item.description ? <span className="text-[var(--muted)]"> · {item.description}</span> : null}
      </span>
      {StatusIcon && <StatusIcon className="size-3 shrink-0 text-[var(--warning)]" />}
    </button>
  );
});

const ToolGroupRowV2 = memo(function ToolGroupRowV2({
  toolKind,
  items,
  onSelect,
}: {
  toolKind: ToolInvocationWorkItemV2['kind'];
  items: ToolInvocationWorkItemV2[];
  onSelect: (item: ToolInvocationWorkItemV2) => void;
}) {
  const Icon = TOOL_KIND_ICONS_V2[toolKind];
  return (
    <button
      type="button"
      onClick={() => onSelect(items[0])}
      className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-5 text-[var(--muted-strong)] hover:bg-white/4"
    >
      <Icon className="size-3 shrink-0 text-[var(--muted)]" />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">
        {TOOL_KIND_LABELS_V2[toolKind]} ({items.length})
      </span>
      <CheckCircle2 className="size-3 shrink-0 text-[var(--success)]" />
    </button>
  );
});

function interactionSummary(item: WorkItemV2 & { type: 'interaction' }): string {
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

function TimelineRow({ row, onSelectTool }: { row: TimelineRowV2; onSelectTool: (item: ToolInvocationWorkItemV2) => void }) {
  switch (row.row) {
    case 'commentary':
      return row.item.text ? (
        <div className="px-1 py-0.5 text-[11px] leading-5 text-[var(--foreground-muted)]">{row.item.text}</div>
      ) : null;
    case 'reasoning':
      return row.item.text ? (
        <div className="px-1 py-0.5 text-[11px] leading-5 text-[var(--muted)]">Thinking · {row.item.text}</div>
      ) : null;
    case 'interaction':
      return <div className="px-1 py-0.5 text-[11px] leading-5 text-[var(--muted)]">{interactionSummary(row.item)}</div>;
    case 'tool':
      return <ToolRowV2 item={row.item} onSelect={onSelectTool} />;
    case 'tool-group':
      return <ToolGroupRowV2 toolKind={row.toolKind} items={row.items} onSelect={onSelectTool} />;
    default:
      return null;
  }
}

export interface WorkTimelineV2Props {
  historicalWork: WorkItemV2[];
  onSelectTool: (item: ToolInvocationWorkItemV2) => void;
}

/**
 * Level 2 — the expanded Work timeline (areas/work-ux-presentation.md § "Level 2").
 * Renders only historical (already-terminal) items; the current activity is a separate
 * projection rendered by the caller below this timeline, never inside it — see "No
 * duplicate active activity".
 */
export const WorkTimelineV2 = memo(function WorkTimelineV2({ historicalWork, onSelectTool }: WorkTimelineV2Props) {
  const rows = buildTimelineRowsV2(historicalWork);
  if (rows.length === 0) return null;

  return (
    <div className={cn('w-full min-w-0 max-w-full space-y-0.5 border-l border-[var(--border)] pl-2')}>
      {rows.map((row) => (
        <TimelineRow key={row.id} row={row} onSelectTool={onSelectTool} />
      ))}
    </div>
  );
});
