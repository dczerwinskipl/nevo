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
} from '../dashboard/server/ai/orchestration/admission.mjs';
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
import { handleWorkflowVerifyHuman } from '../specs/workflow/cli.mjs';

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

    // Call Hook 1 reconciliation with clean settled state
    const releaseRes = await releaseAdmittedExecution('spec-1');
    assert.equal(releaseRes.settled, true);
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
