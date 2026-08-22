import type { TurnWork, WorkItem } from '../../lib/chat-projection';

/**
 * Which individual actions render as inspectable `AiToolView` cards while a turn is
 * still running. The running item itself is never included here — it has its own
 * dedicated current-activity line, so expanding never duplicates it. Pure and
 * independently testable per react-component-guidelines.md §6/§16.
 */
export function visibleWorkItemsWhileRunning(work: TurnWork, expanded: boolean): WorkItem[] {
  if (!expanded) return [];
  return work.items.filter(item => item.status !== 'running');
}

/**
 * Which individual actions render as inspectable `AiToolView` cards once a turn has
 * reached a terminal state (completed/failed). A failed action stays visible even while
 * the rest of the group is collapsed (owner-decisions.md D6, FR-4). Pure and
 * independently testable per react-component-guidelines.md §6/§16.
 */
export function visibleWorkItemsWhenTerminal(work: TurnWork, expanded: boolean): WorkItem[] {
  if (expanded) return work.items;
  return work.items.filter(item => item.status === 'failed');
}
