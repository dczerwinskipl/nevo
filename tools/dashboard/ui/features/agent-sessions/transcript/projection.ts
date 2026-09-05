import type { AgentToolCall, TurnActivityItem, NormalizedMessage } from '../types';

/**
 * A single transcript entry (user/assistant/system text). One-to-one with a
 * `NormalizedMessage` today — transcript rendering (Task 02) does not need Work's
 * tool-call detail, so it gets its own narrower shape.
 */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  activityTimeline?: TurnActivityItem[];
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

export type PresentationSeverity = 'normal' | 'warning' | 'error';

export function isGenuineTurnError(turnError?: { code: string; message: string } | null): boolean {
  if (!turnError || !turnError.code) return false;
  // Explicit user cancellation is an intentional lifecycle termination, not an application/turn error
  if (turnError.code === 'AI_TURN_CANCELLED') return false;
  return true;
}

export function computePresentationSeverity(
  items: WorkItem[],
  turnError?: { code: string; message: string } | null,
): PresentationSeverity {
  if (isGenuineTurnError(turnError)) {
    return 'error';
  }
  if (items.some((item) => item.status === 'failed')) {
    return 'warning';
  }
  return 'normal';
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
   * determined by genuine turn-level failure (isGenuineTurnError).
   */
  status: WorkGroupStatus;
  /**
   * Presentation severity: 'error' if genuine turn failure, 'warning' if individual tool
   * failed, 'normal' otherwise. Centralized source of truth for UI severity styling.
   */
  severity: PresentationSeverity;
  /**
   * Whether this Work group requires user attention (severity !== 'normal').
   */
  hasFailures: boolean;
  items: WorkItem[];
  /**
   * The single most-recently-started running tool call in this turn, or null if no
   * action is currently running in this turn.
   */
  currentActivity: WorkItem | null;
  /**
   * The turn's raw terminal error, present only when it ended via `turn.failed`
   * (owner-decisions.md D6/D9). Not yet classified into the Turn/Work Outcome
   * vocabulary (`successful | failed | cancelled/interrupted`) — that mapping from
   * `error.code` is Task 09's job, kept out of this projection per D9's own scope split.
   */
  turnError?: { code: string; message: string };
}

/**
 * Determines the single most-recently-started running tool call in a list of items,
 * or null if no item is currently running.
 */
export function currentRunningActivity(items: WorkItem[]): WorkItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].status === 'running') {
      return items[i];
    }
  }
  return null;
}

export interface TranscriptProjection {
  entries: TranscriptEntry[];
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
  return isActiveTurn || items.some((item) => item.status === 'running') ? 'current' : 'terminal';
}

/**
 * Pure, deterministic projection from the session's already-fetched `NormalizedMessage[]`
 * into transcript entries and per-turn Work groups (owner-decisions.md D6/D7/D9).
 *
 * Turn/message correlation (D7) and turn outcome (D6/D9) both come from the explicit
 * `turnId`/`turnError` fields on `NormalizedMessage`. A single turn may legitimately
 * produce multiple `NormalizedMessage` records when the provider emits distinct
 * `messageId`s for different content segments — the projection aggregates all messages
 * sharing a `turnId` into exactly **one** `TurnWork`, never one per message.
 *
 * `TurnWork.messageId` is the "anchor" — the ID of the first message in transcript
 * order for that turn that carries tool calls or a `turnError`. The anchor determines
 * where the single Work summary is rendered in the transcript; other messages for the
 * same turn render only prose.
 *
 * `activeTurnId` (the session's current in-flight turn, if any) is the only extra input
 * needed beyond the message list itself — it is what distinguishes a Work group that is
 * still running from one that has already reached a terminal state.
 */
export function projectTranscript(
  messages: NormalizedMessage[],
  { activeTurnId = null }: { activeTurnId?: string | null } = {},
): TranscriptProjection {
  const entries: TranscriptEntry[] = messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    ...(message.activityTimeline === undefined ? {} : { activityTimeline: message.activityTimeline }),
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    createdAt: message.createdAt,
  }));

  // Aggregate all messages sharing a turnId into a single TurnWork — one per turn,
  // never one per message. The anchor is the first message in transcript order that
  // has tool calls or a turnError; that message's `id` is what TurnWork.messageId
  // records so the rendering layer can place Work exactly once.
  const turnWorkMap = new Map<
    string,
    {
      anchorMessageId: string;
      items: WorkItem[];
      turnError: { code: string; message: string } | undefined;
      isActiveTurn: boolean;
    }
  >();

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.turnId) continue;
    const items: WorkItem[] = (message.toolCalls ?? []).map((call) => ({
      toolId: call.id,
      toolName: call.name,
      input: call.input,
      ...(call.output === undefined ? {} : { output: call.output }),
      status: call.status,
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
    }));
    const hasTurnContent = items.length > 0 || Boolean(message.turnError);
    const existing = turnWorkMap.get(message.turnId);
    if (existing) {
      // Merge additional tool calls from later messages for the same turn.
      existing.items.push(...items);
      // If a turnError arrives on a later message in the same turn, adopt it.
      if (message.turnError && !existing.turnError) {
        existing.turnError = message.turnError;
      }
    } else if (hasTurnContent) {
      // First message for this turn that has Work content — becomes the anchor.
      turnWorkMap.set(message.turnId, {
        anchorMessageId: message.id,
        items,
        turnError: message.turnError,
        isActiveTurn: message.turnId === activeTurnId,
      });
    }
  }

  const workByTurn: TurnWork[] = [];
  for (const [turnId, { anchorMessageId, items, turnError, isActiveTurn }] of turnWorkMap) {
    const lifecycle = computeWorkLifecycle(items, isActiveTurn);
    const severity = computePresentationSeverity(items, turnError);
    const hasFailures = severity !== 'normal';
    const currentActivity = currentRunningActivity(items);
    workByTurn.push({
      turnId,
      messageId: anchorMessageId,
      status: lifecycle === 'current' ? 'current' : isGenuineTurnError(turnError) ? 'failed' : 'completed',
      severity,
      hasFailures,
      items,
      currentActivity,
      ...(turnError === undefined ? {} : { turnError }),
    });
  }

  let currentActivity: WorkItem | null = null;
  for (let i = workByTurn.length - 1; i >= 0; i -= 1) {
    if (workByTurn[i].currentActivity) {
      currentActivity = workByTurn[i].currentActivity;
      break;
    }
  }

  let turnOutcome: TranscriptProjection['turnOutcome'] = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.turnId || message.turnId === activeTurnId) continue;
    // Find the Work entry for this turn to get its error state.
    const turnWork = turnWorkMap.get(message.turnId);
    turnOutcome = { turnId: message.turnId, turnError: turnWork?.turnError ?? message.turnError ?? null };
    break;
  }

  return { entries, workByTurn, currentActivity, turnOutcome };
}
