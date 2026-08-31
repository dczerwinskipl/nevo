import type { TurnWork, WorkItem } from '../transcript/projection';
import type { NormalizedMessage } from '../types';

/**
 * Which individual actions render as inspectable `ToolCallView` cards while a turn is
 * still running. Only the selected `currentActivity` is excluded from this list (since it
 * has its own dedicated current-activity line), so expanding never duplicates the current item,
 * while other/prior running actions remain inspectable. Pure and independently testable per
 * react-component-guidelines.md §6/§16.
 */
export function visibleWorkItemsWhileRunning(work: TurnWork, expanded: boolean): WorkItem[] {
  if (!expanded) return [];
  const runningItems = work.items.filter(item => item.status === 'running');
  const current = work.currentActivity ?? (runningItems.length > 0 ? runningItems[runningItems.length - 1] : null);
  if (!current) return work.items;
  return work.items.filter(item => item.toolId !== current.toolId);
}

/**
 * Which individual actions render as inspectable `ToolCallView` cards once a turn has
 * reached a terminal state (completed/failed). Historical actions — including failed
 * ones — are only individually visible once the group is expanded; a failed action's
 * status is retained and it becomes inspectable through expansion, but it does not
 * render automatically alongside the collapsed row (owner-decisions.md, Task 03
 * correction — collapsed Work must never emit historical action cards). Pure and
 * independently testable per react-component-guidelines.md §6/§16.
 */
export function visibleWorkItemsWhenTerminal(work: TurnWork, expanded: boolean): WorkItem[] {
  if (!expanded) return [];
  return work.items;
}

/** Whether a message has any visible prose (assistant text, reasoning, or timeline commentary) to render. */
export function hasVisibleProse(message: Pick<NormalizedMessage, 'text' | 'reasoning' | 'activityTimeline'>): boolean {
  return Boolean(message.text) || Boolean(message.reasoning) || (message.activityTimeline?.some(item => item.type === 'commentary' && Boolean(item.text)) ?? false);
}

/**
 * Whether a transcript entry should render at all. A user message always renders. An
 * assistant message renders only once it has something to show — prose or Work — so a
 * turn that has only just started (no content streamed in yet) never produces an empty
 * bubble/placeholder (Finding 5/8, follow-up review of PR #35).
 */
export function shouldRenderTranscriptMessage(
  message: Pick<NormalizedMessage, 'role' | 'text' | 'reasoning' | 'activityTimeline'>,
  hasWork: boolean,
): boolean {
  if (message.role !== 'assistant') return true;
  return hasVisibleProse(message) || hasWork;
}
