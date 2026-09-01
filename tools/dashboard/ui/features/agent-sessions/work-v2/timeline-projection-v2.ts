import type { ToolInvocationWorkItemV2, ToolKindV2, WorkItemV2 } from '../types.ts';

export type TimelineRowV2 =
  | { row: 'commentary'; id: string; item: WorkItemV2 & { type: 'commentary' } }
  | { row: 'reasoning'; id: string; item: WorkItemV2 & { type: 'reasoning' } }
  | { row: 'interaction'; id: string; item: WorkItemV2 & { type: 'interaction' } }
  | { row: 'tool'; id: string; item: ToolInvocationWorkItemV2 }
  | { row: 'tool-group'; id: string; toolKind: ToolKindV2; items: ToolInvocationWorkItemV2[] };

/**
 * Builds Level 2 timeline rows from `historicalWork` (areas/work-ux-presentation.md
 * § "Row density and grouping"). `historicalWork` already excludes the active/streaming
 * item (server-derived, see `CanonicalTurnV2.historicalWork`), so every tool item here is
 * already terminal — this function only decides local, presentation-only compaction of
 * adjacent same-kind *completed* runs. It never reorders, merges non-adjacent items, or
 * groups failed/cancelled/interrupted/unknown tools (a failed tool always stays its own
 * row, keeping the failure individually visible). The underlying Work sequence is
 * unchanged; Work Details (Level 3) must render `historicalWork` ungrouped instead of
 * this projection.
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

    // item.type === 'tool'
    const last = rows[rows.length - 1];
    if (item.status === 'completed' && last?.row === 'tool-group' && last.toolKind === item.kind) {
      last.items.push(item);
      continue;
    }
    if (item.status === 'completed' && last?.row === 'tool' && last.item.kind === item.kind && last.item.status === 'completed') {
      rows[rows.length - 1] = { row: 'tool-group', id: `group-${last.item.id}`, toolKind: item.kind, items: [last.item, item] };
      continue;
    }
    rows.push({ row: 'tool', id: item.id, item });
  }

  return rows;
}
