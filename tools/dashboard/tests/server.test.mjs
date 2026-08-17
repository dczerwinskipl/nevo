import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadSpecificationActions } from '../server/actions.mjs';
import { createDashboardServer, listen } from '../server/index.mjs';

function fakeHub() {
  return {
    subscribe: () => () => {},
    close: () => {},
  };
}

test('serves read-only dashboard data and rejects unknown or mutating routes', async () => {
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [], counts: { active: 0, archived: 0 } }),
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const dashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.deepEqual((await dashboard.json()).counts, { active: 0, archived: 0 });

    const mutation = await fetch(`${baseUrl}/api/dashboard`, { method: 'POST' });
    assert.equal(mutation.status, 405);

    const unknown = await fetch(`${baseUrl}/api/specs/../../secret`);
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('does not expose filesystem details when loading fails', async () => {
  const server = createDashboardServer({
    dataLoader: () => { throw new Error('D:\\private\\specs\\change.yaml'); },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: 'Unable to load specifications' });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves exact specification manifest routes without leaking lookup failures', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    manifestLoader: async lookup => {
      calls.push(lookup);
      if (lookup.slug === 'missing') return null;
      if (lookup.slug === 'private-error') throw new Error('D:\\private\\overview.md');
      return { slug: lookup.slug, source: lookup.source, areas: [], tasks: [] };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const active = await fetch(`${baseUrl}/api/specs/active/sample-change/content`);
    assert.equal(active.status, 200);
    assert.deepEqual(await active.json(), { slug: 'sample-change', source: 'active', areas: [], tasks: [] });
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change' });

    const archived = await fetch(`${baseUrl}/api/specs/archive/old-change/content`);
    assert.equal(archived.status, 200);

    const missing = await fetch(`${baseUrl}/api/specs/active/missing/content`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification content not found' });

    const failed = await fetch(`${baseUrl}/api/specs/active/private-error/content`);
    assert.equal(failed.status, 404);
    assert.deepEqual(await failed.json(), { error: 'Specification content not found' });

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/content`, { method: 'POST' });
    assert.equal(mutation.status, 405);

    const traversal = await fetch(`${baseUrl}/api/specs/active/%2e%2e%2fsecret/content`);
    assert.equal(traversal.status, 404);

    const unknownSource = await fetch(`${baseUrl}/api/specs/other/sample-change/content`);
    assert.equal(unknownSource.status, 404);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves exact per-document content routes without leaking lookup failures', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    documentLoader: async lookup => {
      calls.push(lookup);
      if (lookup.docId === 'task:missing') return null;
      if (lookup.docId === 'task:private-error') throw new Error('D:\\private\\tasks\\01.md');
      return { docId: lookup.docId, source: lookup.source, slug: lookup.slug, markdown: 'body' };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const doc = await fetch(`${baseUrl}/api/specs/active/sample-change/content/overview`);
    assert.equal(doc.status, 200);
    assert.deepEqual(await doc.json(), { docId: 'overview', source: 'active', slug: 'sample-change', markdown: 'body' });
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change', docId: 'overview' });

    const encoded = await fetch(`${baseUrl}/api/specs/active/sample-change/content/${encodeURIComponent('task:design-it')}`);
    assert.equal(encoded.status, 200);
    assert.equal(calls[1].docId, 'task:design-it');

    const missing = await fetch(`${baseUrl}/api/specs/active/sample-change/content/task%3Amissing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification document not found' });

    const failed = await fetch(`${baseUrl}/api/specs/active/sample-change/content/task%3Aprivate-error`);
    assert.equal(failed.status, 404);
    assert.deepEqual(await failed.json(), { error: 'Specification document not found' });

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/content/overview`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves a small, fast task-statuses route without leaking lookup failures', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    taskStatusLoader: lookup => {
      calls.push(lookup);
      if (lookup.slug === 'missing') return null;
      return { slug: lookup.slug, source: lookup.source, revision: 'abc123', tasks: [{ id: 'design-it', status: 'verified' }] };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/task-statuses`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.revision, 'abc123');
    assert.deepEqual(payload.tasks, [{ id: 'design-it', status: 'verified' }]);
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change' });

    const missing = await fetch(`${baseUrl}/api/specs/active/missing/task-statuses`);
    assert.equal(missing.status, 404);

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/task-statuses`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves provider-neutral pull request results through an exact read-only route', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestLoader: lookup => {
      calls.push(lookup);
      if (lookup.slug === 'missing') return null;
      if (lookup.slug === 'failed') throw new Error('ghp_secret D:\\private');
      return {
        slug: lookup.slug,
        source: lookup.source,
        // The lightweight PR-list shape (area dashboard-data-loading-contracts) —
        // no files/patch/fullDiff field is ever produced by this route's own
        // loader (mapGitHubPullRequest, tested in providers.test.mjs); this
        // route just forwards whatever the loader returns.
        pullRequests: [{ availability: 'available', title: 'PR one', headSha: 'abc' }],
      };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.pullRequests[0].title, 'PR one');
    assert.equal('files' in payload.pullRequests[0], false);
    assert.equal('fullDiff' in payload.pullRequests[0], false);
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change' });

    const missing = await fetch(`${baseUrl}/api/specs/archive/missing/pull-requests`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification changes not found' });

    const failed = await fetch(`${baseUrl}/api/specs/active/failed/pull-requests`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'Unable to load specification changes' });

    const traversal = await fetch(`${baseUrl}/api/specs/active/%2e%2e%2fsecret/pull-requests`);
    assert.equal(traversal.status, 404);

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves the PR file-manifest route (GET) without ever leaking a lookup failure', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestFilesLoader: lookup => {
      calls.push(lookup);
      if (lookup.number === 999) return null;
      return { number: lookup.number, files: [{ path: 'a.js', status: 'added', additions: 1, deletions: 0, changes: 1 }] };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/files`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.files.length, 1);
    assert.equal('patch' in payload.files[0], false);
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change', number: 42 });

    const missing = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/999/files`);
    assert.equal(missing.status, 404);

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/files`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves the PR file-diffs route (POST { paths, headSha }) and rejects a malformed body', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestFileDiffsLoader: lookup => {
      calls.push(lookup);
      return { number: lookup.number, headSha: lookup.headSha, diffs: lookup.paths.map(path => ({ path, patch: 'x' })) };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.js', 'b.js'], headSha: 'sha-1' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.diffs.length, 2);
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change', number: 42, paths: ['a.js', 'b.js'], headSha: 'sha-1' });

    const malformed = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ headSha: 'sha-1' }),
    });
    assert.equal(malformed.status, 400);

    const wrongMethod = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/file-diffs`);
    assert.equal(wrongMethod.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves the full-diff route (GET) only, on demand', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestFullDiffLoader: lookup => {
      calls.push(lookup);
      return { number: lookup.number, diff: 'diff --git a/x b/x\n', diffAvailable: true };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/diff`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).diffAvailable, true);
    assert.deepEqual(calls[0], { source: 'active', slug: 'sample-change', number: 42 });

    const mutation = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/diff`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('never calls the file-manifest or full-diff loaders as a side effect of listing PRs', async () => {
  let filesCalls = 0;
  let diffCalls = 0;
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestLoader: () => ({ slug: 'sample-change', source: 'active', pullRequests: [{ availability: 'available', number: 42 }] }),
    pullRequestFilesLoader: () => { filesCalls += 1; return { number: 42, files: [] }; },
    pullRequestFullDiffLoader: () => { diffCalls += 1; return { number: 42, diff: '', diffAvailable: false }; },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests`);
    assert.equal(filesCalls, 0);
    assert.equal(diffCalls, 0);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves active-only lifecycle gates and executes explicit validated actions', async () => {
  const loads = [];
  const executions = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    actionLoader: lookup => {
      loads.push(lookup);
      return { slug: lookup.slug, source: 'active', worktree: { clean: true }, tasks: {}, finalize: { enabled: true } };
    },
    actionExecutor: request => {
      executions.push(request);
      return { ok: true, action: request.action };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const gates = await fetch(`${baseUrl}/api/specs/active/sample-change/actions`);
    assert.equal(gates.status, 200);
    assert.equal((await gates.json()).finalize.enabled, true);
    assert.deepEqual(loads, [{ slug: 'sample-change' }]);

    const action = await fetch(`${baseUrl}/api/specs/active/sample-change/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ action: 'verify', taskId: 'task-one' }),
    });
    assert.equal(action.status, 200);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].slug, 'sample-change');
    assert.equal(executions[0].action, 'verify');
    assert.equal(executions[0].taskId, 'task-one');
    assert.equal(executions[0].confirmed, false);

    const invalid = await fetch(`${baseUrl}/api/specs/active/sample-change/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: '{',
    });
    assert.equal(invalid.status, 400);

    const missingActionHeader = await fetch(`${baseUrl}/api/specs/active/sample-change/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify', taskId: 'task-one' }),
    });
    assert.equal(missingActionHeader.status, 403);

    const invalidShape = await fetch(`${baseUrl}/api/specs/active/sample-change/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: 'null',
    });
    assert.equal(invalidShape.status, 400);

    const archived = await fetch(`${baseUrl}/api/specs/archive/sample-change/actions`, { method: 'POST' });
    assert.equal(archived.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('slow async pull request operation does not block parallel health or document requests', async () => {
  let releaseGh;
  const slowGhPromise = new Promise(resolvePromise => { releaseGh = resolvePromise; });

  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestFilesLoader: async () => {
      await slowGhPromise;
      return { number: 42, files: [{ path: 'a.js' }] };
    },
    documentLoader: async () => ({ docId: 'overview', markdown: '# Quick doc' }),
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    // Start slow PR request (do not await its completion yet)
    const slowReqPromise = fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests/42/files`);

    // While slow PR request is in-flight, health and document endpoints must respond immediately
    const healthStart = performance.now();
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthDuration = performance.now() - healthStart;
    assert.equal(healthRes.status, 200);
    assert.ok(healthDuration < 100, `health took ${healthDuration}ms, must not be blocked by slow gh`);

    const docStart = performance.now();
    const docRes = await fetch(`${baseUrl}/api/specs/active/sample-change/content/overview`);
    const docDuration = performance.now() - docStart;
    assert.equal(docRes.status, 200);
    assert.ok(docDuration < 100, `document took ${docDuration}ms, must not be blocked by slow gh`);

    // Release slow PR request and verify it finishes normally
    releaseGh();
    const slowRes = await slowReqPromise;
    assert.equal(slowRes.status, 200);
  } finally {
    releaseGh?.();
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('GET /actions evaluates task-level gate with check preflight and disables invalid task actions without heavy finalize probe', () => {
  const root = join(tmpdir(), `nevo-server-actions-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'sample-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), [
    'id: sample-change',
    'title: Sample',
    'tasks:',
    '  - id: failing-task',
    '    status: draft',
    '  - id: passing-task',
    '    status: implemented',
    '',
  ].join('\n'));

  try {
    const specsRunnerCalls = [];
    const actions = loadSpecificationActions({
      slug: 'sample-change',
      activeDir,
      runSpecs: (_root, args) => {
        specsRunnerCalls.push(args);
        if (args.includes('failing-task')) {
          return JSON.stringify({ result: { ok: false, reason: 'Task review incomplete.' } });
        }
        return JSON.stringify({ result: { ok: true } });
      },
      worktreeLoader: () => ({ clean: true, total: 0, staged: 0, unstaged: 0, untracked: 0, files: [] }),
      branchLoader: () => 'feature/sample',
      trackingLoader: () => ({ hasUpstream: true, ahead: 0, behind: 0 }),
    });

    assert.equal(actions.slug, 'sample-change');
    assert.deepEqual(actions.tasks['failing-task'], { action: 'approve', enabled: false, reason: 'Task review incomplete.' });
    assert.deepEqual(actions.tasks['passing-task'], { action: 'verify', enabled: true, reason: null });
    // Heavy finalize probe is NOT executed during GET /actions
    assert.ok(!specsRunnerCalls.some(args => args[0] === 'finalize'), 'must not run finalize probe during GET /actions');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves accurate 504/503/502 status codes on upstream provider errors instead of 404', async () => {
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    pullRequestFileDiffsLoader: async ({ number }) => {
      if (number === 404) return null; // Genuine not found
      if (number === 504) {
        const err = new Error('TLS handshake timeout');
        err.status = 504;
        throw err;
      }
      if (number === 503) {
        const err = new Error('Connection reset by peer');
        err.status = 503;
        throw err;
      }
      throw new Error('Unknown GitHub failure');
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const res404 = await fetch(`${baseUrl}/api/specs/active/sample/pull-requests/404/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.js'] }),
    });
    assert.equal(res404.status, 404);

    const res504 = await fetch(`${baseUrl}/api/specs/active/sample/pull-requests/504/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.js'] }),
    });
    assert.equal(res504.status, 504);
    assert.match((await res504.json()).error, /timeout/);

    const res503 = await fetch(`${baseUrl}/api/specs/active/sample/pull-requests/503/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.js'] }),
    });
    assert.equal(res503.status, 503);

    const res502 = await fetch(`${baseUrl}/api/specs/active/sample/pull-requests/500/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.js'] }),
    });
    assert.equal(res502.status, 502);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});


