import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardApp, listen } from '../server/index.mjs';
function fakeHub() { return { subscribe: () => () => {}, close: () => {} }; }
test('serves provider-neutral pull request results through an exact read-only route', async () => {
  const server = await buildDashboardApp({
    config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' },
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
    // No custom 405 machinery: an unsupported method on a known path falls
    // through to the generic `/api/*` 404, same as an unknown route.
    const mutation = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/pull-requests`, { method: 'POST' });
    assert.equal(mutation.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
test('serves the PR file-diffs route (POST { paths, headSha }) and rejects a malformed body', async () => {
  const server = await buildDashboardApp({
    config: { events: { eventHub: fakeHub() }, distDir: 'Z:/does-not-exist' },
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
    assert.equal(wrongMethod.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});
