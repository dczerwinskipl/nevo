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
import { classifyUpstreamError, createGitHubPullRequestProvider, mapGitHubFileManifest, mapGitHubPullRequest } from '../server/pull-requests/github.mjs';
import { createPullRequestService } from '../server/pull-requests/service.mjs';

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

test('pull-requests service isolates success, unsupported providers, and sanitized errors', async () => {
  const root = join(tmpdir(), `nevo-dashboard-pr-service-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  mkdirSync(join(activeDir, 'mixed-pr'), { recursive: true });
  writeFileSync(join(activeDir, 'mixed-pr', 'change.yaml'), [
    'id: mixed-pr',
    'title: Mixed PR',
    'pull_requests:',
    '  - provider: github',
    '    base_url: https://github.example.com',
    '    repository: owner/repo',
    '    number: 42',
    '  - provider: gitlab',
    '    base_url: https://github.example.com',
    '    repository: owner/repo',
    '    number: 7',
    '  - provider: github',
    '    base_url: https://github.example.com',
    '    repository: owner/repo',
    '    number: 99',
    'tasks: []',
    '',
  ].join('\n'));

  try {
    const provider = createGitHubPullRequestProvider({
      fetchMetadata: async (_root, reference) => {
        if (reference.number === 99) throw new Error('token ghp_secret D:\\private');
        return githubMetadata();
      },
    });
    const service = createPullRequestService({ provider, activeDir, archiveDir, root });

    const changes = await service.loadPullRequests({ source: 'active', slug: 'mixed-pr' });
    const results = changes.pullRequests;

    assert.deepEqual(results.map(result => result.availability), ['available', 'unsupported', 'error']);
    assert.match(results[1].message, /not supported/);
    assert.equal(results[2].message, 'Unable to load pull request details.');
    assert.doesNotMatch(JSON.stringify(results), /ghp_secret|D:\\\\private/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider adapter caches one upstream REST call per (reference, headSha) — all batches for the same PR version share it (AC8)', async () => {
  let filesWithPatchesCalls = 0;
  const provider = createGitHubPullRequestProvider({
    fetchFilesWithPatches: async () => {
      filesWithPatchesCalls += 1;
      return githubFilesWithPatches();
    },
  });

  const first = await provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-1');
  assert.equal(first.length, 1);
  assert.equal(first[0].patch, '@@ -0,0 +1 @@\n+export const value = 1;');
  assert.equal(filesWithPatchesCalls, 1);

  // A second batch, same headSha, different path — no repeated upstream call.
  const second = await provider.loadFileDiffs('fixture-root', githubReference, ['assets/logo.png'], 'sha-1');
  assert.equal(second.length, 1);
  assert.equal(filesWithPatchesCalls, 1);

  // Re-requesting an already-cached path, same headSha — still no repeated call.
  await provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-1');
  assert.equal(filesWithPatchesCalls, 1);

  // A new headSha invalidates the cache entry for this PR (and only this PR).
  await provider.loadFileDiffs('fixture-root', githubReference, ['src/new.js'], 'sha-2');
  assert.equal(filesWithPatchesCalls, 2);

  const otherPr = { ...githubReference, number: 43 };
  await provider.loadFileDiffs('fixture-root', otherPr, ['src/new.js'], 'sha-1');
  assert.equal(filesWithPatchesCalls, 3);
});

test('loadFullDiff is never invoked by loadFiles/load', async () => {
  let fullDiffCalls = 0;
  const provider = createGitHubPullRequestProvider({
    fetchMetadata: async () => githubMetadata(),
    fetchFiles: async () => [{ path: 'a.js', additions: 1, deletions: 0, changeType: 'ADDED' }],
    fetchFullDiff: async () => { fullDiffCalls += 1; return 'diff --git a/a.js b/a.js\n'; },
  });
  await provider.load('fixture-root', githubReference);
  await provider.loadFiles('fixture-root', githubReference);
  assert.equal(fullDiffCalls, 0);
  const result = await provider.loadFullDiff('fixture-root', githubReference);
  assert.equal(fullDiffCalls, 1);
  assert.equal(result.diffAvailable, true);
});

test('loads exact active and archived changes and skips the provider for empty references', async () => {
  const root = join(tmpdir(), `nevo-dashboard-providers-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  mkdirSync(join(activeDir, 'with-pr'), { recursive: true });
  mkdirSync(join(archiveDir, 'without-pr'), { recursive: true });
  writeFileSync(join(activeDir, 'with-pr', 'change.yaml'), `id: with-pr\ntitle: With PR\npull_requests:\n  - provider: github\n    base_url: https://github.com\n    repository: owner/repo\n    number: 42\ntasks: []\n`);
  writeFileSync(join(archiveDir, 'without-pr', 'change.yaml'), 'id: without-pr\ntitle: Without PR\ntasks: []\n');
  let calls = 0;
  const service = createPullRequestService({
    provider: { id: 'github', load: async (_repoRoot, reference) => { calls += 1; return { availability: 'available', reference: { number: reference.number } }; } },
    activeDir,
    archiveDir,
    root,
  });

  try {
    const active = await service.loadPullRequests({ source: 'active', slug: 'with-pr' });
    assert.equal(active.pullRequests.length, 1);
    assert.equal(calls, 1);

    const archive = await service.loadPullRequests({ source: 'archive', slug: 'without-pr' });
    assert.deepEqual(archive.pullRequests, []);
    assert.equal(calls, 1);

    assert.equal(await service.loadPullRequests({ source: 'other', slug: 'with-pr' }), null);
    assert.equal(await service.loadPullRequests({ source: 'active', slug: '../with-pr' }), null);
    assert.equal(await service.loadPullRequests({ source: 'active', slug: 'missing' }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loads a PR sub-resource (files/file-diffs/full-diff) by number, resolved from change.yaml', async () => {
  const root = join(tmpdir(), `nevo-dashboard-providers-sub-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  mkdirSync(join(activeDir, 'with-pr'), { recursive: true });
  writeFileSync(join(activeDir, 'with-pr', 'change.yaml'), `id: with-pr\ntitle: With PR\npull_requests:\n  - provider: github\n    base_url: https://github.com\n    repository: owner/repo\n    number: 42\ntasks: []\n`);

  const service = createPullRequestService({
    provider: {
      id: 'github',
      load: async () => ({ availability: 'available' }),
      loadFiles: async () => [{ path: 'a.js', additions: 1, deletions: 0, changes: 1 }],
      loadFileDiffs: async (_root, _reference, paths, headSha) => paths.map(path => ({ path, headSha, patch: 'x' })),
      loadFullDiff: async () => ({ diff: 'diff', diffAvailable: true }),
    },
    activeDir,
    archiveDir,
    root,
  });

  try {
    const files = await service.loadFiles({ source: 'active', slug: 'with-pr', number: 42 });
    assert.deepEqual(files.files, [{ path: 'a.js', additions: 1, deletions: 0, changes: 1 }]);
    assert.ok(files.changeView.groups.length > 0);
    assert.ok(files.generatedFiles.rules.length > 0);

    const diffs = await service.loadFileDiffs({ source: 'active', slug: 'with-pr', number: '42', paths: ['a.js'], headSha: 'sha-1' });
    assert.equal(diffs.number, 42);
    assert.equal(diffs.headSha, 'sha-1');
    assert.deepEqual(diffs.diffs, [{ path: 'a.js', headSha: 'sha-1', patch: 'x' }]);

    const fullDiff = await service.loadFullDiff({ source: 'active', slug: 'with-pr', number: 42 });
    assert.deepEqual(fullDiff, { number: 42, diff: 'diff', diffAvailable: true });

    assert.equal(await service.loadFiles({ source: 'active', slug: 'with-pr', number: 999 }), null);
    assert.equal(await service.loadFiles({ source: 'active', slug: 'missing', number: 42 }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two concurrent cold diff requests share the same in-flight Promise and execute exactly one fetch', async () => {
  let fetchCount = 0;
  const provider = createGitHubPullRequestProvider({
    fetchFilesWithPatches: async () => {
      fetchCount++;
      await new Promise(r => setTimeout(r, 20));
      return githubFilesWithPatches();
    },
  });

  // Dispatch 5 concurrent cold batch requests for the same PR and headSha
  const results = await Promise.all([
    provider.loadFileDiffs('root', githubReference, ['src/new.js'], 'sha-1'),
    provider.loadFileDiffs('root', githubReference, ['assets/logo.png'], 'sha-1'),
    provider.loadFileDiffs('root', githubReference, ['src/new.js'], 'sha-1'),
    provider.loadFileDiffs('root', githubReference, ['src/new.js'], 'sha-1'),
    provider.loadFileDiffs('root', githubReference, ['assets/logo.png'], 'sha-1'),
  ]);

  assert.equal(fetchCount, 1, 'expected exactly 1 upstream fetch for concurrent batches');
  assert.equal(results[0].length, 1);
  assert.equal(results[1].length, 1);
});

test('failure in cold fetch releases in-flight state so future requests can retry', async () => {
  let shouldFail = true;
  let fetchCount = 0;
  const provider = createGitHubPullRequestProvider({
    fetchFilesWithPatches: async () => {
      fetchCount++;
      if (shouldFail) throw new Error('network timeout');
      return githubFilesWithPatches();
    },
  });

  await assert.rejects(
    () => provider.loadFileDiffs('root', githubReference, ['src/new.js'], 'sha-1'),
    /network timeout/,
  );

  // Future call after failure is not stuck on old rejected Promise
  shouldFail = false;
  const result = await provider.loadFileDiffs('root', githubReference, ['src/new.js'], 'sha-1');
  assert.equal(result.length, 1);
  assert.equal(fetchCount, 2);
});

test('PR metadata is cached across subsequent calls within TTL (cache hit)', async () => {
  let metadataCalls = 0;
  const provider = createGitHubPullRequestProvider({
    fetchMetadata: async () => {
      metadataCalls++;
      return githubMetadata();
    },
  });

  const first = await provider.load('fixture-root', githubReference);
  assert.equal(metadataCalls, 1);
  assert.equal(first.number, 42);

  // Subsequent call short after is a cache hit
  const second = await provider.load('fixture-root', githubReference);
  assert.equal(metadataCalls, 1, 'subsequent call must hit result cache without gh call');
  assert.equal(second.number, 42);
});

test('classifyUpstreamError maps timeouts to 504 and connection drops to 503', () => {
  const timeoutErr = classifyUpstreamError(new Error('TLS handshake timeout after 10000ms'));
  assert.equal(timeoutErr.status, 504);

  const resetErr = classifyUpstreamError(new Error('wsarecv: connection was forcibly closed by the remote host'));
  assert.equal(resetErr.status, 503);

  const genericErr = classifyUpstreamError(new Error('API error 500'));
  assert.equal(genericErr.status, 502);
});

test('createPullRequestService: custom root relocates specs directory without falling back to real repo', async () => {
  const tempRoot = join(tmpdir(), `nevo-pr-root-test-${Date.now()}`);
  const activeDir = join(tempRoot, 'specs', 'active');
  const specDir = join(activeDir, 'custom-spec');
  mkdirSync(specDir, { recursive: true });

  writeFileSync(
    join(specDir, 'change.yaml'),
    'id: custom-spec\npull_requests:\n  - provider: github\n    base_url: https://github.example.com\n    repository: owner/repo\n    number: 99\n',
  );

  const mockProvider = {
    id: 'github',
    load: async (rootPath, ref) => {
      assert.equal(rootPath, tempRoot, 'Provider must receive resolved rootPath');
      return { availability: 'available', number: ref.number, title: 'Custom root PR' };
    },
    loadFiles: async (rootPath) => {
      assert.equal(rootPath, tempRoot);
      return [];
    },
    loadFileDiffs: async (rootPath) => {
      assert.equal(rootPath, tempRoot);
      return [];
    },
    loadFullDiff: async (rootPath) => {
      assert.equal(rootPath, tempRoot);
      return { diff: '' };
    },
  };

  try {
    const service = createPullRequestService({
      provider: mockProvider,
      root: tempRoot,
    });

    const result = await service.loadPullRequests({ source: 'active', slug: 'custom-spec' });
    assert.ok(result);
    assert.equal(result.slug, 'custom-spec');
    assert.equal(result.pullRequests.length, 1);
    assert.equal(result.pullRequests[0].number, 99);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('createPullRequestService: explicit activeDir/archiveDir overrides override root-derived directories', async () => {
  const tempRoot = join(tmpdir(), `nevo-pr-override-root-${Date.now()}`);
  const explicitActive = join(tmpdir(), `nevo-pr-explicit-active-${Date.now()}`);
  const specDir = join(explicitActive, 'override-spec');
  mkdirSync(specDir, { recursive: true });

  writeFileSync(
    join(specDir, 'change.yaml'),
    'id: override-spec\npull_requests:\n  - provider: github\n    base_url: https://github.example.com\n    repository: owner/repo\n    number: 101\n',
  );

  const mockProvider = {
    id: 'github',
    load: async (rootPath, ref) => ({ availability: 'available', number: ref.number }),
  };

  try {
    const service = createPullRequestService({
      provider: mockProvider,
      root: tempRoot,
      activeDir: explicitActive,
    });

    const result = await service.loadPullRequests({ source: 'active', slug: 'override-spec' });
    assert.ok(result);
    assert.equal(result.slug, 'override-spec');
    assert.equal(result.pullRequests[0].number, 101);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(explicitActive, { recursive: true, force: true });
  }
});
