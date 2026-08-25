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
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const dashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.ok(data.counts.active >= 1);
    assert.ok(Array.isArray(data.active));

    const mutation = await fetch(`${baseUrl}/api/dashboard`, { method: 'POST' });
    assert.equal(mutation.status, 405);

    const unknown = await fetch(`${baseUrl}/api/specs/../../secret`);
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves exact specification manifest routes without leaking lookup failures', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const active = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content`);
    assert.equal(active.status, 200);
    const manifest = await active.json();
    assert.equal(manifest.slug, 'refaktoring-tooli');
    assert.equal(manifest.source, 'active');

    const missing = await fetch(`${baseUrl}/api/specs/active/missing-nonexistent-slug/content`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification content not found' });

    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content`, { method: 'POST' });
    assert.equal(mutation.status, 405);

    const traversal = await fetch(`${baseUrl}/api/specs/active/%2e%2e%2fsecret/content`);
    assert.equal(traversal.status, 404);

    const unknownSource = await fetch(`${baseUrl}/api/specs/other/refaktoring-tooli/content`);
    assert.equal(unknownSource.status, 404);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves exact per-document content routes without leaking lookup failures', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const doc = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/overview`);
    assert.equal(doc.status, 200);
    const payload = await doc.json();
    assert.equal(payload.docId, 'overview');
    assert.ok(payload.markdown.length > 0);

    const missing = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/task%3Amissing-task-id`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification document not found' });

    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content/overview`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves a small, fast task-statuses route without leaking lookup failures', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/task-statuses`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.slug, 'refaktoring-tooli');
    assert.equal(payload.source, 'active');
    assert.ok(Array.isArray(payload.tasks));

    const missing = await fetch(`${baseUrl}/api/specs/active/missing-nonexistent-slug/task-statuses`);
    assert.equal(missing.status, 404);

    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/task-statuses`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves provider-neutral pull request results through an exact read-only route', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/pull-requests`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.slug, 'refaktoring-tooli');
    assert.equal(payload.source, 'active');
    assert.ok(Array.isArray(payload.pullRequests));

    const missing = await fetch(`${baseUrl}/api/specs/archive/missing-nonexistent-slug/pull-requests`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Specification changes not found' });

    const traversal = await fetch(`${baseUrl}/api/specs/active/%2e%2e%2fsecret/pull-requests`);
    assert.equal(traversal.status, 404);

    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/pull-requests`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves the PR file-diffs route (POST { paths, headSha }) and rejects a malformed body', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const malformed = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/pull-requests/42/file-diffs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ headSha: 'sha-1' }),
    });
    assert.equal(malformed.status, 400);

    const wrongMethod = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/pull-requests/42/file-diffs`);
    assert.equal(wrongMethod.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('serves active-only lifecycle gates and executes explicit validated actions', async () => {
  const server = createDashboardServer({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const gates = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`);
    assert.equal(gates.status, 200);
    const actionsPayload = await gates.json();
    assert.equal(actionsPayload.slug, 'refaktoring-tooli');
    assert.ok(actionsPayload.tasks);

    const invalid = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: '{',
    });
    assert.equal(invalid.status, 400);

    const missingActionHeader = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify', taskId: 'shared-specs-workflow-operations' }),
    });
    assert.equal(missingActionHeader.status, 403);

    const invalidShape = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: 'null',
    });
    assert.equal(invalidShape.status, 400);

    const unknownAction = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      body: JSON.stringify({ action: 'nonexistent-action' }),
    });
    assert.equal(unknownAction.status, 400);

    const archived = await fetch(`${baseUrl}/api/specs/archive/refaktoring-tooli/actions`, { method: 'POST' });
    assert.equal(archived.status, 405);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});


