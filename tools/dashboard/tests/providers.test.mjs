import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getFullDiff,
  getPullRequestFiles,
  getPullRequestFilesWithPatches,
  getPullRequestMetadata,
} from '../../lib/github.mjs';
import { createGitHubProvider, mapGitHubFileManifest, mapGitHubPullRequest } from '../server/providers/github.mjs';
import {
  createProviderRegistry,
  loadSpecificationPullRequestFileDiffs,
  loadSpecificationPullRequestFiles,
  loadSpecificationPullRequestFullDiff,
  loadSpecificationPullRequests,
  resolvePullRequestReferences,
} from '../server/providers/service.mjs';

const githubReference = {
  provider: 'github',
  base_url: 'https://github.example.com',
  repository: 'owner/repo',
  number: 42,
};

function githubMetadata() {
  return {
    number: 42,
    title: 'Add dashboard changes',
    html_url: 'https://github.example.com/owner/repo/pull/42',
    state: 'closed',
    merged_at: '2026-08-14T10:00:00Z',
    draft: false,
    mergeable_state: 'clean',
    user: { login: 'octo', html_url: 'https://github.example.com/octo', avatar_url: 'https://avatars.example/octo' },
    head: { label: 'owner:feature', ref: 'feature', sha: 'abc' },
    base: { label: 'owner:main', ref: 'main', sha: 'def' },
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-14T09:00:00Z',
    additions: 21,
    deletions: 8,
    changed_files: 2,
    commits: 3,
  };
}

function githubFilesWithPatches() {
  return [
    {
      filename: 'src/new.js', status: 'added', additions: 20, deletions: 0, changes: 20,
      patch: '@@ -0,0 +1 @@\n+export const value = 1;', raw_url: 'https://raw.example/new', blob_url: 'https://blob.example/new',
    },
    {
      filename: 'assets/logo.png', previous_filename: 'assets/old.png', status: 'renamed',
      additions: 1, deletions: 8, changes: 9,
    },
  ];
}

test('maps GitHub metadata into lightweight PR-list fields — no files/diff carried at all', () => {
  const result = mapGitHubPullRequest(githubReference, githubMetadata());

  assert.equal(result.availability, 'available');
  assert.equal(result.state, 'merged');
  assert.equal(result.author.login, 'octo');
  assert.equal(result.head.name, 'feature');
  assert.equal(result.base.name, 'main');
  assert.equal(result.headSha, 'abc');
  assert.equal(result.mergeableState, 'clean');
  assert.deepEqual(result.stats, { additions: 21, deletions: 8, changedFiles: 2, commits: 3 });
  assert.equal('files' in result, false);
  assert.equal('fullDiff' in result, false);
});

test('getPullRequestMetadata issues exactly one REST call, no files/diff', () => {
  const calls = [];
  const execute = (_root, args) => {
    calls.push(args);
    return JSON.stringify(githubMetadata());
  };
  const metadata = getPullRequestMetadata('fixture-root', githubReference, execute);
  assert.equal(metadata.number, 42);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].some(a => a.includes('/files') || a.includes('vnd.github.diff')));
});

test('maps a GraphQL file-manifest response with no patch field', () => {
  const manifest = mapGitHubFileManifest([
    { path: 'src/new.js', additions: 20, deletions: 0, changeType: 'ADDED' },
    { path: 'assets/logo.png', additions: 1, deletions: 8, changeType: 'RENAMED' },
  ]);
  assert.deepEqual(manifest.map(f => f.path), ['src/new.js', 'assets/logo.png']);
  assert.equal(manifest[0].status, 'added');
  assert.equal(manifest[1].status, 'renamed');
  assert.ok(manifest.every(f => !('patch' in f)));
});

test('getPullRequestFiles paginates GraphQL without ever requesting patch content', () => {
  const calls = [];
  const execute = (_root, args) => {
    calls.push(args);
    const after = args.find(a => a.startsWith('after='));
    if (!after) {
      return JSON.stringify({ data: { repository: { pullRequest: { files: {
        pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        nodes: [{ path: 'a.js', additions: 1, deletions: 0, changeType: 'ADDED' }],
      } } } } });
    }
    return JSON.stringify({ data: { repository: { pullRequest: { files: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ path: 'b.js', additions: 2, deletions: 1, changeType: 'MODIFIED' }],
    } } } } });
  };

  const files = getPullRequestFiles('fixture-root', githubReference, execute);
  assert.deepEqual(files.map(f => f.path), ['a.js', 'b.js']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => !JSON.stringify(args).includes('patch')));
});

test('getPullRequestFilesWithPatches fetches the REST files listing, patches included', () => {
  const execute = (_root, args) => {
    assert.ok(args.some(v => v.includes('/files?per_page=100')));
    return JSON.stringify([githubFilesWithPatches()]);
  };
  const files = getPullRequestFilesWithPatches('fixture-root', githubReference, execute);
  assert.equal(files.length, 2);
  assert.equal(files[0].patch, '@@ -0,0 +1 @@\n+export const value = 1;');
});

test('getFullDiff swallows only an oversized-diff rejection', () => {
  const oversized = (_root, _args) => {
    const error = new Error('Command failed with HTTP 406');
    error.stdout = JSON.stringify({ message: 'diff exceeded the maximum number of lines', code: 'too_large' });
    throw error;
  };
  assert.equal(getFullDiff('fixture-root', githubReference, oversized), '');

  const unrelated = () => { throw new Error('authentication failed'); };
  assert.throws(() => getFullDiff('fixture-root', githubReference, unrelated), /authentication failed/);
});

test('provider registry isolates success, unsupported providers, and sanitized errors', () => {
  const provider = createGitHubProvider({
    fetchMetadata: (_root, reference) => {
      if (reference.number === 99) throw new Error('token ghp_secret D:\\private');
      return githubMetadata();
    },
  });
  const registry = createProviderRegistry([provider]);
  const results = resolvePullRequestReferences([
    githubReference,
    { ...githubReference, provider: 'gitlab', number: 7 },
    { ...githubReference, number: 99 },
  ], { root: 'fixture-root', registry });

  assert.deepEqual(results.map(result => result.availability), ['available', 'unsupported', 'error']);
  assert.match(results[1].message, /not supported/);
  assert.equal(results[2].message, 'Unable to load pull request details.');
  assert.doesNotMatch(JSON.stringify(results), /ghp_secret|D:\\\\private/);
});

test('provider adapter caches the REST files+patch fetch per (reference, headSha) across diff batches', () => {
  let filesWithPatchesCalls = 0;
  const provider = createGitHubProvider({
    fetchFilesWithPatches: () => {
      filesWithPatchesCalls += 1;
      return githubFilesWithPatches();
    },
  });

  const first = provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-1');
  assert.equal(first.length, 1);
  assert.equal(first[0].patch, '@@ -0,0 +1 @@\n+export const value = 1;');
  assert.equal(filesWithPatchesCalls, 1);

  // A second batch, same headSha, different path — no repeated upstream call.
  const second = provider.loadFileDiffs('fixture-root', githubReference, ['assets/logo.png'], 'sha-1');
  assert.equal(second.length, 1);
  assert.equal(filesWithPatchesCalls, 1);

  // Re-requesting an already-cached path, same headSha — still no repeated call.
  provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-1');
  assert.equal(filesWithPatchesCalls, 1);

  // A new headSha invalidates the cache entry for this PR (and only this PR).
  provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-2');
  assert.equal(filesWithPatchesCalls, 2);

  const otherPr = { ...githubReference, number: 43 };
  provider.loadFileDiffs('fixture-root', otherPr, ['src/new.js'], 'sha-1');
  assert.equal(filesWithPatchesCalls, 3);
});

test('loadFullDiff is never invoked by loadFiles/load', () => {
  let fullDiffCalls = 0;
  const provider = createGitHubProvider({
    fetchMetadata: () => githubMetadata(),
    fetchFiles: () => [{ path: 'a.js', additions: 1, deletions: 0, changeType: 'ADDED' }],
    fetchFullDiff: () => { fullDiffCalls += 1; return 'diff --git a/a.js b/a.js\n'; },
  });
  provider.load('fixture-root', githubReference);
  provider.loadFiles('fixture-root', githubReference);
  assert.equal(fullDiffCalls, 0);
  const result = provider.loadFullDiff('fixture-root', githubReference);
  assert.equal(fullDiffCalls, 1);
  assert.equal(result.diffAvailable, true);
});

test('loads exact active and archived changes and skips providers for empty references', () => {
  const root = join(tmpdir(), `nevo-dashboard-providers-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  mkdirSync(join(activeDir, 'with-pr'), { recursive: true });
  mkdirSync(join(archiveDir, 'without-pr'), { recursive: true });
  writeFileSync(join(activeDir, 'with-pr', 'change.yaml'), `id: with-pr\ntitle: With PR\npull_requests:\n  - provider: github\n    base_url: https://github.com\n    repository: owner/repo\n    number: 42\ntasks: []\n`);
  writeFileSync(join(archiveDir, 'without-pr', 'change.yaml'), 'id: without-pr\ntitle: Without PR\ntasks: []\n');
  let calls = 0;
  const registry = createProviderRegistry([{
    id: 'github',
    load: (_repoRoot, reference) => {
      calls += 1;
      return { availability: 'available', reference: { number: reference.number } };
    },
  }]);

  try {
    const active = loadSpecificationPullRequests({ source: 'active', slug: 'with-pr', activeDir, archiveDir, root, registry });
    assert.equal(active.pullRequests.length, 1);
    assert.equal(calls, 1);

    const archive = loadSpecificationPullRequests({ source: 'archive', slug: 'without-pr', activeDir, archiveDir, root, registry });
    assert.deepEqual(archive.pullRequests, []);
    assert.equal(calls, 1);

    assert.equal(loadSpecificationPullRequests({ source: 'other', slug: 'with-pr', activeDir, archiveDir, root, registry }), null);
    assert.equal(loadSpecificationPullRequests({ source: 'active', slug: '../with-pr', activeDir, archiveDir, root, registry }), null);
    assert.equal(loadSpecificationPullRequests({ source: 'active', slug: 'missing', activeDir, archiveDir, root, registry }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loads a PR sub-resource (files/file-diffs/full-diff) by number, resolved from change.yaml', () => {
  const root = join(tmpdir(), `nevo-dashboard-providers-sub-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  mkdirSync(join(activeDir, 'with-pr'), { recursive: true });
  writeFileSync(join(activeDir, 'with-pr', 'change.yaml'), `id: with-pr\ntitle: With PR\npull_requests:\n  - provider: github\n    base_url: https://github.com\n    repository: owner/repo\n    number: 42\ntasks: []\n`);

  const registry = createProviderRegistry([{
    id: 'github',
    load: () => ({ availability: 'available' }),
    loadFiles: () => [{ path: 'a.js', additions: 1, deletions: 0, changes: 1 }],
    loadFileDiffs: (_root, _reference, paths, headSha) => paths.map(path => ({ path, headSha, patch: 'x' })),
    loadFullDiff: () => ({ diff: 'diff', diffAvailable: true }),
  }]);

  try {
    const files = loadSpecificationPullRequestFiles({ source: 'active', slug: 'with-pr', number: 42, activeDir, archiveDir, root, registry });
    assert.deepEqual(files.files, [{ path: 'a.js', additions: 1, deletions: 0, changes: 1 }]);
    // The per-project changeView/generatedFiles config rides along with the
    // manifest (AC6) — this fixture has no .nevo/dashboard-view.json, so it's
    // this repo's own reasonable default, not hardcoded into the frontend.
    assert.ok(files.changeView.groups.length > 0);
    assert.ok(files.generatedFiles.rules.length > 0);

    const diffs = loadSpecificationPullRequestFileDiffs({ source: 'active', slug: 'with-pr', number: '42', paths: ['a.js'], headSha: 'sha-1', activeDir, archiveDir, root, registry });
    assert.equal(diffs.number, 42);
    assert.equal(diffs.headSha, 'sha-1');
    assert.deepEqual(diffs.diffs, [{ path: 'a.js', headSha: 'sha-1', patch: 'x' }]);

    const fullDiff = loadSpecificationPullRequestFullDiff({ source: 'active', slug: 'with-pr', number: 42, activeDir, archiveDir, root, registry });
    assert.deepEqual(fullDiff, { number: 42, diff: 'diff', diffAvailable: true });

    assert.equal(loadSpecificationPullRequestFiles({ source: 'active', slug: 'with-pr', number: 999, activeDir, archiveDir, root, registry }), null);
    assert.equal(loadSpecificationPullRequestFiles({ source: 'active', slug: 'missing', number: 42, activeDir, archiveDir, root, registry }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
