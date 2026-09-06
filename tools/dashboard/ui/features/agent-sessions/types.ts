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

export interface TaskNavigationTarget {
  taskId: string;
  specSlug?: string | null;
}

export interface AgentSessionTaskRef {
  id: string;
  title?: string;
}

export type SessionReadinessStatus = 'ready' | 'busy' | 'requiresAttention' | 'readOnly' | 'unavailable';

export interface SessionReadiness {
  status: SessionReadinessStatus;
  reason: string;
  details?: Record<string, unknown>;
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
  readiness?: SessionReadiness;
  createdAt: string;
  lastActivityAt?: string;
  lastSeenAt?: string;
  completedAt?: string;
  capabilities: AgentCapabilities;
}

export interface AgentSessionSnapshot extends AgentSession {
  activeTurn?: { turnId: string; startedAt: string; status?: string } | null;
  pendingInteraction?: AgentInteraction | null;
  turns?: CanonicalTurn[];
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

export interface AgentConfirmationInteraction {
  id: string;
  kind: 'confirmation';
  resumePolicy: 'restart' | 'live-operation';
  title?: string;
  message: string;
  details?: string;
  payload?: unknown;
}

export type AgentInteraction =
  | AgentPermissionInteraction
  | AgentQuestionInteraction
  | AgentConfirmationInteraction
  | {
      id: string;
      kind: string;
      resumePolicy: 'restart' | 'live-operation';
      payload?: unknown;
      [key: string]: unknown;
    };

// --- Canonical Turn & Work model ---
// Mirrors the server wire contract exactly (tools/dashboard/server/ai/model/*.mjs,
// sessions/service.mjs). The browser never derives these shapes itself — only formats them.

export type TurnStatus =
  | {
      status: 'active';
      detail: 'startup' | 'processing' | 'commentary' | 'reasoning' | 'tool_execution';
      subjectId?: string;
      since: string;
      source: string;
    }
  | {
      status: 'waiting';
      reason: 'provider_response' | 'tool_result';
      subjectId?: string;
      since: string;
      source: string;
    }
  | {
      status: 'requiresAttention';
      reason: 'permission' | 'question' | 'confirmation';
      interactionId: string;
      since: string;
      source: string;
    }
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

export type ToolKind = 'read' | 'edit' | 'write' | 'list' | 'search' | 'command' | 'test' | 'web' | 'other';
export type ToolStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type ToolActionKind = 'read' | 'write' | 'edit' | 'search' | 'list' | 'execute' | 'fetch' | 'other';
export type ToolActionStatus = 'active' | 'completed' | 'failed';
export type ToolClosureReason =
  | 'turn_cancelled'
  | 'turn_failed'
  | 'turn_interrupted'
  | 'turn_completed'
  | 'process_exit'
  | 'timeout'
  | 'unknown';

export interface ToolAction {
  id: string;
  seq: number;
  kind: ToolActionKind;
  title: string;
  description?: string;
  target?: string;
  status?: ToolActionStatus;
  startedAt?: string;
  completedAt?: string;
}

interface WorkItemBase {
  id: string;
  seq: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentaryWorkItem extends WorkItemBase {
  type: 'commentary';
  text: string;
  status: 'streaming' | 'completed';
  confidence?: string;
  completedAt?: string;
}

export interface ReasoningWorkItem extends WorkItemBase {
  type: 'reasoning';
  representation: 'summary' | 'raw_text' | 'provider_defined';
  text: string;
  status: 'streaming' | 'completed';
  confidence?: string;
  completedAt?: string;
}

export interface ToolInvocationWorkItem extends WorkItemBase {
  type: 'tool';
  toolName: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  actions: ToolAction[];
  subject?: string;
  description?: string;
  input?: unknown;
  output?: unknown;
  exitCode?: number;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  closureReason?: ToolClosureReason;
  progress?: string;
  confidence?: string;
}

export interface InteractionWorkItem extends WorkItemBase {
  type: 'interaction';
  interaction: AgentInteraction;
  status: 'pending' | 'resolved' | 'denied' | 'rejected' | 'cancelled' | 'expired';
  response?: unknown;
  resolvedAt?: string;
}

export type WorkItem = CommentaryWorkItem | ReasoningWorkItem | ToolInvocationWorkItem | InteractionWorkItem;

export interface FinalAnswer {
  id: string;
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'absent';
  confidence?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type CurrentActivityKind =
  | 'requires_attention'
  | 'tool'
  | 'thinking'
  | 'commentary'
  | 'waiting_for_tool'
  | 'cancelling'
  | 'waiting_for_model';

export interface CurrentActivity {
  kind: CurrentActivityKind;
  subjectId?: string;
  title: string;
  subject?: string;
  description?: string;
  text?: string;
  toolKind?: ToolKind;
  toolName?: string;
  status?: string;
  activeCount?: number;
  startedAt: string;
}

export interface CanonicalTurn {
  id: string;
  turnId: string;
  sessionId: string | null;
  provider: string;
  providerSessionId: string | null;
  mode: AgentExecutionMode;
  status: TurnStatus;
  work: WorkItem[];
  /** Historical timeline items only — excludes the item(s) currently projected as `currentActivity` (server-derived, HTTP-only). */
  historicalWork: WorkItem[];
  activityCount: number;
  currentActivity: CurrentActivity | null;
  finalAnswer: FinalAnswer | null;
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

export type WorkSummaryStatus = 'idle' | 'running' | 'waitingForUser' | 'completed' | 'failed';

export interface WorkSummary {
  status: WorkSummaryStatus;
  activityCount: number;
  currentActivity: CurrentActivity | null;
  activeToolCount: number;
  attention: { required: boolean; kind: string; interactionId: string; title: string } | null;
  expandable: boolean;
}

export interface AgentSessionChatPayload {
  session: {
    provider: string;
    providerSessionId: string;
    sessionId: string;
    status: AgentSessionStatus | 'unavailable';
    readiness: SessionReadiness;
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
  turns: CanonicalTurn[];
  workSummary: WorkSummary;
  readiness: SessionReadiness;
}

export interface AgentEvent {
  id?: number;
  seq?: number;
  type: string;
  turnId?: string;
  timestamp?: string;
  /** `turn.updated` payload — the full canonical Turn snapshot. */
  turn?: CanonicalTurn;
  /** Authoritative session readiness, synchronized with turn.updated. */
  readiness?: SessionReadiness;
  error?: { code: string; message: string };
}

