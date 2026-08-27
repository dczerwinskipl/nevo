import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { createDashboardServer } from '../server/index.mjs';
import { ACTIVE_DIR } from '../../specs/store.mjs';
import { refreshSpecsIndexes } from '../../specs/indexes.mjs';

function fakeHub() {
  return { subscribe: () => () => {}, close: () => {} };
}

async function startTestServer() {
  const server = createDashboardServer({
    eventHub: fakeHub(),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('POST /api/specs creates specification and returns 201 Created', async () => {
  const env = await startTestServer();
  const slug = `temp-spec-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        title: 'My New Spec',
        type: 'standard',
        goal: 'My goal description',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.slug, slug);
    assert.ok(body.specId);
    assert.equal(body.change.title, 'My New Spec');
  } finally {
    await env.close();
    try {
      rmSync(join(ACTIVE_DIR, slug), { recursive: true, force: true });
      refreshSpecsIndexes();
    } catch {}
  }
});

test('POST /api/specs rejects invalid slug with 400 Bad Request', async () => {
  const env = await startTestServer();
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'INVALID SLUG WITH SPACES',
        title: 'My Title',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'SPEC_VALIDATION_ERROR');
    assert.ok(body.error.includes('Invalid specification slug'));
  } finally {
    await env.close();
  }
});

test('POST /api/specs rejects duplicate slug with 409 Conflict', async () => {
  const env = await startTestServer();
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'refaktoring-tooli',
        title: 'Duplicate Spec',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'SPEC_CONFLICT');
  } finally {
    await env.close();
  }
});

test('POST /api/specs rejects non-POST methods with 405 Method Not Allowed', async () => {
  const env = await startTestServer();
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'GET',
    });
    assert.equal(res.status, 405);
  } finally {
    await env.close();
  }
});
