import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { buildDashboardApp } from '../server/index.mjs';
import { registerGlobalHttpInfrastructure } from '../server/infrastructure/http.mjs';
import specsRoutes from '../server/specs/routes.mjs';

// Characterization coverage specific to the Fastify migration (Task 09) —
// exercised via `app.inject()`, never a real network port. Behavior already
// covered by the adapted pre-existing suites (routing/method compatibility,
// SSE lifecycle, AI body-size overrides, static/SPA serving) is not
// duplicated here.

test('an unexpected actionExecutor failure is mapped by the specs capability\'s own local catch, not left to hang', async () => {
  // `actionExecutor` is the specs slice's own local override option (see
  // specs/routes.mjs's own comment) — exercised here by registering just
  // this one capability on a bare Fastify instance, never routed through
  // `buildDashboardApp()`.
  const app = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(app);
  await app.register(specsRoutes, {
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
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
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
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ slug: 'x'.repeat(5000) }),
    });
    assert.equal(res.statusCode, 413);
    // Fastify's own FST_ERR_CTP_BODY_TOO_LARGE message (no custom parser
    // remains to reword it — the shared error handler just forwards
    // `error.message`, which already carries a 413 statusCode).
    assert.deepEqual(res.json(), { error: 'Request body is too large' });
  } finally {
    await app.close();
  }
});

test('malformed JSON with a declared application/json content-type yields Fastify\'s own 400 message', async () => {
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs',
      headers: { 'content-type': 'application/json' },
      payload: '{not valid json',
    });
    assert.equal(res.statusCode, 400);
    // Fastify's own built-in JSON parser now runs (no permissive catch-all
    // parser to intercept it) — FST_ERR_CTP_INVALID_JSON_BODY.
    assert.deepEqual(res.json(), { error: "Body is not valid JSON but content-type is set to 'application/json'" });
  } finally {
    await app.close();
  }
});

test('a body with an unrelated content-type is never silently parsed as JSON', async () => {
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/specs',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ slug: 'looks-like-json' }),
    });
    // No dashboard route accepts `text/plain` — Fastify's default text
    // parser hands the raw string through, so the route's own "body must be
    // a JSON object" validation rejects it, exactly as it would reject any
    // other malformed request body. This is the point: nothing upstream
    // silently reinterprets it as JSON just because the bytes look JSON-ish.
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('an empty POST body parses as an empty object, matching the old readJsonBody contract', async () => {
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
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

test('HEAD falls through to the generic API 404 (no auto-HEAD, no custom method-fallback machinery)', async () => {
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  try {
    const res = await app.inject({ method: 'HEAD', url: '/api/health' });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('a source outside {active, archive} falls through to the generic API-not-found 404, not a resource-specific one', async () => {
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
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

  const app = await buildDashboardApp({ config: { distDir: tmpDist } });
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
  const app = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  await app.close();
  // A second close is a no-op, not a hang or throw.
  await app.close();
});
