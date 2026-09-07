import type { AvailablePullRequest, PullRequestResult } from '../types';
import { statusSurfaceTone, type StatusTone } from '@/shared/status-tone';

export function stateLabel(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'Draft';
  if (pullRequest.state === 'merged') return 'Merged';
  if (pullRequest.state === 'closed') return 'Closed';
  return 'Open';
}

export function prStateTone(pullRequest: AvailablePullRequest): StatusTone {
  if (pullRequest.draft) return 'neutral';
  if (pullRequest.state === 'merged') return 'success';
  if (pullRequest.state === 'closed') return 'neutral';
  return 'active';
}

export function stateTone(pullRequest: AvailablePullRequest): string {
  return statusSurfaceTone({ tone: prStateTone(pullRequest) });
}

export function pullRequestKey(result: PullRequestResult) {
  const { provider, baseUrl, repository, number } = result.reference;
  return `${provider}:${baseUrl}:${repository}:${number}`;
}
