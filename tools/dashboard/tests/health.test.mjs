import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardApp, listen } from '../server/index.mjs';

test('serves GET /api/health with status ok and rejects non-GET with 405', async () => {
  const server = buildDashboardApp({
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
