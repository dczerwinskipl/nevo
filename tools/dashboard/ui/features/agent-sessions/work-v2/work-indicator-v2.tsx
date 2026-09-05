import { memo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LoaderCircle,
  XCircle,
} from 'lucide-react';
import { describeCurrentActivityV2, terminalHeaderLabelV2 } from './activity-model-v2';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { useElapsedLabel } from './use-elapsed-label';
import { turnStatusToneV2, currentActivityToneV2 } from './turn-status-tone-v2';
import { statusTextTone } from '@/shared/status-tone';
import type { CanonicalTurnV2 } from '../types';
import { cn } from '@/shared/lib/utils';

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
  const tone = currentActivityToneV2(display);
  const isAttention = tone === 'attention';
  const detail = display.detail || display.description;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs leading-4',
        !embedded && 'pl-1',
        isAttention ? statusTextTone({ tone: 'attention' }) : 'text-fg-primary',
      )}
      role="status"
    >
      <div className="relative flex size-4 shrink-0 items-center justify-center">
        <span className="relative z-10 flex items-center justify-center bg-transparent">
          {isAttention ? (
            <AlertTriangle className="size-4 shrink-0 text-status-attention" />
          ) : display.kind === 'cancelling' ? (
            <XCircle className="size-4 shrink-0 text-fg-muted" />
          ) : ToolIcon ? (
            <ToolIcon className="size-4 shrink-0 text-accent" />
          ) : (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" />
          )}
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-fg-primary">{display.label}</span>
        {detail ? <span className="font-normal text-fg-muted"> · {detail}</span> : null}
        {elapsed ? <span className="font-normal text-fg-muted"> ({elapsed})</span> : null}
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
  const tone = turnStatusToneV2(turn.status);
  const attention = tone === 'attention';
  const count = turn.activityCount;

  const isCancelling = turn.status.status === 'cancelling';
  const isUnknown = turn.status.status === 'unknown';
  const statusLabel =
    terminalLabel ||
    (isCancelling ? 'Cancelling…' : isUnknown ? 'Unknown' : attention ? 'Requires attention' : 'In progress');

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium transition-colors hover:bg-fg-primary/4',
        tone === 'error' && 'text-status-error',
        tone === 'attention' && 'text-status-attention',
        tone === 'warning' && 'text-status-warning',
        (tone === 'neutral' || tone === 'active' || tone === 'success') && 'text-fg-muted',
      )}
    >
      {terminalLabel === 'Failed' ? (
        <AlertTriangle className="size-4 shrink-0 text-status-error" />
      ) : terminalLabel === 'Cancelled' || terminalLabel === 'Interrupted' || isCancelling ? (
        <XCircle className="size-4 shrink-0 text-fg-muted" />
      ) : terminalLabel === 'Completed' ? (
        <CheckCircle2 className="size-4 shrink-0 text-status-success" />
      ) : isUnknown ? (
        <HelpCircle className="size-4 shrink-0 text-fg-muted" />
      ) : attention ? (
        <AlertTriangle className="size-4 shrink-0 text-status-attention" />
      ) : (
        <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" />
      )}
      <span className="min-w-0 flex-1 truncate">
        Work · {count} {count === 1 ? 'action' : 'actions'} · {statusLabel}
      </span>
      {expanded ? (
        <ChevronDown className="size-4 shrink-0 text-fg-muted" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-fg-muted" />
      )}
    </button>
  );
});
