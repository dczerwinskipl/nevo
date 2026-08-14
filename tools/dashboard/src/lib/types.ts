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

export interface SpecificationDocument {
  id: string;
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

export interface SpecificationContent {
  id: string;
  slug: string;
  title: string;
  source: 'active' | 'archive';
  path: string | null;
  overview: SpecificationDocument;
  areas: SpecificationDocument[];
  tasks: SpecificationTaskDocument[];
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
  author: { login: string; url: string | null; avatarUrl: string | null } | null;
  head: PullRequestBranch;
  base: PullRequestBranch;
  stats: { additions: number; deletions: number; changedFiles: number; commits: number };
  files: PullRequestFile[];
  filesComplete: boolean;
  fullDiff: string;
  fullDiffAvailable: boolean;
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
