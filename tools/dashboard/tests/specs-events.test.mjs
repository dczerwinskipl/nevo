import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { buildDashboardApp, listen } from '../server/index.mjs';
import { registerGlobalHttpInfrastructure } from '../server/infrastructure/http.mjs';
import specEventRoutes from '../server/specs/events.mjs';
import specsRoutes from '../server/specs/routes.mjs';

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

test('specs events: app.close() awaits the watcher\'s own close() rather than firing-and-forgetting it', async () => {
  let resolveWatcherClose;
  const watcherCloseCalled = new Promise(resolve => { resolveWatcherClose = resolve; });
  let watcherClosed = false;
  const controlledWatcher = {
    subscribe: () => () => {},
    close: () => {
      // Only resolves once the test explicitly releases it — proves
      // app.close() itself is blocked on this promise, not just the
      // low-level chokidar wrapper in isolation.
      return watcherCloseCalled.then(() => { watcherClosed = true; });
    },
  };

  const app = await buildSpecEventsTestApp({ watcher: controlledWatcher });
  await app.listen({ port: 0 });

  let closeResolved = false;
  const closePromise = app.close().then(() => { closeResolved = true; });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closeResolved, false, 'app.close() resolved before the watcher finished closing');
  assert.equal(watcherClosed, false);

  resolveWatcherClose();
  await closePromise;
  assert.equal(closeResolved, true);
  assert.equal(watcherClosed, true, 'app.close() waited for the watcher\'s close() to actually settle');
});

test('specs events: a configured activeDir/archiveDir is what the watcher actually watches, not the real repo\'s specs/ tree', async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'nevo-specs-watcher-config-'));
  const activeDir = join(tmpRoot, 'active');
  const archiveDir = join(tmpRoot, 'archive');
  await mkdir(activeDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  // No `watcher` override — this exercises the real
  // createSpecChangeWatcher(), proving specsRoutes resolves the exact same
  // config.activeDir/config.archiveDir the rest of the Specs capability
  // uses (see specs/routes.mjs and specs/events.mjs's own comments), not a
  // separately-derived default pointed at the real repo's specs/ tree.
  const app = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(app);
  app.decorate('operationRuntime', {
    createOperation: () => 'op-test',
    recordEvent: () => {},
    completeOperation: () => {},
    failOperation: () => {},
    getSnapshot: () => null,
  });
  await app.register(specsRoutes, { config: { activeDir, archiveDir } });
  const baseUrl = await app.listen({ port: 0 });

  try {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = decoder.decode((await reader.read()).value); // "connected"
    assert.match(buffered, /event: connected/);

    await writeFile(join(activeDir, 'sample-change.yaml'), 'id: sample-change\n');

    buffered = '';
    while (!buffered.includes('event: specs-changed')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value);
    }
    assert.match(buffered, /event: specs-changed/);
    const dataLine = buffered.split('\n').find(line => line.startsWith('data:'));
    const payload = JSON.parse(dataLine.slice('data:'.length).trim());
    assert.deepEqual(payload.files, ['specs/active/sample-change.yaml']);

    controller.abort();
  } finally {
    await app.close();
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
