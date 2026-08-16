export type StageId = 'new' | 'design' | 'ready' | 'implementation' | 'review' | 'done';

export interface DashboardTask {
  id: string;
  title: string;
  status: string;
  stage: StageId;
  order: number | null;
  dependsOn: string[];
  blockedBy: string[];
  ready: boolean;
  terminal: boolean;
  file: string | null;
}

export interface DashboardLane {
  id: StageId;
  label: string;
  shortLabel: string;
  tasks: DashboardTask[];
}

export interface DashboardChange {
  id: string;
  specId: string | null;
  slug: string;
  title: string;
  status: string;
  source: 'active' | 'archive';
  priority: number | null;
  created: string | null;
  updatedAt: string;
  path: string | null;
  overviewFile: string | null;
  summary: string;
  tasks: DashboardTask[];
  lanes: DashboardLane[];
  nextTask: DashboardTask | null;
  metrics: {
    total: number;
    actionable: number;
    completed: number;
    abandoned: number;
    inImplementation: number;
    inReview: number;
    ready: number;
    stageCounts: Record<StageId, number>;
    progress: number;
  };
}

export interface DashboardPayload {
  generatedAt: string;
  counts: { active: number; archived: number };
  active: DashboardChange[];
  archive: DashboardChange[];
}

export type SpecificationDocumentKind = 'overview' | 'area' | 'task';

// Manifest entries carry no markdown body (area dashboard-data-loading-contracts:
// "which documents exist ... but not their bodies") — only enough to render
// navigation and to resolve a full body via GET .../content/:docId.
export interface SpecificationManifestDocument {
  id: string;
  docId: string;
  kind: SpecificationDocumentKind;
  title: string;
  path: string | null;
  available: boolean;
  lastModified: string | null;
}

export interface SpecificationManifestTaskDocument extends SpecificationManifestDocument {
  kind: 'task';
  status: string;
  order: number | null;
  dependsOn: string[];
}

export interface SpecificationManifest {
  id: string;
  specId: string | null;
  slug: string;
  title: string;
  source: 'active' | 'archive';
  path: string | null;
  overview: SpecificationManifestDocument;
  areas: SpecificationManifestDocument[];
  tasks: SpecificationManifestTaskDocument[];
}

export interface SpecificationDocument {
  id: string;
  docId: string;
  kind: SpecificationDocumentKind;
  title: string;
  path: string | null;
  available: boolean;
  markdown: string;
}

export interface SpecificationTaskDocument extends SpecificationDocument {
  kind: 'task';
  status: string;
  order: number | null;
  dependsOn: string[];
}

export interface TaskStatusSummary {
  id: string;
  status: string;
  stage: StageId;
  order: number | null;
  dependsOn: string[];
  blockedBy: string[];
  ready: boolean;
  terminal: boolean;
}

export interface TaskStatusesPayload {
  id: string;
  slug: string;
  source: 'active' | 'archive';
  revision: string;
  tasks: TaskStatusSummary[];
}

export interface PullRequestReference {
  provider: string;
  baseUrl: string;
  repository: string;
  number: number;
}

export interface PullRequestBranch {
  label: string | null;
  name: string | null;
  sha: string | null;
}

// A files-manifest entry — no `patch` field at all (area
// pull-request-file-and-diff-loading: the manifest never carries diff
// content, not even an empty placeholder for it).
export interface PullRequestFileManifestEntry {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  changes: number;
}

// A file-diffs batch entry — the same shape the old bundled PR payload
// carried per file, patch included, fetched only for the requested paths.
export interface PullRequestFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
  patchAvailable: boolean;
  rawUrl: string | null;
  blobUrl: string | null;
}

export interface AvailablePullRequest {
  availability: 'available';
  reference: PullRequestReference;
  provider: string;
  providerLabel: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  mergeableState: string | null;
  author: { login: string; url: string | null; avatarUrl: string | null } | null;
  head: PullRequestBranch;
  base: PullRequestBranch;
  headSha: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  stats: { additions: number; deletions: number; changedFiles: number; commits: number };
}

export interface PullRequestFilesPayload {
  number: number;
  files: PullRequestFileManifestEntry[];
}

export interface PullRequestFileDiffsPayload {
  number: number;
  headSha: string | null;
  diffs: PullRequestFile[];
}

export interface PullRequestFullDiffPayload {
  number: number;
  diff: string;
  diffAvailable: boolean;
}

export interface UnavailablePullRequest {
  availability: 'unsupported' | 'error';
  reference: PullRequestReference;
  message: string;
}

export type PullRequestResult = AvailablePullRequest | UnavailablePullRequest;

export interface PullRequestsPayload {
  id: string;
  slug: string;
  source: 'active' | 'archive';
  pullRequests: PullRequestResult[];
}

export type SpecificationOwnerAction = 'approve' | 'verify' | 'finalize';

export interface SpecificationTaskActionGate {
  action: 'approve' | 'verify';
  enabled: boolean;
  reason: string | null;
}

export interface SpecificationWorktreeState {
  clean: boolean;
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
  files: Array<{ status: string; path: string }>;
  branch: string;
  hasUpstream: boolean;
  ahead: number | null;
  behind: number | null;
}

export interface SpecificationActionsPayload {
  id: string;
  slug: string;
  source: 'active';
  generatedAt: string;
  worktree: SpecificationWorktreeState;
  tasks: Record<string, SpecificationTaskActionGate>;
  finalize: {
    enabled: boolean;
    reason: string | null;
    checks: Array<{ name: string; passed: boolean; detail?: string }>;
    pullRequest: { number: number; state: string; isDraft: boolean; unresolvedThreads: number } | null;
  };
}

export interface SpecificationActionResult {
  ok: true;
  action: SpecificationOwnerAction;
  taskId?: string;
  message: string;
}

export type AiSessionStatus = 'running' | 'waitingForUser' | 'idle' | 'completed';

export interface AiProviderCapabilities {
  listSessions: boolean;
  sessionMetadata: boolean;
  messages: boolean;
  createSession: boolean;
  startTurn: boolean;
  streamEvents: boolean;
  resumeTurn: boolean;
  resolveInteractions: boolean;
  cancelTurn: boolean;
}

export interface AiProviderDescriptor {
  id: string;
  label: string;
  enabled: boolean;
  capabilities: AiProviderCapabilities;
}

export interface AiSession {
  specId: string;
  provider: string;
  sessionId: string;
  taskIds: string[];
  title?: string;
  status: AiSessionStatus;
  createdAt: string;
  lastActivityAt: string;
  completedAt?: string;
  capabilities: AiProviderCapabilities;
}

export interface AiProvidersPayload {
  providers: AiProviderDescriptor[];
  access: { mode: 'trusted-network'; identityAuthenticated: false };
}

export interface AiSessionsPayload {
  sessions: AiSession[];
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
}

export interface AiPermissionInteraction {
  id: string;
  kind: 'permission';
  toolName: string;
  input?: Record<string, unknown>;
  details?: string;
}

export interface AiQuestion {
  id: string;
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
}

export interface AiQuestionInteraction {
  id: string;
  kind: 'question';
  questions: AiQuestion[];
}

export type AiInteraction = AiPermissionInteraction | AiQuestionInteraction;

export interface AiTurnEvent {
  id: number;
  type: 'turn.started' | 'message.delta' | 'interaction.requested' | 'interaction.resolved' | 'turn.completed' | 'turn.failed' | 'activity';
  turnId: string;
  timestamp: string;
  messageId?: string;
  delta?: string;
  interaction?: AiInteraction;
  interactionId?: string;
  error?: { code: string; message: string };
}

export interface AiTurnSnapshot {
  turnId: string;
  provider: string;
  sessionId: string;
  status: 'running' | 'waitingForUser' | 'completed' | 'failed';
  sessionStatus: AiSessionStatus;
  startedAt: string;
  completedAt?: string;
  lastEventId: number;
  pendingInteraction: AiInteraction | null;
  events: AiTurnEvent[];
}
