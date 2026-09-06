import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { WorkIndicator, WorkCurrentActivityLine } from './work-indicator';
import { WorkTimeline } from './work-timeline';
import { WorkDetailsSheet } from './work-details-sheet';
import { PendingInteractionView } from './pending-interaction-view';
import { FinalAnswerView } from './final-answer-view';
import type { CanonicalTurn, WorkItem } from '../types';

export interface TurnWorkPanelProps {
  turn: CanonicalTurn;
  onRespondInteraction: (interactionId: string, response: unknown) => void;
}

/**
 * Composes the three Work UX levels for one Turn (task 11 /
 * areas/work-ux-presentation.md). Owns only local expand/collapse and Work Details
 * open/selected-tool state — all semantic data is the server projection, unmodified.
 * FinalAnswer renders after Work, never inside it (§ "Final answer").
 */
export function TurnWorkPanel({ turn, onRespondInteraction }: TurnWorkPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const openDetailsForItem = useCallback((item: WorkItem) => {
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
      <WorkIndicator turn={turn} expanded={expanded} onToggle={toggleExpanded} />

      {expanded ? (
        <div className="flex w-full min-w-0 items-end justify-between gap-2 pl-1">
          {/* Column 1: Timeline occupying almost all free space */}
          <div className="relative min-w-0 flex-1">
            <div className="absolute top-2 bottom-2 left-[18px] w-px -translate-x-1/2 bg-border" aria-hidden="true" />
            <div className="relative flex flex-col gap-0.5">
              <WorkTimeline historicalWork={turn.historicalWork} onSelectItem={openDetailsForItem} embedded />
              {!isTerminal && <WorkCurrentActivityLine turn={turn} embedded />}
            </div>
          </div>

          {/* Column 2: Details button on the right, width as needed, aligned to bottom */}
          {turn.activityCount > 0 && (
            <div className="shrink-0 self-end pr-0.5 pb-0.5">
              <button
                type="button"
                onClick={openDetailsOverview}
                aria-label="Details"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-fg-muted transition-colors hover:bg-fg-primary/4 hover:text-fg-primary"
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
            <WorkCurrentActivityLine turn={turn} />
          </div>
        )
      )}

      <PendingInteractionView turn={turn} onRespond={onRespondInteraction} />

      <FinalAnswerView finalAnswer={turn.finalAnswer} />

      <WorkDetailsSheet
        turn={turn}
        open={detailsOpen}
        onOpenChange={(next) => {
          setDetailsOpen(next);
          if (!next) setSelectedItemId(null);
        }}
        selectedItemId={selectedItemId}
        onSelectItemId={setSelectedItemId}
      />
    </div>
  );
}
