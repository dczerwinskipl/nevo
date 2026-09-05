import type {
  CommentaryWorkItemV2,
  InteractionWorkItemV2,
  ReasoningWorkItemV2,
  ToolInvocationWorkItemV2,
  ToolKindV2,
  ToolStatusV2,
  WorkItemV2,
} from '../types.ts';
import { previewPlainText } from './text-preview-v2.ts';

export interface ToolGroupPresentationRowV2 {
  row: 'tool_group';
  id: string;
  kind: ToolKindV2;
  title: string;
  count: number;
  subject?: string;
  items: ToolInvocationWorkItemV2[];
  status: ToolStatusV2;
}

export interface CommentaryPresentationRowV2 {
  row: 'commentary';
  id: string;
  item: CommentaryWorkItemV2;
  repeatCount?: number;
}

export interface ReasoningPresentationRowV2 {
  row: 'reasoning';
  id: string;
  item: ReasoningWorkItemV2;
}

export interface InteractionPresentationRowV2 {
  row: 'interaction';
  id: string;
  item: InteractionWorkItemV2;
}

export type TimelineRowV2 =
  ToolGroupPresentationRowV2 | CommentaryPresentationRowV2 | ReasoningPresentationRowV2 | InteractionPresentationRowV2;

export interface ProjectedTimelineV2 {
  allRows: TimelineRowV2[];
  visibleRows: TimelineRowV2[];
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
export function buildTimelineRowsV2(historicalWork: WorkItemV2[]): TimelineRowV2[] {
  const rows: TimelineRowV2[] = [];

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
export function projectTimelineV2(historicalWork: WorkItemV2[], options?: { maxRows?: number }): ProjectedTimelineV2 {
  const maxRows = options?.maxRows ?? DEFAULT_L2_MAX_VISIBLE_ROWS;
  const allRows = buildTimelineRowsV2(historicalWork);

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
