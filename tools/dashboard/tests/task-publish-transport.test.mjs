import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { buildDashboardApp } from '../server/index.mjs';
import { loadChange } from '../../specs/store.mjs';
import { createGroupReservation } from '../../specs/workflow/queue/index.mjs';
import { acquireWorkspaceWriter } from '../../specs/workflow/workspace-writer.mjs';
import { saveBatchFinishRecord } from '../../specs/workflow/batch-finish/record.mjs';
import { createWorkspaceRequest, transitionWorkspaceRequest } from '../../specs/workflow/workspace-request.mjs';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
} from '../server/ai/orchestration/batch-completion-settlement.mjs';
import { resetAdmissionStateForTest, setDefaultSessionService } from '../server/ai/orchestration/admission.mjs';

const HANDOVER_WORKFLOW_YAML = `id: test-sweep-handover-wf
title: "Test Sweep Handover Workflow"
type: standard
version: 1
entryStep: implementation
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    purpose: "Implement code"
    expectedWork:
      summary: "Implement"
    transitions:
      - to: review
        continuation: auto
        execution:
          session: fresh
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Review code"
    expectedWork:
      summary: "Review"
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
        continuation: auto
        execution:
          session: fresh
          role: refiner
`;

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
spec_id: 11111111-1111-4111-8111-111111111111
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
spec_id: 22222222-2222-4222-8222-222222222222
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

  test('batch publish: completing a batch-publish request also sweeps and resumes an unrelated spec\'s durably pending grouped-handover settlement (task 16, third-round review finding 1)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-');
    resetAdmissionStateForTest();
    try {
      // Spec A: a grouped-handover settlement, durably pending, blocked by a
      // worktree-wide workspace request belonging to a completely different spec —
      // neither of the two slot-freeing triggers (a sibling of spec A settling, or
      // spec A's own singleton settling) can ever notice this block clearing, because
      // nothing of spec A was ever admitted in the first place.
      mkdirSync(join(fx.repo, '.nevo-ai', 'workflows'), { recursive: true });
      writeFileSync(join(fx.repo, '.nevo-ai', 'workflows', 'test-sweep-handover-wf.yaml'), HANDOVER_WORKFLOW_YAML);

      const slugA = 'handover-spec-a';
      const changeDirA = join(fx.activeDir, slugA);
      const taskDirA = join(changeDirA, 'tasks');
      mkdirSync(taskDirA, { recursive: true });
      const specIdA = randomUUID();
      const memberIds = ['tA', 'tB'];
      const tasksYamlA = memberIds.map((id, idx) => `  - id: ${id}
    order: ${idx + 1}
    title: Task ${id}
    status: in-review
    allowed_paths:
      - src/${id}.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-${id}
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
          transitioned_to: implementation
`).join('');
      writeFileSync(
        join(changeDirA, 'change.yaml'),
        `id: ${slugA}\nspec_id: ${specIdA}\ntitle: "Handover Spec A"\nstatus: in-progress\nworkflow:\n  mode: deterministic\n  version: 1\n  definition: test-sweep-handover-wf\ntasks:\n${tasksYamlA}`,
      );
      for (const id of memberIds) {
        writeFileSync(join(taskDirA, `${id}.md`), `# Task ${id}\n`, 'utf8');
      }

      // Spec B: an ordinary, unrelated spec with a draft task, used only to drive a
      // real batch-publish HTTP request through to completion.
      const slugB = 'publish-spec-b';
      const changeDirB = join(fx.activeDir, slugB);
      const tasksDirB = join(changeDirB, 'tasks');
      mkdirSync(tasksDirB, { recursive: true });
      writeFileSync(
        join(changeDirB, 'change.yaml'),
        `id: ${slugB}\nspec_id: ${randomUUID()}\ntitle: "Publish Spec B"\nstatus: in-progress\nworkflow:\n  mode: deterministic\n  definition: standard-v1\ntasks:\n  - id: 01-task\n    title: "First Task"\n    status: draft\n    file: tasks/01-task.md\n`,
      );
      writeFileSync(join(changeDirB, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDirB, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add handover spec A and publish spec B']);

      const batchExecutionId = `batch-${randomUUID()}`;
      const batchSessionId = `session-rev-batch-${randomUUID()}`;
      await createGroupReservation({
        repoRoot: fx.repo,
        changeSlug: slugA,
        taskIds: memberIds,
        batchExecutionId,
        executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
      });
      const acq = await acquireWorkspaceWriter({
        repoRoot: fx.repo,
        kind: 'agent',
        specId: specIdA,
        changeSlug: slugA,
        scope: { kind: 'task-batch', taskIds: memberIds },
        sessionId: batchSessionId,
        batchExecutionId,
      });
      saveBatchFinishRecord(fx.repo, slugA, {
        batchExecutionId,
        changeSlug: slugA,
        sessionId: batchSessionId,
        taskIds: memberIds,
        status: 'completed',
        results: Object.fromEntries(memberIds.map((id) => [id, { value: 'fail' }])),
      });

      const createdSessions = [];
      const mockSessionService = {
        createdSessions,
        createSession: async (provider, opts) => {
          const sessionId = `sess-${randomUUID()}`;
          createdSessions.push({ sessionId, provider, ...opts });
          return { sessionId };
        },
      };

      const blockingRequestId = randomUUID();
      await createWorkspaceRequest({
        repoRoot: fx.repo,
        requestId: blockingRequestId,
        kind: 'human-submit',
        specId: 'completely-unrelated-spec',
        taskId: 'completely-unrelated-task',
      });

      const firstOutcome = await executeBatchCompletionSettlement({
        repoRoot: fx.repo,
        changeSlug: slugA,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId: acq.ownerId,
        activeDir: fx.activeDir,
        options: { sessionService: mockSessionService },
      });
      assert.equal(firstOutcome.settled, false);
      assert.equal(firstOutcome.status, 'pending');

      // The blocking request genuinely completes — through a mechanism entirely
      // unrelated to spec A or spec B's own publish flow.
      await transitionWorkspaceRequest({
        repoRoot: fx.repo,
        requestId: blockingRequestId,
        expectedStatus: 'queued',
        to: 'cancelled',
      });

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });

      // The AI routes plugin just wired its own real default session service during
      // the build above — override it with the mock for this test's own admission
      // attempt now, after construction, so it isn't immediately clobbered back.
      setDefaultSessionService(mockSessionService);

      try {
        // A completely unrelated real HTTP request — spec B's own batch-publish —
        // is the only thing this test does directly. It knows nothing about spec A.
        const res = await app.inject({
          method: 'POST',
          url: `/api/specs/${slugB}/workflow/publish`,
          payload: {},
        });
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().ok, true);

        // Spec A's durably pending handover must now be resumed — as a side effect of
        // spec B's own batch-publish request completing and releasing its claim,
        // which triggers the dashboard route's own sweepAllPendingHandovers call.
        const settlementA = loadBatchCompletionSettlement(fx.repo, slugA, batchExecutionId);
        assert.equal(settlementA.status, 'completed', 'spec A\'s handover must be auto-resumed by spec B\'s own publish request completing');
        assert.equal(settlementA.stages.continuationDispatch.members.tA.action, 'agent-admitted');
        assert.equal(settlementA.stages.continuationDispatch.members.tB.action, 'agent-admitted');
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });
});
