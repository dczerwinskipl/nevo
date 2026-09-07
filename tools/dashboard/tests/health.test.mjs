import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboardApp, listen } from '../server/index.mjs';

const NONEXISTENT_DIST = join(tmpdir(), 'nevo-nonexistent-dist');

test('serves GET /api/health with status ok and rejects unsupported methods with the generic API 404', async () => {
  const server = await buildDashboardApp({
    config: { distDir: NONEXISTENT_DIST },
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });

    // No custom 405 machinery: an unsupported method on a known API path
    // falls through to the same generic `/api/*` 404 as an unknown route —
    // no dashboard consumer ever distinguished the two.
    const postRes = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
    assert.equal(postRes.status, 404);
    assert.deepEqual(await postRes.json(), { error: 'API route not found' });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
