import { memo } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, LoaderCircle, XCircle } from 'lucide-react';
import { describeCurrentActivityV2, terminalHeaderLabelV2 } from './activity-model-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { useElapsedLabel } from './use-elapsed-label';
import type { CanonicalTurnV2 } from '../types';
import { cn } from '@/lib/utils';

/**
 * Level 1 — the collapsed Work indicator (areas/work-ux-presentation.md § "Level 1").
 * Answers only "what is the agent doing right now?" — handles ordinary waiting kinds
 * (`waiting_for_model`, `waiting_for_tool`) as normal running activities, keeping them
 * distinct from `requires_attention`. Header state, activityCount, and currentActivity all
 * come straight from the server projection.
 */
export const WorkCurrentActivityLineV2 = memo(function WorkCurrentActivityLineV2({
  turn,
  embedded = false,
}: {
  turn: CanonicalTurnV2;
  embedded?: boolean;
}) {
  const display = describeCurrentActivityV2(turn.currentActivity);
  const elapsed = useElapsedLabel(display?.startedAt);
  if (!display) return null;

  const ToolIcon = display.toolKind ? TOOL_KIND_ICONS_V2[display.toolKind] : null;
  const isAttention = display.kind === 'requires_attention';
  const detail = display.detail || display.description;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4',
        !embedded && 'pl-1',
        isAttention ? 'text-[var(--warning-strong)]' : 'text-[var(--foreground)]',
      )}
      role="status"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 flex items-center justify-center bg-transparent">
          {isAttention ? (
            <AlertTriangle className="size-4 shrink-0 text-[var(--warning)]" />
          ) : display.kind === 'cancelling' ? (
            <XCircle className="size-4 shrink-0 text-[var(--muted)]" />
          ) : ToolIcon ? (
            <ToolIcon className="size-4 shrink-0 text-[var(--accent)]" />
          ) : (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--accent)]" />
          )}
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-[var(--foreground)]">{display.label}</span>
        {detail ? <span className="font-normal text-[var(--muted)]"> · {detail}</span> : null}
        {elapsed ? <span className="font-normal text-[var(--muted)]"> ({elapsed})</span> : null}
      </span>
    </div>
  );
});

export interface WorkIndicatorV2Props {
  turn: CanonicalTurnV2;
  expanded: boolean;
  onToggle: () => void;
}

export const WorkIndicatorV2 = memo(function WorkIndicatorV2({ turn, expanded, onToggle }: WorkIndicatorV2Props) {
  const terminalLabel = terminalHeaderLabelV2(turn.status);
  const attention = turn.status.status === 'requiresAttention';
  const count = turn.activityCount;

  const statusLabel = terminalLabel || (attention ? 'Requires attention' : 'In progress');

  const severity: 'normal' | 'warning' | 'error' = attention
    ? 'warning'
    : terminalLabel === 'Failed'
      ? 'error'
      : 'normal';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium transition-colors hover:bg-white/4',
        severity === 'error' && 'text-[var(--danger-strong)]',
        severity === 'warning' && 'text-[var(--warning-strong)]',
        severity === 'normal' && 'text-[var(--foreground-muted)]',
      )}
    >
      {terminalLabel === 'Failed' ? (
        <AlertTriangle className="size-4 shrink-0 text-[var(--danger)]" />
      ) : terminalLabel === 'Cancelled' || terminalLabel === 'Interrupted' ? (
        <XCircle className="size-4 shrink-0 text-[var(--muted)]" />
      ) : terminalLabel === 'Completed' ? (
        <CheckCircle2 className="size-4 shrink-0 text-[var(--success)]" />
      ) : attention ? (
        <AlertTriangle className="size-4 shrink-0 text-[var(--warning)]" />
      ) : (
        <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--accent)]" />
      )}
      <span className="min-w-0 flex-1 truncate">
        Work · {count} {count === 1 ? 'action' : 'actions'} · {statusLabel}
      </span>
      {expanded ? <ChevronDown className="size-4 shrink-0 text-[var(--muted)]" /> : <ChevronRight className="size-4 shrink-0 text-[var(--muted)]" />}
    </button>
  );
});
