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
