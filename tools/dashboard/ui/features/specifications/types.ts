export type StageId = 'new' | 'design' | 'ready' | 'implementation' | 'review' | 'done';

export type SpecificationSource = 'active' | 'archive';

export interface SpecificationTask {
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

export interface SpecificationLane {
  id: StageId;
  label: string;
  shortLabel: string;
  tasks: SpecificationTask[];
}

export interface SpecificationSummary {
  id: string;
  specId: string | null;
  slug: string;
  title: string;
  status: string;
  source: SpecificationSource;
  priority: number | null;
  created: string | null;
  updatedAt: string;
  path: string | null;
  overviewFile: string | null;
  summary: string;
  tasks: SpecificationTask[];
  lanes: SpecificationLane[];
  nextTask: SpecificationTask | null;
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

export interface SpecificationIndex {
  generatedAt: string;
  counts: { active: number; archived: number };
  active: SpecificationSummary[];
  archive: SpecificationSummary[];
}

export type SpecificationDocumentKind = 'overview' | 'area' | 'task' | string;

export type SpecificationSectionType = 'document' | 'directory';

export interface SpecificationManifestDocumentSection {
  id: string;
  type: 'document';
  label: string;
  icon?: string;
  template?: string;
  available: boolean;
  document: SpecificationManifestDocument | null;
}

export interface SpecificationManifestDirectorySection {
  id: string;
  type: 'directory';
  label: string;
  singularLabel?: string;
  icon?: string;
  template?: string;
  available: boolean;
  documents: SpecificationManifestDocument[];
}

export type SpecificationManifestSection = SpecificationManifestDocumentSection | SpecificationManifestDirectorySection;

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
  source: SpecificationSource;
  path: string | null;
  overview: SpecificationManifestDocument;
  areas: SpecificationManifestDocument[];
  tasks: SpecificationManifestTaskDocument[];
  sections: SpecificationManifestSection[];
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
  source: SpecificationSource;
  revision: string;
  tasks: TaskStatusSummary[];
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
  operationId: string;
  action: SpecificationOwnerAction;
  taskId?: string;
  message: string;
}
