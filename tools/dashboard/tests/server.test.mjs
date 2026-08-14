import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardServer, listen } from '../server/index.mjs';

function fakeHub() {
  return {
    subscribe: () => () => {},
    close: () => {},
  };
}

test('serves read-only dashboard data and rejects unknown or mutating routes', async () => {
  const server = createDashboardServer({
    dataLoader: () => ({ active: [], archive: [], counts: { active: 0, archived: 0 } }),
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const dashboard = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.deepEqual((await dashboard.json()).counts, { active: 0, archived: 0 });

    const mutation = await fetch(`${baseUrl}/api/dashboard`, { method: 'POST' });
    assert.equal(mutation.status, 405);

    const unknown = await fetch(`${baseUrl}/api/specs/../../secret`);
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test('does not expose filesystem details when loading fails', async () => {
  const server = createDashboardServer({
    dataLoader: () => { throw new Error('D:\\private\\specs\\change.yaml'); },
    eventHub: fakeHub(),
    distDir: 'Z:/does-not-exist',
  });
  const baseUrl = await listen(server, { port: 0 });

  try {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: 'Unable to load specifications' });
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});
