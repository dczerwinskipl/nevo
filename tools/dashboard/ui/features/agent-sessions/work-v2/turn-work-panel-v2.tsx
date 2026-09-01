import { useCallback, useState } from 'react';
import { Info } from 'lucide-react';
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
    <div className="my-1.5 w-full min-w-0 max-w-full space-y-1.5">
      {/*
        Interaction ownership (corrected direction): the Work header row is the primary
        expand/collapse target (its own button, including the chevron) — it must stay
        visually dominant. Details is a small, icon-only secondary action beside it that
        never toggles Level 2 (separate sibling button, no shared click handler).
      */}
      <div className="flex items-center gap-0.5">
        <div className="min-w-0 flex-1">
          <WorkIndicatorV2 turn={turn} expanded={expanded} onToggle={toggleExpanded} />
        </div>
        {turn.activityCount > 0 && (
          <button
            type="button"
            onClick={openDetailsOverview}
            aria-label="Szczegóły Work"
            title="Szczegóły Work"
            className="shrink-0 rounded p-1.5 text-[var(--muted)] hover:bg-white/4 hover:text-[var(--foreground)]"
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <WorkTimelineV2 historicalWork={turn.historicalWork} onSelectItem={openDetailsForItem} />
      )}

      {!isTerminal && (
        <div className="pl-1">
          <WorkCurrentActivityLineV2 turn={turn} />
        </div>
      )}

      <PendingInteractionViewV2 turn={turn} onRespond={onRespondInteraction} />

      <FinalAnswerViewV2 finalAnswer={turn.finalAnswer} />

      <WorkDetailsSheetV2
        turn={turn}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        initialItemId={selectedItemId}
      />
    </div>
  );
}
