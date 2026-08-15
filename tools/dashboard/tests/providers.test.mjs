import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getPullRequestDetails } from '../../lib/github.mjs';
import { createGitHubProvider, mapGitHubPullRequest } from '../server/providers/github.mjs';
import {
  createProviderRegistry,
  loadSpecificationPullRequests,
  resolvePullRequestReferences,
} from '../server/providers/service.mjs';

const githubReference = {
  provider: 'github',
  base_url: 'https://github.example.com',
  repository: 'owner/repo',
  number: 42,
};

function githubPayload() {
  return {
    metadata: {
      number: 42,
      title: 'Add dashboard changes',
      html_url: 'https://github.example.com/owner/repo/pull/42',
      state: 'closed',
      merged_at: '2026-08-14T10:00:00Z',
      draft: false,
      user: { login: 'octo', html_url: 'https://github.example.com/octo', avatar_url: 'https://avatars.example/octo' },
      head: { label: 'owner:feature', ref: 'feature', sha: 'abc' },
      base: { label: 'owner:main', ref: 'main', sha: 'def' },
      additions: 21,
      deletions: 8,
      changed_files: 2,
      commits: 3,
    },
    files: [
      {
        filename: 'src/new.js', status: 'added', additions: 20, deletions: 0, changes: 20,
        patch: '@@ -0,0 +1 @@\n+export const value = 1;', raw_url: 'https://raw.example/new', blob_url: 'https://blob.example/new',
      },
      {
        filename: 'assets/logo.png', previous_filename: 'assets/old.png', status: 'renamed',
        additions: 1, deletions: 8, changes: 9,
      },
    ],
    diff: 'diff --git a/src/new.js b/src/new.js\nnew file mode 100644\n@@ -0,0 +1 @@\n+export const value = 1;\n',
  };
}

test('maps GitHub metadata, branches, stats, file states, and full diff', () => {
  const result = mapGitHubPullRequest(githubReference, githubPayload());

  assert.equal(result.availability, 'available');
  assert.equal(result.state, 'merged');
  assert.equal(result.author.login, 'octo');
  assert.equal(result.head.name, 'feature');
  assert.equal(result.base.name, 'main');
  assert.deepEqual(result.stats, { additions: 21, deletions: 8, changedFiles: 2, commits: 3 });
  assert.equal(result.files[0].patchAvailable, true);
  assert.equal(result.files[1].status, 'renamed');
  assert.equal(result.files[1].patchAvailable, false);
  assert.equal(result.filesComplete, true);
  assert.equal(result.fullDiffAvailable, true);
});

test('keeps metadata and files when GitHub rejects only an oversized full diff', () => {
  const calls = [];
  const execute = (_root, args) => {
    calls.push(args);
    if (args.includes('Accept: application/vnd.github.diff')) {
      const error = new Error('Command failed with HTTP 406');
      error.stdout = JSON.stringify({ message: 'diff exceeded the maximum number of lines', code: 'too_large' });
      throw error;
    }
    if (args.some(value => value.includes('/files?per_page=100'))) {
      return JSON.stringify([[{ filename: 'src/large.cs', status: 'modified', additions: 2, deletions: 1, changes: 3 }]]);
    }
    return JSON.stringify({ number: 42, changed_files: 1 });
  };

  const payload = getPullRequestDetails('fixture-root', githubReference, execute);

  assert.equal(payload.metadata.number, 42);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.diff, '');
  assert.equal(calls.length, 3);
});

test('does not hide unrelated full-diff failures', () => {
  const execute = (_root, args) => {
    if (args.includes('Accept: application/vnd.github.diff')) throw new Error('authentication failed');
    if (args.some(value => value.includes('/files?per_page=100'))) return '[]';
    return JSON.stringify({ number: 42 });
  };

  assert.throws(
    () => getPullRequestDetails('fixture-root', githubReference, execute),
    /authentication failed/,
  );
});

test('provider registry isolates success, unsupported providers, and sanitized errors', () => {
  const provider = createGitHubProvider({
    fetchPullRequest: (_root, reference) => {
      if (reference.number === 99) throw new Error('token ghp_secret D:\\private');
      return githubPayload();
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
