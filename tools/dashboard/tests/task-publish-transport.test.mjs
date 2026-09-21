import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildDashboardApp } from '../server/index.mjs';
import { loadChange } from '../../specs/store.mjs';

const STANDARD_V1_YAML = `id: standard-v1
title: "Standard Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    executor: agent
    status:
      active: in-implementation
      completed: implemented
    purpose: "Implementation"
    expectedWork:
      summary: "Write code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    executor: agent
    status:
      active: in-review
      completed: reviewed
    purpose: "Review"
    expectedWork:
      summary: "Review code"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
`;

function createGitFixture(prefix = 'nevo-pub-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });

  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.com']);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'standard-v1.yaml'), STANDARD_V1_YAML);

  const activeDir = join(repo, 'specs', 'active');
  const archiveDir = join(repo, 'specs', 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'initial\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);

  return {
    base,
    repo,
    activeDir,
    archiveDir,
    git,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe('Deterministic Task Publish Transport & Projection', () => {
  test('single task publish: draft task publishes to approved and projection updates from draft to ready', async () => {
    const fx = createGitFixture('nevo-pub-single-');
    try {
      const changeDir = join(fx.activeDir, 'demo-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: demo-change
title: "Demo Change"
status: in-progress
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: 01-task
    title: "First Task"
    status: draft
    file: tasks/01-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add spec with draft task']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // 1. Initial actions: task is draft, canPublish: true, availableActions: []
      const preRes = await app.inject({
        method: 'GET',
        url: '/api/specs/active/demo-change/actions',
      });
      assert.equal(preRes.statusCode, 200);
      const preActions = preRes.json();
      assert.equal(preActions.tasks['01-task'].state, 'draft');
      assert.equal(preActions.tasks['01-task'].canPublish, true);
      assert.deepEqual(preActions.tasks['01-task'].availableActions, []);

      // 2. Publish task via POST /api/specs/demo-change/tasks/01-task/workflow/publish
      const pubRes = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/01-task/workflow/publish',
      });
      assert.equal(pubRes.statusCode, 200);
      const pubData = pubRes.json();
      assert.equal(pubData.ok, true);
      assert.equal(pubData.taskId, '01-task');
      assert.equal(pubData.status, 'approved');

      // 3. Post-publish change.yaml is updated to approved
      const reloaded = loadChange('demo-change', fx.activeDir);
      assert.equal(reloaded.tasks[0].status, 'approved');

      // 4. Post-publish actions: task is ready, canPublish: false, availableActions: ['start-step']
      const postRes = await app.inject({
        method: 'GET',
        url: '/api/specs/active/demo-change/actions',
      });
      assert.equal(postRes.statusCode, 200);
      const postActions = postRes.json();
      assert.equal(postActions.tasks['01-task'].state, 'ready');
      assert.equal(postActions.tasks['01-task'].canPublish, false);
      assert.deepEqual(postActions.tasks['01-task'].availableActions, ['start-step']);

      // 5. Publishing again fails with 400 because status is already approved
      const repeatRes = await app.inject({
        method: 'POST',
        url: '/api/specs/demo-change/tasks/01-task/workflow/publish',
      });
      assert.equal(repeatRes.statusCode, 400);
      assert.equal(repeatRes.json().code, 'TASK_PUBLISH_FAILED');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('single task publish: rejects publishing on legacy workflow', async () => {
    const fx = createGitFixture('nevo-pub-legacy-');
    try {
      const changeDir = join(fx.activeDir, 'legacy-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: legacy-change
title: "Legacy Change"
status: in-progress
tasks:
  - id: 01-task
    title: "First Task"
    status: draft
    file: tasks/01-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add legacy spec']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/legacy-change/tasks/01-task/workflow/publish',
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().code, 'TASK_PUBLISH_FAILED');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('batch publish: publishes all draft tasks or specified taskIds', async () => {
    const fx = createGitFixture('nevo-pub-batch-');
    try {
      const changeDir = join(fx.activeDir, 'batch-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: batch-change
title: "Batch Change"
status: in-progress
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: 01-task
    title: "First Task"
    status: draft
    file: tasks/01-task.md
  - id: 02-task
    title: "Second Task"
    status: draft
    file: tasks/02-task.md
  - id: 03-task
    title: "Third Task"
    status: draft
    file: tasks/03-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');
      writeFileSync(join(tasksDir, '02-task.md'), '# Task 2\n');
      writeFileSync(join(tasksDir, '03-task.md'), '# Task 3\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add batch spec']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // 1. Batch publish specific taskIds (01-task and 02-task)
      const batchSubsetRes = await app.inject({
        method: 'POST',
        url: '/api/specs/active/batch-change/workflow/publish',
        payload: { taskIds: ['01-task', '02-task'] },
      });
      assert.equal(batchSubsetRes.statusCode, 200);
      const batchSubsetData = batchSubsetRes.json();
      assert.equal(batchSubsetData.ok, true);
      assert.deepEqual(batchSubsetData.published, ['01-task', '02-task']);
      assert.equal(batchSubsetData.total, 2);

      // Verify 01-task and 02-task are approved, 03-task is still draft
      let reloaded = loadChange('batch-change', fx.activeDir);
      assert.equal(reloaded.tasks.find(t => t.id === '01-task').status, 'approved');
      assert.equal(reloaded.tasks.find(t => t.id === '02-task').status, 'approved');
      assert.equal(reloaded.tasks.find(t => t.id === '03-task').status, 'draft');

      // 2. Batch publish all remaining draft tasks without specifying taskIds
      const batchAllRes = await app.inject({
        method: 'POST',
        url: '/api/specs/batch-change/workflow/publish',
        payload: {},
      });
      assert.equal(batchAllRes.statusCode, 200);
      const batchAllData = batchAllRes.json();
      assert.equal(batchAllData.ok, true);
      assert.deepEqual(batchAllData.published, ['03-task']);
      assert.equal(batchAllData.total, 1);

      reloaded = loadChange('batch-change', fx.activeDir);
      assert.equal(reloaded.tasks.find(t => t.id === '03-task').status, 'approved');

      // 3. Batch publish when none remain draft returns total: 0
      const batchEmptyRes = await app.inject({
        method: 'POST',
        url: '/api/specs/batch-change/workflow/publish',
        payload: {},
      });
      assert.equal(batchEmptyRes.statusCode, 200);
      assert.equal(batchEmptyRes.json().total, 0);

      await app.close();
    } finally {
      fx.cleanup();
    }
  });

  test('batch publish: rejects on legacy workflow', async () => {
    const fx = createGitFixture('nevo-pub-batch-legacy-');
    try {
      const changeDir = join(fx.activeDir, 'legacy-change');
      const tasksDir = join(changeDir, 'tasks');
      mkdirSync(tasksDir, { recursive: true });

      const changeYaml = `id: legacy-change
title: "Legacy Change"
status: in-progress
tasks:
  - id: 01-task
    title: "First Task"
    status: draft
    file: tasks/01-task.md
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
      writeFileSync(join(changeDir, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDir, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add legacy spec']);

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/specs/legacy-change/workflow/publish',
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().code, 'LEGACY_WORKFLOW_MODE');

      await app.close();
    } finally {
      fx.cleanup();
    }
  });
});
