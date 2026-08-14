import assert from 'node:assert/strict';
import test from 'node:test';

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

test('serves exact specification content routes without leaking lookup failures', async () => {
  const calls = [];
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [] }),
    contentLoader: lookup => {
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
        pullRequests: [{ availability: 'available', title: 'PR one' }],
      };
    },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/sample-change/pull-requests`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pullRequests[0].title, 'PR one');
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
    assert.deepEqual(await action.json(), { ok: true, action: 'verify' });
    assert.deepEqual(executions, [{ slug: 'sample-change', action: 'verify', taskId: 'task-one', confirmed: false }]);

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
