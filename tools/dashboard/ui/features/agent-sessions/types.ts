export type AgentSessionStatus = 'idle' | 'running' | 'waitingForUser';

export type LiveConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'unknown';

export type AgentExecutionMode = 'ask' | 'edit' | 'agent';

export interface AgentCapabilities {
  interactivePermissions: boolean;
  interactiveQuestions: boolean;
  interactiveConfirmations: boolean;
  resumeSession: boolean;
  cancelTurn: boolean;
  toolCalls: boolean;
  reasoning: boolean;
  usage: boolean;
  steerTurn: boolean;
  planUpdates: boolean;
}

export interface AgentProviderDescriptor {
  id: string;
  label: string;
  enabled: boolean;
  available?: boolean;
  unavailableReason?: string;
  capabilities: AgentCapabilities;
  supportedModes?: AgentExecutionMode[];
  defaultMode?: AgentExecutionMode;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export type TurnActivityItem =
  | { id: string; type: 'commentary'; text: string; timestamp?: string }
  | { id: string; type: 'tool'; toolCall: AgentToolCall }
  | { id: string; type: 'interaction'; interaction: NonNullable<NormalizedMessage['interaction']> };

export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  /** Schema placeholder for future provider-neutral timeline interleaved segments. Currently unmapped pending real provider capture analysis. */
  activityTimeline?: TurnActivityItem[];
  /**
   * The turn this message belongs to (owner-decisions.md D7). Assistant messages are
   * created one-per-turn and always carry it; explicit rather than recoverable only by
   * parsing `id`'s naming convention.
   */
  turnId?: string;
  /**
   * The owning turn's terminal error, when it ended via `turn.failed` (owner-decisions.md
   * D6/D9) — the raw `error.code`/`message`, not yet classified into the Turn/Work
   * Outcome vocabulary (`successful | failed | cancelled/interrupted`, Task 09's job).
   */
  turnError?: { code: string; message: string };
  toolCalls?: AgentToolCall[];
  interaction?: {
    id: string;
    kind: string;
    resumePolicy: 'restart' | 'live-operation';
    payload?: unknown;
    toolName?: string;
    input?: unknown;
    details?: string;
    questions?: AgentQuestion[];
    response?: unknown;
  };
  createdAt: string;
}

export interface TaskNavigationTarget {
  taskId: string;
  specSlug?: string | null;
}

export interface AgentSession {
  provider: string;
  providerSessionId: string;
  sessionId: string;
  specId: string | null;
  taskId?: string;
  taskIds: string[];
  purpose?: string;
  mode?: AgentExecutionMode;
  title?: string;
  status: AgentSessionStatus;
  createdAt: string;
  lastActivityAt?: string;
  lastSeenAt?: string;
  completedAt?: string;
  capabilities: AgentCapabilities;
}

export interface AgentSessionSnapshot extends AgentSession {
  activeTurn?: { turnId: string; startedAt: string; status?: string } | null;
  pendingInteraction?: AgentInteraction | null;
  messages: NormalizedMessage[];
  turns?: CanonicalTurnV2[];
  lastEventSeq: number;
  updatedAt: string;
}

export interface AgentProvidersPayload {
  providers: AgentProviderDescriptor[];
  access: { mode: 'trusted-network'; identityAuthenticated: false };
}

export interface AgentSessionsPayload {
  sessions: AgentSession[];
}

export interface AgentPermissionInteraction {
  id: string;
  kind: 'permission';
  resumePolicy: 'restart' | 'live-operation';
  toolName: string;
  input?: Record<string, unknown>;
  details?: string;
}

export interface AgentQuestion {
  id: string;
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
}

export interface AgentQuestionInteraction {
  id: string;
  kind: 'question';
  resumePolicy: 'restart' | 'live-operation';
  questions: AgentQuestion[];
}

export type AgentInteraction = AgentPermissionInteraction | AgentQuestionInteraction | {
  id: string;
  kind: string;
  resumePolicy: 'restart' | 'live-operation';
  payload?: unknown;
  [key: string]: unknown;
};

// --- V2 canonical Work model (task 11, temporary "V2" naming per owner-decisions.md D17) ---
// Mirrors the server wire contract exactly (tools/dashboard/server/ai/model/*.mjs,
// sessions/service.mjs). The browser never derives these shapes itself — only formats them.

export type TurnStatusV2 =
  | { status: 'active'; detail: 'startup' | 'processing' | 'commentary' | 'reasoning' | 'tool_execution'; subjectId?: string; since: string; source: string }
  | { status: 'waiting'; reason: 'provider_response' | 'tool_result'; subjectId?: string; since: string; source: string }
  | { status: 'requiresAttention'; reason: 'permission' | 'question' | 'confirmation'; interactionId: string; since: string; source: string }
  | { status: 'cancelling'; initiator: string; requestedAt: string; since: string; source: string }
  | {
      status: 'terminal';
      outcome: 'completed' | 'failed' | 'cancelled' | 'interrupted';
      initiator: string;
      cause?: string;
      finishReason?: string;
      error?: { code: string; message: string };
      since: string;
      source: string;
    }
  | { status: 'unknown'; reason: string; since: string; source: string };

export type ToolKindV2 = 'read' | 'edit' | 'write' | 'list' | 'search' | 'command' | 'test' | 'web' | 'other';
export type ToolStatusV2 = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type ToolActionKindV2 = 'read' | 'write' | 'edit' | 'search' | 'list' | 'execute' | 'fetch' | 'other';
export type ToolActionStatusV2 = 'active' | 'completed' | 'failed';
export type ToolClosureReasonV2 =
  | 'turn_cancelled'
  | 'turn_failed'
  | 'turn_interrupted'
  | 'turn_completed'
  | 'process_exit'
  | 'timeout'
  | 'unknown';

export interface ToolActionV2 {
  id: string;
  seq: number;
  kind: ToolActionKindV2;
  title: string;
  description?: string;
  target?: string;
  status?: ToolActionStatusV2;
  startedAt?: string;
  completedAt?: string;
}

interface WorkItemV2Base {
  id: string;
  seq: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentaryWorkItemV2 extends WorkItemV2Base {
  type: 'commentary';
  text: string;
  status: 'streaming' | 'completed';
  confidence?: string;
  completedAt?: string;
}

export interface ReasoningWorkItemV2 extends WorkItemV2Base {
  type: 'reasoning';
  representation: 'summary' | 'raw_text' | 'provider_defined';
  text: string;
  status: 'streaming' | 'completed';
  confidence?: string;
  completedAt?: string;
}

export interface ToolInvocationWorkItemV2 extends WorkItemV2Base {
  type: 'tool';
  toolName: string;
  kind: ToolKindV2;
  title: string;
  status: ToolStatusV2;
  actions: ToolActionV2[];
  subject?: string;
  description?: string;
  input?: unknown;
  output?: unknown;
  exitCode?: number;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  closureReason?: ToolClosureReasonV2;
  progress?: string;
  confidence?: string;
}

export interface InteractionWorkItemV2 extends WorkItemV2Base {
  type: 'interaction';
  interaction: AgentInteraction;
  status: 'pending' | 'resolved' | 'denied' | 'rejected' | 'cancelled' | 'expired';
  response?: unknown;
  resolvedAt?: string;
}

export type WorkItemV2 = CommentaryWorkItemV2 | ReasoningWorkItemV2 | ToolInvocationWorkItemV2 | InteractionWorkItemV2;

export interface FinalAnswerV2 {
  id: string;
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'absent';
  confidence?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type CurrentActivityKindV2 =
  | 'requires_attention'
  | 'tool'
  | 'thinking'
  | 'commentary'
  | 'waiting_for_tool'
  | 'cancelling'
  | 'waiting_for_model';

export interface CurrentActivityV2 {
  kind: CurrentActivityKindV2;
  subjectId?: string;
  title: string;
  subject?: string;
  description?: string;
  text?: string;
  toolKind?: ToolKindV2;
  toolName?: string;
  status?: string;
  activeCount?: number;
  startedAt: string;
}

export interface CanonicalTurnV2 {
  id: string;
  turnId: string;
  sessionId: string | null;
  provider: string;
  providerSessionId: string | null;
  mode: AgentExecutionMode;
  status: TurnStatusV2;
  work: WorkItemV2[];
  /** Historical timeline items only — excludes the item(s) currently projected as `currentActivity` (server-derived, HTTP-only). */
  historicalWork: WorkItemV2[];
  activityCount: number;
  currentActivity: CurrentActivityV2 | null;
  finalAnswer: FinalAnswerV2 | null;
  /** The user-visible chat message — never the enriched/injected `prompt`. The sole authoritative source for the turn's chat bubble, live or reloaded. */
  userMessage?: { text: string; createdAt: string };
  terminalOutcome?: {
    outcome: string;
    initiator: string;
    cause?: string;
    finishReason?: string;
    error?: { code: string; message: string };
    completedAt: string;
  };
  usage?: { tokensIn?: number; tokensOut?: number; cost?: number };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type WorkSummaryStatusV2 = 'idle' | 'running' | 'waitingForUser' | 'completed' | 'failed';

export interface WorkSummaryV2 {
  status: WorkSummaryStatusV2;
  activityCount: number;
  currentActivity: CurrentActivityV2 | null;
  activeToolCount: number;
  attention: { required: boolean; kind: string; interactionId: string; title: string } | null;
  expandable: boolean;
}

export type SessionReadinessStatusV2 = 'ready' | 'busy' | 'requiresAttention' | 'readOnly' | 'unavailable';

export interface SessionReadinessV2 {
  status: SessionReadinessStatusV2;
  reason: string;
  details?: Record<string, unknown>;
}

export interface AgentSessionChatV2Payload {
  session: {
    provider: string;
    providerSessionId: string;
    sessionId: string;
    status: AgentSessionStatus | 'unavailable';
    readiness: SessionReadinessV2;
    mode: AgentExecutionMode;
    capabilities: AgentCapabilities;
    specId: string | null;
    taskId?: string;
    taskIds: string[];
    title?: string;
    createdAt: string;
    lastActivityAt?: string;
    /** Authoritative SSE replay cursor for this snapshot — subscribe with `after=lastEventSeq`, never 0, or historical events replay visibly. */
    lastEventSeq?: number;
  };
  turns: CanonicalTurnV2[];
  workSummary: WorkSummaryV2;
  readiness: SessionReadinessV2;
}

export interface AgentEvent {
  id: number;
  seq: number;
  type: string;
  turnId?: string;
  timestamp: string;
  messageId?: string;
  progressId?: string;
  text?: string;
  delta?: string;
  toolId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  interaction?: AgentInteraction;
  interactionId?: string;
  response?: unknown;
  finishReason?: string;
  userPrompt?: string;
  userMessage?: { id?: string; role?: string; text?: string; createdAt?: string };
  error?: { code: string; message: string };
  /** `turn.updated` payload — the full canonical Turn snapshot (V2 semantic model). */
  turn?: CanonicalTurnV2;
}
