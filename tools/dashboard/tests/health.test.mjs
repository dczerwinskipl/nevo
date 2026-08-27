import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardServer, listen } from '../server/index.mjs';
import { handleHealthRoute } from '../server/routes/health.mjs';

test('health route adapter: returns false for non-health URLs', () => {
  const handled = handleHealthRoute({
    request: {},
    response: {},
    method: 'GET',
    url: new URL('http://127.0.0.1/api/specs'),
  });
  assert.equal(handled, false);
});

test('serves GET /api/health with status ok and rejects non-GET with 405', async () => {
  const server = createDashboardServer({
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });

    const postRes = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
    assert.equal(postRes.status, 405);
    assert.deepEqual(await postRes.json(), { error: 'Method not allowed' });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});
