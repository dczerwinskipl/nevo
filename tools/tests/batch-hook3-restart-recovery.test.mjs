// Hook 3 batch claim restart recovery integration tests.
// Tests the real reconcileBootState() path for batch scope claims (Issue #3 fix).
// Each scenario uses a real temp git repo and actual durable file writes.
//
// Scenario A: Full batch lifecycle — reservation → batch-finish completed → reconcileBootState resumes settlement
// Scenario B: Crash after batch-start but before batch-finish — Hook 3 fails closed to recovery-required
// Scenario C: Batch claim missing batchExecutionId — Hook 3 fails closed to recovery-required
// Scenario D: Batch claim in 'invoking' state — Hook 3 fails closed to recovery-required
// Scenario E: assessBatchExecutionSettlement returns false when batch-finish not completed, true when completed
// Scenario F: acquireWorkspaceWriter persists batchExecutionId in workspace-writer claim

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { createGroupReservation, getGroupReservation } from '../specs/workflow/queue/reservation.mjs';
import {
  acquireWorkspaceWriter,
  updateWorkspaceWriterIfOwned,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createBatchFinishRecord,
  saveBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';
import {
  loadBatchCompletionSettlement,
  assessBatchExecutionSettlement,
  executeBatchCompletionSettlement,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import { reconcileBootState } from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import { createWorkspaceRequest, transitionWorkspaceRequest } from '../specs/workflow/workspace-request.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function setupBatchTestRepo(slug) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-hook3-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');

  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );

  const specUuid = randomUUID();
  const changeYaml = `id: ${slug}
spec_id: ${specUuid}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
  fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: tmpRoot });

  return { tmpRoot, activeDir, changeDir, specUuid };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A: Full batch lifecycle — batch-finish completed → Hook 3 resumes settlement
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario A: Hook 3 resumes executeBatchCompletionSettlement when batch-finish completed but settlement not started', async () => {
  const { tmpRoot, activeDir, specUuid } = setupBatchTestRepo('hook3-scenario-a');
  try {
    const changeSlug = 'hook3-scenario-a';
    const sessionId = randomUUID();

    // 1. Production queue reservation
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug,
      taskIds: ['t1', 't2'],
      executionConfigSnapshot: { provider: 'mock', model: 'm', mode: 'agent', contextCapacity: { status: 'unknown' } },
    });
    assert.ok(reservation, 'Reservation must be created');
    const batchExecutionId = reservation.batchExecutionId;

    // 2. Production workspace-writer claim in 'started' state
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId,
    });
    assert.equal(acquireRes.acquired, true, 'Workspace writer must be acquired');

    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRoot,
      expectedOwnerId: acquireRes.ownerId,
      expectedKind: 'agent',
      expectedSpecId: specUuid,
      expectedChangeSlug: changeSlug,
      expectedScope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      sessionId,
      turnStartState: 'started',
      batchExecutionId,
    });

    // 3. Production completed batch-finish record
    const finishRecord = createBatchFinishRecord({
      repoRoot: tmpRoot,
      changeSlug,
      batchExecutionId,
      taskIds: ['t1', 't2'],
      results: {
        t1: { result: 'pass' },
        t2: { result: 'pass' },
      },
      reportPath: `specs/active/${changeSlug}/reviews/review-batch-${batchExecutionId}.md`,
      sessionId,
    });
    finishRecord.status = 'completed';
    saveBatchFinishRecord(tmpRoot, changeSlug, finishRecord);

    // 4. Hook 3 boot reconciliation (simulates restart before Hook 1 was called)
    const result = await reconcileBootState({ repoRoot: tmpRoot, activeDir });
    assert.ok(result.reconciledClaims >= 1, 'Should have reconciled at least 1 claim');

    // 5. Assertions on settlement record
    const settlement = loadBatchCompletionSettlement(tmpRoot, changeSlug, batchExecutionId);
    assert.ok(settlement, 'Settlement record must exist');
    assert.equal(settlement.status, 'completed', 'Settlement must reach completed status');
    assert.equal(settlement.stages.claimRelease.status, 'completed', 'Claim release stage must be completed');
    assert.equal(settlement.stages.activeExecutionClear.status, 'completed', 'Active execution clear stage must be completed');
    assert.equal(settlement.stages.reservationRelease.status, 'completed', 'Reservation release stage must be completed');
    assert.equal(settlement.stages.continuationDispatch.status, 'completed', 'Continuation dispatch stage must be completed');

    // 6. Assertions on workspace claim & reservation
    const claimAfter = getWorkspaceWriterClaim(tmpRoot);
    // The original batch workspace claim was released. t1 and t2 share an identical
    // resulting continuation contract (both transition from implementation to the same
    // review step with the same role), so task 05's grouped handover admits ONE new
    // batch covering both members, not two independent single-task claims.
    assert.equal(claimAfter?.scope?.kind, 'task-batch', 'Continuation claim should be a new task-batch claim covering both members');
    assert.notEqual(claimAfter?.batchExecutionId, batchExecutionId, 'Must be a new batch execution, not the original one');

    const resAfter = getGroupReservation(tmpRoot, changeSlug, batchExecutionId);
    assert.equal(resAfter?.status, 'released', 'Group reservation must be released');

    // 7. Assertions on member continuations
    assert.equal(settlement.stages.continuationDispatch.members.t1?.status, 'completed');
    assert.equal(settlement.stages.continuationDispatch.members.t2?.status, 'completed');
    assert.equal(settlement.stages.continuationDispatch.members.t1?.action, 'agent-admitted');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B: Crash after batch-start (started state) but batch-finish NOT completed
// → Hook 3 must fail closed to recovery-required, NOT release reservation
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario B: Hook 3 fails closed when batch claim exists but batch-finish is not completed', async () => {
  const { tmpRoot, activeDir, specUuid } = setupBatchTestRepo('hook3-scenario-b');
  try {
    const changeSlug = 'hook3-scenario-b';
    const sessionId = randomUUID();

    // 1. Production queue reservation (still active)
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug,
      taskIds: ['t1', 't2'],
      executionConfigSnapshot: { provider: 'mock', model: 'm', mode: 'agent', contextCapacity: { status: 'unknown' } },
    });
    const batchExecutionId = reservation.batchExecutionId;

    // 2. Production workspace-writer claim in 'started' state
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId,
    });
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRoot,
      expectedOwnerId: acquireRes.ownerId,
      expectedKind: 'agent',
      expectedSpecId: specUuid,
      expectedChangeSlug: changeSlug,
      expectedScope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      sessionId,
      turnStartState: 'started',
      batchExecutionId,
    });

    // NO batch-finish record → batch finish did NOT complete

    // 3. Hook 3 boot reconciliation
    await reconcileBootState({ repoRoot: tmpRoot, activeDir });

    // 4. Claim must be marked recovery-required (NOT released)
    const claimAfter = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(claimAfter !== null, 'Claim should not be deleted');
    assert.equal(claimAfter?.status, 'recovery-required', 'Claim must be recovery-required when batch-finish was not completed');

    // 5. Reservation must NOT be released
    const resAfter = getGroupReservation(tmpRoot, changeSlug, batchExecutionId);
    assert.equal(resAfter?.status, 'reserved', 'Reservation must remain reserved');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C: Batch claim missing batchExecutionId → fails closed to recovery-required
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario C: Batch claim without batchExecutionId fails closed to recovery-required', async () => {
  const { tmpRoot, activeDir, specUuid } = setupBatchTestRepo('hook3-scenario-c');
  try {
    const changeSlug = 'hook3-scenario-c';

    // Claim acquired without batchExecutionId
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
    });
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRoot,
      expectedOwnerId: acquireRes.ownerId,
      expectedKind: 'agent',
      expectedSpecId: specUuid,
      expectedChangeSlug: changeSlug,
      expectedScope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      sessionId: randomUUID(),
      turnStartState: 'started',
    });

    await reconcileBootState({ repoRoot: tmpRoot, activeDir });

    const claimAfter = getWorkspaceWriterClaim(tmpRoot);
    assert.equal(claimAfter?.status, 'recovery-required', 'Batch claim with missing batchExecutionId must be marked recovery-required');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D: Batch claim in 'invoking' state → ambiguous, fails closed
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario D: Batch claim in invoking state fails closed to recovery-required', async () => {
  const { tmpRoot, activeDir, specUuid } = setupBatchTestRepo('hook3-scenario-d');
  try {
    const changeSlug = 'hook3-scenario-d';
    const batchExecutionId = randomUUID();

    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId,
    });
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRoot,
      expectedOwnerId: acquireRes.ownerId,
      expectedKind: 'agent',
      expectedSpecId: specUuid,
      expectedChangeSlug: changeSlug,
      expectedScope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      sessionId: randomUUID(),
      turnStartState: 'invoking', // Crashed mid-invoke
      batchExecutionId,
    });

    await reconcileBootState({ repoRoot: tmpRoot, activeDir });

    const claimAfter = getWorkspaceWriterClaim(tmpRoot);
    assert.equal(claimAfter?.status, 'recovery-required', 'Batch claim in invoking state must be marked recovery-required');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario E: assessBatchExecutionSettlement returns true when batch-finish is completed
// and false when batch-finish is absent or not completed
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario E: assessBatchExecutionSettlement correctly reads durable batch-finish state', async () => {
  const { tmpRoot } = setupBatchTestRepo('hook3-scenario-e');
  try {
    const batchExecutionId = randomUUID();
    const changeSlug = 'hook3-scenario-e';

    // No batch-finish record at all → not settled
    const r1 = assessBatchExecutionSettlement({ repoRoot: tmpRoot, changeSlug, batchExecutionId });
    assert.equal(r1.settled, false);
    assert.equal(r1.reason, 'batch-finish-not-found');

    // Batch-finish in 'validated' (not completed) state
    const record = createBatchFinishRecord({
      repoRoot: tmpRoot,
      changeSlug,
      batchExecutionId,
      taskIds: ['t1', 't2'],
      results: { t1: { result: 'pass' }, t2: { result: 'pass' } },
      reportPath: `specs/active/${changeSlug}/reviews/review-batch-${batchExecutionId}.md`,
    });
    assert.equal(record.status, 'validated');

    const r2 = assessBatchExecutionSettlement({ repoRoot: tmpRoot, changeSlug, batchExecutionId });
    assert.equal(r2.settled, false);
    assert.equal(r2.reason, 'batch-finish-not-completed');

    // Update to completed
    record.status = 'completed';
    saveBatchFinishRecord(tmpRoot, changeSlug, record);

    const r3 = assessBatchExecutionSettlement({ repoRoot: tmpRoot, changeSlug, batchExecutionId });
    assert.equal(r3.settled, true);
    assert.ok(r3.finishRecord);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario F: acquireWorkspaceWriter persists batchExecutionId durably in claim
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario F: acquireWorkspaceWriter persists batchExecutionId in workspace-writer claim', async () => {
  const { tmpRoot, specUuid } = setupBatchTestRepo('hook3-scenario-f');
  try {
    const batchExecutionId = randomUUID();
    const changeSlug = 'hook3-scenario-f';

    const result = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug,
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId,
    });

    assert.equal(result.acquired, true, 'Should have acquired workspace writer');

    const claim = getWorkspaceWriterClaim(tmpRoot);
    assert.equal(claim?.batchExecutionId, batchExecutionId, 'batchExecutionId must be durably written to claim');
    assert.equal(claim?.scope?.kind, 'task-batch', 'Scope kind must be task-batch');
    assert.deepEqual(claim?.scope?.taskIds?.sort(), ['t1', 't2'].sort(), 'Task IDs must match');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario G (task 16, third-round review finding 1): Hook 3 sweeps and resumes a
// durably pending grouped-handover settlement blocked by a worktree-wide transient
// admission reason — no live claim of its own is even involved in triggering this;
// Hook 3's own boot/first-request reconciliation is the only mechanism that can ever
// notice this class of block clearing.
// ─────────────────────────────────────────────────────────────────────────────
test('Scenario G: Hook 3 boot reconciliation sweeps and resumes a durably pending grouped-handover settlement once its blocking workspace request has cleared', async () => {
  const slug = 'hook3-scenario-g';
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-hook3-${slug}-`));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

    const activeDir = path.join(tmpRoot, 'specs', 'active');
    const changeDir = path.join(activeDir, slug);
    const taskDir = path.join(changeDir, 'tasks');
    const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(workflowDir, { recursive: true });

    const handoverWorkflowYaml = `id: test-hook3-handover-wf
title: "Test Hook3 Handover Workflow"
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
    fs.writeFileSync(path.join(workflowDir, 'test-hook3-handover-wf.yaml'), handoverWorkflowYaml, 'utf8');

    const specUuid = randomUUID();
    const memberIds = ['tA', 'tB'];
    const tasksYaml = memberIds.map((id, idx) => `  - id: ${id}
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
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: ${slug}\nspec_id: ${specUuid}\nworkflow:\n  mode: deterministic\n  version: 1\n  definition: test-hook3-handover-wf\ntasks:\n${tasksYaml}`,
      'utf8',
    );
    for (const id of memberIds) {
      fs.writeFileSync(path.join(taskDir, `${id}.md`), `# Task ${id}\n`, 'utf8');
    }
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial'], { cwd: tmpRoot });

    const batchExecutionId = `batch-${randomUUID()}`;
    const batchSessionId = `session-rev-batch-${randomUUID()}`;
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds: memberIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
    });
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: specUuid,
      changeSlug: slug,
      scope: { kind: 'task-batch', taskIds: memberIds },
      sessionId: batchSessionId,
      batchExecutionId,
    });
    saveBatchFinishRecord(tmpRoot, slug, {
      batchExecutionId,
      changeSlug: slug,
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
      repoRoot: tmpRoot,
      requestId: blockingRequestId,
      kind: 'human-submit',
      specId: 'completely-unrelated-spec',
      taskId: 'completely-unrelated-task',
    });

    const firstOutcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId,
      sessionId: batchSessionId,
      ownerId: acq.ownerId,
      activeDir,
      options: { sessionService: mockSessionService },
    });
    assert.equal(firstOutcome.settled, false);
    assert.equal(firstOutcome.status, 'pending');

    // The blocking request genuinely completes.
    await transitionWorkspaceRequest({
      repoRoot: tmpRoot,
      requestId: blockingRequestId,
      expectedStatus: 'queued',
      to: 'cancelled',
    });

    // No live claim of any kind exists at this point — Hook 3's own claim-snapshot
    // reconciliation (step 1) and workspace-request reconciliation (step 2) both have
    // nothing to do. Only the new sweep step (task 16) can notice spec A's own
    // durably pending handover and resume it.
    assert.equal(getWorkspaceWriterClaim(tmpRoot), null);
    await reconcileBootState({ repoRoot: tmpRoot, activeDir, sessionService: mockSessionService });

    const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
    assert.equal(settlement.status, 'completed', 'Hook 3 must have discovered and resumed this handover on its own');
    assert.equal(settlement.stages.continuationDispatch.members.tA.action, 'agent-admitted');
    assert.equal(settlement.stages.continuationDispatch.members.tB.action, 'agent-admitted');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
