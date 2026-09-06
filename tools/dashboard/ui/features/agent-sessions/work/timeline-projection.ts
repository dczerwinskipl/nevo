import type {
  CommentaryWorkItem,
  InteractionWorkItem,
  ReasoningWorkItem,
  ToolInvocationWorkItem,
  ToolKind,
  ToolStatus,
  WorkItem,
} from '../types.ts';
import { previewPlainText } from './text-preview.ts';

export interface ToolGroupPresentationRow {
  row: 'tool_group';
  id: string;
  kind: ToolKind;
  title: string;
  count: number;
  subject?: string;
  items: ToolInvocationWorkItem[];
  status: ToolStatus;
}

export interface CommentaryPresentationRow {
  row: 'commentary';
  id: string;
  item: CommentaryWorkItem;
  repeatCount?: number;
}

export interface ReasoningPresentationRow {
  row: 'reasoning';
  id: string;
  item: ReasoningWorkItem;
}

export interface InteractionPresentationRow {
  row: 'interaction';
  id: string;
  item: InteractionWorkItem;
}

export type TimelineRow =
  | ToolGroupPresentationRow
  | CommentaryPresentationRow
  | ReasoningPresentationRow
  | InteractionPresentationRow;

export interface ProjectedTimeline {
  allRows: TimelineRow[];
  visibleRows: TimelineRow[];
  hiddenCount: number;
  hiddenRowCount: number;
  hasMore: boolean;
}

export const DEFAULT_L2_MAX_VISIBLE_ROWS = 8;

/**
 * Normalizes commentary text for exact repeated narration comparison.
 * Strips markdown and collapses whitespace to compare semantic narration.
 */
export function normalizeCommentaryText(text: string | undefined): string {
  if (!text) return '';
  return previewPlainText(text, 500).trim();
}

/**
 * Builds Level 2 timeline rows from `historicalWork`.
 *
 * Level 2 is a compact, chronology-preserving visual summary:
 * 1. Adjacent equivalent happy-path ToolInvocations (same kind, same title, status === 'completed')
 *    are compressed into a single summary row `title (count)`.
 * 2. Conservative repeated-Commentary presentation dedupe: when the exact same normalized
 *    narration repeats across intervening tools (e.g. waiting loops), only one commentary row
 *    is emitted in Level 2 with an updated repeatCount, eliminating repetitive noise while
 *    leaving canonical and Level 3 history complete.
 *
 * Boundaries that break grouping/dedupe:
 * - Different commentary text (meaningful narration is always preserved).
 * - Reasoning boundaries.
 * - Interaction boundaries.
 * - Exceptional tools (failed, cancelled, interrupted, active).
 * - Change of tool kind or title.
 */
export function buildTimelineRows(historicalWork: WorkItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const item of historicalWork) {
    if (item.type === 'commentary') {
      rows.push({
        row: 'commentary',
        id: item.id,
        item,
      });
      continue;
    }

    if (item.type === 'reasoning') {
      rows.push({ row: 'reasoning', id: item.id, item });
      continue;
    }

    if (item.type === 'interaction') {
      rows.push({ row: 'interaction', id: item.id, item });
      continue;
    }

    if (item.type === 'tool') {
      const isCompleted = item.status === 'completed';
      const hasActions = Boolean(item.actions && item.actions.length > 0);
      const prevRow = rows[rows.length - 1];
      const prevHasActions = Boolean(
        prevRow && prevRow.row === 'tool_group' && prevRow.items.some((i) => i.actions && i.actions.length > 0),
      );

      if (
        isCompleted &&
        !hasActions &&
        !prevHasActions &&
        prevRow &&
        prevRow.row === 'tool_group' &&
        prevRow.status === 'completed' &&
        prevRow.kind === item.kind &&
        prevRow.title === item.title
      ) {
        prevRow.count += 1;
        prevRow.items.push(item);
        if (prevRow.subject !== item.subject) {
          prevRow.subject = undefined;
        }
      } else {
        rows.push({
          row: 'tool_group',
          id: item.id,
          kind: item.kind,
          title: item.title,
          count: 1,
          subject: item.subject,
          items: [item],
          status: item.status,
        });
      }
    }
  }

  return rows;
}

/**
 * Applies Stage B visible-history cap to Level 2 timeline rows.
 *
 * For long turns, renders only a bounded, useful chronological summary and accurately
 * counts hidden canonical history for the "+N more in Work Details →" affordance.
 */
export function projectTimeline(historicalWork: WorkItem[], options?: { maxRows?: number }): ProjectedTimeline {
  const maxRows = options?.maxRows ?? DEFAULT_L2_MAX_VISIBLE_ROWS;
  const allRows = buildTimelineRows(historicalWork);

  if (allRows.length <= maxRows) {
    return {
      allRows,
      visibleRows: allRows,
      hiddenCount: 0,
      hiddenRowCount: 0,
      hasMore: false,
    };
  }

  const visibleRows = allRows.slice(-maxRows);
  const hiddenRows = allRows.slice(0, allRows.length - maxRows);

  let hiddenCount = 0;
  for (const row of hiddenRows) {
    if (row.row === 'tool_group') {
      hiddenCount += row.count;
    } else if (row.row === 'commentary') {
      hiddenCount += row.repeatCount ?? 1;
    } else {
      hiddenCount += 1;
    }
  }

  return {
    allRows,
    visibleRows,
    hiddenCount,
    hiddenRowCount: hiddenRows.length,
    hasMore: true,
  };
}
