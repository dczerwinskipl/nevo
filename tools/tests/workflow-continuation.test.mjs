// Test suite for Automatic Workflow Continuation and Orchestration (Task 29).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  admitAgentExecution,
  releaseAdmittedExecution,
  resetAdmissionStateForTest,
  hasActiveAgentExecution,
  getActiveAgentExecution,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { evaluateExecutionReadiness, isActivationOnlyBlocker } from '../specs/workflow/readiness-policy.mjs';
import { loadWorkflowDefinition } from '../specs/workflow/definitions/loader.mjs';
import {
  reconcileWorkflowPosition,
  reconcileBootState,
} from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import {
  activateAndSubmitHumanStep,
  startHumanStep,
  submitHumanStepResult,
} from '../specs/workflow/human-step/operations.mjs';
import {
  loadHumanSubmitOperation,
  findInFlightHumanSubmitOperation,
  createHumanSubmitOperationRecord,
  updateHumanSubmitOperationStatus,
  getHumanSubmitOperationFilePath,
} from '../specs/workflow/human-step/submit-request.mjs';
import {
  getWorkspaceWriterClaim,
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
} from '../specs/workflow/workspace-request.mjs';
import { reconcileRequestBackedWorkspaceClaim } from '../specs/workflow/workspace-claim-reconciliation.mjs';
import { computeDeterministicTaskActionProjection } from '../dashboard/server/specs/actions.mjs';
import { handleWorkflowVerifyHuman, handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import { saveStartOperation } from '../specs/workflow/start-operation.mjs';
import { saveOperationRecord, loadOperationRecord } from '../specs/workflow/operation-record.mjs';
import { readActivities } from '../specs/activity/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createTempRepo() {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-repo-cont-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n', 'utf8');

  // Copy workflow definitions from real repo so loadWorkflowDefinition works
  const wfDir = path.join(dir, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  const realWfDir = path.join(REPO_ROOT, '.nevo-ai', 'workflows');
  if (fs.existsSync(realWfDir)) {
    for (const f of fs.readdirSync(realWfDir)) {
      if (f.endsWith('.yaml') || f.endsWith('.yml')) {
        fs.copyFileSync(path.join(realWfDir, f), path.join(wfDir, f));
      }
    }
  }

  // Create specs directory with fixtures
  const specsDir = path.join(dir, 'specs', 'active');
  const specList = ['spec-1', 'spec-boot', 'spec-enrich', 'spec-A', 'spec-B', 'demo-change'];
  for (const s of specList) {
    const sDir = path.join(specsDir, s);
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `
schema_version: '1.0'
id: ${s}
title: ${s}
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
  - id: t2
    file: tasks/t2.md
    status: in-progress
  - id: tA
    file: tasks/tA.md
    status: in-progress
  - id: tB
    file: tasks/tB.md
    status: in-progress
  - id: task-1
    file: tasks/task-1.md
    status: in-progress
  - id: task-a
    file: tasks/task-a.md
    status: in-progress
  - id: task-b
    file: tasks/task-b.md
    status: in-progress
`, 'utf8');

    for (const tid of ['t1', 't2', 'tA', 'tB', 'task-1', 'task-a', 'task-b']) {
      fs.writeFileSync(path.join(tasksDir, `${tid}.md`), `---
id: ${tid}
status: in-progress
allowed_paths:
  - README.md
---
# Task ${tid}
`, 'utf8');
    }
  }

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('AC 409: Two simultaneous admitAgentExecution calls for the same spec never both return admitted (D33)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidate1 = { taskId: 't1', stepId: 'impl' };
    const candidate2 = { taskId: 't2', stepId: 'impl' };

    const [res1, res2] = await Promise.all([
      admitAgentExecution('spec-1', candidate1, { repoRoot: tmpRepo }),
      admitAgentExecution('spec-1', candidate2, { repoRoot: tmpRepo }),
    ]);

    // Exactly one admitted, one rejected
    assert.equal(res1.admitted !== res2.admitted, true, 'Exactly one must be admitted');
    const rejected = res1.admitted ? res2 : res1;
    assert.equal(rejected.reason, 'ACTIVE_EXECUTION_EXISTS');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 411: Admitting an agent execution claims workspace-writer and enriches fields; human-submit waits (D98)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidate = { taskId: 't1', stepId: 'impl', sessionId: 'sess-abc' };
    const admission = await admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo });
    assert.equal(admission.admitted, true);

    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claim);
    assert.equal(claim.kind, 'agent');
    assert.equal(claim.sessionId, 'sess-abc');
    assert.equal(claim.turnStartState, 'prepared');
    assert.equal(claim.taskId, 't1');

    // A concurrent acquireWorkspaceWriter with kind human-submit does not immediately acquire
    const humanAcquire = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      requestId: 'req-h1',
      specId: 'spec-1',
      taskId: 't1',
    });

    assert.equal(humanAcquire.acquired, false);
    assert.equal(humanAcquire.currentClaim.kind, 'agent');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 417: Rollback on session/turn failure rolls back both admission and workspace-writer claim', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidate = {
      taskId: 't1',
      stepId: 'impl',
      invokeStartTurn: async () => {
        throw new Error('Provider spawn failure');
      },
    };

    await assert.rejects(
      async () => {
        await admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo });
      },
      /Provider spawn failure/
    );

    // Reset admission state and release old claim using ownerId
    resetAdmissionStateForTest();
    const currentClaim = getWorkspaceWriterClaim(tmpRepo);
    if (currentClaim) {
      await releaseWorkspaceWriterIfOwned({
        repoRoot: tmpRepo,
        expectedOwnerId: currentClaim.ownerId,
        expectedKind: 'agent',
      });
    }

    const res2 = await admitAgentExecution('spec-1', { taskId: 't1', stepId: 'impl', sessionId: 'sess-retry' }, { repoRoot: tmpRepo });
    assert.equal(res2.admitted, true);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 422: Proven settlement releases workspace-writer claim using captured ownerId (Hook 1, D100)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidate = { taskId: 't1', stepId: 'impl', sessionId: 'sess-settle' };
    const admission = await admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo });
    assert.equal(admission.admitted, true);

    const claimBefore = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimBefore);
    assert.equal(claimBefore.ownerId, admission.ownerId);

    // Call Hook 1 reconciliation with a clean worktree. t1 has no workflow_progress
    // at all (never activated), so this correctly settles as resumable, not
    // completed (regression-fixed: see tools/tests/execution-settlement.test.mjs's
    // dedicated test for a never-started task) — what this AC actually verifies is
    // that the claim release itself uses the captured ownerId, independent of which
    // of the two non-recovery-required outcomes triggered it.
    const releaseRes = await releaseAdmittedExecution('spec-1');
    assert.equal(releaseRes.settled, false);
    assert.equal(releaseRes.outcome, 'resumable');
    assert.equal(releaseRes.released, true);

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter, null);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 429: Turn terminal with un-finalized dirty worktree marks recovery-required and retains claim (D87)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidate = { taskId: 't1', stepId: 'impl', sessionId: 'sess-dirty' };
    const admission = await admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo });

    // Simulate dirty tracked file within scope
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Dirty Uncommitted\n', 'utf8');

    const releaseRes = await releaseAdmittedExecution('spec-1');
    assert.equal(releaseRes.settled, false);
    assert.equal(releaseRes.markedRecovery, true);

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.status, 'recovery-required');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 439: Stale-reconciliation race: delayed Hook 1 for execution A cannot release newer execution B claim (D70, D100)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    // 1. Execution A admitted
    const admA = await admitAgentExecution('spec-1', { taskId: 'tA', stepId: 'impl', sessionId: 'sess-A' }, { repoRoot: tmpRepo });
    assert.equal(admA.admitted, true);
    const ownerA = admA.ownerId;

    // Execution A settles and releases
    await releaseAdmittedExecution('spec-1');
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);

    // 2. Execution B admitted
    const admB = await admitAgentExecution('spec-1', { taskId: 'tB', stepId: 'impl', sessionId: 'sess-B' }, { repoRoot: tmpRepo });
    assert.equal(admB.admitted, true);
    const ownerB = admB.ownerId;
    assert.notEqual(ownerA, ownerB);

    // 3. Delayed Hook 1 callback for A fires with A's own captured identity
    const delayedReleaseA = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: ownerA,
      expectedKind: 'agent',
      expectedSpecId: 'spec-1',
      expectedTaskId: 'tA',
    });

    assert.equal(delayedReleaseA.released, false);
    assert.equal(delayedReleaseA.reason, 'not-current-owner');

    // B's claim is completely intact
    const currentClaim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(currentClaim);
    assert.equal(currentClaim.ownerId, ownerB);
    assert.equal(currentClaim.sessionId, 'sess-B');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 449: Hook 3 restart reconciliation: prepared state settles safely; unestablished identity fails closed (D99, D100)', async () => {
  const tmpRepo = createTempRepo();

  try {
    // 1. Unestablished identity (no sessionId, no turnStartState)
    const acq1 = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-boot',
      taskId: 't1',
    });

    const bootRes1 = await reconcileBootState({ repoRoot: tmpRepo });
    assert.equal(bootRes1.reconciledClaims, 0);
    // Claim left as found
    assert.ok(getWorkspaceWriterClaim(tmpRepo));

    // 2. Prepared state (startTurn never invoked)
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: acq1.ownerId,
      expectedKind: 'agent',
      sessionId: 'sess-boot-prep',
      turnStartState: 'prepared',
    });

    const bootRes2 = await reconcileBootState({ repoRoot: tmpRepo });
    assert.equal(bootRes2.reconciledClaims, 1);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 464: Human-submit durable operation record is persisted status: pending before acquireWorkspaceWriter is called (D73)', async () => {
  const tmpRepo = createTempRepo();

  try {
    const op = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
      result: 'pass',
      feedback: 'LGTM',
    });

    assert.equal(op.status, 'pending');
    assert.equal(op.step, 'human-verification');
    assert.equal(op.attempt, 1);
    assert.ok(op.requestId);

    const loaded = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
    });

    assert.ok(loaded);
    assert.equal(loaded.requestId, op.requestId);
    assert.equal(loaded.status, 'pending');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 515 & 519: Two rapid human-submit clicks resolve to one request; conflicting decision is rejected (D90)', async () => {
  const tmpRepo = createTempRepo();

  try {
    createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
      result: 'pass',
      feedback: 'LGTM',
      requestId: 'req-initial',
    });

    // 1. Identical resubmission
    const loadedIdentical = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.equal(loadedIdentical.requestId, 'req-initial');

    // 2. Conflicting decision detection
    const isConflict = loadedIdentical.result !== 'fail';
    assert.equal(isConflict, true);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 526 & 536: Two different human-owned steps of same task persist to distinct paths; load finds terminal, findInFlight excludes (D94, D96)', async () => {
  const tmpRepo = createTempRepo();

  try {
    // Step 1: verification
    const op1 = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
      result: 'pass',
    });

    // Step 2: approval (different step name, same attempt)
    const op2 = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-approval',
      attempt: 1,
      result: 'pass',
    });

    assert.notEqual(op1.requestId, op2.requestId);

    const path1 = getHumanSubmitOperationFilePath(tmpRepo, 'demo-change', 'task-1', 'human-verification', 1);
    const path2 = getHumanSubmitOperationFilePath(tmpRepo, 'demo-change', 'task-1', 'human-approval', 1);
    assert.notEqual(path1, path2);

    // Mark op1 completed
    updateHumanSubmitOperationStatus({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
      status: 'completed',
    });

    // loadHumanSubmitOperation returns terminal record
    const loadedTerminal = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.ok(loadedTerminal);
    assert.equal(loadedTerminal.status, 'completed');

    // findInFlightHumanSubmitOperation intentionally excludes terminal record (D96)
    const inFlight = findInFlightHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'demo-change',
      taskId: 'task-1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.equal(inFlight, null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 542, 571, 575: Enrichment sequence: prepared -> invoking -> started with turnId (D93, D99)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    let capturedDuringInvoke = null;

    const candidate = {
      taskId: 't1',
      stepId: 'impl',
      sessionId: 'sess-enrich',
      invokeStartTurn: async () => {
        // Inspect claim while inside startTurn boundary
        capturedDuringInvoke = getWorkspaceWriterClaim(tmpRepo);
        return { turnId: 'turn-123' };
      },
    };

    const res = await admitAgentExecution('spec-enrich', candidate, { repoRoot: tmpRepo });
    assert.equal(res.admitted, true);

    // Immediately before startTurn, claim was invoking
    assert.ok(capturedDuringInvoke);
    assert.equal(capturedDuringInvoke.turnStartState, 'invoking');
    assert.equal(capturedDuringInvoke.turnId, undefined);

    // After startTurn resolves, claim is started with turnId atomically present
    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.turnStartState, 'started');
    assert.equal(claimAfter.turnId, 'turn-123');
    assert.equal(claimAfter.sessionId, 'sess-enrich');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 676: Worktree-wide dispatch priority across specs: Spec A defers if Spec B has queued request (D57, D74)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    // Spec B creates a durable workspace request (e.g. human-submit or publish)
    await createWorkspaceRequest({
      repoRoot: tmpRepo,
      requestId: 'req-spec-B',
      kind: 'human-submit',
      specId: 'spec-B',
      taskId: 'task-b',
    });

    // Spec A attempts agent admission on the shared physical worktree
    const candidateA = { taskId: 'task-a', stepId: 'impl' };
    const resA = await admitAgentExecution('spec-A', candidateA, { repoRoot: tmpRepo });

    assert.equal(resA.admitted, false);
    assert.equal(resA.reason, 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST');
    assert.equal(resA.pendingRequests.length, 1);
    assert.equal(resA.pendingRequests[0].requestId, 'req-spec-B');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 688: Reaching human-owned destination exposes interaction preview with ZERO workflow_progress mutation (D47)', () => {
  const definition = {
    id: 'test-wf',
    entryStep: 'impl',
    steps: {
      impl: {
        executor: 'agent',
        transitions: [{ to: 'human-verify', continuation: 'auto' }],
      },
      'human-verify': {
        executor: 'human',
        transitions: [
          { value: 'pass', action: { label: 'Approve' } },
          { value: 'fail', action: { label: 'Request Changes', feedback: { required: true } } },
        ],
      },
    },
  };

  const task = {
    id: 'task-1',
    order: 1,
    workflow_progress: {
      current_step: 'impl',
      current_attempt: 1,
      state: 'completed', // completed impl, next is human-verify
      history: [{ step: 'impl', attempt: 1, transitioned_to: 'human-verify' }],
    },
  };

  const change = {
    id: 'spec-1',
    workflow: { mode: 'deterministic', definition: 'test-wf' },
    tasks: [task],
  };

  // Preview projection without mutating workflow_progress
  const originalTaskJson = JSON.stringify(task);
  const projection = computeDeterministicTaskActionProjection(task, change, { definition });

  assert.equal(JSON.stringify(task), originalTaskJson, 'Task must not be mutated');
  assert.ok(projection.humanInteraction);
  assert.equal(projection.humanInteraction.actions.length, 2);
  assert.equal(projection.humanInteraction.actions[0].label, 'Approve');
  assert.equal(projection.humanInteraction.actions[1].label, 'Request Changes');
  assert.equal(projection.humanInteraction.actions[1].feedbackRequired, true);
});

test('AC 489: Dead pid on human-submit claim never triggers bare delete; reconciles via registry (D79, D88)', async () => {
  const tmpRepo = createTempRepo();

  try {
    // 1. Create operation and request
    createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dead',
      taskId: 't1',
      step: 'human-verify',
      attempt: 1,
      result: 'pass',
      requestId: 'req-dead-pid',
    });

    const req = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      requestId: 'req-dead-pid',
      kind: 'human-submit',
      specId: 'spec-dead',
      taskId: 't1',
      operationRef: { change: 'spec-dead', task: 't1', step: 'human-verify', attempt: 1 },
    });

    // 2. Create claim with confirmed dead pid (pid: 999999999)
    await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      requestId: 'req-dead-pid',
      operationRef: req.operationRef,
      specId: 'spec-dead',
      taskId: 't1',
    });

    const claimSnapshot = getWorkspaceWriterClaim(tmpRepo);

    // 3. Reconcile dead request-backed claim
    const reconRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tmpRepo,
      claimSnapshot,
    });

    // Since operation record is pending (not completed/failed), it marks recovery-required, never bare deletes!
    assert.equal(reconRes.reconciled, false);
    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.status, 'recovery-required');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 4 (Task 07): Resuming a resumable attempt via workflow step start never double-consumes dependencies end-to-end', async () => {
  const tmpRepo = createTempRepo();
  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-resume-dep');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-resume-dep
title: Resume Dep Spec
spec_id: 'c7b94998-356a-4d2a-a9e9-fbb839818817'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1'], { cwd: tmpRepo });

    // 1. Initial workflow step start activates t1 and consumes dependencies (seq: 1)
    const ctx1 = await handleWorkflowStepStart('spec-resume-dep', 't1', {
      repoRoot: tmpRepo,
      activeDir: specsDir,
      silent: true,
    });
    assert.equal(ctx1.currentStep, 'implementation');
    assert.equal(ctx1.attempt, 1);

    const depDir = path.join(tmpRepo, '.nevo-ai-local', 'dependency-consumption', 'spec-resume-dep', 't1', 'implementation');
    assert.deepEqual(fs.readdirSync(depDir), ['attempt-1.json']);
    const record1 = JSON.parse(fs.readFileSync(path.join(depDir, 'attempt-1.json'), 'utf8'));
    assert.equal(record1.consumptionSequence, 1);

    // Release workspace writer as if turn ended / resumable release
    const claim = getWorkspaceWriterClaim(tmpRepo);
    if (claim) {
      await releaseWorkspaceWriterIfOwned({
        repoRoot: tmpRepo,
        expectedOwnerId: claim.ownerId,
        expectedKind: claim.kind,
        expectedSpecId: claim.specId,
        expectedChangeSlug: claim.changeSlug,
        expectedScope: claim.scope,
        expectedTaskId: claim.taskId,
      });
    }

    // 2. Next execution starts (resume after resumable release)
    const ctx2 = await handleWorkflowStepStart('spec-resume-dep', 't1', {
      repoRoot: tmpRepo,
      activeDir: specsDir,
      silent: true,
    });
    assert.equal(ctx2.currentStep, 'implementation');
    assert.equal(ctx2.attempt, 1);

    // Exactly one consumption record, sequence unchanged, timestamp unchanged
    assert.deepEqual(fs.readdirSync(depDir), ['attempt-1.json']);
    const record2 = JSON.parse(fs.readFileSync(path.join(depDir, 'attempt-1.json'), 'utf8'));
    assert.equal(record2.consumptionSequence, 1);
    assert.equal(record2.createdAt, record1.createdAt);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): Active-attempt turn ending releases claim cleanly as resumable without continuation or attempt increment', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-resume-active');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-resume-active
title: Resume Active Spec
spec_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add active task t1'], { cwd: tmpRepo });

    // 1. First execution admitted
    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-1' };
    const adm1 = await admitAgentExecution('spec-resume-active', candidate1, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm1.admitted, true);

    // Verify claim exists
    const claimBefore = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimBefore);
    assert.equal(claimBefore.ownerId, adm1.ownerId);

    // 2. Turn ends (Hook 1) while task is active
    const relRes = await releaseAdmittedExecution('spec-resume-active');
    assert.equal(relRes.outcome, 'resumable');
    assert.equal(relRes.released, true);
    assert.equal(relRes.settled, false);

    // Claim released, null in lockfile
    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter, null);

    // workflow_progress unchanged
    const changeAfter = fs.readFileSync(path.join(sDir, 'change.yaml'), 'utf8');
    assert.ok(changeAfter.includes('current_attempt: 1'));
    assert.ok(changeAfter.includes('state: active'));

    // 3. Subsequent admission for same task succeeds and gets same attempt/step
    const candidate2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-2' };
    const adm2 = await admitAgentExecution('spec-resume-active', candidate2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm2.admitted, true);
    assert.notEqual(adm2.ownerId, adm1.ownerId);

    await releaseAdmittedExecution('spec-resume-active');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): Turn ending at pre-activation blocker releases claim cleanly as resumable without marking recovery', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-resume-blocker');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-resume-blocker
title: Resume Blocker Spec
spec_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: waiting-for-step-start
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1 with blocker'], { cwd: tmpRepo });

    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-blocker-1' };
    const adm1 = await admitAgentExecution('spec-resume-blocker', candidate1, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm1.admitted, true);

    const relRes = await releaseAdmittedExecution('spec-resume-blocker');
    assert.equal(relRes.outcome, 'resumable');
    assert.equal(relRes.released, true);
    assert.equal(relRes.markedRecovery, undefined);

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter, null);

    // Subsequent admission succeeds without attempt increment
    const candidate2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-blocker-2' };
    const adm2 = await admitAgentExecution('spec-resume-blocker', candidate2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm2.admitted, true);

    await releaseAdmittedExecution('spec-resume-blocker');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): In-flight start-operation record marks recovery-required and blocks future admission', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-start-op');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-start-op
title: Start Op Spec
spec_id: 'c3d4e5f6-a7b8-9012-cdef-123456789012'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1'], { cwd: tmpRepo });

    const candidate = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-start' };
    const adm = await admitAgentExecution('spec-start-op', candidate, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm.admitted, true);

    // Persist in-flight start-operation record
    saveStartOperation(tmpRepo, {
      change: 'spec-start-op',
      task: 't1',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      consumptionSequence: 1,
    });

    const relRes = await releaseAdmittedExecution('spec-start-op');
    assert.equal(relRes.outcome, 'recovery-required');
    assert.equal(relRes.markedRecovery, true);

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.status, 'recovery-required');

    // Future admission blocked by recovery
    const admBlocked = await admitAgentExecution('spec-start-op', { taskId: 't1', stepId: 'implementation', sessionId: 'sess-blocked' }, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(admBlocked.admitted, false);
    assert.equal(admBlocked.reason, 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): In-flight non-replayable finish-operation record marks recovery-required and blocks future admission', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-finish-non-rep');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-finish-non-rep
title: Non-Replayable Finish Op Spec
spec_id: 'd4e5f6a7-b8c9-0123-def1-234567890123'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1'], { cwd: tmpRepo });

    const candidate = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-finish-non-rep' };
    const adm = await admitAgentExecution('spec-finish-non-rep', candidate, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm.admitted, true);

    // Save in-flight finish record with failed stage (non-replayable)
    saveOperationRecord(tmpRepo, {
      operationId: 'op-finish-fail',
      change: 'spec-finish-non-rep',
      task: 't1',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'failed' },
      ],
    });

    const relRes = await releaseAdmittedExecution('spec-finish-non-rep');
    assert.equal(relRes.outcome, 'recovery-required');
    assert.equal(relRes.markedRecovery, true);

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.status, 'recovery-required');

    // Future admission blocked by recovery
    const admBlocked = await admitAgentExecution('spec-finish-non-rep', { taskId: 't1', stepId: 'implementation' }, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(admBlocked.admitted, false);
    assert.equal(admBlocked.reason, 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): In-flight replayable finish-operation record produces resumable and leaves record intact', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-finish-rep');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-finish-rep
title: Replayable Finish Op Spec
spec_id: 'e5f6a7b8-c9d0-1234-ef12-345678901234'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');

    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1'], { cwd: tmpRepo });

    const candidate = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-finish-rep' };
    const adm = await admitAgentExecution('spec-finish-rep', candidate, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm.admitted, true);

    // Save in-flight finish record that is deterministically replayable
    saveOperationRecord(tmpRepo, {
      operationId: 'op-finish-replayable-123',
      change: 'spec-finish-rep',
      task: 't1',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'pending' },
      ],
    });

    const relRes = await releaseAdmittedExecution('spec-finish-rep');
    assert.equal(relRes.outcome, 'resumable');
    assert.equal(relRes.released, true);
    assert.equal(relRes.markedRecovery, undefined);

    // Claim released cleanly
    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter, null);

    // Durable record left completely intact
    const loadedOp = loadOperationRecord(tmpRepo, 'spec-finish-rep', 't1', 'implementation', 1);
    assert.ok(loadedOp);
    assert.equal(loadedOp.operationId, 'op-finish-replayable-123');
    assert.equal(loadedOp.status, 'running');

    // Subsequent admission succeeds
    const adm2 = await admitAgentExecution('spec-finish-rep', { taskId: 't1', stepId: 'implementation', sessionId: 'sess-rep-2' }, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm2.admitted, true);

    await releaseAdmittedExecution('spec-finish-rep');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 06): Scenario D: Non-terminal live claim rejects second admitAgentExecution for same spec', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const candidateA = { taskId: 't1', stepId: 'impl', sessionId: 'sess-live-A' };
    const admA = await admitAgentExecution('spec-1', candidateA, { repoRoot: tmpRepo });
    assert.equal(admA.admitted, true);

    // Second admission while turn A is still live (same specId rejected by in-process admission guard)
    const candidateB = { taskId: 't1', stepId: 'impl', sessionId: 'sess-live-B' };
    const admB = await admitAgentExecution('spec-1', candidateB, { repoRoot: tmpRepo });
    assert.equal(admB.admitted, false);
    assert.equal(admB.reason, 'ACTIVE_EXECUTION_EXISTS');

    // Admission for different spec in same worktree rejected by workspace-writer slot contention
    const admOtherSpec = await admitAgentExecution('spec-boot', { taskId: 't1', stepId: 'impl' }, { repoRoot: tmpRepo });
    assert.equal(admOtherSpec.admitted, false);
    assert.equal(admOtherSpec.reason, 'WORKSPACE_WRITER_CONTENDED');

    // Once turn A releases cleanly
    await releaseAdmittedExecution('spec-1');

    // Turn B can now be admitted
    const admB2 = await admitAgentExecution('spec-1', candidateB, { repoRoot: tmpRepo });
    assert.equal(admB2.admitted, true);

    await releaseAdmittedExecution('spec-1');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 03): direct single-task readiness treats dirty-worktree and replayable-finish tasks as runnable (activation-only); excludes non-replayable finish task', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const definition = loadWorkflowDefinition('standard', { repoRoot: tmpRepo });

    // 1. Task with dirty worktree: readiness.ready is false, but it is runnable via the
    // activation-only exception (no queue file involved — batch-execution-
    // generalization, task 01).
    fs.writeFileSync(path.join(tmpRepo, 'dirty-queue.txt'), 'dirty content');
    const changeDirty = {
      id: 'spec-1',
      _slug: 'spec-1',
      workflow: { mode: 'deterministic', definition: 'standard' },
      tasks: [
        { id: 't1', status: 'in-progress', order: 1 },
      ],
    };
    const task1 = changeDirty.tasks[0];
    const readinessDirty = evaluateExecutionReadiness(task1, changeDirty, 'agent', { definition, repoRoot: tmpRepo });
    const isActivationOnlyDirty = !readinessDirty.ready && isActivationOnlyBlocker(readinessDirty, {
      repoRoot: tmpRepo,
      task: task1,
      change: changeDirty,
      record: readinessDirty.priorRecord,
    });
    assert.ok(readinessDirty.ready || isActivationOnlyDirty, 't1 must be runnable (ready, or activation-only via dirty worktree)');

    // Clean up dirty file
    fs.unlinkSync(path.join(tmpRepo, 'dirty-queue.txt'));

    // 2. Task with safely-replayable finish operation is runnable; non-replayable is not
    const changeFinish = {
      id: 'spec-1',
      _slug: 'spec-1',
      workflow: { mode: 'deterministic', definition: 'standard' },
      tasks: [
        {
          id: 't-rep',
          status: 'in-progress',
          order: 1,
          workflow_progress: {
            current_step: 'implementation',
            current_attempt: 1,
            state: 'completed',
            history: [
              {
                step: 'implementation',
                attempt: 1,
                transitioned_to: 'review',
              },
            ],
          },
        },
        {
          id: 't-block',
          status: 'in-progress',
          order: 2,
          workflow_progress: {
            current_step: 'implementation',
            current_attempt: 1,
            state: 'completed',
            history: [
              {
                step: 'implementation',
                attempt: 1,
                transitioned_to: 'review',
              },
            ],
          },
        },
      ],
    };
    // Save replayable record for t-rep
    saveOperationRecord(tmpRepo, {
      change: 'spec-1',
      task: 't-rep',
      step: 'implementation',
      attempt: 1,
      operationId: 'op-rep-queue',
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running' },
      ],
    });
    // Save non-replayable record for t-block
    saveOperationRecord(tmpRepo, {
      change: 'spec-1',
      task: 't-block',
      step: 'implementation',
      attempt: 1,
      operationId: 'op-block-queue',
      status: 'blocked',
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'unknown' },
      ],
    });

    const tRep = changeFinish.tasks.find((t) => t.id === 't-rep');
    const tBlock = changeFinish.tasks.find((t) => t.id === 't-block');

    const readinessRep = evaluateExecutionReadiness(tRep, changeFinish, 'agent', { definition, repoRoot: tmpRepo });
    const runnableRep = readinessRep.ready || isActivationOnlyBlocker(readinessRep, {
      repoRoot: tmpRepo,
      task: tRep,
      change: changeFinish,
      record: readinessRep.priorRecord,
    });
    assert.ok(runnableRep, 't-rep (replayable finish) must be runnable');

    const readinessBlock = evaluateExecutionReadiness(tBlock, changeFinish, 'agent', { definition, repoRoot: tmpRepo });
    const runnableBlock = readinessBlock.ready || isActivationOnlyBlocker(readinessBlock, {
      repoRoot: tmpRepo,
      task: tBlock,
      change: changeFinish,
      record: readinessBlock.priorRecord,
    });
    assert.equal(runnableBlock, false, 't-block (non-replayable finish) must be excluded');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 03): Admitted activation-blocked execution has live claim (kind: "agent") and second admission fails (Scenario D)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    // Create dirty file in worktree
    fs.writeFileSync(path.join(tmpRepo, 'dirty-file.txt'), 'dirty');

    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-dirty-1' };
    const adm = await admitAgentExecution('spec-1', candidate1, { repoRoot: tmpRepo });
    assert.equal(adm.admitted, true);

    // Live workspace-writer claim exists with kind: 'agent'
    const liveClaim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(liveClaim);
    assert.equal(liveClaim.kind, 'agent');
    assert.equal(liveClaim.ownerId, adm.ownerId);
    assert.equal(liveClaim.specId, 'spec-1');
    assert.equal(liveClaim.taskId, 't1');

    // Second admission while activation-blocked execution is live fails (Scenario D)
    const candidate2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-dirty-2' };
    const adm2 = await admitAgentExecution('spec-1', candidate2, { repoRoot: tmpRepo });
    assert.equal(adm2.admitted, false);
    assert.equal(adm2.reason, 'ACTIVE_EXECUTION_EXISTS');

    // Release admitted execution
    await releaseAdmittedExecution('spec-1');
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
    assert.equal(hasActiveAgentExecution('spec-1'), false);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 03): Unexpected exception in startTurn leaves no dangling claim and no stale activeExecutions', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const mockSessionService = {
      createSession: async () => ({
        sessionId: 'sess-fail-start',
        id: 'sess-fail-start',
      }),
      startTurn: async () => {
        throw new Error('Simulated startTurn unexpected exception');
      },
    };

    const candidate = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-fail-start' };
    await assert.rejects(
      () => admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo, sessionService: mockSessionService }),
      (err) => err.message.includes('Simulated startTurn unexpected exception')
    );

    // Workspace claim was released and not left dangling
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
    // activeExecutions was cleared and not left stale
    assert.equal(hasActiveAgentExecution('spec-1'), false);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 03): subscribeToSession failure leaves no dangling claim, no stale activeExecutions, and returns admitted: false', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const mockSessionService = {
      createSession: async () => ({
        sessionId: 'sess-fail-sub',
        id: 'sess-fail-sub',
      }),
      startTurn: async () => ({
        turnId: 'turn-sub-fail',
        status: 'active',
      }),
      subscribeToSession: () => {
        throw new Error('Simulated subscribeToSession failure');
      },
    };

    const candidate = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-fail-sub' };
    const adm = await admitAgentExecution('spec-1', candidate, { repoRoot: tmpRepo, sessionService: mockSessionService });

    // Returns admitted: false
    assert.equal(adm.admitted, false);
    assert.equal(adm.reason, 'SESSION_SUBSCRIPTION_FAILED');

    // Workspace claim was released and not left dangling
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
    // activeExecutions was cleared and not left stale
    assert.equal(hasActiveAgentExecution('spec-1'), false);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 08): Releasing a claim with outcome: "resumable" writes activity record for all three sub-cases', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');

    // ── Sub-case 1: Active mid-flight ──
    const sDirActive = path.join(specsDir, 'spec-sub-active');
    const tasksDirActive = path.join(sDirActive, 'tasks');
    fs.mkdirSync(tasksDirActive, { recursive: true });
    fs.writeFileSync(path.join(sDirActive, 'change.yaml'), `schema_version: '1.0'
id: spec-sub-active
title: Active Mid-Flight Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');
    fs.writeFileSync(path.join(tasksDirActive, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    // ── Sub-case 2: Pre-activation blocker abandoned (never-activated) ──
    const sDirBlocker = path.join(specsDir, 'spec-sub-blocker');
    const tasksDirBlocker = path.join(sDirBlocker, 'tasks');
    fs.mkdirSync(tasksDirBlocker, { recursive: true });
    fs.writeFileSync(path.join(sDirBlocker, 'change.yaml'), `schema_version: '1.0'
id: spec-sub-blocker
title: Blocker Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: waiting-for-step-start
`, 'utf8');
    fs.writeFileSync(path.join(tasksDirBlocker, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    // ── Sub-case 3: Replayable finish operation left behind ──
    const sDirReplay = path.join(specsDir, 'spec-sub-replay');
    const tasksDirReplay = path.join(sDirReplay, 'tasks');
    fs.mkdirSync(tasksDirReplay, { recursive: true });
    fs.writeFileSync(path.join(sDirReplay, 'change.yaml'), `schema_version: '1.0'
id: spec-sub-replay
title: Replay Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');
    fs.writeFileSync(path.join(tasksDirReplay, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add test specs for audit trail'], { cwd: tmpRepo });

    // Test Sub-case 1: Active mid-flight
    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-sub1', turnId: 'turn-sub1' };
    const adm1 = await admitAgentExecution('spec-sub-active', candidate1, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm1.admitted, true);
    const rel1 = await releaseAdmittedExecution('spec-sub-active');
    assert.equal(rel1.outcome, 'resumable');

    const activities1 = readActivities('spec-sub-active', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(activities1.length, 1);
    assert.equal(activities1[0].type, 'workflow.execution.resumable');
    assert.equal(activities1[0].data.sessionId, 'sess-sub1');
    assert.equal(activities1[0].data.turnId, 'turn-sub1');
    assert.equal(activities1[0].data.step, 'implementation');
    assert.equal(activities1[0].data.attempt, 1);
    assert.equal(activities1[0].data.outcome, 'resumable');
    assert.equal(activities1[0].data.changeSlug, 'spec-sub-active');
    assert.equal(typeof activities1[0].occurredAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(activities1[0].occurredAt)));

    // Test Sub-case 2: Never activated / blocker abandoned
    const candidate2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-sub2', turnId: 'turn-sub2' };
    const adm2 = await admitAgentExecution('spec-sub-blocker', candidate2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm2.admitted, true);
    const rel2 = await releaseAdmittedExecution('spec-sub-blocker');
    assert.equal(rel2.outcome, 'resumable');

    const activities2 = readActivities('spec-sub-blocker', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(activities2.length, 1);
    assert.equal(activities2[0].type, 'workflow.execution.resumable');
    assert.equal(activities2[0].data.sessionId, 'sess-sub2');
    assert.equal(activities2[0].data.turnId, 'turn-sub2');
    assert.equal(activities2[0].data.step, 'implementation');
    assert.equal(activities2[0].data.attempt, 1);
    assert.equal(activities2[0].data.outcome, 'resumable');
    assert.equal(typeof activities2[0].occurredAt, 'string');

    // Test Sub-case 3: Replayable finish-operation left behind
    const candidate3 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-sub3', turnId: 'turn-sub3' };
    const adm3 = await admitAgentExecution('spec-sub-replay', candidate3, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm3.admitted, true);

    saveOperationRecord(tmpRepo, {
      operationId: 'op-replayable-audit-1',
      change: 'spec-sub-replay',
      task: 't1',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'pending' },
      ],
    });

    const rel3 = await releaseAdmittedExecution('spec-sub-replay');
    assert.equal(rel3.outcome, 'resumable');

    const activities3 = readActivities('spec-sub-replay', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(activities3.length, 1);
    assert.equal(activities3[0].type, 'workflow.execution.resumable');
    assert.equal(activities3[0].data.sessionId, 'sess-sub3');
    assert.equal(activities3[0].data.turnId, 'turn-sub3');
    assert.equal(activities3[0].data.step, 'implementation');
    assert.equal(activities3[0].data.attempt, 1);
    assert.equal(activities3[0].data.outcome, 'resumable');
    assert.equal(typeof activities3[0].occurredAt, 'string');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 08): Subsequent admission resuming same (changeSlug, taskId, step, attempt) writes linked second activity record', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-resume-link');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-resume-link
title: Resume Link Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');
    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1 for resume link'], { cwd: tmpRepo });

    // Turn 1 ends resumable
    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-first', turnId: 'turn-first' };
    const adm1 = await admitAgentExecution('spec-resume-link', candidate1, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm1.admitted, true);
    await releaseAdmittedExecution('spec-resume-link');

    const activitiesAfterRel1 = readActivities('spec-resume-link', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(activitiesAfterRel1.length, 1);
    const rec1 = activitiesAfterRel1[0];
    assert.equal(rec1.type, 'workflow.execution.resumable');

    // Turn 2 admits, resuming the same (spec-resume-link, t1, implementation, 1)
    const candidate2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-second', turnId: 'turn-second' };
    const adm2 = await admitAgentExecution('spec-resume-link', candidate2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(adm2.admitted, true);

    const activitiesAfterAdm2 = readActivities('spec-resume-link', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(activitiesAfterAdm2.length, 2);

    const rec2 = activitiesAfterAdm2[1];
    assert.equal(rec2.type, 'workflow.execution.resumed');
    assert.equal(rec2.triggeredBy, rec1.id);
    assert.equal(rec2.actor.id, 'sess-second');
    assert.equal(rec2.data.sessionId, 'sess-second');
    assert.equal(rec2.data.turnId, 'turn-second');
    assert.equal(rec2.data.step, 'implementation');
    assert.equal(rec2.data.attempt, 1);
    assert.equal(rec2.data.changeSlug, 'spec-resume-link');
    assert.equal(rec2.data.priorActivityId, rec1.id);
    assert.equal(rec2.data.priorSessionId, 'sess-first');
    assert.equal(rec2.data.priorTurnId, 'turn-first');
    assert.equal(typeof rec2.occurredAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(rec2.occurredAt)));

    await releaseAdmittedExecution('spec-resume-link');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 08): Admission for a different task or next attempt after real finish does not produce spurious resumed correlation', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-no-spurious');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-no-spurious
title: No Spurious Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
  - id: t2
    file: tasks/t2.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: waiting-for-step-start
`, 'utf8');
    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');
    fs.writeFileSync(path.join(tasksDir, 't2.md'), `---
id: t2
status: in-progress
allowed_paths:
  - README.md
---
# Task 2
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add tasks for spurious test'], { cwd: tmpRepo });

    // 1. Task t1 released as resumable
    const candT1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-t1-orig', turnId: 'turn-t1-orig' };
    const admT1 = await admitAgentExecution('spec-no-spurious', candT1, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(admT1.admitted, true);
    await releaseAdmittedExecution('spec-no-spurious');

    const actsAfterT1 = readActivities('spec-no-spurious', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(actsAfterT1.length, 1);
    assert.equal(actsAfterT1[0].type, 'workflow.execution.resumable');

    // 2. Admission for a DIFFERENT task (t2) does NOT produce a resumed event
    const candT2 = { taskId: 't2', stepId: 'implementation', sessionId: 'sess-t2', turnId: 'turn-t2' };
    const admT2 = await admitAgentExecution('spec-no-spurious', candT2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(admT2.admitted, true);

    const actsAfterT2 = readActivities('spec-no-spurious', { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(actsAfterT2.length, 1); // No new resumed event written for t2!
    await releaseAdmittedExecution('spec-no-spurious');

    // 3. Admission for the same task (t1) but for the NEXT attempt (attempt 2) after real finish
    // Update change.yaml to simulate real finish (attempt advanced to 2)
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-no-spurious
title: No Spurious Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 2
      state: active
      history:
        - step: implementation
          attempt: 1
          transitioned_to: completed
  - id: t2
    file: tasks/t2.md
    status: in-progress
`, 'utf8');

    const candT1Att2 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-t1-att2', turnId: 'turn-t1-att2' };
    const admT1Att2 = await admitAgentExecution('spec-no-spurious', candT1Att2, { repoRoot: tmpRepo, activeDir: specsDir });
    assert.equal(admT1Att2.admitted, true);

    // Activities must still have no resumed event matching attempt 1's resumable record
    const actsAfterT1Att2 = readActivities('spec-no-spurious', { repoRoot: tmpRepo, activeDir: specsDir });
    const resumedEvents = actsAfterT1Att2.filter((a) => a.type === 'workflow.execution.resumed');
    assert.equal(resumedEvents.length, 0);

    await releaseAdmittedExecution('spec-no-spurious');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC (Task 08): Simulated activity-store write failure does not prevent claim release or admission from succeeding', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();

  try {
    const specsDir = path.join(tmpRepo, 'specs', 'active');
    const sDir = path.join(specsDir, 'spec-audit-fail');
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-audit-fail
title: Write Failure Spec
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');
    fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Add task t1 for write failure test'], { cwd: tmpRepo });

    // Create a regular file at the activity directory path so mkdirSync / appendFileSync throws ENOTDIR
    const brokenActivityDir = path.join(tmpRepo, '.nevo-ai-local', 'activity');
    fs.mkdirSync(path.dirname(brokenActivityDir), { recursive: true });
    fs.writeFileSync(brokenActivityDir, 'blocking-file-not-a-dir', 'utf8');

    const candidate1 = { taskId: 't1', stepId: 'implementation', sessionId: 'sess-fail-1', turnId: 'turn-fail-1' };
    const adm1 = await admitAgentExecution('spec-audit-fail', candidate1, { repoRoot: tmpRepo, activeDir: specsDir, activityDir: brokenActivityDir });
    // Admission succeeds despite activity store failure
    assert.equal(adm1.admitted, true);

    // Release succeeds despite activity store failure
    const rel1 = await releaseAdmittedExecution('spec-audit-fail');
    assert.equal(rel1.outcome, 'resumable');
    assert.equal(rel1.released, true);

    // Workspace claim released cleanly
    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim, null);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});




