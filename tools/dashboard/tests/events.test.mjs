import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardServer, listen } from '../server/index.mjs';
import { handleEventsRoute } from '../server/routes/events.mjs';

test('events route adapter: returns false for non-events URLs', () => {
  const handled = handleEventsRoute({
    request: {},
    response: {},
    method: 'GET',
    url: new URL('http://127.0.0.1/api/health'),
    eventHub: { subscribe: () => () => {} },
  });
  assert.equal(handled, false);
});

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

  const server = createDashboardServer({
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
