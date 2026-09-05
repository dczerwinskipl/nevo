import type { CurrentActivityKindV2, CurrentActivityV2, ToolKindV2, TurnStatusV2 } from '../types.ts';

/**
 * Bounded type-icon vocabulary (areas/work-ux-presentation.md § "Icon vocabulary").
 * Commentary and Reasoning/Thinking are intentionally absent — they stay text-first
 * everywhere per "Icon and text weighting" and never get a kind label from this table.
 */
export const TOOL_KIND_LABELS_V2: Record<ToolKindV2, string> = {
  read: 'Read file',
  edit: 'Edit file',
  write: 'Write file',
  list: 'List directory',
  search: 'Search',
  command: 'Run command',
  test: 'Run tests',
  web: 'Web',
  other: 'Tool',
};

import { previewPlainText } from './text-preview-v2.ts';

export interface CurrentActivityDisplay {
  kind: CurrentActivityKindV2;
  /** Primary label — semantic tool title, or a truthful state label ("Waiting for model response…", "Thinking…"). */
  label: string;
  /** Secondary detail (concise subject, reasoning preview, or brief detail), when available. */
  detail?: string;
  /** Backward-compatible alias for detail. */
  description?: string;
  /** Text-first (no type icon, per "Icon and text weighting") vs icon+label (tool). */
  textFirst: boolean;
  toolKind?: ToolKindV2;
  startedAt: string;
}

/**
 * Formats the server-computed `currentActivity` for Level 1/Level 2 "current activity"
 * presentation. This is pure formatting of already-classified server evidence — it does
 * not reclassify, infer, or fall back to a fake state; a `null` activity stays `null`.
 */
export function describeCurrentActivityV2(activity: CurrentActivityV2 | null): CurrentActivityDisplay | null {
  if (!activity) return null;

  switch (activity.kind) {
    case 'requires_attention':
      return {
        kind: activity.kind,
        label: activity.title,
        detail: activity.description,
        description: activity.description,
        textFirst: false,
        startedAt: activity.startedAt,
      };
    case 'tool': {
      const detail =
        activity.subject ||
        (activity.description && activity.description.length <= 80 && !activity.description.includes('\n')
          ? activity.description
          : undefined);
      return {
        kind: activity.kind,
        label: activity.title,
        detail,
        description: detail,
        textFirst: false,
        toolKind: activity.toolKind,
        startedAt: activity.startedAt,
      };
    }
    case 'thinking': {
      const label = activity.text?.trim() ? activity.text.trim() : 'Thinking…';
      const detail = activity.text?.trim() ? previewPlainText(activity.text, 80) : undefined;
      return {
        kind: activity.kind,
        label,
        detail,
        description: detail,
        textFirst: true,
        startedAt: activity.startedAt,
      };
    }
    case 'commentary':
      return {
        kind: activity.kind,
        label: activity.text?.trim() ? previewPlainText(activity.text, 80) : 'Generating response…',
        textFirst: true,
        startedAt: activity.startedAt,
      };
    case 'waiting_for_tool':
      return {
        kind: activity.kind,
        label: 'Waiting for tool execution',
        textFirst: true,
        startedAt: activity.startedAt,
      };
    case 'waiting_for_model':
      return {
        kind: activity.kind,
        label: 'Waiting for model response',
        textFirst: true,
        startedAt: activity.startedAt,
      };
    case 'cancelling':
      return { kind: activity.kind, label: 'Cancelling turn…', textFirst: true, startedAt: activity.startedAt };
    default:
      return null;
  }
}

export type TerminalHeaderLabelV2 = 'Completed' | 'Failed' | 'Cancelled' | 'Interrupted';

/** Truthful terminal Work-header label — `null` while the Turn has not reached a terminal outcome. */
export function terminalHeaderLabelV2(status: TurnStatusV2): TerminalHeaderLabelV2 | null {
  if (status.status !== 'terminal') return null;
  switch (status.outcome) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Interrupted';
    default:
      return null;
  }
}
