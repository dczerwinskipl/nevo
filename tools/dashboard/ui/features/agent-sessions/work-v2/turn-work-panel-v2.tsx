import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { WorkIndicatorV2, WorkCurrentActivityLineV2 } from './work-indicator-v2';
import { WorkTimelineV2 } from './work-timeline-v2';
import { WorkDetailsSheetV2 } from './work-details-sheet-v2';
import { PendingInteractionViewV2 } from './pending-interaction-view-v2';
import { FinalAnswerViewV2 } from './final-answer-view-v2';
import type { CanonicalTurnV2, WorkItemV2 } from '../types';

export interface TurnWorkPanelV2Props {
  turn: CanonicalTurnV2;
  onRespondInteraction: (interactionId: string, response: unknown) => void;
}

/**
 * Composes the three Work UX levels for one Turn (task 11 /
 * areas/work-ux-presentation.md). Owns only local expand/collapse and Work Details
 * open/selected-tool state — all semantic data is the server projection, unmodified.
 * FinalAnswer renders after Work, never inside it (§ "Final answer").
 */
export function TurnWorkPanelV2({ turn, onRespondInteraction }: TurnWorkPanelV2Props) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const openDetailsForItem = useCallback((item: WorkItemV2) => {
    setSelectedItemId(item.id);
    setDetailsOpen(true);
  }, []);

  const openDetailsOverview = useCallback(() => {
    setSelectedItemId(null);
    setDetailsOpen(true);
  }, []);

  const isTerminal = turn.status.status === 'terminal';

  return (
    <div className="my-1.5 w-full max-w-full min-w-0 space-y-1.5">
      {/*
        Level 1 — the Work header indicator is the single, full-width expand/collapse toggle.
        Level 3 (Work Details) is accessed by selecting any row in Level 2 or via the bottom-right Details action.
      */}
      <WorkIndicatorV2 turn={turn} expanded={expanded} onToggle={toggleExpanded} />

      {expanded ? (
        <div className="flex w-full min-w-0 items-end justify-between gap-2 pl-1">
          {/* Column 1: Timeline occupying almost all free space */}
          <div className="relative min-w-0 flex-1">
            <div
              className="absolute top-2 bottom-2 left-[18px] w-px -translate-x-1/2 bg-[var(--border)]"
              aria-hidden="true"
            />
            <div className="relative flex flex-col gap-0.5">
              <WorkTimelineV2 historicalWork={turn.historicalWork} onSelectItem={openDetailsForItem} embedded />
              {!isTerminal && <WorkCurrentActivityLineV2 turn={turn} embedded />}
            </div>
          </div>

          {/* Column 2: Details button on the right, width as needed, aligned to bottom */}
          {turn.activityCount > 0 && (
            <div className="shrink-0 self-end pr-0.5 pb-0.5">
              <button
                type="button"
                onClick={openDetailsOverview}
                aria-label="Details"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-[var(--muted)] transition-colors hover:bg-white/4 hover:text-[var(--foreground)]"
              >
                <Search className="size-3" />
                <span>Details</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        !isTerminal && (
          <div className="pl-1">
            <WorkCurrentActivityLineV2 turn={turn} />
          </div>
        )
      )}

      <PendingInteractionViewV2 turn={turn} onRespond={onRespondInteraction} />

      <FinalAnswerViewV2 finalAnswer={turn.finalAnswer} />

      <WorkDetailsSheetV2 turn={turn} open={detailsOpen} onOpenChange={setDetailsOpen} initialItemId={selectedItemId} />
    </div>
  );
}
