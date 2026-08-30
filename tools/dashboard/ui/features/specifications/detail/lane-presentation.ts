import type { StageId } from '../types';

export interface LanePresentation {
  accent: string;
}

export const lanePresentation: Record<StageId, LanePresentation> = {
  new: { accent: 'var(--lane-new)' },
  design: { accent: 'var(--lane-design)' },
  ready: { accent: 'var(--lane-ready)' },
  implementation: { accent: 'var(--lane-implementation)' },
  review: { accent: 'var(--lane-review)' },
  done: { accent: 'var(--lane-done)' },
};
