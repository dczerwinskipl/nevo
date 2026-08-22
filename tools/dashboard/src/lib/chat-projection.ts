import type { AgentToolCall, NormalizedMessage } from './types';

/**
 * A single conversational entry (user/assistant/system text). One-to-one with a
 * `NormalizedMessage` today — Conversation rendering (Task 02) does not need Work's
 * tool-call detail, so it gets its own narrower shape.
 */
export interface ConversationEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  turnId?: string;
  createdAt: string;
}

export type WorkGroupStatus = 'current' | 'completed' | 'failed';

/**
 * Raw technical tool-call detail (toolName, input, output, duration, status) —
 * normalization into a human-readable label is deferred to Task 04, not this
 * projection's job (owner-decisions.md).
 */
export interface WorkItem {
  toolId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: AgentToolCall['status'];
  durationMs?: number;
}

export interface TurnWork {
  turnId: string;
  messageId: string;
  /**
   * Lifecycle-first status: `'current'` whenever the turn itself has not reached a
   * terminal state (it is still the active turn, or some item is still `'running'`),
   * regardless of whether an earlier action in it already failed — an active turn can
   * legitimately contain a failed historical action (e.g. `Read failed`, `Bash
   * completed`, `Edit running`) and must stay `'current'` while it does. Only once the
   * turn itself is terminal does this fall through to `'failed'`/`'completed'`,
   * determined by `hasFailures`. This is a deliberately narrow, three-value status
   * field, not a larger state-machine abstraction — see `hasFailures` for the
   * orthogonal "does this Work need attention" signal.
   */
  status: WorkGroupStatus;
  /**
   * Whether any individual action in this turn — at any point, including while the
   * turn is still `'current'` — ended `'failed'`, or the turn itself carries a
   * `turnError`. Independent of `status`'s lifecycle meaning: a `'current'` turn can
   * have `hasFailures: true` (an earlier action failed, but the turn is still running)
   * just as validly as a terminal one.
   */
  hasFailures: boolean;
  items: WorkItem[];
  /**
   * The turn's raw terminal error, present only when it ended via `turn.failed`
   * (owner-decisions.md D6/D9). Not yet classified into the Turn/Work Outcome
   * vocabulary (`successful | failed | cancelled/interrupted`) — that mapping from
   * `error.code` is Task 09's job, kept out of this projection per D9's own scope split.
   */
  turnError?: { code: string; message: string };
}

export interface ChatProjection {
  conversation: ConversationEntry[];
  workByTurn: TurnWork[];
  /** The single most-recently-started running tool call across all turns, or null if nothing is currently running. */
  currentActivity: WorkItem | null;
  /**
   * The most recently produced non-active turn's raw outcome — `turnError: null` means
   * it ended via `turn.completed` (success); a non-null `turnError` carries the raw
   * `error.code`/`message` from `turn.failed`. `null` overall when there is no prior
   * turn yet. Unclassified, same reasoning as `TurnWork.turnError` above.
   */
  turnOutcome: { turnId: string; turnError: { code: string; message: string } | null } | null;
}

/**
 * Lifecycle is checked before outcome, deliberately: whether this turn is still
 * `'current'` depends only on whether it has actually terminated (the session's
 * `activeTurnId` still names it, or some item is still `'running'`) — never on whether
 * an earlier action in it happened to fail. Checking failure first would make a single
 * failed historical action prematurely terminate an otherwise still-active turn's Work
 * group, which is exactly the bug this ordering avoids.
 */
function computeWorkLifecycle(items: WorkItem[], isActiveTurn: boolean): 'current' | 'terminal' {
  return isActiveTurn || items.some(item => item.status === 'running') ? 'current' : 'terminal';
}

function computeHasFailures(items: WorkItem[], turnError: { code: string; message: string } | undefined): boolean {
  return Boolean(turnError) || items.some(item => item.status === 'failed');
}

/**
 * Pure, deterministic projection from the session's already-fetched `NormalizedMessage[]`
 * into Conversation entries and per-turn Work groups (owner-decisions.md D6/D7/D9).
 *
 * Turn/message correlation (D7) and turn outcome (D6/D9) both come from the explicit
 * `turnId`/`turnError` fields on `NormalizedMessage` — never from parsing message text
 * or `id`'s naming convention. Each assistant message already corresponds to exactly one
 * turn (verified: neither the Claude nor the Antigravity adapter ever emits an explicit
 * `messageId`, so every content/tool event within one turn resolves to the same
 * `turnId`-keyed message — see `tools/tests/chat-projection.test.mjs` for the fixture
 * proving this holds for a multi-tool-call turn).
 *
 * `activeTurnId` (the session's current in-flight turn, if any) is the only extra input
 * needed beyond the message list itself — it is what distinguishes a Work group that is
 * still running from one that has already reached a terminal state.
 */
export function projectChat(
  messages: NormalizedMessage[],
  { activeTurnId = null }: { activeTurnId?: string | null } = {},
): ChatProjection {
  const conversation: ConversationEntry[] = messages.map(message => ({
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    createdAt: message.createdAt,
  }));

  const workByTurn: TurnWork[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.turnId) continue;
    const items: WorkItem[] = (message.toolCalls ?? []).map(call => ({
      toolId: call.id,
      toolName: call.name,
      input: call.input,
      ...(call.output === undefined ? {} : { output: call.output }),
      status: call.status,
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
    }));
    // A turn with no tool calls and no error has no Work to show — plain conversational
    // text stays represented in `conversation` only.
    if (items.length === 0 && !message.turnError) continue;
    const isActiveTurn = message.turnId === activeTurnId;
    const lifecycle = computeWorkLifecycle(items, isActiveTurn);
    const hasFailures = computeHasFailures(items, message.turnError);
    workByTurn.push({
      turnId: message.turnId,
      messageId: message.id,
      status: lifecycle === 'current' ? 'current' : (hasFailures ? 'failed' : 'completed'),
      hasFailures,
      items,
      ...(message.turnError === undefined ? {} : { turnError: message.turnError }),
    });
  }

  let currentActivity: WorkItem | null = null;
  for (const turn of workByTurn) {
    const running = turn.items.find(item => item.status === 'running');
    if (running) currentActivity = running;
  }

  let turnOutcome: ChatProjection['turnOutcome'] = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.turnId || message.turnId === activeTurnId) continue;
    turnOutcome = { turnId: message.turnId, turnError: message.turnError ?? null };
    break;
  }

  return { conversation, workByTurn, currentActivity, turnOutcome };
}
