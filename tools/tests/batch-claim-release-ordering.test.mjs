// Test suite for Batch Claim Release Ordering and Staged Settlement (Task 06, D35, D40).
// Verifies exact ordering: settlement proof -> claim release -> activeExecutions clear -> reservation release -> dispatch.
// Verifies crash recovery at each stage and structural dispatch safety guards.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  acquireWorkspaceWriter,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createGroupReservation,
  getGroupReservation,
} from '../specs/workflow/queue/index.mjs';
import {
  saveBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';

const standardWorkflowYaml = `id: standard-v1
title: "Standard Workflow"
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

function setupTestRepo(slug = 'test-claim-ordering') {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-claim-order-'));
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

  fs.writeFileSync(path.join(workflowDir, 'standard.yaml'), standardWorkflowYaml, 'utf8');

  const specId = randomUUID();
  const changeYaml = `id: ${slug}
spec_id: ${specId}
title: "Test Change"
status: in-progress
workflow:
  mode: deterministic
  version: 1
  definition: standard
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-review
    allowed_paths:
      - src/t1.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
  - id: t2
    order: 2
    title: Task 2
    status: in-review
    allowed_paths:
      - src/t2.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');

  fs.writeFileSync(path.join(taskDir, '01-t1.md'), `# Task 1\n`, 'utf8');
  fs.writeFileSync(path.join(taskDir, '02-t2.md'), `# Task 2\n`, 'utf8');

  return { tmpRoot, activeDir, changeDir, taskDir, workflowDir, sessionsDir, specId };
}

test('Exact D35 ordering: claim release -> active-execution clear -> reservation release -> dispatch with crash recovery at each stage', async () => {
  const slug = 'test-ordering-saga';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  const taskIds = ['t1', 't2'];
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-${randomUUID()}`;

  // 1. Create group reservation
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });

  // Verify reservation is active
  const initialRes = getGroupReservation(tmpRoot, slug, batchExecutionId);
  assert.equal(initialRes.status, 'reserved');

  // 2. Create batch workspace claim
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

  const initialClaim = getWorkspaceWriterClaim(tmpRoot);
  assert.ok(initialClaim);
  assert.equal(initialClaim.scope?.kind, 'task-batch');
  assert.deepEqual(initialClaim.scope?.taskIds, taskIds);

  // 3. Register active execution in admission
  const { registerActiveAgentExecution } = await import('../dashboard/server/ai/orchestration/admission.mjs');
  registerActiveAgentExecution(slug, {
    ownerId,
    sessionId: batchSessionId,
    candidate: { batchExecutionId },
    scope: { kind: 'task-batch', taskIds },
    specId,
  });
  assert.ok(getActiveAgentExecution(slug));

  // 4. Mark batch-finish record as completed
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'completed',
    results: {
      t1: { value: 'pass' },
      t2: { value: 'pass' },
    },
  });

  // --- STAGE 1: Crash after claim release ---
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId,
        activeDir,
        _crashAfterClaimRelease: true,
      });
    },
    /Simulated crash after claim release/
  );

  // Assert Stage 1 outcome:
  // - Claim is released!
  const claimAfterCrash1 = getWorkspaceWriterClaim(tmpRoot);
  assert.equal(claimAfterCrash1, null, 'Workspace claim must be released');
  // - Active execution still present!
  assert.ok(getActiveAgentExecution(slug), 'Active execution must not be cleared yet');
  // - Reservation still reserved!
  const resAfterCrash1 = getGroupReservation(tmpRoot, slug, batchExecutionId);
  assert.equal(resAfterCrash1.status, 'reserved', 'Reservation must still be reserved');

  // Verify settlement record state on disk
  const settlement1 = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.ok(settlement1);
  assert.equal(settlement1.stages.claimRelease.status, 'completed');
  assert.equal(settlement1.stages.activeExecutionClear.status, 'pending');
  assert.equal(settlement1.stages.reservationRelease.status, 'pending');

  // --- STAGE 2: Resume, crash after active execution clear ---
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId,
        activeDir,
        _crashAfterActiveExecutionClear: true,
      });
    },
    /Simulated crash after active execution clear/
  );

  // Assert Stage 2 outcome:
  // - Active execution is now cleared!
  assert.equal(getActiveAgentExecution(slug), null, 'Active execution must be cleared');
  // - Reservation still reserved!
  const resAfterCrash2 = getGroupReservation(tmpRoot, slug, batchExecutionId);
  assert.equal(resAfterCrash2.status, 'reserved', 'Reservation must still be reserved');

  // Verify settlement record state on disk
  const settlement2 = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(settlement2.stages.claimRelease.status, 'completed');
  assert.equal(settlement2.stages.activeExecutionClear.status, 'completed');
  assert.equal(settlement2.stages.reservationRelease.status, 'pending');

  // --- STAGE 3: Resume, crash after reservation release ---
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId,
        activeDir,
        _crashAfterReservationRelease: true,
      });
    },
    /Simulated crash after reservation release/
  );

  // Assert Stage 3 outcome:
  // - Reservation is now released!
  const resAfterCrash3 = getGroupReservation(tmpRoot, slug, batchExecutionId);
  assert.equal(resAfterCrash3.status, 'released', 'Reservation must be atomically released');

  // Verify settlement record state on disk
  const settlement3 = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(settlement3.stages.claimRelease.status, 'completed');
  assert.equal(settlement3.stages.activeExecutionClear.status, 'completed');
  assert.equal(settlement3.stages.reservationRelease.status, 'completed');
  assert.equal(settlement3.stages.continuationDispatch.status, 'pending');

  // --- STAGE 4 & 5: Resume to final completion ---
  const finalOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId,
    activeDir,
  });

  assert.equal(finalOutcome.settled, true);
  assert.equal(finalOutcome.status, 'completed');

  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(finalSettlement.status, 'completed');
  assert.equal(finalSettlement.stages.claimRelease.status, 'completed');
  assert.equal(finalSettlement.stages.activeExecutionClear.status, 'completed');
  assert.equal(finalSettlement.stages.reservationRelease.status, 'completed');
  assert.equal(finalSettlement.stages.continuationDispatch.status, 'completed');
});

test('Structural Dispatch Safety Guard: dispatch cannot occur while workspace claim is held', async () => {
  const slug = 'test-dispatch-guard';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  const taskIds = ['t1', 't2'];
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-${randomUUID()}`;
  const ownerId = `owner-${randomUUID()}`;

  // 1. Create group reservation and release it upfront
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds,
    batchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });
  const { releaseGroupReservation } = await import('../specs/workflow/queue/index.mjs');
  await releaseGroupReservation({ repoRoot: tmpRoot, changeSlug: slug, batchExecutionId });

  // 2. Re-acquire claim to simulate an unreleased workspace claim before dispatch
  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    ownerId,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds },
    sessionId: batchSessionId,
    batchExecutionId,
  });

  // 3. Mark batch-finish record as completed
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'completed',
    results: { t1: { value: 'pass' }, t2: { value: 'pass' } },
  });

  // 4. Manually construct a settlement record where stages 1-3 were marked completed,
  // but the live claim is actually still held on disk!
  const { saveBatchCompletionSettlement } = await import('../dashboard/server/ai/orchestration/batch-completion-settlement.mjs');
  saveBatchCompletionSettlement(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    sessionId: batchSessionId,
    taskIds,
    status: 'pending',
    stages: {
      claimRelease: { status: 'completed' }, // Falsely marked or corrupted stage
      activeExecutionClear: { status: 'completed' },
      reservationRelease: { status: 'completed' },
      continuationDispatch: { status: 'pending', members: {} },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // 5. Attempt execution: structural guard must catch the held claim and throw DISPATCH_BEFORE_CLAIM_RELEASE
  await assert.rejects(
    async () => {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        changeSlug: slug,
        batchExecutionId,
        sessionId: batchSessionId,
        ownerId,
        activeDir,
      });
    },
    (err) => {
      assert.equal(err.code, 'DISPATCH_BEFORE_CLAIM_RELEASE');
      return true;
    }
  );
});

test('Settlement fails safe when batch-finish has not durably reached completed', async () => {
  const slug = 'test-unsettled-batch';
  const { tmpRoot, activeDir } = setupTestRepo(slug);
  const taskIds = ['t1', 't2'];
  const batchExecutionId = `batch-${randomUUID()}`;

  // Batch finish record in validated status (not completed)
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId,
    changeSlug: slug,
    taskIds,
    status: 'validated',
  });

  const res = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    activeDir,
  });

  assert.equal(res.settled, false);
  assert.equal(res.reason, 'BATCH_FINISH_NOT_COMPLETED');
});
