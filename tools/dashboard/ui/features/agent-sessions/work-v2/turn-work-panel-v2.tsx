import { useCallback, useState } from 'react';
import { WorkIndicatorV2, WorkCurrentActivityLineV2 } from './work-indicator-v2';
import { WorkTimelineV2 } from './work-timeline-v2';
import { WorkDetailsSheetV2 } from './work-details-sheet-v2';
import { PendingInteractionViewV2 } from './pending-interaction-view-v2';
import { FinalAnswerViewV2 } from './final-answer-view-v2';
import type { CanonicalTurnV2, ToolInvocationWorkItemV2 } from '../types';

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
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const openDetailsForTool = useCallback((item: ToolInvocationWorkItemV2) => {
    setSelectedToolId(item.id);
    setDetailsOpen(true);
  }, []);

  const openDetailsOverview = useCallback(() => {
    setSelectedToolId(null);
    setDetailsOpen(true);
  }, []);

  const isTerminal = turn.status.status === 'terminal';

  return (
    <div className="my-1.5 w-full min-w-0 max-w-full space-y-1.5">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <WorkIndicatorV2 turn={turn} expanded={expanded} onToggle={toggleExpanded} />
        </div>
        {turn.activityCount > 0 && (
          <button
            type="button"
            onClick={openDetailsOverview}
            className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-[var(--muted)] hover:bg-white/4 hover:text-[var(--foreground)]"
          >
            Szczegóły
          </button>
        )}
      </div>

      {expanded && (
        <WorkTimelineV2 historicalWork={turn.historicalWork} onSelectTool={openDetailsForTool} />
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
        initialToolId={selectedToolId}
      />
    </div>
  );
}
