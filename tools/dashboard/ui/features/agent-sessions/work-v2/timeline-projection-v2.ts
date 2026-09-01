import type { CommentaryWorkItemV2, InteractionWorkItemV2, ReasoningWorkItemV2, ToolInvocationWorkItemV2, WorkItemV2 } from '../types.ts';

export type TimelineRowV2 =
  | { row: 'commentary'; id: string; item: CommentaryWorkItemV2 }
  | { row: 'reasoning'; id: string; item: ReasoningWorkItemV2 }
  | { row: 'interaction'; id: string; item: InteractionWorkItemV2 }
  | { row: 'tool'; id: string; item: ToolInvocationWorkItemV2 };

/**
 * Builds Level 2 timeline rows from `historicalWork` — one row per canonical top-level
 * WorkItem, in exact chronological order (owner-decisions.md D4/C3: Work is never
 * grouped globally by type, and one real provider operation is one ToolInvocation).
 * Independent top-level invocations are never merged just because they share a kind —
 * compactness comes from row density (work-timeline-v2.tsx), not from deleting
 * chronology. Nested `ToolAction[]` stay nested under their owning invocation, which is
 * this function's only "grouping": it is not top-level grouping at all, just rendering
 * a tool item's existing children.
 */
export function buildTimelineRowsV2(historicalWork: WorkItemV2[]): TimelineRowV2[] {
  return historicalWork.map((item): TimelineRowV2 => {
    switch (item.type) {
      case 'commentary':
        return { row: 'commentary', id: item.id, item };
      case 'reasoning':
        return { row: 'reasoning', id: item.id, item };
      case 'interaction':
        return { row: 'interaction', id: item.id, item };
      case 'tool':
        return { row: 'tool', id: item.id, item };
    }
  });
}
