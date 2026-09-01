import type {
  CommentaryWorkItemV2,
  InteractionWorkItemV2,
  ReasoningWorkItemV2,
  ToolInvocationWorkItemV2,
  ToolKindV2,
  ToolStatusV2,
  WorkItemV2,
} from '../types.ts';

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
  | ToolGroupPresentationRowV2
  | CommentaryPresentationRowV2
  | ReasoningPresentationRowV2
  | InteractionPresentationRowV2;

/**
 * Builds Level 2 timeline rows from `historicalWork`.
 *
 * Level 2 is a compact, chronology-preserving visual summary. It compresses adjacent,
 * equivalent happy-path ToolInvocations (same kind, same title, status === 'completed')
 * into a single summary row `title (count)`.
 *
 * Group boundaries:
 * - Commentary, Reasoning, and Interactions are never grouped and strictly preserve temporal order.
 * - ToolInvocations with different kinds or titles start a new group.
 * - Any exceptional tool (status !== 'completed', e.g. failed, cancelled, interrupted) is NOT
 *   swallowed into a happy-path group; it renders as its own individual row.
 * - For count === 1, a concise `item.subject` is displayed (`title · subject`).
 * - For count > 1, subjects are not concatenated inline; the row displays `title (count)`.
 *   (If all grouped items share the exact same non-empty subject, it is preserved).
 */
export function buildTimelineRowsV2(historicalWork: WorkItemV2[]): TimelineRowV2[] {
  const rows: TimelineRowV2[] = [];

  for (const item of historicalWork) {
    if (item.type === 'commentary') {
      rows.push({ row: 'commentary', id: item.id, item });
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
      const prevRow = rows[rows.length - 1];

      if (
        isCompleted &&
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

