export type AgentSessionStatus = 'idle' | 'running' | 'waitingForUser';

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
}
