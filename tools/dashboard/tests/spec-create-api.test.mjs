import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { createDashboardServer } from '../server/index.mjs';
import { refreshSpecsIndexes, SpecRollbackError } from '../../specs/service.mjs';

function fakeHub() {
  return { subscribe: () => () => {}, close: () => {} };
}

async function startTestServer(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nevo-dashboard-spec-test-'));
  const activeDir = join(root, 'specs', 'active');
  const archiveDir = join(root, 'specs', 'archive');
  const activeIndexMd = join(root, 'specs', 'active.generated.md');
  const archiveIndexMd = join(root, 'specs', 'archive.generated.md');
  const indexJson = join(root, 'specs', 'index.generated.json');

  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  refreshSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson });

  const server = createDashboardServer({
    eventHub: fakeHub(),
    specCreator: (input) => options.specCreator
      ? options.specCreator(input)
      : import('../../specs/service.mjs').then(m => m.createSpecification({
          ...input,
          activeDir,
          archiveDir,
          activeIndexMd,
          archiveIndexMd,
          indexJson,
        })),
    ...options,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

test('POST /api/specs creates specification and returns 201 Created', async () => {
  const env = await startTestServer();
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'my-new-spec',
        title: 'My New Spec',
        type: 'standard',
        goal: 'My goal description',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.slug, 'my-new-spec');
    assert.ok(body.specId);
    assert.equal(body.change.title, 'My New Spec');
  } finally {
    await env.close();
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
    const firstRes = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'duplicate-spec',
        title: 'First Spec',
      }),
    });
    assert.equal(firstRes.status, 201);

    const secondRes = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'duplicate-spec',
        title: 'Second Spec',
      }),
    });
    assert.equal(secondRes.status, 409);
    const body = await secondRes.json();
    assert.equal(body.code, 'SPEC_CONFLICT');
  } finally {
    await env.close();
  }
});

test('POST /api/specs returns 500 on SpecRollbackError with failedSteps metadata', async () => {
  const env = await startTestServer({
    specCreator: async () => {
      throw new SpecRollbackError('Rollback failed during index recovery', {
        slug: 'failed-rollback-spec',
        failedSteps: ['rebuild_indexes'],
      });
    },
  });
  try {
    const res = await fetch(`${env.baseUrl}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'failed-rollback-spec',
        title: 'Failing Rollback Spec',
      }),
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'SPEC_ROLLBACK_FAILED');
    assert.equal(body.slug, 'failed-rollback-spec');
    assert.deepEqual(body.failedSteps, ['rebuild_indexes']);
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
