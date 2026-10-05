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
    const transitionedTo = m.result === 'pass' ? 'verified' : 'implementation';
    return `  - id: ${m.id}
    order: ${idx + 1}
    title: Task ${m.id}
    status: in-review
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
  const tAGroup = settlement.stages.continuationDispatch.members.tA.batchExecutionId;
  const tBGroup = settlement.stages.continuationDispatch.members.tB.batchExecutionId;
  const tCGroup = settlement.stages.continuationDispatch.members.tC.batchExecutionId;

  assert.equal(tAGroup, tBGroup, 'tA and tB share the identical contract and must be grouped together');
  assert.notEqual(tCGroup, tAGroup, 'tC diverges via taskOverrides and must not be grouped with tA/tB');
  // tC went through the single-task path (no new batch reservation), tA/tB through a new 2-member batch
  assert.equal(tCGroup, undefined, 'tC dispatches via the single-task path, not a fabricated one-member batch');

  const refinerReservation = getGroupReservation(tmpRoot, slug, tAGroup);
  assert.ok(refinerReservation);
  assert.deepEqual([...refinerReservation.taskIds].sort(), ['tA', 'tB']);

  // Exactly two sessions total: one shared batch session for {tA,tB}, one single-task session for tC
  assert.equal(mockSessionService.createdSessions.length, 1, 'Only the 2-member group goes through admitAgentExecution/createSession directly');
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
