import { PermissionPrompt, QuestionPrompt } from '../interactions/interaction-prompt';
import type { AgentPermissionInteraction, AgentQuestionInteraction, CanonicalTurnV2, InteractionWorkItemV2 } from '../types';

export interface PendingInteractionViewV2Props {
  turn: CanonicalTurnV2;
  onRespond: (interactionId: string, response: unknown) => void;
}

/**
 * Renders the Turn's pending permission/question actionably at its chronological
 * position (areas/canonical-turn-work-model.md § "Interaction";
 * areas/chat-migration-and-validation.md § "Requires attention"). A pending Interaction
 * is the Turn's `currentActivity` while `requiresAttention` — it is excluded from
 * `historicalWork` for exactly the same no-duplicate-active-activity reason an active
 * tool is, so this renders once, here, not a second time in the timeline.
 */
export function PendingInteractionViewV2({ turn, onRespond }: PendingInteractionViewV2Props) {
  if (turn.status.status !== 'requiresAttention') return null;
  const interactionId = turn.status.interactionId;

  const item = turn.work.find(
    (w): w is InteractionWorkItemV2 => w.type === 'interaction' && w.status === 'pending' && w.id === interactionId,
  );

  if (!item) return null;

  if (item.interaction.kind === 'permission') {
    return (
      <PermissionPrompt
        interaction={item.interaction as AgentPermissionInteraction}
        onResolve={(response) => onRespond(item.id, response)}
      />
    );
  }
  if (item.interaction.kind === 'question') {
    return (
      <QuestionPrompt
        interaction={item.interaction as AgentQuestionInteraction}
        onResolve={(response) => onRespond(item.id, response)}
      />
    );
  }
  return null;
}
