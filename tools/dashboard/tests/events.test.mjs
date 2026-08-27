import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardApp, listen } from '../server/index.mjs';

test('serves GET /api/events with SSE headers, connected event, eventHub subscription, and rejects POST with 405', async () => {
  let subscriber = null;
  let unsubscribed = false;
  const fakeHub = {
    subscribe: (fn) => {
      subscriber = fn;
      return () => { unsubscribed = true; };
    },
    close: () => {},
  };

  const server = buildDashboardApp({
    eventHub: fakeHub,
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const postRes = await fetch(`${baseUrl}/api/events`, { method: 'POST' });
    assert.equal(postRes.status, 405);
    assert.deepEqual(await postRes.json(), { error: 'Method not allowed' });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
    assert.equal(res.headers.get('connection'), 'keep-alive');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const { value: firstChunk } = await reader.read();
    const text = decoder.decode(firstChunk);
    assert.match(text, /event: connected/);

    assert.equal(typeof subscriber, 'function');
    subscriber({ type: 'specs-changed', slug: 'sample' });
    const { value: secondChunk } = await reader.read();
    const text2 = decoder.decode(secondChunk);
    assert.match(text2, /event: specs-changed/);

    controller.abort();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(unsubscribed, true);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('server shutdown closes open SSE connections and cleans subscriptions exactly once without client disconnect', async () => {
  let unsubscribeCallCount = 0;
  const fakeHub = {
    subscribe: () => {
      return () => {
        unsubscribeCallCount++;
      };
    },
    close: () => {},
  };

  const server = buildDashboardApp({
    eventHub: fakeHub,
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  // Open a real persistent SSE connection without aborting it
  const res = await fetch(`${baseUrl}/api/events`);
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const { value: firstChunk, done: firstDone } = await reader.read();
  assert.equal(firstDone, false);
  assert.match(new TextDecoder().decode(firstChunk), /event: connected/);

  // Initiate graceful server close while client SSE connection is actively open
  const closePromise = new Promise((resolvePromise) => server.close(resolvePromise));

  // The reader must receive stream completion (done: true) because server closes the SSE response
  const { done: streamEnded } = await reader.read();
  assert.equal(streamEnded, true, 'SSE stream was closed by server shutdown');

  // Server close completes without needing client abort
  await closePromise;

  assert.equal(unsubscribeCallCount, 1, 'EventHub subscriber was cleaned up exactly once');
});
