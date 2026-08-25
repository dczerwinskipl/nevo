import type { AvailablePullRequest, PullRequestResult } from '@/lib/types';

export function stateLabel(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'Draft';
  if (pullRequest.state === 'merged') return 'Merged';
  if (pullRequest.state === 'closed') return 'Closed';
  return 'Open';
}

export function stateTone(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'border-[color-mix(in_srgb,var(--muted)_20%,transparent)] bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] text-[var(--muted-strong)]';
  if (pullRequest.state === 'merged') return 'border-violet-400/25 bg-violet-400/10 text-violet-300';
  if (pullRequest.state === 'closed') return 'border-red-400/20 bg-red-400/8 text-red-300';
  return 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]';
}

export function pullRequestKey(result: PullRequestResult) {
  const { provider, baseUrl, repository, number } = result.reference;
  return `${provider}:${baseUrl}:${repository}:${number}`;
}
