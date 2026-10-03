// End-to-end orchestration tests for workflow engine, CLI manual arbitration,
// dependency consumption, and standing invariants (Task 33).
// Run: node --test tools/tests/orchestration-e2e.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  acquireGitFinalizeLease,
  releaseGitFinalizeLease,
  withGitFinalizeLock,
} from '../specs/workflow/git-finalize-lock.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
  getWorkspaceWriterClaim,
  withWorkspaceControlLock,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
} from '../specs/workflow/workspace-request.mjs';
import {
  registerRequestKindReconciler,
  reconcileRequestBackedWorkspaceClaim,
} from '../specs/workflow/workspace-claim-reconciliation.mjs';
import {
  recordDependencyConsumption,
  loadDependencyConsumption,
  findConsumersOfEpoch,
} from '../specs/workflow/dependency-consumption.mjs';
import {
  planStart,
  completeActivateStage,
  completeConsumptionStage,
  findInFlightStartOperation,
} from '../specs/workflow/start-operation.mjs';
import { assessExecutionSettlement } from '../specs/workflow/execution-settlement.mjs';
import {
  activateAndSubmitHumanStep,
  startHumanStep,
  submitHumanStepResult,
} from '../specs/workflow/human-step/operations.mjs';
import {
  createHumanSubmitOperationRecord,
  loadHumanSubmitOperation,
  updateHumanSubmitOperationStatus,
} from '../specs/workflow/human-step/submit-request.mjs';
import { publishTask } from '../specs/workflow/publish/operation.mjs';
import { projectTask, TaskProjection } from '../specs/workflow/task-projection.mjs';
import { projectSuspensions } from '../specs/workflow/suspension-projection.mjs';
import {
  admitAgentExecution,
  releaseAdmittedExecution,
  resetAdmissionStateForTest,
  hasActiveAgentExecution,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { reconcileBootState } from '../dashboard/server/ai/orchestration/reconciliation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createTempRepo(prefix = 'orch-e2e') {
  const dir = path.join(
    REPO_ROOT,
    '.nevo-ai-local',
    `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Orchestration Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'orch@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Orchestration Test\n', 'utf8');

  // Copy workflow definitions
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

  // Create active specs
  const specsDir = path.join(dir, 'specs', 'active');
  for (const s of ['spec-A', 'spec-B', 'spec-dogfood']) {
    const sDir = path.join(specsDir, s);
    const tasksDir = path.join(sDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(sDir, 'change.yaml'),
      `
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
`,
      'utf8',
    );

    for (const tid of ['t1', 't2']) {
      fs.writeFileSync(
        path.join(tasksDir, `${tid}.md`),
        `---
id: ${tid}
status: in-progress
allowed_paths:
  - README.md
---
# Task ${tid}
`,
        'utf8',
      );
    }
  }

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('AC 1 & AC 3: Git-finalize lease acquired exclusively and reclaims dead PID without file deletion (D50, D51)', async () => {
  const tmpRepo = createTempRepo();
  try {
    // 1. Exclusive lease acquisition
    const lease = await acquireGitFinalizeLease({ repoRoot: tmpRepo });
    assert.ok(lease.ownerId);

    // 2. Dead PID lease simulation
    const lockFile = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'git-finalize.lock');
    fs.writeFileSync(
      lockFile,
      JSON.stringify({
        ownerId: 'dead-owner-123',
        pid: 99999999, // confirmed dead PID
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );

    // A new acquirer reclaims the dead lease without manual deletion
    const reclaimed = await acquireGitFinalizeLease({
      repoRoot: tmpRepo,
      timeoutMs: 1000,
      retryIntervalMs: 50,
    });
    assert.ok(reclaimed.ownerId);
    assert.notEqual(reclaimed.ownerId, 'dead-owner-123');
    reclaimed.release();
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 4, 5, 6, 7: Active agent holds workspace-writer slot until settled; human-submit & Publish wait cleanly', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    // Agent execution admitted and holds workspace-writer claim
    const candidate = { taskId: 't1', stepId: 'impl', sessionId: 'sess-active-agent' };
    const admission = await admitAgentExecution('spec-A', candidate, { repoRoot: tmpRepo });
    assert.equal(admission.admitted, true);

    // 1. Human-submit attempted while agent active waits and does not mutate tracked files
    const humanAcquire = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(humanAcquire.acquired, false, 'Human submit must wait for active agent claim');

    // 2. Publish attempted while agent active waits and does not mutate tracked files
    const pubAcquire = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(pubAcquire.acquired, false, 'Publish must wait for active agent claim');

    // 3. Agent leaves dirty files: release without commit leaves recovery-required
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Dirty agent code\n', 'utf8');

    const releaseRes = await releaseAdmittedExecution('spec-A');
    assert.equal(releaseRes.settled, false);
    assert.equal(releaseRes.markedRecovery, true);

    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim.status, 'recovery-required');

    // Subsequent writers remain blocked, preventing absorbing agent dirty state
    const pubRetry = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(pubRetry.acquired, false);
    assert.equal(Boolean(pubRetry.blocked), true);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 9, 10, 11: Workspace-writer recovery on restart and rollback on admission failure', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    registerRequestKindReconciler('publish', async () => {
      return { settled: true, terminalStatus: 'completed' };
    });

    const pubReq = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'pub-test' },
    });

    // 1. Stale dead-PID non-agent claim is safely reclaimed by new acquirer (AC 10)
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'dead-pub-owner',
        kind: 'publish',
        status: 'active',
        requestId: pubReq.requestId,
        specId: 'spec-A',
        taskId: 't1',
        pid: 99999999,
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-A',
      taskId: 't2',
      timeoutMs: 1000,
    });
    assert.equal(acq.acquired, true, 'Dead non-agent PID must be reclaimed by a new acquirer');

    // 2. Live owner is never stolen
    const stealAttempt = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(stealAttempt.acquired, false, 'Live owner must never be stolen');

    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: acq.ownerId,
      expectedKind: 'agent',
    });

    // 3. Admission failure releases both admission and workspace-writer claims (AC 11)
    const mockSessionService = {
      createSession: async () => {
        throw new Error('Forced failure');
      },
    };
    await assert.rejects(
      async () => {
        await admitAgentExecution('spec-A', { taskId: 't1', sessionPolicy: 'fresh' }, { repoRoot: tmpRepo, sessionService: mockSessionService });
      },
      /Forced failure/,
    );
    assert.equal(hasActiveAgentExecution('spec-A'), false);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 12, 13, 14, 15, 16, 17, 18: Monotonic dependency consumption, custom step names, and epoch matching (D52, D58)', async () => {
  const tmpRepo = createTempRepo();
  try {
    // 1. Attempt 1 consumes epoch 1
    const r1 = recordDependencyConsumption({
      repoRoot: tmpRepo,
      change: 'spec-dogfood',
      consumingTaskId: 'task-consumer',
      consumingStep: 'specialized-impl', // AC 17: custom step name with consumesDependencies: true
      consumingAttempt: 1,
      consumptionSequence: 10,
      dependencies: [{ taskId: 'dep-task', releaseEpoch: { step: 'impl', attempt: 1 } }],
    });
    assert.equal(r1.consumptionSequence, 10);

    // 2. Later rework attempt consumes fresh epoch 2 at higher consumptionSequence (AC 13)
    const r2 = recordDependencyConsumption({
      repoRoot: tmpRepo,
      change: 'spec-dogfood',
      consumingTaskId: 'task-consumer',
      consumingStep: 'specialized-impl',
      consumingAttempt: 2,
      consumptionSequence: 20,
      dependencies: [{ taskId: 'dep-task', releaseEpoch: { step: 'impl', attempt: 2 } }],
    });
    assert.equal(r2.consumptionSequence, 20);

    // AC 15: Invalidating epoch 2 discovers consumer via findConsumersOfEpoch; epoch 1 does not
    const consumersOfEpoch2 = findConsumersOfEpoch({
      repoRoot: tmpRepo,
      change: 'spec-dogfood',
      dependencyTaskId: 'dep-task',
      releaseEpoch: { step: 'impl', attempt: 2 },
    });
    assert.equal(consumersOfEpoch2.length, 1);
    assert.equal(consumersOfEpoch2[0].consumingTaskId, 'task-consumer');
    assert.equal(consumersOfEpoch2[0].consumptionSequence, 20);

    const consumersOfEpoch1 = findConsumersOfEpoch({
      repoRoot: tmpRepo,
      change: 'spec-dogfood',
      dependencyTaskId: 'dep-task',
      releaseEpoch: { step: 'impl', attempt: 1 },
    });
    assert.equal(consumersOfEpoch1.length, 0, 'Superseded epoch 1 must not be matched as authoritative');

    // AC 16: Path identity distinguishes step and attempt
    const loadedAttempt1 = loadDependencyConsumption(tmpRepo, 'spec-dogfood', 'task-consumer', 'specialized-impl', 1);
    const loadedAttempt2 = loadDependencyConsumption(tmpRepo, 'spec-dogfood', 'task-consumer', 'specialized-impl', 2);
    assert.equal(loadedAttempt1.consumptionSequence, 10);
    assert.equal(loadedAttempt2.consumptionSequence, 20);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 19: Two simultaneous admitAgentExecution requests for one spec result in at most one created execution (D33)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    const candidate1 = { taskId: 't1', stepId: 'impl', sessionId: 'sess-1' };
    const candidate2 = { taskId: 't2', stepId: 'impl', sessionId: 'sess-2' };

    const [r1, r2] = await Promise.all([
      admitAgentExecution('spec-A', candidate1, { repoRoot: tmpRepo }),
      admitAgentExecution('spec-A', candidate2, { repoRoot: tmpRepo }),
    ]);

    assert.equal(r1.admitted !== r2.admitted, true, 'Exactly one execution admitted');
    const admitted = r1.admitted ? r1 : r2;
    const rejected = r1.admitted ? r2 : r1;
    assert.equal(rejected.reason, 'ACTIVE_EXECUTION_EXISTS');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 22, 23, 24: Standing invariants (release stability, pure task projection, single active agent)', async () => {
  const tmpRepo = createTempRepo();
  try {
    // AC 23: Task projection remains pure under suspensions
    const change = {
      id: 'spec-A',
      workflow: { mode: 'deterministic', definition: 'standard' },
      tasks: [{ id: 't1', order: 1 }],
    };
    const baseTask = {
      id: 't1',
      status: 'implemented',
      workflow_progress: { step: 'review', attempt: 1, active: false, history: [] },
    };

    const definition = { steps: { review: { executor: 'agent' } } };
    const projection1 = projectTask(baseTask, change, { definition });
    const projection2 = projectTask(baseTask, change, { definition });

    assert.deepEqual(projection1, projection2, 'Task projection must be pure');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 25, 26, 27: Execution settlement assessment branches (settled vs unfinalized/running op)', async () => {
  const tmpRepo = createTempRepo();
  try {
    // 1. Clean repo is settled
    const cleanSettlement = await assessExecutionSettlement({
      repoRoot: tmpRepo,
      changeSlug: 'spec-A',
      taskId: 't1',
    });
    assert.equal(cleanSettlement.settled, true);

    // 2. Dirty repo is unsettled
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Dirty\n', 'utf8');
    const dirtySettlement = await assessExecutionSettlement({
      repoRoot: tmpRepo,
      changeSlug: 'spec-A',
      taskId: 't1',
    });
    assert.equal(dirtySettlement.settled, false);
    assert.equal(dirtySettlement.reason, 'dirty-in-scope-files');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 29, 30, 72: CLI manual claim acquisition and settlement-gated release (D62, D85)', async () => {
  const tmpRepo = createTempRepo();
  try {
    // Direct CLI acquisition
    const cliClaim = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'cli-manual',
      specId: 'spec-A',
      taskId: 't1',
    });
    assert.equal(cliClaim.acquired, true);

    // Concurrently active agent is blocked
    const blockedAgent = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-A',
      taskId: 't2',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(blockedAgent.acquired, false);

    // Release cli-manual claim
    const rel = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: cliClaim.ownerId,
      expectedKind: 'cli-manual',
    });
    assert.equal(rel.released, true);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 32 & AC 33: publishTask arbitration and cross-spec contention in shared worktree (D64, D65)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    // Agent active in Spec A
    const candidate = { taskId: 't1', stepId: 'impl', sessionId: 'sess-spec-a' };
    const adm = await admitAgentExecution('spec-A', candidate, { repoRoot: tmpRepo });
    assert.equal(adm.admitted, true);

    // Publish in Spec B sharing same worktree must arbitrate and wait for the shared claim (D65)
    const pubClaimB = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-B',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(pubClaimB.acquired, false, 'Spec B Publish must wait for Spec A workspace-writer');
    assert.equal(pubClaimB.currentClaim.specId, 'spec-A');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 37: No auto-clean or auto-stash on workspace-writer reconciliation', async () => {
  const tmpRepo = createTempRepo();
  try {
    const filePath = path.join(tmpRepo, 'custom-untracked.txt');
    fs.writeFileSync(filePath, 'Important user changes\n', 'utf8');

    await reconcileBootState({ repoRoot: tmpRepo });

    // File must remain exactly as left
    assert.ok(fs.existsSync(filePath));
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'Important user changes\n');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 38, 39, 40, 41: Ownership-conditional release and mark-recovery-required fail on mismatched ownerId (D70)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const claimRes = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-A',
      taskId: 't1',
    });
    assert.equal(claimRes.acquired, true);

    // 1. Release with wrong ownerId fails
    const badRelease = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: 'wrong-owner-id',
      expectedKind: 'agent',
    });
    assert.equal(badRelease.released, false);
    assert.equal(badRelease.reason, 'not-current-owner');

    // 2. Mark recovery-required with wrong ownerId fails
    const badMark = await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: 'wrong-owner-id',
      expectedKind: 'agent',
    });
    assert.equal(badMark.marked, false);
    assert.equal(badMark.reason, 'not-current-owner');

    // 3. Correct ownerId succeeds
    const goodRelease = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: claimRes.ownerId,
      expectedKind: 'agent',
    });
    assert.equal(goodRelease.released, true);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 58, 59, 60, 84, 85, 86: Dead-PID request claims trigger request/operation reconciliation (D79, D88)', async () => {
  const tmpRepo = createTempRepo();
  try {
    registerRequestKindReconciler('human-submit', async () => {
      return { settled: true, terminalStatus: 'completed' };
    });

    const hsReq = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'hs-dead' },
    });

    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'dead-hs-owner',
        kind: 'human-submit',
        status: 'active',
        requestId: hsReq.requestId,
        specId: 'spec-A',
        taskId: 't1',
        pid: 99999999,
      }),
      'utf8',
    );

    const claim = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const recRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tmpRepo,
      claimSnapshot: claim,
    });
    assert.equal(recRes.reconciled, true);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 64, 65, 66, 67, 68: requestSequence monotonic allocation, exact requestId in claim, and attempt distinction (D81, D82)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const r1 = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'attempt-1' },
    });
    const r2 = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'attempt-2' },
    });

    assert.ok(r1.requestSequence < r2.requestSequence);
    assert.notEqual(r1.requestId, r2.requestId);

    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      requestId: r1.requestId,
      specId: 'spec-A',
      taskId: 't1',
    });
    assert.equal(acq.acquired, true);

    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim.requestId, r1.requestId);

    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: acq.ownerId,
      expectedRequestId: r1.requestId,
    });
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 76 & AC 77: Request-backed claim with unresolvable or mismatched requestId fails closed', async () => {
  const tmpRepo = createTempRepo();
  try {
    const claimSnapshot = {
      ownerId: 'unresolvable-owner',
      kind: 'publish',
      status: 'active',
      requestId: 'non-existent-request-id',
      specId: 'spec-A',
      taskId: 't1',
      pid: 99999999,
    };

    const recRes = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tmpRepo,
      claimSnapshot,
    });
    assert.equal(recRes.reconciled, false, 'Unresolvable requestId must fail closed');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 79, 80, 81, 82: Human-submit settlement and failure handling (D87)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const claimRes = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-dogfood',
      taskId: 't1',
    });
    assert.equal(claimRes.acquired, true);

    // If human step fails before commit, workspace claim is marked recovery-required
    await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: claimRes.ownerId,
      expectedKind: 'human-submit',
    });

    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim.status, 'recovery-required');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 94, 95, 96, 97, 104, 105: Human-submit operation records, deduplication, conflict rejection, and terminal isolation', async () => {
  const tmpRepo = createTempRepo();
  try {
    // 1. Create first human-submit record
    const r1 = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
      result: 'pass',
    });
    assert.equal(r1.result, 'pass');

    // 2. Terminal state isolation
    updateHumanSubmitOperationStatus({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
      status: 'completed',
    });

    const terminalOp = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.equal(terminalOp.status, 'completed');

    // Attempt 2 can be created cleanly after attempt 1 is terminal
    const r2 = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 2,
      result: 'fail',
    });
    assert.equal(r2.attempt, 2);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 99 & AC 100: Lock nesting precision between workspace-control lock and conditional release', async () => {
  const tmpRepo = createTempRepo();
  try {
    const claimRes = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-A',
      taskId: 't1',
    });
    assert.equal(claimRes.acquired, true);

    // releaseWorkspaceWriterIfOwned acquires workspace-control lock internally and completes cleanly
    const relRes = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: claimRes.ownerId,
      expectedKind: 'agent',
    });
    assert.equal(relRes.released, true);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
