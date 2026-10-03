import type { StageId } from '../types';
import type { StatusTone } from '@/shared/status-tone';

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

/**
 * Returns the StatusTone for a canonical deterministic TaskProjection/action DTO state.
 * Never derived from task.status or literal step names.
 */
export function deterministicStateTone(state?: string | null, outcome?: string | null): StatusTone {
  switch (state) {
    case 'active':
      return 'active';
    case 'human-interaction':
      return 'warning';
    case 'waiting-for-step-start':
      return 'info';
    case 'ready':
      return 'info';
    case 'blocked':
      return 'warning';
    case 'terminal':
      return outcome === 'failure' ? 'error' : 'success';
    case 'draft':
    default:
      return 'neutral';
  }
}

/**
 * Formats a canonical deterministic TaskProjection/action DTO state for display.
 * Never derived from formatTaskStatus(task.status) or literal step names.
 */
export function formatDeterministicState(state?: string | null, outcome?: string | null): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'human-interaction':
      return 'Human Action';
    case 'waiting-for-step-start':
      return 'Waiting';
    case 'ready':
      return 'Ready';
    case 'blocked':
      return 'Blocked';
    case 'terminal':
      return outcome === 'failure' ? 'Failed' : 'Completed';
    case 'draft':
      return 'Draft';
    default:
      return state ? String(state) : 'Draft';
  }
}
