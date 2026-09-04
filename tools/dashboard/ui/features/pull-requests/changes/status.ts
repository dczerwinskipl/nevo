import type { AvailablePullRequest, PullRequestResult } from '../types';

export function stateLabel(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft) return 'Draft';
  if (pullRequest.state === 'merged') return 'Merged';
  if (pullRequest.state === 'closed') return 'Closed';
  return 'Open';
}

export function stateTone(pullRequest: AvailablePullRequest) {
  if (pullRequest.draft)
    return 'border-[color-mix(in_srgb,var(--muted)_20%,transparent)] bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] text-[var(--muted-strong)]';
  if (pullRequest.state === 'merged')
    return 'border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]';
  if (pullRequest.state === 'closed')
    return 'border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted-strong)]';
  return 'border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--accent)]';
}

export function pullRequestKey(result: PullRequestResult) {
  const { provider, baseUrl, repository, number } = result.reference;
  return `${provider}:${baseUrl}:${repository}:${number}`;
}
