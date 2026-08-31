import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildDashboardApp, listen } from '../server/index.mjs';

const NONEXISTENT_DIST = join(tmpdir(), 'nevo-nonexistent-dist');

test('composed server routes all major capability route groups', async () => {
  const server = await buildDashboardApp({ config: { distDir: NONEXISTENT_DIST } });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);

    const dashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);

    const specContent = await fetch(`${baseUrl}/api/specs/active/refaktoring-tooli/content`);
    assert.equal(specContent.status, 200);

    const operation = await fetch(`${baseUrl}/api/operations/non-existent-op`);
    assert.equal(operation.status, 404);

    const providers = await fetch(`${baseUrl}/api/agent-providers`);
    assert.equal(providers.status, 200);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('handles unknown /api/* fallback with 404 JSON', async () => {
  const server = await buildDashboardApp({ config: { distDir: NONEXISTENT_DIST } });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const unknownGet = await fetch(`${baseUrl}/api/nonexistent-route`);
    assert.equal(unknownGet.status, 404);
    assert.deepEqual(await unknownGet.json(), { error: 'API route not found' });

    const unknownPost = await fetch(`${baseUrl}/api/nonexistent-route`, { method: 'POST' });
    assert.equal(unknownPost.status, 404);
    assert.deepEqual(await unknownPost.json(), { error: 'API route not found' });

    const nestedUnknown = await fetch(`${baseUrl}/api/unknown/subpath/secret`);
    assert.equal(nestedUnknown.status, 404);
    assert.deepEqual(await nestedUnknown.json(), { error: 'API route not found' });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('handles static asset serving and missing distDir fallback', async () => {
  const serverMissing = await buildDashboardApp({ config: { distDir: NONEXISTENT_DIST } });
  const baseUrlMissing = await listen(serverMissing, { port: 0 });

  try {
    const res = await fetch(`${baseUrlMissing}/`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Dashboard assets not found');
  } finally {
    await new Promise(resolvePromise => serverMissing.close(resolvePromise));
  }

  const tmpDist = join(tmpdir(), `nevo-dist-test-${Date.now()}`);
  mkdirSync(tmpDist, { recursive: true });
  writeFileSync(join(tmpDist, 'index.html'), '<!doctype html><html><body>Test</body></html>');
  writeFileSync(join(tmpDist, 'app.js'), 'console.log("app");');

  const serverWithDist = await buildDashboardApp({ config: { distDir: tmpDist } });
  const baseUrlWithDist = await listen(serverWithDist, { port: 0 });

  try {
    const indexRes = await fetch(`${baseUrlWithDist}/`);
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers.get('content-type'), /text\/html/);
    assert.match(await indexRes.text(), /<!doctype html>/);

    const jsRes = await fetch(`${baseUrlWithDist}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers.get('content-type'), /javascript/);
    assert.match(await jsRes.text(), /console\.log/);

    const spaFallback = await fetch(`${baseUrlWithDist}/specs/active/refaktoring-tooli`);
    assert.equal(spaFallback.status, 200);
    assert.match(spaFallback.headers.get('content-type'), /text\/html/);

    // Regression guard: a rebuild that lands new hashed asset filenames
    // while the server is still running (no restart) must still be served —
    // `wildcard: false` would glob distDir once at plugin-registration time
    // and 404 on anything added after that snapshot.
    writeFileSync(join(tmpDist, 'app.newhash123.js'), 'console.log("rebuilt");');
    const rebuiltRes = await fetch(`${baseUrlWithDist}/app.newhash123.js`);
    assert.equal(rebuiltRes.status, 200);
    assert.match(await rebuiltRes.text(), /rebuilt/);
  } finally {
    await new Promise(resolvePromise => serverWithDist.close(resolvePromise));
    rmSync(tmpDist, { recursive: true, force: true });
  }
});

// The one root-level resource: app.mjs decorates the real app instance with
// it (see app.mjs's own comment), so its shutdown wiring is a genuine
// full-app HTTP-integration concern — verified here by reading the public
// `operationRuntime` decoration directly, with no fake/mock and no config
// injection. What `.shutdown()` itself does to the runtime is already
// covered by operations.test.mjs's own unit tests; this only confirms
// app.mjs actually calls it when the app closes. Each other capability's own
// shutdown wiring (eventHub, AI service) is covered by that capability's own
// slice-level tests (events.test.mjs, ai-server.test.mjs).
test('the shared operationRuntime decoration is shut down when the app closes', async () => {
  const server = await buildDashboardApp({ config: { distDir: NONEXISTENT_DIST } });
  const runtime = server.operationRuntime;
  assert.ok(runtime, 'operationRuntime is decorated on the app instance');

  await server.close();

  assert.throws(
    () => runtime.createOperation(),
    err => err.status === 503,
    'operationRuntime was shut down when the app closed',
  );
});
