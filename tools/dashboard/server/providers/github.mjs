import {
  getFullDiff,
  getPullRequestFiles,
  getPullRequestFilesWithPatches,
  getPullRequestMetadata,
} from '../../../lib/github.mjs';

const FILE_STATUSES = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']);
const CHANGE_TYPE_TO_STATUS = {
  ADDED: 'added',
  DELETED: 'removed',
  MODIFIED: 'modified',
  RENAMED: 'renamed',
  COPIED: 'copied',
  CHANGED: 'changed',
};

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

// The files-manifest route's shape — deliberately no `patch`/`patchAvailable`
// field at all (not even empty), since a manifest entry is never expected to
// carry diff content (area pull-request-file-and-diff-loading AC1).
function fileManifestProjection(node) {
  return {
    path: node.path,
    status: CHANGE_TYPE_TO_STATUS[node.changeType] || 'modified',
    additions: Number(node.additions) || 0,
    deletions: Number(node.deletions) || 0,
    changes: (Number(node.additions) || 0) + (Number(node.deletions) || 0),
  };
}

// The file-diffs batch route's shape — same fields the old bundled PR payload
// carried per file, patch included, but only for the requested paths.
function fileDiffProjection(file) {
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

export function mapGitHubPullRequest(reference, metadata) {
  metadata = metadata || {};
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
    mergeableState: metadata.mergeable_state || null,
    author: metadata.user ? {
      login: metadata.user.login || 'unknown',
      url: metadata.user.html_url || null,
      avatarUrl: metadata.user.avatar_url || null,
    } : null,
    head: branchProjection(metadata.head),
    base: branchProjection(metadata.base),
    headSha: metadata.head?.sha || null,
    createdAt: metadata.created_at || null,
    updatedAt: metadata.updated_at || null,
    stats: {
      additions: Number(metadata.additions) || 0,
      deletions: Number(metadata.deletions) || 0,
      changedFiles: Number(metadata.changed_files) || 0,
      commits: Number(metadata.commits) || 0,
    },
  };
}

export function mapGitHubFileManifest(nodes) {
  return (nodes || []).map(fileManifestProjection);
}

function diffCacheKey(reference, headSha) {
  return [reference.provider, reference.base_url, reference.repository, reference.number, headSha].join('|');
}

// `cache` is per-provider-instance, keyed by (reference, headSha) — deliberately
// long-lived across requests (the registry holding this provider is a module-
// level singleton, see providers/service.mjs) so a batch of diff requests for
// the same PR version only ever pays for the underlying REST files+patch call
// once, regardless of how many separate hydration batches ask for it (area
// pull-request-file-and-diff-loading AC8). No eviction — "no requirement to
// explicitly purge them in this change" (area doc).
export function createGitHubProvider({
  fetchMetadata = getPullRequestMetadata,
  fetchFiles = getPullRequestFiles,
  fetchFilesWithPatches = getPullRequestFilesWithPatches,
  fetchFullDiff = getFullDiff,
  cache = new Map(),
} = {}) {
  return {
    id: 'github',
    load(root, reference) {
      return mapGitHubPullRequest(reference, fetchMetadata(root, reference));
    },
    loadFiles(root, reference) {
      return mapGitHubFileManifest(fetchFiles(root, reference));
    },
    loadFileDiffs(root, reference, paths, headSha) {
      const key = diffCacheKey(reference, headSha);
      let byPath = cache.get(key);
      if (!byPath) {
        byPath = new Map(fetchFilesWithPatches(root, reference).map(file => [file.filename, file]));
        cache.set(key, byPath);
      }
      return paths.map(path => byPath.get(path)).filter(Boolean).map(fileDiffProjection);
    },
    loadFullDiff(root, reference) {
      const diff = fetchFullDiff(root, reference) || '';
      return { diff, diffAvailable: Boolean(diff.trim()) };
    },
  };
}
