import { getPullRequestDetails } from '../../../lib/github.mjs';

const FILE_STATUSES = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']);

function normalizedReference(reference) {
  return {
    provider: reference.provider,
    baseUrl: reference.base_url,
    repository: reference.repository,
    number: reference.number,
  };
}

function branchProjection(branch) {
  return {
    label: branch?.label || null,
    name: branch?.ref || null,
    sha: branch?.sha || null,
  };
}

function fileProjection(file) {
  const patch = typeof file.patch === 'string' ? file.patch : '';
  return {
    path: file.filename,
    previousPath: file.previous_filename || null,
    status: FILE_STATUSES.has(file.status) ? file.status : 'modified',
    additions: Number(file.additions) || 0,
    deletions: Number(file.deletions) || 0,
    changes: Number(file.changes) || 0,
    patch,
    patchAvailable: Boolean(patch),
    rawUrl: file.raw_url || null,
    blobUrl: file.blob_url || null,
  };
}

export function mapGitHubPullRequest(reference, payload) {
  const metadata = payload?.metadata || {};
  const files = Array.isArray(payload?.files) ? payload.files.map(fileProjection) : [];
  const fullDiff = typeof payload?.diff === 'string' ? payload.diff : '';
  const expectedFileCount = Number(metadata.changed_files) || 0;
  const merged = Boolean(metadata.merged_at || metadata.merged);

  return {
    availability: 'available',
    reference: normalizedReference(reference),
    provider: 'github',
    providerLabel: 'GitHub',
    number: Number(metadata.number) || reference.number,
    title: metadata.title || `Pull request #${reference.number}`,
    url: metadata.html_url || `${reference.base_url}/${reference.repository}/pull/${reference.number}`,
    state: merged ? 'merged' : (metadata.state === 'closed' ? 'closed' : 'open'),
    draft: Boolean(metadata.draft),
    author: metadata.user ? {
      login: metadata.user.login || 'unknown',
      url: metadata.user.html_url || null,
      avatarUrl: metadata.user.avatar_url || null,
    } : null,
    head: branchProjection(metadata.head),
    base: branchProjection(metadata.base),
    stats: {
      additions: Number(metadata.additions) || 0,
      deletions: Number(metadata.deletions) || 0,
      changedFiles: expectedFileCount,
      commits: Number(metadata.commits) || 0,
    },
    files,
    filesComplete: expectedFileCount === 0 || files.length >= expectedFileCount,
    fullDiff,
    fullDiffAvailable: Boolean(fullDiff.trim()),
  };
}

export function createGitHubProvider({ fetchPullRequest = getPullRequestDetails } = {}) {
  return {
    id: 'github',
    load(root, reference) {
      return mapGitHubPullRequest(reference, fetchPullRequest(root, reference));
    },
  };
}
