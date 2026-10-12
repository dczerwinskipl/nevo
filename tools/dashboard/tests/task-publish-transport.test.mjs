import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

const HUMAN_VERIFICATION_WORKFLOW_YAML = `id: test-human-verification-wf
title: "Test Human Verification Workflow"
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
        to: human-verification
      - value: fail
        to: implementation
  human-verification:
    executor: human
    status:
      active: awaiting-human-verification
      completed: completed
    purpose: "Human Verification"
    expectedWork:
      summary: "Verify work"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
        action:
          label: Approve
      - value: fail
        to: implementation
        action:
          label: Request changes
          feedback:
            required: true
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

// push: true with no configured git remote (createGitFixture never sets one up) —
// any commit-and-push finalize/publish push step genuinely fails, letting the
// failure-path sweep tests (task 18) exercise a real "settled as failure, claim
// released, then throw" lifecycle rather than a contrived one.
const PUSH_ENABLED_STANDARD_V1_YAML = `id: push-enabled-standard-v1
title: "Push-Enabled Standard Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
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

const PUSH_ENABLED_HUMAN_VERIFICATION_WORKFLOW_YAML = `id: test-human-verification-push-wf
title: "Test Human Verification Workflow (push enabled)"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
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
        to: human-verification
      - value: fail
        to: implementation
  human-verification:
    executor: human
    status:
      active: awaiting-human-verification
      completed: completed
    purpose: "Human Verification"
    expectedWork:
      summary: "Verify work"
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
        action:
          label: Approve
      - value: fail
        to: implementation
        action:
          label: Request changes
          feedback:
            required: true
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

  // Shared setup for the sweep-wiring tests below (task 16's batch-publish wiring,
  // task 17's human-step and single-task-publish wiring): spec A carries a durably
  // pending grouped-handover settlement, blocked by a worktree-wide workspace request
  // belonging to a completely different spec — neither of the two slot-freeing
  // triggers (a sibling of spec A settling, or spec A's own singleton settling) can
  // ever notice this block clearing, because nothing of spec A was ever admitted in
  // the first place.
  async function setupPendingHandoverSpecA(fx) {
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

    const batchExecutionId = `batch-${randomUUID()}`;
    const batchSessionId = `session-rev-batch-${randomUUID()}`;
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

    return {
      slugA,
      memberIds,
      batchExecutionId,
      batchSessionId,
      specIdA,
      mockSessionService,
      blockingRequestId,
      async activate() {
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
        // unrelated to whatever HTTP request this test will use to drive the sweep.
        await transitionWorkspaceRequest({
          repoRoot: fx.repo,
          requestId: blockingRequestId,
          expectedStatus: 'queued',
          to: 'cancelled',
        });
      },
      assertResumed() {
        const settlementA = loadBatchCompletionSettlement(fx.repo, slugA, batchExecutionId);
        assert.equal(settlementA.status, 'completed', 'spec A\'s handover must be auto-resumed');
        assert.equal(settlementA.stages.continuationDispatch.members.tA.action, 'agent-admitted');
        assert.equal(settlementA.stages.continuationDispatch.members.tB.action, 'agent-admitted');
      },
    };
  }

  test('batch publish: completing a batch-publish request also sweeps and resumes an unrelated spec\'s durably pending grouped-handover settlement (task 16, third-round review finding 1)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-');
    resetAdmissionStateForTest();
    try {
      const handover = await setupPendingHandoverSpecA(fx);

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

      await handover.activate();

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
      setDefaultSessionService(handover.mockSessionService);

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
        handover.assertResumed();
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });

  test('single-task publish: completing a publish request also sweeps and resumes an unrelated spec\'s durably pending grouped-handover settlement (task 17, fifth-round review finding 2)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-single-');
    resetAdmissionStateForTest();
    try {
      const handover = await setupPendingHandoverSpecA(fx);

      const slugB = 'publish-single-spec-b';
      const changeDirB = join(fx.activeDir, slugB);
      const tasksDirB = join(changeDirB, 'tasks');
      mkdirSync(tasksDirB, { recursive: true });
      writeFileSync(
        join(changeDirB, 'change.yaml'),
        `id: ${slugB}\nspec_id: ${randomUUID()}\ntitle: "Publish Single Spec B"\nstatus: in-progress\nworkflow:\n  mode: deterministic\n  definition: standard-v1\ntasks:\n  - id: 01-task\n    title: "First Task"\n    status: draft\n    file: tasks/01-task.md\n`,
      );
      writeFileSync(join(changeDirB, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDirB, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add handover spec A and single-publish spec B']);

      await handover.activate();

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });
      setDefaultSessionService(handover.mockSessionService);

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/specs/${slugB}/tasks/01-task/workflow/publish`,
        });
        assert.equal(res.statusCode, 200);
        handover.assertResumed();
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });

  test('human-step: completing a human-step action also sweeps and resumes an unrelated spec\'s durably pending grouped-handover settlement (task 17, fifth-round review finding 2)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-humanstep-');
    resetAdmissionStateForTest();
    try {
      const handover = await setupPendingHandoverSpecA(fx);

      mkdirSync(join(fx.repo, '.nevo-ai', 'workflows'), { recursive: true });
      writeFileSync(join(fx.repo, '.nevo-ai', 'workflows', 'test-human-verification-wf.yaml'), HUMAN_VERIFICATION_WORKFLOW_YAML);

      const slugB = 'human-step-spec-b';
      const changeDirB = join(fx.activeDir, slugB);
      const tasksDirB = join(changeDirB, 'tasks');
      mkdirSync(tasksDirB, { recursive: true });
      const changeYamlB = `id: ${slugB}
spec_id: ${randomUUID()}
title: "Human Step Spec B"
workflow:
  mode: deterministic
  definition: test-human-verification-wf
tasks:
  - id: task-waiting-human
    title: "Task waiting for human verification"
    status: in-implementation
    file: tasks/01-task.md
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
      writeFileSync(join(changeDirB, 'change.yaml'), changeYamlB);
      writeFileSync(join(changeDirB, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDirB, '01-task.md'), '---\nid: task-waiting-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add handover spec A and human-step spec B']);

      await handover.activate();

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });
      setDefaultSessionService(handover.mockSessionService);

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/specs/${slugB}/tasks/task-waiting-human/workflow/human-step`,
          payload: { action: 'start' },
        });
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().ok, true);
        handover.assertResumed();
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });

  test('single-task publish: an operation that resolves its own workspace-request/claim lifecycle as failure and THEN throws still sweeps and resumes an unrelated spec\'s durably pending handover (task 18, sixth-round review finding 1)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-single-fail-');
    resetAdmissionStateForTest();
    try {
      const handover = await setupPendingHandoverSpecA(fx);

      mkdirSync(join(fx.repo, '.nevo-ai', 'workflows'), { recursive: true });
      writeFileSync(join(fx.repo, '.nevo-ai', 'workflows', 'push-enabled-standard-v1.yaml'), PUSH_ENABLED_STANDARD_V1_YAML);

      // push: true with no configured git remote — publishTask's own commit succeeds
      // but the push step genuinely throws, which its own try/catch/finally marks
      // the request 'failed' and releases the claim for, then re-throws. The route's
      // sweep must still fire on this exact failure path, not only on success.
      const slugB = 'publish-single-fail-spec-b';
      const changeDirB = join(fx.activeDir, slugB);
      const tasksDirB = join(changeDirB, 'tasks');
      mkdirSync(tasksDirB, { recursive: true });
      writeFileSync(
        join(changeDirB, 'change.yaml'),
        `id: ${slugB}\nspec_id: ${randomUUID()}\ntitle: "Publish Single Fail Spec B"\nstatus: in-progress\nworkflow:\n  mode: deterministic\n  definition: push-enabled-standard-v1\ntasks:\n  - id: 01-task\n    title: "First Task"\n    status: draft\n    file: tasks/01-task.md\n`,
      );
      writeFileSync(join(changeDirB, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDirB, '01-task.md'), '# Task 1\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add handover spec A and push-failing publish spec B']);

      await handover.activate();

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });
      setDefaultSessionService(handover.mockSessionService);

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/specs/${slugB}/tasks/01-task/workflow/publish`,
        });
        // The push genuinely fails (no remote configured) — this must be a real
        // error response, not a silently-swallowed success, proving the test
        // actually exercises the failure path and not the already-covered success
        // path.
        assert.notEqual(res.statusCode, 200);
        handover.assertResumed();
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });

  test('human-step: an action that genuinely fails after acquiring the workspace-writer claim still invokes the sweep in finally, not only on success (task 18, sixth-round review finding 1)', async () => {
    const fx = createGitFixture('nevo-pub-sweep-humanstep-fail-');
    resetAdmissionStateForTest();
    try {
      const handover = await setupPendingHandoverSpecA(fx);

      mkdirSync(join(fx.repo, '.nevo-ai', 'workflows'), { recursive: true });
      writeFileSync(
        join(fx.repo, '.nevo-ai', 'workflows', 'test-human-verification-push-wf.yaml'),
        PUSH_ENABLED_HUMAN_VERIFICATION_WORKFLOW_YAML,
      );

      // Task is already active at human-verification — submitting 'pass' runs the
      // real submit/finalize path (commit-and-push). The commit succeeds locally but
      // the push genuinely throws (no remote configured); human-step/operations.mjs
      // fails closed to a live, recovery-marked claim in this case (by design — the
      // operation is safely resumable, not safe to treat as cleanly settled) rather
      // than releasing it outright. That means spec A's own pending unit correctly
      // CANNOT be admitted yet (the worktree-wide claim is still physically held) —
      // but the route's sweep must still have been *invoked* on this failure path
      // (not only on success), observable as a fresh settlement write even though the
      // unit's own status cannot change while the claim remains live.
      const slugB = 'human-step-spec-b-fail';
      const changeDirB = join(fx.activeDir, slugB);
      const tasksDirB = join(changeDirB, 'tasks');
      mkdirSync(tasksDirB, { recursive: true });
      const changeYamlB = `id: ${slugB}
spec_id: ${randomUUID()}
title: "Human Step Spec B Fail"
workflow:
  mode: deterministic
  definition: test-human-verification-push-wf
tasks:
  - id: task-active-human
    title: "Task active at human verification"
    status: in-implementation
    file: tasks/01-task.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
      writeFileSync(join(changeDirB, 'change.yaml'), changeYamlB);
      writeFileSync(join(changeDirB, 'overview.md'), '# Overview\n');
      writeFileSync(join(tasksDirB, '01-task.md'), '---\nid: task-active-human\nstatus: in-implementation\n---\n# Task\n');

      fx.git(['add', '-A']);
      fx.git(['commit', '-m', 'add handover spec A and push-failing human-step spec B']);

      await handover.activate();

      const settlementBefore = loadBatchCompletionSettlement(fx.repo, handover.slugA, handover.batchExecutionId);
      const updatedAtBefore = settlementBefore.updatedAt;

      const app = await buildDashboardApp({
        config: {
          root: fx.repo,
          activeDir: fx.activeDir,
          archiveDir: fx.archiveDir,
        },
      });
      setDefaultSessionService(handover.mockSessionService);

      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/specs/${slugB}/tasks/task-active-human/workflow/human-step`,
          payload: { action: 'submit', result: 'pass' },
        });
        // Real failure (no remote configured) — proves this exercises the failure
        // path, not the already-covered success path.
        assert.notEqual(res.statusCode, 200);

        const settlementAfter = loadBatchCompletionSettlement(fx.repo, handover.slugA, handover.batchExecutionId);
        assert.notEqual(
          settlementAfter.updatedAt,
          updatedAtBefore,
          'the sweep must have run (re-persisting the settlement on its own pending-unit retry attempt) even though spec B\'s own operation failed — a try-only sweep would leave this file completely untouched by spec B\'s own failed request',
        );
        const pendingUnit = settlementAfter.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tA'));
        assert.equal(
          pendingUnit.status,
          'pending',
          'correctly still pending — spec B\'s own claim remains physically held (recovery-required), so admission is correctly, safely refused; this is not a bug in the sweep itself',
        );
      } finally {
        await app.close();
      }
    } finally {
      resetAdmissionStateForTest();
      fx.cleanup();
    }
  });
});
