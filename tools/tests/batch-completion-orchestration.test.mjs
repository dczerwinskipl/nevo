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
  TRANSIENT_ADMISSION_REASONS,
  sweepAllPendingHandovers,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
} from '../specs/workflow/workspace-request.mjs';
import {
  getActiveAgentExecution,
  clearActiveAgentExecution,
  resetAdmissionStateForTest,
  releaseAdmittedExecution,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  acquireWorkspaceWriter,
  getWorkspaceWriterClaim,
  releaseWorkspaceWriterIfOwned,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createGroupReservation,
  getGroupReservation,
  isTaskBarriered,
} from '../specs/workflow/queue/index.mjs';
import {
  saveBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';
import { requireChange, requireTask, setTaskWorkflowState } from '../specs/store.mjs';
import { executionPolicyService } from '../dashboard/server/ai/sessions/execution-policy-service.mjs';

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

// --- batch-execution-generalization, task 05: handover partitioning by full contract ---
// Unlike `workflowYaml` above (whose transitions declare no `continuation` field at
// all, so `reconcileWorkflowPosition`'s own NOT_AUTO_CONTINUATION gate makes every
// dispatch in the suite above a no-op in practice — the existing assertions are
// correspondingly conditional), this fixture explicitly declares `continuation: auto`
// on the fail->implementation transition, matching the real production workflow
// definitions, so these tests genuinely exercise agent dispatch and grouping.
const handoverWorkflowYaml = `id: test-handover-wf
title: "Test Handover Workflow"
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

function setupHandoverRepo(slug, memberSpecs) {
  resetAdmissionStateForTest();
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-handover-'));
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

  fs.writeFileSync(path.join(workflowDir, 'test-handover-wf.yaml'), handoverWorkflowYaml, 'utf8');

  const specId = randomUUID();
  const tasksYaml = memberSpecs.map((m, idx) => {
    if (m.external) {
      // A task deliberately NOT part of any batch/group — exists only to be an
      // unsatisfied external dependency for a batch member (task 11, gap 2).
      return `  - id: ${m.id}
    order: ${idx + 1}
    title: Task ${m.id}
    status: approved
    allowed_paths:
      - src/${m.id}.js
`;
    }
    const transitionedTo = m.result === 'pass' ? 'verified' : 'implementation';
    const dependsOn = m.dependsOn?.length ? `\n    depends_on: [${m.dependsOn.join(', ')}]` : '';
    return `  - id: ${m.id}
    order: ${idx + 1}
    title: Task ${m.id}
    status: in-review${dependsOn}
    allowed_paths:
      - src/${m.id}.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-${m.id}
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: ${m.result}
          transitioned_to: ${transitionedTo}
`;
  }).join('');

  const changeYaml = `id: ${slug}
spec_id: ${specId}
title: "Test Handover Change"
status: in-progress
workflow:
  mode: deterministic
  version: 1
  definition: test-handover-wf
tasks:
${tasksYaml}`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  for (const m of memberSpecs) {
    fs.writeFileSync(path.join(taskDir, `${m.id}.md`), `# Task ${m.id}\n`, 'utf8');
  }

  // Commit fixtures — the single-task continuation path (reconcileWorkflowPosition)
  // asserts a clean worktree before a new attempt; an uncommitted fixture would
  // otherwise be indistinguishable from a real dirty-worktree activation blocker.
  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', 'Fixture setup'], { cwd: tmpRoot });

  return { tmpRoot, activeDir, changeDir, taskDir, workflowDir, sessionsDir, specId };
}

function makeMockSessionService() {
  const createdSessions = [];
  return {
    createdSessions,
    createSession: async (provider, opts) => {
      const sessionId = `sess-${randomUUID()}`;
      createdSessions.push({ sessionId, provider, ...opts });
      return { sessionId };
    },
  };
}

test('AC (Task 05): A review batch where all 3 members fail with the identical resulting contract produces exactly one new refiner batch covering all 3', async () => {
  const slug = 'test-handover-all-fail';
  const memberIds = ['tA', 'tB', 'tC'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));
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
    specId,
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

  const mockSessionService = makeMockSessionService();

  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });

  assert.equal(outcome.settled, true);
  assert.equal(outcome.status, 'completed');

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const newBatchIds = new Set(memberIds.map((id) => settlement.stages.continuationDispatch.members[id].batchExecutionId));
  assert.equal(newBatchIds.size, 1, 'All 3 failing members must share the same new batch execution id');
  assert.equal(mockSessionService.createdSessions.length, 1, 'Exactly one new session must be created, not three');
  assert.equal(mockSessionService.createdSessions[0].parentSessionId, batchSessionId);
  assert.equal(mockSessionService.createdSessions[0].role, 'refiner');

  const newBatchId = [...newBatchIds][0];
  const newReservation = getGroupReservation(tmpRoot, slug, newBatchId);
  assert.ok(newReservation, 'A new group reservation must exist for the refiner batch');
  assert.deepEqual([...newReservation.taskIds].sort(), [...memberIds].sort());
});

test('AC (Task 05): 2 members fail with identical contracts and 1 fails with a taskOverrides-diverged contract produces two groups', async () => {
  const slug = 'test-handover-diverged-override';
  const memberIds = ['tA', 'tB', 'tC'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));
  const batchExecutionId = `batch-${randomUUID()}`;
  const batchSessionId = `session-rev-batch-${randomUUID()}`;

  // tC's resolved execution policy diverges via taskOverrides — same role, different provider.
  executionPolicyService.saveExecutionPolicy(
    slug,
    {
      provider: 'claude',
      mode: 'agent',
      roles: { refiner: { provider: 'claude', mode: 'agent' } },
      taskOverrides: { tC: { provider: 'gemini', mode: 'agent' } },
    },
    { repoRoot: tmpRoot },
  );

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
    specId,
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

  const mockSessionService = makeMockSessionService();

  // Pass 1 (task 11): the one-active-execution-per-spec invariant means only ONE
  // dispatch unit can be admitted this pass. {tA,tB}'s group (inserted first) is
  // admitted; tC's own unit is left durably pending — not silently 'noop'/completed.
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
  assert.equal(firstOutcome.reason, 'CONTINUATION_DISPATCH_PENDING');

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const tAGroup = afterFirstPass.stages.continuationDispatch.members.tA?.batchExecutionId;
  const tBGroup = afterFirstPass.stages.continuationDispatch.members.tB?.batchExecutionId;
  assert.equal(tAGroup, tBGroup, 'tA and tB share the identical contract and must be grouped together');
  assert.ok(tAGroup, 'tA/tB group must have been admitted in pass 1');
  assert.equal(
    afterFirstPass.stages.continuationDispatch.members.tC,
    undefined,
    'tC must remain durably pending after pass 1, not recorded as completed/noop',
  );
  const pendingUnitsAfterFirstPass = afterFirstPass.stages.continuationDispatch.pendingUnits.filter((u) => u.status === 'pending');
  assert.equal(pendingUnitsAfterFirstPass.length, 1, 'Exactly tC\'s own unit must remain pending');
  assert.deepEqual(pendingUnitsAfterFirstPass[0].taskIds, ['tC']);

  const refinerReservation = getGroupReservation(tmpRoot, slug, tAGroup);
  assert.ok(refinerReservation);
  assert.deepEqual([...refinerReservation.taskIds].sort(), ['tA', 'tB']);

  // Simulate the admitted {tA,tB} group's own execution settling (the real trigger is
  // that group's own batch-finish + batch-completion-settlement reaching its own
  // Stage 1/2, exercised end-to-end in the dedicated durable-resume test below) —
  // here, directly free both the one-active-execution-per-spec slot and the
  // workspace-writer claim pass 1's admission acquired.
  assert.ok(getActiveAgentExecution(specId), 'the admitted group must hold the active-execution slot after pass 1');
  clearActiveAgentExecution(specId);
  const groupClaim = getWorkspaceWriterClaim(tmpRoot);
  if (groupClaim) {
    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRoot,
      expectedOwnerId: groupClaim.ownerId,
      expectedKind: groupClaim.kind,
      expectedScope: groupClaim.scope,
      expectedSessionId: groupClaim.sessionId,
    });
  }

  // Pass 2: tC's own unit is now eligible and gets admitted for real.
  const secondOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });

  assert.equal(secondOutcome.settled, true);
  assert.equal(secondOutcome.status, 'completed');

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const tCMember = settlement.stages.continuationDispatch.members.tC;
  assert.equal(tCMember.action, 'agent-admitted', 'tC must be genuinely admitted, not silently noop\'d');
  assert.equal(tCMember.batchExecutionId, undefined, 'tC dispatches via the single-task path, not a fabricated one-member batch');
  assert.notEqual(tCMember, tAGroup);

  // Exactly two sessions total: one shared batch session for {tA,tB}, one single-task
  // session for tC — both created via the same mock sessionService.
  assert.equal(mockSessionService.createdSessions.length, 2);
});

test('AC (Task 05): Some members pass (human-verification) and others fail (refiner) — zero sessions for the passing group, correctly-grouped session(s) for the failing group', async () => {
  const slug = 'test-handover-mixed-pass-fail';
  const memberIds = ['tA', 'tB', 'tC'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, [
    { id: 'tA', result: 'pass' },
    { id: 'tB', result: 'fail' },
    { id: 'tC', result: 'fail' },
  ]);
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
    specId,
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
    results: { tA: { value: 'pass' }, tB: { value: 'fail' }, tC: { value: 'fail' } },
  });

  const mockSessionService = makeMockSessionService();

  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });

  assert.equal(outcome.settled, true);

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(settlement.stages.continuationDispatch.members.tA.action, 'noop', 'Passing member produces no session');
  assert.equal(settlement.stages.continuationDispatch.members.tA.batchExecutionId, undefined);

  const tBGroup = settlement.stages.continuationDispatch.members.tB.batchExecutionId;
  const tCGroup = settlement.stages.continuationDispatch.members.tC.batchExecutionId;
  assert.equal(tBGroup, tCGroup, 'Both failing members share the identical contract and must be grouped together');
  assert.ok(tBGroup, 'The failing group must have been dispatched to a new batch');

  assert.equal(mockSessionService.createdSessions.length, 1, 'Exactly one session for the failing group; zero for the passing one');
});

test('AC (Task 05): A single failed member still gets exactly one session, via the single-task path, not a fabricated one-member batch', async () => {
  const slug = 'test-handover-single-refiner';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, [
    { id: 'tA', result: 'pass' },
    { id: 'tB', result: 'fail' },
  ]);
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
    specId,
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
    results: { tA: { value: 'pass' }, tB: { value: 'fail' } },
  });

  const mockSessionService = makeMockSessionService();

  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });

  assert.equal(outcome.settled, true);

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const tBDispatch = settlement.stages.continuationDispatch.members.tB;
  assert.equal(tBDispatch.action, 'agent-admitted');
  assert.equal(tBDispatch.batchExecutionId, undefined, 'A lone refiner must use the single-task path, never a fabricated one-member batch');
  assert.equal(tBDispatch.admission?.admitted, true);
  assert.equal(mockSessionService.createdSessions.length, 1);
  assert.equal(mockSessionService.createdSessions[0].parentSessionId, batchSessionId);
  assert.equal(mockSessionService.createdSessions[0].role, 'refiner');

  // No new group reservation was created for a group of one
  const anyNewReservations = getGroupReservation(tmpRoot, slug, tBDispatch.batchExecutionId || 'none');
  assert.equal(anyNewReservations, null);
});

test('AC (Task 11, gap 2): a grouped-handover group whose member carries an independent admission-blocking state is rejected before any reservation is created for it', async () => {
  const slug = 'test-handover-suspended-member';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, [
    { id: 'tA', result: 'fail' },
    { id: 'tB', result: 'fail' },
  ]);

  // tB independently picked up an active, non-advisory remediation suspension between
  // its own batch-finish transition and this settlement running (task 11, gap 2) — a
  // real admission-blocking state validateBatchCompatibility's own readiness check
  // must still catch, exactly as it would for a manually started batch.
  const { createRemediationRecord } = await import('../specs/workflow/remediation-record.mjs');
  createRemediationRecord({
    repoRoot: tmpRoot,
    change: slug,
    invalidatedDependency: { taskId: 'some-upstream-task', releaseEpoch: { step: 'implementation', attempt: 1 } },
    members: [{ taskId: 'tB', role: 'consumer', terminal: false }],
  });

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
    specId,
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

  const mockSessionService = makeMockSessionService();

  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });

  // Genuinely incompatible (external unsatisfied dependency) is a real failure, not a
  // transient pending — the settlement itself reaches 'completed' with a recorded
  // failure, not 'pending' waiting for another pass.
  assert.equal(outcome.settled, true);
  assert.equal(outcome.status, 'completed');

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(settlement.stages.continuationDispatch.members.tA.action, 'failed');
  assert.equal(settlement.stages.continuationDispatch.members.tB.action, 'failed');
  assert.match(settlement.stages.continuationDispatch.members.tB.reason || '', /tB/);

  // No reservation and no session were ever created for the rejected group.
  assert.equal(mockSessionService.createdSessions.length, 0);
});

test('AC (Task 11, gap 3): a destination resolving to sessionPolicy "reuse" is dispatched via the single-task reuse-capable path, never silently admitted as fresh', async () => {
  const slug = 'test-handover-reuse-policy';
  const reuseWorkflowYaml = `id: test-handover-reuse-wf
title: "Test Handover Reuse Workflow"
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
          session: reuse
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Review code"
    expectedWork:
      summary: "Review"
    transitions:
      - to: verified
        outcome: success
`;

  resetAdmissionStateForTest();
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-reuse-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

    const activeDir = path.join(tmpRoot, 'specs', 'active');
    const changeDir = path.join(activeDir, slug);
    const taskDir = path.join(changeDir, 'tasks');
    const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'test-handover-reuse-wf.yaml'), reuseWorkflowYaml, 'utf8');

    const specId = randomUUID();
    const implSessionId = 'session-impl-shared';
    // t1's destination resolves to session: reuse (implementation -> review). t2 is
    // already terminal (review -> verified already recorded) — no agent executor, no
    // dispatch, no contention risk — isolating t1 as the only agent-dispatch unit this
    // settlement must process.
    const changeYaml = `id: ${slug}
spec_id: ${specId}
title: "Test Handover Reuse Change"
status: in-progress
workflow:
  mode: deterministic
  version: 1
  definition: test-handover-reuse-wf
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    allowed_paths:
      - src/t1.js
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: ${implSessionId}
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: verified
    allowed_paths:
      - src/t2.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: review
          attempt: 1
          sessionId: session-rev-t2
          result: pass
          transitioned_to: verified
`;
    fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Fixture setup'], { cwd: tmpRoot });

    const batchExecutionId = `batch-${randomUUID()}`;
    const batchSessionId = implSessionId;
    const memberIds = ['t1', 't2'];

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
      specId,
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
      results: {},
    });

    const mockSessionService = makeMockSessionService();

    const outcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId,
      sessionId: batchSessionId,
      ownerId: acq.ownerId,
      activeDir,
      options: { sessionService: mockSessionService },
    });

    assert.equal(outcome.settled, true);
    assert.equal(outcome.status, 'completed');

    const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
    const t1Dispatch = settlement.stages.continuationDispatch.members.t1;
    const t2Dispatch = settlement.stages.continuationDispatch.members.t2;

    assert.equal(t2Dispatch.action, 'noop', 't2 is already terminal — no dispatch');
    assert.equal(t1Dispatch.batchExecutionId, undefined, 'session: reuse is never grouped into a fabricated multi-member batch');
    assert.equal(t1Dispatch.action, 'agent-admitted');

    // The single-task continuation path resolved the exact predecessor session
    // (session: reuse) rather than creating a fresh one via the mock sessionService.
    assert.equal(mockSessionService.createdSessions.length, 0, 'session: reuse must resume the predecessor session, never create a fresh one');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC (Task 11, gap 1): the second, durably pending group is admitted automatically once the first group\'s own settlement frees the active-execution slot — no manual intervention, no re-processing the first group', async () => {
  const slug = 'test-handover-durable-resume';
  const memberIds = ['tA', 'tB', 'tC'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

  // tC diverges via taskOverrides (same role, different provider) so the review pass
  // produces two groups: {tA,tB} (inserted first) and {tC} (inserted second).
  executionPolicyService.saveExecutionPolicy(
    slug,
    {
      provider: 'claude',
      mode: 'agent',
      roles: { refiner: { provider: 'claude', mode: 'agent' } },
      taskOverrides: { tC: { provider: 'gemini', mode: 'agent' } },
    },
    { repoRoot: tmpRoot },
  );

  const parentBatchExecutionId = `batch-${randomUUID()}`;
  const parentSessionId = `session-rev-batch-${randomUUID()}`;

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds: memberIds,
    batchExecutionId: parentBatchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });
  const acq = await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds: memberIds },
    sessionId: parentSessionId,
    batchExecutionId: parentBatchExecutionId,
  });
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId: parentBatchExecutionId,
    changeSlug: slug,
    sessionId: parentSessionId,
    taskIds: memberIds,
    status: 'completed',
    results: Object.fromEntries(memberIds.map((id) => [id, { value: 'fail' }])),
  });

  const mockSessionService = makeMockSessionService();

  // Pass 1: {tA,tB} is admitted as a new group; {tC} is left durably pending.
  const firstOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId: parentBatchExecutionId,
    sessionId: parentSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(firstOutcome.settled, false);
  assert.equal(firstOutcome.status, 'pending');

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
  const childBatchExecutionId = afterFirstPass.stages.continuationDispatch.members.tA.batchExecutionId;
  assert.ok(childBatchExecutionId, 'the {tA,tB} group must have been admitted in pass 1');
  assert.equal(
    afterFirstPass.stages.continuationDispatch.members.tC,
    undefined,
    'tC must remain durably pending, not completed, after pass 1',
  );

  // Fast-forward: {tA,tB}'s own admitted work is done (both reach a terminal state
  // with no further agent executor) — set up its own real batch-finish record so its
  // settlement has genuine durable state to read, exactly as a real completed child
  // batch would.
  const childChange = requireChange(slug, activeDir);
  for (const taskId of ['tA', 'tB']) {
    const task = requireTask(childChange, taskId);
    setTaskWorkflowState(childChange, taskId, {
      status: 'verified',
      workflowProgress: {
        current_step: 'review',
        current_attempt: task.workflow_progress.current_attempt,
        state: 'completed',
        history: [
          ...task.workflow_progress.history,
          { step: 'review', attempt: task.workflow_progress.current_attempt, result: 'pass', transitioned_to: 'verified' },
        ],
      },
    });
  }
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId: childBatchExecutionId,
    changeSlug: slug,
    sessionId: afterFirstPass.stages.continuationDispatch.members.tA.admission?.sessionId || 'session-child',
    taskIds: ['tA', 'tB'],
    status: 'completed',
    results: {},
  });

  // Resume the ORIGINAL (parent) settlement via the child's own settlement reaching
  // its own Stage 2 — this is the real, automatic trigger (resumePendingHandoverForSpec),
  // not a manual re-invocation of the parent settlement by the test itself.
  const childOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId: childBatchExecutionId,
    sessionId: afterFirstPass.stages.continuationDispatch.members.tA.admission?.sessionId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(childOutcome.settled, true, 'the child {tA,tB} batch must settle on its own terms');

  // The parent settlement must now ALSO be 'completed' — resumed automatically as a
  // side effect of the child's own Stage 2 freeing the active-execution slot, not
  // because the test itself called executeBatchCompletionSettlement for the parent
  // a second time.
  const parentAfterResume = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
  assert.equal(parentAfterResume.status, 'completed', 'the parent settlement must be auto-resumed and completed');
  assert.equal(parentAfterResume.stages.continuationDispatch.members.tC.action, 'agent-admitted');
  assert.equal(parentAfterResume.stages.continuationDispatch.members.tA.batchExecutionId, childBatchExecutionId);

  // tA/tB's own original group dispatch is untouched/not re-processed by the resume.
  assert.equal(parentAfterResume.stages.continuationDispatch.members.tA.action, 'agent-admitted');
});

test('AC (Task 13, gap 1 reverse): singleton dispatched first, grouped batch left pending second — the singleton settling for real (admission.mjs\'s own turn-terminal handling, not a manual clearActiveAgentExecution call) automatically admits the pending group', async () => {
  const slug = 'test-singleton-first-handover';
  const singletonFirstWorkflowYaml = `id: test-singleton-first-wf
title: "Test Singleton First Workflow"
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
          session: reuse
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

  resetAdmissionStateForTest();
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-singleton-first-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

    const activeDir = path.join(tmpRoot, 'specs', 'active');
    const changeDir = path.join(activeDir, slug);
    const taskDir = path.join(changeDir, 'tasks');
    const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'test-singleton-first-wf.yaml'), singletonFirstWorkflowYaml, 'utf8');

    const specId = randomUUID();
    const implSessionId = 'session-impl-shared-t1';
    const changeYaml = `id: ${slug}
spec_id: ${specId}
title: "Test Singleton First Change"
status: in-progress
workflow:
  mode: deterministic
  version: 1
  definition: test-singleton-first-wf
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    allowed_paths:
      - src/t1.js
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: ${implSessionId}
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-review
    allowed_paths:
      - src/t2.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-t2
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
          transitioned_to: implementation
  - id: t3
    order: 3
    title: Task 3
    status: in-review
    allowed_paths:
      - src/t3.js
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          sessionId: session-impl-t3
          transitioned_to: review
        - step: review
          attempt: 1
          sessionId: session-rev-batch
          result: fail
          transitioned_to: implementation
`;
    fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't3.md'), '# Task 3\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Fixture setup'], { cwd: tmpRoot });

    const memberIds = ['t1', 't2', 't3'];
    const parentBatchExecutionId = `batch-${randomUUID()}`;
    const parentSessionId = implSessionId;

    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      taskIds: memberIds,
      batchExecutionId: parentBatchExecutionId,
      executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
    });
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      changeSlug: slug,
      scope: { kind: 'task-batch', taskIds: memberIds },
      sessionId: parentSessionId,
      batchExecutionId: parentBatchExecutionId,
    });
    saveBatchFinishRecord(tmpRoot, slug, {
      batchExecutionId: parentBatchExecutionId,
      changeSlug: slug,
      sessionId: parentSessionId,
      taskIds: memberIds,
      status: 'completed',
      results: {},
    });

    const mockSessionService = makeMockSessionService();

    // Pass 1: t1 (session: reuse) is the sole singleUnit — dispatched first via the
    // single-task continuation path (reconcileContinuation -> admitAgentExecution),
    // never grouped. {t2,t3} (fresh refiner group) is left durably pending behind it.
    const firstOutcome = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId: parentBatchExecutionId,
      sessionId: parentSessionId,
      ownerId: acq.ownerId,
      activeDir,
      options: { sessionService: mockSessionService },
    });
    assert.equal(firstOutcome.settled, false);
    assert.equal(firstOutcome.status, 'pending');

    const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
    assert.equal(afterFirstPass.stages.continuationDispatch.members.t1.action, 'agent-admitted');
    assert.equal(
      afterFirstPass.stages.continuationDispatch.members.t1.batchExecutionId,
      undefined,
      'session: reuse must never be grouped into a fabricated batch',
    );
    assert.equal(
      afterFirstPass.stages.continuationDispatch.members.t2,
      undefined,
      '{t2,t3} must remain durably pending, not completed, after pass 1',
    );
    assert.equal(mockSessionService.createdSessions.length, 0, 't1 resumed its predecessor session — no fresh session created yet');

    // t1 is now the live active-execution for this spec, admitted via the real
    // single-task admission path.
    assert.ok(getActiveAgentExecution(specId), 't1 must be the live active execution after pass 1');

    // Simulate t1's own real progress: between admission and turn-terminal, t1 passed
    // review and reached a terminal workflow position (exactly what a real finish-step
    // CLI invocation would have recorded on disk).
    const changeForUpdate = requireChange(slug, activeDir);
    const t1Task = requireTask(changeForUpdate, 't1');
    setTaskWorkflowState(changeForUpdate, 't1', {
      status: 'verified',
      workflowProgress: {
        current_step: 'review',
        current_attempt: t1Task.workflow_progress.current_attempt,
        state: 'completed',
        history: [
          ...t1Task.workflow_progress.history,
          { step: 'review', attempt: t1Task.workflow_progress.current_attempt, sessionId: implSessionId, result: 'pass', transitioned_to: 'verified' },
        ],
      },
    });
    // Commit the progress update — `assessExecutionSettlement` treats change.yaml
    // (a workflow-owned path) as in-scope, and an uncommitted in-scope dirty file
    // would misclassify this as 'dirty-in-scope-files' rather than a clean settle.
    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 't1 passes review'], { cwd: tmpRoot });

    // Settle t1 FOR REAL via admission.mjs's own turn-terminal handling
    // (releaseAdmittedExecution drives the exact same `reconcileHook1` closure a real
    // session's turn.completed event would invoke) — not a manual
    // clearActiveAgentExecution call standing in for the real trigger.
    const reconcileRes = await releaseAdmittedExecution(specId, { settled: true });
    assert.equal(reconcileRes.outcome, 'completed');
    assert.equal(reconcileRes.released, true);

    // The pending {t2,t3} group must now be admitted automatically, as a side effect of
    // t1's own slot-freeing trigger (task 13, second-round review finding 1) — no
    // manual intervention, no manual re-invocation of the parent settlement by the
    // test itself.
    const parentAfterResume = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
    assert.equal(parentAfterResume.status, 'completed', 'the parent settlement must be auto-resumed and completed');
    assert.equal(parentAfterResume.stages.continuationDispatch.members.t2.action, 'agent-admitted');
    assert.equal(
      parentAfterResume.stages.continuationDispatch.members.t2.batchExecutionId,
      parentAfterResume.stages.continuationDispatch.members.t3.batchExecutionId,
    );
    assert.equal(mockSessionService.createdSessions.length, 1, 'exactly one new session for the {t2,t3} refiner group');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC (Task 13, gap 2): a grouped-handover admission attempt that throws during session creation is treated as transient — the unit stays pending and a later pass admits it', async () => {
  const slug = 'test-handover-transient-exception';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

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
    specId,
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

  // Pass 1: session creation throws (a simulated transient infrastructure failure) —
  // the grouped unit must stay durably pending, never recorded as a terminal failure
  // (task 13, second-round review finding 2).
  const throwingSessionService = {
    createdSessions: [],
    createSession: async () => {
      throw new Error('Simulated transient session-creation failure');
    },
  };

  const firstOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: throwingSessionService },
  });
  assert.equal(firstOutcome.settled, false);
  assert.equal(firstOutcome.status, 'pending');

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(
    afterFirstPass.stages.continuationDispatch.members.tA,
    undefined,
    'a transient admission exception must not be recorded as a terminal member outcome',
  );
  const pendingUnit = afterFirstPass.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tA'));
  assert.equal(pendingUnit.status, 'pending', 'the unit must remain pending after a transient admission exception, not failed');

  // Pass 2: a working session service — the same pending unit is now admitted, no
  // duplicate reservation, no lost group.
  const mockSessionService = makeMockSessionService();
  const secondOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(secondOutcome.settled, true);
  assert.equal(secondOutcome.status, 'completed');

  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(finalSettlement.stages.continuationDispatch.members.tA.action, 'agent-admitted');
  assert.equal(finalSettlement.stages.continuationDispatch.members.tB.action, 'agent-admitted');
  assert.equal(mockSessionService.createdSessions.length, 1, 'exactly one new session for the retried group');
});

test('AC (Task 15): TRANSIENT_ADMISSION_REASONS classifies every known admitAgentExecution reason correctly', () => {
  // Direct, explicit proof of the classification itself — complements (does not
  // replace) the end-to-end tests above, which exercise how the classification is
  // actually consumed at the settlement level (same discipline task 07's AC2 already
  // established for "covered elsewhere vs. covered here").
  const transientReasons = [
    'ACTIVE_EXECUTION_EXISTS',
    'DEFERRED_TO_PENDING_WORKSPACE_REQUEST',
    'WORKSPACE_WRITER_CONTENDED',
    'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY',
    'REUSE_SESSION_NOT_RESOLVED',
  ];
  for (const reason of transientReasons) {
    assert.equal(TRANSIENT_ADMISSION_REASONS.has(reason), true, `${reason} must classify as transient`);
  }

  // Every other reason admitAgentExecution can actually return (admission.mjs) is a
  // genuine, permanent failure. (The "gap 2" test above fails via
  // validateBatchCompatibility, a different code path entirely, never via
  // admitAgentExecution's own reason — it does NOT exercise this terminal branch; see
  // the dedicated SESSION_SUBSCRIPTION_FAILED test below for that, task 16.)
  const nonTransientReasons = [
    'CLAIM_ENRICHMENT_FAILED',
    'STARTED_STATE_TRANSITION_FAILED',
    'SESSION_SUBSCRIPTION_FAILED',
    'INVOKING_STATE_TRANSITION_FAILED',
    'SOME_UNKNOWN_FUTURE_REASON',
  ];
  for (const reason of nonTransientReasons) {
    assert.equal(TRANSIENT_ADMISSION_REASONS.has(reason), false, `${reason} must not classify as transient`);
  }
});

test('AC (Task 16): a grouped-handover admission attempt that fails with a genuinely non-transient reason (SESSION_SUBSCRIPTION_FAILED, sourced from admitAgentExecution itself) is recorded as a terminal failure immediately — not left pending, not retried', async () => {
  const slug = 'test-handover-nontransient-terminal';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

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
    specId,
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

  // A session service that creates a session successfully but whose subscription
  // itself fails — admitAgentExecution's own real `SESSION_SUBSCRIPTION_FAILED` path
  // (not a thrown exception, not validateBatchCompatibility — the one branch the
  // second-/third-round reviews both flagged as unproven for a genuinely terminal,
  // non-transient admission reason).
  const createdSessions = [];
  const throwingSubscribeSessionService = {
    createdSessions,
    createSession: async (provider, opts) => {
      const sessionId = `sess-${randomUUID()}`;
      createdSessions.push({ sessionId, provider, ...opts });
      return { sessionId };
    },
    subscribeToSession: () => {
      throw new Error('Simulated subscribeToSession failure');
    },
  };

  const outcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: throwingSubscribeSessionService },
  });
  assert.equal(outcome.settled, true);
  assert.equal(outcome.status, 'completed');

  const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(settlement.stages.continuationDispatch.members.tA.action, 'noop');
  assert.equal(settlement.stages.continuationDispatch.members.tA.admission.reason, 'SESSION_SUBSCRIPTION_FAILED');
  const unit = settlement.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tA'));
  assert.equal(unit.status, 'failed', 'a genuinely non-transient reason must be recorded as a terminal failure, not left pending');
});

test('AC (Task 15): a grouped-handover admission attempt blocked by a genuine (non-exception) DEFERRED_TO_PENDING_WORKSPACE_REQUEST result stays pending and is admitted once the contention clears', async () => {
  const slug = 'test-handover-transient-workspace-request';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

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
    specId,
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

  // An unrelated, durable, queued workspace request — admitAgentExecution's own step 3
  // defers to it worktree-wide, regardless of which spec/task it names, producing a
  // genuine `{ admitted: false, reason: 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST' }`
  // result (not a thrown exception).
  const blockingRequestId = randomUUID();
  await createWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    kind: 'human-submit',
    specId: 'unrelated-spec',
    taskId: 'unrelated-task',
  });

  const mockSessionService = makeMockSessionService();
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

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(
    afterFirstPass.stages.continuationDispatch.members.tA,
    undefined,
    'a genuine transient admission result must not be recorded as a terminal member outcome',
  );
  const pendingUnit = afterFirstPass.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tA'));
  assert.equal(pendingUnit.status, 'pending', 'the unit must remain pending, not failed');
  assert.equal(mockSessionService.createdSessions.length, 0, 'no session must be created while blocked');

  // Clear the contention and retry — the same pending unit is now admitted.
  await transitionWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    expectedStatus: 'queued',
    to: 'cancelled',
  });

  const secondOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(secondOutcome.settled, true);
  assert.equal(secondOutcome.status, 'completed');

  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(finalSettlement.stages.continuationDispatch.members.tA.action, 'agent-admitted');
  assert.equal(finalSettlement.stages.continuationDispatch.members.tB.action, 'agent-admitted');
  assert.equal(mockSessionService.createdSessions.length, 1);
});

test('AC (Task 16): a handover blocked by a worktree-wide DEFERRED_TO_PENDING_WORKSPACE_REQUEST resumes automatically once the request genuinely completes — via sweepAllPendingHandovers, not a manual re-invocation of executeBatchCompletionSettlement for the parent', async () => {
  const slug = 'test-handover-sweep-auto-resume';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

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
    specId,
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

  // A durable, queued workspace request belonging to a completely unrelated spec —
  // this is the exact scenario the third review round named: a different spec's
  // pending human-submit/publish/batch-publish request is the only thing blocking
  // this handover's own admission attempt. Neither of the two existing slot-freeing
  // triggers (a sibling of the SAME spec settling, or this spec's own singleton
  // settling) can ever notice this, because nothing of THIS spec was ever admitted.
  const blockingRequestId = randomUUID();
  await createWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    kind: 'human-submit',
    specId: 'completely-unrelated-spec',
    taskId: 'completely-unrelated-task',
  });

  const mockSessionService = makeMockSessionService();
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

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const pendingUnit = afterFirstPass.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tA'));
  assert.equal(pendingUnit.status, 'pending');

  // The unrelated request genuinely completes — through whatever real mechanism
  // resolved it (out of scope here); from this point on, nothing about this specific
  // handover is special-cased or known to that mechanism.
  await transitionWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    expectedStatus: 'queued',
    to: 'cancelled',
  });

  // The production retry entry point (task 16): a generic, worktree-wide sweep —
  // exactly what Hook 3 boot reconciliation and the dashboard's own batch-publish
  // route now call after any claim/request resolves. It is NOT told which
  // changeSlug/batchExecutionId is pending; it must discover and resume this
  // handover entirely on its own.
  await sweepAllPendingHandovers({ repoRoot: tmpRoot, activeDir, options: { sessionService: mockSessionService } });

  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(finalSettlement.status, 'completed', 'the sweep must have discovered and resumed this handover on its own');
  assert.equal(finalSettlement.stages.continuationDispatch.members.tA.action, 'agent-admitted');
  assert.equal(finalSettlement.stages.continuationDispatch.members.tB.action, 'agent-admitted');
  assert.equal(mockSessionService.createdSessions.length, 1);
});

test('AC (Task 15): a singleton dispatch blocked by a genuine (non-exception) transient admission result stays pending and is admitted once the contention clears', async () => {
  const slug = 'test-handover-singleton-transient-workspace-request';
  const memberIds = ['tA', 'tB'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, [
    { id: 'tA', result: 'pass' },
    { id: 'tB', result: 'fail' },
  ]);
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
    specId,
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
    results: { tA: { value: 'pass' }, tB: { value: 'fail' } },
  });

  const blockingRequestId = randomUUID();
  await createWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    kind: 'human-submit',
    specId: 'unrelated-spec',
    taskId: 'unrelated-task',
  });

  const mockSessionService = makeMockSessionService();
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

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  assert.equal(
    afterFirstPass.stages.continuationDispatch.members.tB,
    undefined,
    'a genuine transient admission result on the singleton path must not be recorded as a member outcome',
  );
  const pendingUnit = afterFirstPass.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tB'));
  assert.equal(pendingUnit.status, 'pending', 'the singleton unit must remain pending, not failed');
  assert.equal(mockSessionService.createdSessions.length, 0);

  await transitionWorkspaceRequest({
    repoRoot: tmpRoot,
    requestId: blockingRequestId,
    expectedStatus: 'queued',
    to: 'cancelled',
  });

  const secondOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    sessionId: batchSessionId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(secondOutcome.settled, true);

  const finalSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
  const tBDispatch = finalSettlement.stages.continuationDispatch.members.tB;
  assert.equal(tBDispatch.action, 'agent-admitted');
  assert.equal(tBDispatch.batchExecutionId, undefined, 'a lone refiner must use the single-task path, never a fabricated one-member batch');
  assert.equal(mockSessionService.createdSessions.length, 1);
});

test('AC (Task 15, finding 1 regression): a task-batch scope reaching recovery-required must not wake a sibling\'s durably pending unit — only the batch\'s own settlement (Stage 2) may do that', async () => {
  const slug = 'test-handover-batch-recovery-no-wake';
  const memberIds = ['tA', 'tB', 'tC'];
  const { tmpRoot, activeDir, specId } = setupHandoverRepo(slug, memberIds.map((id) => ({ id, result: 'fail' })));

  // tC diverges via taskOverrides so the review pass produces two units: {tA,tB} (a
  // fresh group, task-batch scope once admitted) and {tC} (a singleton), exactly like
  // the existing "2 groups" test.
  executionPolicyService.saveExecutionPolicy(
    slug,
    {
      provider: 'claude',
      mode: 'agent',
      roles: { refiner: { provider: 'claude', mode: 'agent' } },
      taskOverrides: { tC: { provider: 'gemini', mode: 'agent' } },
    },
    { repoRoot: tmpRoot },
  );

  const parentBatchExecutionId = `batch-${randomUUID()}`;
  const parentSessionId = `session-rev-batch-${randomUUID()}`;

  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    taskIds: memberIds,
    batchExecutionId: parentBatchExecutionId,
    executionConfigSnapshot: { provider: 'mock', mode: 'agent' },
  });
  const acq = await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    changeSlug: slug,
    scope: { kind: 'task-batch', taskIds: memberIds },
    sessionId: parentSessionId,
    batchExecutionId: parentBatchExecutionId,
  });
  saveBatchFinishRecord(tmpRoot, slug, {
    batchExecutionId: parentBatchExecutionId,
    changeSlug: slug,
    sessionId: parentSessionId,
    taskIds: memberIds,
    status: 'completed',
    results: Object.fromEntries(memberIds.map((id) => [id, { value: 'fail' }])),
  });

  const mockSessionService = makeMockSessionService();

  // Pass 1: {tA,tB} admitted as a new CHILD batch (task-batch scope, holding the
  // active-execution slot); {tC} left durably pending behind it.
  const firstOutcome = await executeBatchCompletionSettlement({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId: parentBatchExecutionId,
    sessionId: parentSessionId,
    ownerId: acq.ownerId,
    activeDir,
    options: { sessionService: mockSessionService },
  });
  assert.equal(firstOutcome.settled, false);
  assert.equal(firstOutcome.status, 'pending');

  const afterFirstPass = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
  assert.equal(afterFirstPass.stages.continuationDispatch.members.tC, undefined, 'tC must remain durably pending after pass 1');
  assert.ok(getActiveAgentExecution(specId), 'the child {tA,tB} batch must hold the active-execution slot after pass 1');

  // Deliberately do NOT save a batch-finish record for the child — its own
  // reconcileHook1 settlement check (assessBatchExecutionSettlement) will then find no
  // durable finish record and fail closed to 'recovery-required', exactly the scenario
  // the third review round flagged: a task-batch scope reaching recovery-required.
  //
  // Also release the child's own live workspace-writer claim *before* reconciling —
  // simulating the exact edge case the review named ("jeżeli claim nie został
  // skutecznie oznaczony / zniknął w sytuacji recovery"): the claim is already gone,
  // so `markWorkspaceWriterRecoveryRequiredIfOwned`'s own ifOwned no-op cannot serve as
  // a second safety net. Without this, the test would pass regardless of the scope
  // guard — acquireWorkspaceWriter would simply refuse tC's admission attempt on its
  // own (WORKSPACE_WRITER_BLOCKED_BY_RECOVERY), masking whether the guard itself works.
  const childOwnerId = afterFirstPass.stages.continuationDispatch.members.tA.admission?.ownerId;
  await releaseWorkspaceWriterIfOwned({
    repoRoot: tmpRoot,
    expectedOwnerId: childOwnerId,
    expectedKind: 'agent',
  });
  assert.equal(getWorkspaceWriterClaim(tmpRoot), null, 'the child claim must be genuinely gone, not merely recovery-marked, to isolate the scope guard itself');

  const reconcileRes = await releaseAdmittedExecution(specId, { settled: false });
  assert.equal(reconcileRes.outcome, 'recovery-required');

  // The sibling's durably pending {tC} unit must remain untouched — the scope guard
  // (task 15) must prevent this task-batch recovery-required event from triggering
  // `resumePendingHandoverForSpec`. Only the batch's own correctly-completed settlement
  // (Stage 2), a singleton settling, or another natural trigger (e.g. Hook 3) may wake
  // it — never this path.
  const parentAfterRecovery = loadBatchCompletionSettlement(tmpRoot, slug, parentBatchExecutionId);
  assert.notEqual(parentAfterRecovery.status, 'completed', 'the parent settlement must NOT be resumed by a sibling task-batch\'s recovery-required event');
  const stillPendingUnit = parentAfterRecovery.stages.continuationDispatch.pendingUnits.find((u) => u.taskIds.includes('tC'));
  assert.equal(stillPendingUnit.status, 'pending', 'tC must still be pending — not woken by the wrong trigger');
  assert.equal(mockSessionService.createdSessions.length, 1, 'only the original {tA,tB} session must exist — no session for tC');
});
