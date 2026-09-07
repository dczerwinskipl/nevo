import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

import { registerGlobalHttpInfrastructure } from '../server/infrastructure/http.mjs';
import specsRoutes from '../server/specs/routes.mjs';

// Proves the whole Specs vertical slice — dashboard/manifest/document/
// task-status reads, spec creation and its indexes, actions, and the
// change watcher — resolves its filesystem context from the exact same
// `resolveSpecsPaths(config)` call (see specs/routes.mjs, specs/service.mjs,
// specs/events.mjs), not a mix of configured paths for some operations and
// the real repository's specs/ tree for others. Every fixture directory
// here lives under a fresh temp root, so the test cannot accidentally pass
// by silently reading real repo data.
test('a custom root/activeDir/archiveDir configuration is used consistently by every Specs operation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nevo-specs-paths-'));
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  const activeIndexMd = join(root, 'active.generated.md');
  const archiveIndexMd = join(root, 'archive.generated.md');
  const indexJson = join(root, 'index.generated.json');

  const activeChangeDir = join(activeDir, 'custom-active-change');
  await mkdir(join(activeChangeDir, 'tasks'), { recursive: true });
  await writeFile(
    join(activeChangeDir, 'change.yaml'),
    [
      'id: custom-active-change',
      'title: Custom Active Change',
      'status: draft',
      'tasks:',
      '  - id: only-task',
      '    order: 1',
      '    file: tasks/01-only.md',
      '    status: draft',
      '',
    ].join('\n'),
  );
  await writeFile(join(activeChangeDir, 'overview.md'), '# Custom Active Change\n\nLives only in the temp fixture.');
  await writeFile(join(activeChangeDir, 'tasks', '01-only.md'), '# Only task\n\nContent.');

  const archiveChangeDir = join(archiveDir, 'custom-archived-change');
  await mkdir(archiveChangeDir, { recursive: true });
  await writeFile(
    join(archiveChangeDir, 'change.yaml'),
    ['id: custom-archived-change', 'title: Custom Archived Change', 'status: draft', 'tasks: []', ''].join('\n'),
  );
  await writeFile(join(archiveChangeDir, 'overview.md'), '# Custom Archived Change');

  let capturedActionExecutorArgs = null;
  const app = Fastify({ bodyLimit: 4096 });
  await registerGlobalHttpInfrastructure(app);
  app.decorate('operationRuntime', {
    createOperation: () => 'op-test',
    recordEvent: () => {},
    completeOperation: () => {},
    failOperation: () => {},
    getSnapshot: () => null,
  });
  await app.register(specsRoutes, {
    config: { root, activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson },
    actionExecutor: (args) => {
      capturedActionExecutorArgs = args;
      return { ok: true, operationId: 'op-test', action: args.action, taskId: args.taskId };
    },
  });
  const baseUrl = await app.listen({ port: 0 });

  // 8 & 9 set up first: connect and keep draining the Specs watcher's SSE
  // stream for the whole test, so events emitted by earlier steps (spec
  // creation) can't race a late-opened connection — proving the watcher
  // observes the same configured directories the read/write steps below
  // exercise, with logical `specs/active/...` prefixes.
  const controller = new AbortController();
  const sseRes = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
  assert.equal(sseRes.status, 200);
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value);
      }
    } catch {}
  })();
  while (!sseBuffer.includes('event: connected')) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  t.after(async () => {
    controller.abort();
    await pump.catch(() => {});
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  // 1. Dashboard/list data reads from the custom directories.
  const dashboardRes = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(dashboardRes.status, 200);
  const dashboard = await dashboardRes.json();
  assert.ok(
    dashboard.active.some((change) => change.slug === 'custom-active-change'),
    'dashboard active list is missing the custom-fixture change',
  );
  assert.ok(
    dashboard.archive.some((change) => change.slug === 'custom-archived-change'),
    'dashboard archive list is missing the custom-fixture change',
  );

  // 2. Manifest lookup uses the custom directories.
  const manifestRes = await fetch(`${baseUrl}/api/specs/active/custom-active-change/content`);
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.slug, 'custom-active-change');
  assert.equal(manifest.title, 'Custom Active Change');

  // 3. Document lookup uses the custom directories.
  const overviewRes = await fetch(`${baseUrl}/api/specs/active/custom-active-change/content/overview`);
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.match(overview.markdown, /Lives only in the temp fixture/);

  // 4. Task status lookup uses the custom directories.
  const taskStatusesRes = await fetch(`${baseUrl}/api/specs/active/custom-active-change/task-statuses`);
  assert.equal(taskStatusesRes.status, 200);
  const taskStatuses = await taskStatusesRes.json();
  assert.deepEqual(
    taskStatuses.tasks.map((task) => task.id),
    ['only-task'],
  );

  // The same change is invisible under the real repository's own specs/
  // tree — confirms the reads above did not fall back to it.
  assert.equal(existsSync(join(process.cwd(), 'specs', 'active', 'custom-active-change')), false);

  // 5. Spec creation writes to the custom directories.
  const createRes = await fetch(`${baseUrl}/api/specs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'custom-new-spec', title: 'Custom New Spec' }),
  });
  assert.equal(createRes.status, 201, JSON.stringify(await createRes.json().catch(() => null)));
  assert.equal(
    existsSync(join(activeDir, 'custom-new-spec', 'change.yaml')),
    true,
    'the new spec was not written into the configured activeDir',
  );
  assert.equal(
    existsSync(join(root, 'specs')),
    false,
    'a stray specs/ directory was created — creation fell back to a repo-shaped default path',
  );

  // 6. Relevant indexes are updated in the corresponding custom location,
  // not the real repository's specs/*.generated.* files.
  assert.equal(existsSync(activeIndexMd), true, 'active index markdown was not written to the configured path');
  assert.equal(existsSync(indexJson), true, 'index JSON was not written to the configured path');
  const indexJsonContent = JSON.parse(await readFile(indexJson, 'utf8'));
  assert.ok(
    indexJsonContent.changes.some((change) => change.id === 'custom-new-spec'),
    'the configured index.generated.json does not list the newly created spec',
  );

  // 7. Specs actions use the same configured context (activeDir/root are
  // exactly what was configured, not the real repository's).
  const actionsRes = await fetch(`${baseUrl}/api/specs/active/custom-active-change/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
    body: JSON.stringify({ action: 'verify', taskId: 'only-task' }),
  });
  assert.equal(actionsRes.status, 200, JSON.stringify(await actionsRes.json().catch(() => null)));
  assert.ok(capturedActionExecutorArgs, 'actionExecutor was never called');
  assert.equal(capturedActionExecutorArgs.activeDir, activeDir);
  assert.equal(capturedActionExecutorArgs.root, root);

  // 8 & 9. The Specs watcher watched the same configured directories all
  // along — the spec-creation write above (step 5) must have already been
  // reported, with the logical specs/active/... prefix, even though the
  // physical directory is a temp fixture.
  const deadline = Date.now() + 2000;
  while (!sseBuffer.includes('custom-new-spec') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(sseBuffer, /event: specs-changed/);
  const dataLines = sseBuffer.split('\n').filter((line) => line.startsWith('data:'));
  const allFiles = dataLines.flatMap((line) => {
    try {
      return JSON.parse(line.slice('data:'.length).trim()).files || [];
    } catch {
      return [];
    }
  });
  assert.ok(
    allFiles.some((file) => file.startsWith('specs/active/custom-new-spec/')),
    `expected a specs/active/custom-new-spec/... file in watcher events, got: ${JSON.stringify(allFiles)}`,
  );
  assert.ok(
    allFiles.every((file) => file.startsWith('specs/active/') || file.startsWith('specs/archive/')),
    `a watcher event used a path outside the logical specs/active|archive prefixes: ${JSON.stringify(allFiles)}`,
  );
});
