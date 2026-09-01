import { memo } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Hourglass, LoaderCircle, XCircle } from 'lucide-react';
import { describeCurrentActivityV2, terminalHeaderLabelV2 } from './activity-model-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { useElapsedLabel } from './use-elapsed-label';
import type { CanonicalTurnV2 } from '../types';
import { cn } from '@/lib/utils';

/**
 * Level 1 — the collapsed Work indicator (areas/work-ux-presentation.md § "Level 1").
 * Answers only "what is the agent doing right now?" — no historical activity renders
 * here. Header state, activityCount, and currentActivity all come straight from the
 * server projection; this component only formats and lays them out.
 */
export const WorkCurrentActivityLineV2 = memo(function WorkCurrentActivityLineV2({ turn }: { turn: CanonicalTurnV2 }) {
  const display = describeCurrentActivityV2(turn.currentActivity);
  const elapsed = useElapsedLabel(display?.startedAt);
  if (!display) return null;

  const ToolIcon = display.toolKind ? TOOL_KIND_ICONS_V2[display.toolKind] : null;
  const isAttention = display.kind === 'requires_attention';

  return (
    <div
      className={cn(
        'flex items-center gap-2 pl-1 text-xs',
        isAttention ? 'text-[var(--warning-strong)]' : 'text-[var(--muted)]',
      )}
      role="status"
    >
      {isAttention ? (
        <AlertTriangle className="size-3.5 shrink-0 text-[var(--warning)]" />
      ) : display.kind === 'cancelling' ? (
        <XCircle className="size-3.5 shrink-0 text-[var(--muted)]" />
      ) : display.textFirst ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
      ) : ToolIcon ? (
        <ToolIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
      ) : (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {display.label}
        {display.description ? <span className="text-[var(--muted)]"> · {display.description}</span> : null}
      </span>
      {!isAttention && display.kind !== 'cancelling' && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted)]" aria-hidden="true">
          {display.kind === 'waiting_for_model' || display.kind === 'waiting_for_tool' ? (
            <Hourglass className="size-3" />
          ) : (
            <LoaderCircle className="size-3 animate-spin" />
          )}
          {elapsed}
        </span>
      )}
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
        severity === 'normal' && 'text-[var(--muted)]',
      )}
    >
      {terminalLabel === 'Failed' ? (
        <AlertTriangle className="size-3.5 shrink-0 text-[var(--danger)]" />
      ) : terminalLabel === 'Cancelled' || terminalLabel === 'Interrupted' ? (
        <XCircle className="size-3.5 shrink-0 text-[var(--muted)]" />
      ) : terminalLabel === 'Completed' ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-[var(--success)]" />
      ) : attention ? (
        <AlertTriangle className="size-3.5 shrink-0 text-[var(--warning)]" />
      ) : (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
      )}
      <span className="min-w-0 flex-1 truncate">
        Work · {count} {count === 1 ? 'action' : 'actions'}
        {terminalLabel ? ` · ${terminalLabel}` : attention ? ' · requires attention' : ''}
      </span>
      {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
    </button>
  );
});
