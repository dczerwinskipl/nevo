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
  status: WorkGroupStatus;
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

function computeWorkStatus(
  items: WorkItem[],
  turnError: { code: string; message: string } | undefined,
  isActiveTurn: boolean,
): WorkGroupStatus {
  if (turnError || items.some(item => item.status === 'failed')) return 'failed';
  if (isActiveTurn || items.some(item => item.status === 'running')) return 'current';
  return 'completed';
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
    workByTurn.push({
      turnId: message.turnId,
      messageId: message.id,
      status: computeWorkStatus(items, message.turnError, isActiveTurn),
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
