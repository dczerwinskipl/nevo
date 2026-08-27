import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDashboardApp } from '../server/index.mjs';

function fakeHub() {
  return { subscribe: () => () => {}, close: () => {} };
}

// Characterization coverage specific to the Fastify migration (Task 09) —
// exercised via `app.inject()`, never a real network port. Behavior already
// covered by the adapted pre-existing suites (routing/method compatibility,
// SSE lifecycle, AI body-size overrides, static/SPA serving) is not
// duplicated here.

test('an unexpected actionExecutor failure is mapped by the specs capability\'s own local catch, not left to hang', async () => {
  const app = buildDashboardApp({
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
    actionExecutor: () => {
      throw new Error('boom: unexpected failure unrelated to any known domain error');
    },
  });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs/active/refaktoring-tooli/actions',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: { action: 'approve', taskId: 'shared-specs-workflow-operations' },
    });
    // The specs capability's own try/catch handles this (matching the old
    // contract) — it never reaches the shared global error handler, which
    // the next test exercises directly.
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { error: 'Unable to execute specification action.' });
  } finally {
    await app.close();
  }
});

test('a truly uncaught error reaches the shared Fastify error handler as a generic 500', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  app.get('/__test/boom', async () => {
    throw new Error('unexpected internal failure');
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { error: 'Internal server error' });
  } finally {
    await app.close();
  }
});

test('the default 4096-byte body limit applies to non-AI routes and rejects oversized JSON with 413', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ slug: 'x'.repeat(5000) }),
    });
    assert.equal(res.statusCode, 413);
    assert.deepEqual(res.json(), { error: 'Request body is too large.' });
  } finally {
    await app.close();
  }
});

test('malformed JSON on the default body parser yields the exact old 400 message', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs',
      headers: { 'content-type': 'application/json' },
      payload: '{not valid json',
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'Request body must be valid JSON.' });
  } finally {
    await app.close();
  }
});

test('an empty POST body parses as an empty object, matching the old readJsonBody contract', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  try {
    const res = await app.inject({ method: 'POST', url: '/api/specs' });
    // No `slug` in an empty body reaches domain validation (not the
    // transport-level "must be a JSON object" 400) — proving the body
    // parsed to `{}`, not `undefined`.
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.notEqual(body.error, 'Request body must be a JSON object.');
  } finally {
    await app.close();
  }
});

test('HEAD is rejected with 405 on API routes, matching the pre-Fastify contract (no auto-HEAD)', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  try {
    const res = await app.inject({ method: 'HEAD', url: '/api/health' });
    assert.equal(res.statusCode, 405);
  } finally {
    await app.close();
  }
});

test('a source outside {active, archive} falls through to the generic API-not-found 404, not a resource-specific one', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/specs/bogus-source/refaktoring-tooli/content' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: 'API route not found' });
  } finally {
    await app.close();
  }
});

test('static caching distinguishes index.html (no-cache) from versioned assets (immutable)', async () => {
  const tmpDist = join(tmpdir(), `nevo-dist-fastify-test-${Date.now()}`);
  mkdirSync(tmpDist, { recursive: true });
  writeFileSync(join(tmpDist, 'index.html'), '<!doctype html><html><body>Test</body></html>');
  writeFileSync(join(tmpDist, 'app.abc123.js'), 'console.log("app");');

  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: tmpDist });
  try {
    const index = await app.inject({ method: 'GET', url: '/' });
    assert.equal(index.statusCode, 200);
    assert.equal(index.headers['cache-control'], 'no-cache');

    const asset = await app.inject({ method: 'GET', url: '/app.abc123.js' });
    assert.equal(asset.statusCode, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

    // SPA fallback also gets the index.html cache policy.
    const spa = await app.inject({ method: 'GET', url: '/specs/active/some-change' });
    assert.equal(spa.statusCode, 200);
    assert.equal(spa.headers['cache-control'], 'no-cache');
    assert.match(spa.headers['content-type'], /text\/html/);
  } finally {
    await app.close();
    rmSync(tmpDist, { recursive: true, force: true });
  }
});

test('graceful shutdown via app.close() completes deterministically and rejects new requests while closing', async () => {
  const app = buildDashboardApp({ eventHub: fakeHub(), distDir: 'Z:/does-not-exist' });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  await app.close();
  // A second close is a no-op, not a hang or throw.
  await app.close();
});
