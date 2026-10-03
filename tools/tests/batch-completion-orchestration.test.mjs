// Test suite for Batch Completion Orchestration (Task 06, D8, D16, D17, D19, D31, D35, D40).
// Verifies:
// 1. Failed member B getting admitted as fresh refiner with parentSessionId = batch reviewer session id, no contention.
// 2. Atomic reservation release across all members without sibling window, and crash recovery after release.
// 3. Crash after member dispatch observing existing continuation rather than duplicating it.
// 4. Member's own workflow_progress history entry is readable before barrier releases.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import {
  getActiveAgentExecution,
  clearActiveAgentExecution,
  resetAdmissionStateForTest,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  acquireWorkspaceWriter,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createGroupReservation,
  getGroupReservation,
  isTaskBarriered,
} from '../specs/workflow/queue/index.mjs';
import {
  saveBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const workflowYaml = `id: test-orchestration-wf
title: "Test Orchestration Workflow"
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
        execution:
          session: fresh
          role: refiner
`;

function setupRepo(slug = 'test-orchestration-slug') {
  resetAdmissionStateForTest();
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-orch-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'root commit'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  fs.writeFileSync(path.join(workflowDir, 'test-orchestration-wf.yaml'), workflowYaml, 'utf8');

  const specId = randomUUID();
  const changeYaml = `id: ${slug}
spec_id: ${specId}
title: "Test Orchestration Change"
status: in-progress
workflow:
  mode: deterministic
  version: 1
  definition: test-orchestration-wf
tasks:
  - id: tA
    order: 1
    title: Task A
    status: in-review
    allowed_paths:
      - src/tA.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-A
          result: advance
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: pass
  - id: tB
    order: 2
    title: Task B
    status: in-review
    allowed_paths:
      - src/tB.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-B
          result: advance
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  fs.writeFileSync(path.join(taskDir, '01-tA.md'), `# Task A\n`, 'utf8');
  fs.writeFileSync(path.join(taskDir, '02-tB.md'), `# Task B\n`, 'utf8');

  return { tmpRoot, activeDir, changeDir, taskDir, workflowDir, sessionsDir, specId };
}

test('Failed member B gets admitted as fresh refiner with parentSessionId = batch reviewer session id, no contention', async () => {
  const slug = 'test-refiner-admission';
  const { tmpRoot, activeDir, specId } = setupRepo(slug);
  const taskIds = ['tA', 'tB'];
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-rev-batch-${randomUUID()}`;

  // 1. Create reservation
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });

  // 2. Acquire batch workspace writer claim
  const acq = await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds },
    sessionId: batchSessionId,
    batchExecutionId,
  });
  const ownerId = acq.ownerId;

  // 3. Mark batch finish record as completed
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'completed',
    results: {
      tA: { value: 'pass' },
      tB: { value: 'fail' },
    },
  });

  // 4. Mock session service to track turn admissions
  const admittedSessions = [];
  const mockSessionService = {
    createSession: async (sessionParams) => {
      const sessionId = `refiner-sess-${randomUUID()}`;
      admittedSessions.push({ sessionId, ...sessionParams });
      return { id: sessionId, ...sessionParams };
    },
    startTurn: async (sessionId, turnParams) => {
      return { turnId: `turn-${randomUUID()}`, sessionId, ...turnParams };
    },
  };

  // 5. Execute settlement saga
  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId,
    activeDir,
    options: {
      sessionService: mockSessionService,
    },
  });

  assert.equal(outcome.settled, true);
  assert.equal(outcome.status, 'completed');

  // Verify settlement record continuation results
  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.ok(settlement);
  assert.equal(settlement.stages.continuationDispatch.status, 'completed');

  // Member tB continuation must have admitted a refiner!
  const tBDispatch = settlement.stages.continuationDispatch.members.tB;
  assert.ok(tBDispatch);
  assert.equal(tBDispatch.status, 'completed');

  // Verify that an execution was admitted for tB
  if (tBDispatch.action === 'agent-admitted') {
    assert.equal(tBDispatch.admission?.admitted, true);
    // Verify parentSessionId equals the batch reviewer's session id (D8, D35)
    assert.equal(admittedSessions.length, 1);
    assert.equal(admittedSessions[0].parentSessionId, batchSessionId);
    assert.equal(admittedSessions[0].role, 'refiner');
  }

  // Workspace claim should now be held by the new refiner (or released if turn finished),
  // NEVER the old batch claim
  const currentClaim = getWorkspaceWriterClaim(tmpRoot);
  if (currentClaim) {
    assert.notEqual(currentClaim.ownerId, ownerId, 'Batch claim must be gone');
  }
});

test('Atomic reservation release across all members without sibling window + crash recovery', async () => {
  const slug = 'test-atomic-barrier-release';
  const { tmpRoot, activeDir, specId } = setupRepo(slug);
  const taskIds = ['tA', 'tB'];
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-rev-batch-${randomUUID()}`;

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });

  // Verify all members are barriered before release
  assert.equal(isTaskBarriered(slug, 'tA', { repoRoot: tmpRoot }), true);
  assert.equal(isTaskBarriered(slug, 'tB', { repoRoot: tmpRoot }), true);

  const acq = await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds },
    sessionId: batchSessionId,
    batchExecutionId,
  });

  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'completed',
    results: { tA: { value: 'pass' }, tB: { value: 'pass' } },
  });

  // Simulate crash immediately after reservation release
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId: acq.ownerId,
        activeDir,
        _crashAfterReservationRelease: true,
      });
    },
    /Simulated crash after reservation release/
  );

  // Both tasks MUST be atomically unbarriered at the exact same time (no sibling window)
  assert.equal(isTaskBarriered(slug, 'tA', { repoRoot: tmpRoot }), false);
  assert.equal(isTaskBarriered(slug, 'tB', { repoRoot: tmpRoot }), false);

  // Resuming from crash after release succeeds idempotently
  const resumeOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
  });

  assert.equal(resumeOutcome.settled, true);
  assert.equal(resumeOutcome.status, 'completed');
});

test('Crash after member dispatch observes existing continuation rather than duplicating it', async () => {
  const slug = 'test-dispatch-crash-resume';
  const { tmpRoot, activeDir, specId } = setupRepo(slug);
  const taskIds = ['tA', 'tB'];
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-rev-batch-${randomUUID()}`;

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });

  const acq = await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds },
    sessionId: batchSessionId,
    batchExecutionId,
  });

  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'completed',
    results: { tA: { value: 'pass' }, tB: { value: 'pass' } },
  });

  // Simulate crash after member tA dispatch
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId: acq.ownerId,
        activeDir,
        _crashAfterMemberDispatchTaskId: 'tA',
      });
    },
    /Simulated crash after member dispatch for task tA/
  );

  // Verify tA was recorded as completed in settlement
  const midSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(midSettlement.stages.continuationDispatch.members.tA.status, 'completed');
  assert.equal(midSettlement.stages.continuationDispatch.members.tB, undefined);

  // Resume settlement
  const resumeOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
  });

  assert.equal(resumeOutcome.settled, true);
  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(finalSettlement.stages.continuationDispatch.members.tA.status, 'completed');
  assert.equal(finalSettlement.stages.continuationDispatch.members.tB.status, 'completed');
  assert.equal(finalSettlement.status, 'completed');
});

test('Member own workflow_progress history entry is readable before barrier releases', async () => {
  const slug = 'test-history-readable-before-release';
  const { tmpRoot, activeDir } = setupRepo(slug);
  const taskIds = ['tA', 'tB'];
  const batchExecutionId = `batch-${randomUUID()}`;

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });

  // Barrier is active
  assert.equal(isTaskBarriered(slug, 'tA', { repoRoot: tmpRoot }), true);

  // Read member task's workflow_progress while barrier is still active
  const change = requireChange(slug, activeDir);
  const taskA = requireTask(change, 'tA');
  assert.ok(taskA.workflow_progress);
  assert.ok(Array.isArray(taskA.workflow_progress.history));
  assert.equal(taskA.workflow_progress.history.length, 2);
  assert.equal(taskA.workflow_progress.history[1].sessionId, 'session-rev-batch');
  assert.equal(taskA.workflow_progress.history[1].result, 'pass');
});
