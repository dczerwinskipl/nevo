import type { StageId } from '../types';

export interface LanePresentation {
  dotClassName: string;
}

export const lanePresentation: Record<StageId, LanePresentation> = {
  new: { dotClassName: 'bg-status-neutral' },
  design: { dotClassName: 'bg-workflow-design' },
  ready: { dotClassName: 'bg-status-info' },
  implementation: { dotClassName: 'bg-status-active' },
  review: { dotClassName: 'bg-status-warning' },
  done: { dotClassName: 'bg-status-success' },
};
