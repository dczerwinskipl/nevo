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

export interface PathGlobRule {
  name?: string;
  paths: string[];
  fallback?: boolean;
}

export interface ChangeViewConfig {
  groups: PathGlobRule[];
}

export interface GeneratedFilesConfig {
  rules: PathGlobRule[];
  lockfiles?: string[];
}

export interface PullRequestFilesPayload {
  number: number;
  files: PullRequestFileManifestEntry[];
  // Per-project config, delivered here rather than bundled at build time
  // (area changes-grouping-and-filtering — must work for a consumer repo
  // other than NEvo).
  changeView: ChangeViewConfig;
  generatedFiles: GeneratedFilesConfig;
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
