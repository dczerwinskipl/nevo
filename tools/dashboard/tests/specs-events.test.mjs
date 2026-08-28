import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { buildDashboardApp, listen } from '../server/index.mjs';
import { registerGlobalHttpInfrastructure } from '../server/infrastructure/http.mjs';
import specEventRoutes from '../server/specs/events.mjs';

test('full app: GET /api/events opens an SSE stream and POST falls through to the generic API 404', async () => {
  const server = await buildDashboardApp({ config: { distDir: 'Z:/does-not-exist' } });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const postRes = await fetch(`${baseUrl}/api/events`, { method: 'POST' });
    assert.equal(postRes.status, 404);
    assert.deepEqual(await postRes.json(), { error: 'API route not found' });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    // @fastify/sse's own headers (no charset on content-type, no
    // "no-transform" on cache-control — the established plugin's shape, not
    // our old hand-rolled one).
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(res.headers.get('connection'), 'keep-alive');

    const reader = res.body.getReader();
    const { value: firstChunk } = await reader.read();
    assert.match(new TextDecoder().decode(firstChunk), /event: connected/);

    controller.abort();
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

// `watcher` is the specs-events slice's own local override option (see
// specs/events.mjs's own comment) — a feature-level test seam, exercised
// here by registering just this one sub-plugin on a bare Fastify instance
// (with the same global infra app.mjs installs), never routed through
// `buildDashboardApp()`.
async function buildSpecEventsTestApp({ watcher }) {
  const app = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(app);
  await app.register(specEventRoutes, { watcher });
  return app;
}

test('specs events: SSE subscribes to the watcher, forwards its events, and unsubscribes once on client disconnect', async () => {
  let subscriber = null;
  let unsubscribed = false;
  const fakeWatcher = {
    subscribe: (fn) => {
      subscriber = fn;
      return () => { unsubscribed = true; };
    },
    close: () => {},
  };

  const app = await buildSpecEventsTestApp({ watcher: fakeWatcher });
  const baseUrl = await app.listen({ port: 0 });

  try {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const { value: firstChunk } = await reader.read();
    assert.match(decoder.decode(firstChunk), /event: connected/);

    assert.equal(typeof subscriber, 'function');
    subscriber({ type: 'specs-changed', slug: 'sample' });
    const { value: secondChunk } = await reader.read();
    assert.match(decoder.decode(secondChunk), /event: specs-changed/);

    controller.abort();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(unsubscribed, true);
  } finally {
    await app.close();
  }
});

test('specs events: server shutdown closes open SSE connections and cleans subscriptions exactly once without client disconnect', async () => {
  let unsubscribeCallCount = 0;
  const fakeWatcher = {
    subscribe: () => () => { unsubscribeCallCount++; },
    close: () => {},
  };

  const app = await buildSpecEventsTestApp({ watcher: fakeWatcher });
  const baseUrl = await app.listen({ port: 0 });

  // Open a real persistent SSE connection without aborting it
  const res = await fetch(`${baseUrl}/api/events`);
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const { value: firstChunk, done: firstDone } = await reader.read();
  assert.equal(firstDone, false);
  assert.match(new TextDecoder().decode(firstChunk), /event: connected/);

  // Initiate graceful server close while client SSE connection is actively open
  const closePromise = app.close();

  // The reader must receive stream completion (done: true) because server closes the SSE response
  const { done: streamEnded } = await reader.read();
  assert.equal(streamEnded, true, 'SSE stream was closed by server shutdown');

  // Server close completes without needing client abort
  await closePromise;

  assert.equal(unsubscribeCallCount, 1, 'watcher subscriber was cleaned up exactly once');
});
