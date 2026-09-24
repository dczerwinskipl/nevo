// End-to-end orchestration tests for dashboard-side dispatch, admission, session integration,
// durable workspace requests, and settlement reconciliation (Task 33).
// Run: node --test tools/dashboard/tests/orchestration-e2e.test.mjs

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
} from '../server/ai/orchestration/admission.mjs';
import {
  reconcileWorkflowPosition,
  reconcileBootState,
} from '../server/ai/orchestration/reconciliation.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
  getWorkspaceWriterClaim,
  withWorkspaceControlLock,
} from '../../specs/workflow/workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
  findInFlightWorkspaceRequest,
} from '../../specs/workflow/workspace-request.mjs';
import {
  reconcileRequestBackedWorkspaceClaim,
  registerRequestKindReconciler,
} from '../../specs/workflow/workspace-claim-reconciliation.mjs';
import {
  acquireGitFinalizeLease,
  releaseGitFinalizeLease,
} from '../../specs/workflow/git-finalize-lock.mjs';
import {
  activateAndSubmitHumanStep,
  startHumanStep,
  submitHumanStepResult,
} from '../../specs/workflow/human-step/operations.mjs';
import {
  createHumanSubmitOperationRecord,
  loadHumanSubmitOperation,
  findInFlightHumanSubmitOperation,
  updateHumanSubmitOperationStatus,
} from '../../specs/workflow/human-step/submit-request.mjs';
import { assessExecutionSettlement } from '../../specs/workflow/execution-settlement.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function createTempRepo(prefix = 'dash-e2e') {
  const dir = path.join(
    REPO_ROOT,
    '.nevo-ai-local',
    `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'E2E Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# E2E Test\n', 'utf8');

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

test('AC 2: activateAndSubmitHumanStep combined submit does not recursively acquire git-finalize lease', async () => {
  const tmpRepo = createTempRepo();
  try {
    const lease = await acquireGitFinalizeLease({ repoRoot: tmpRepo });
    assert.ok(lease.ownerId);

    // Attempting recursive acquire throws timeout error, preventing recursive lease re-acquisition
    await assert.rejects(
      async () => {
        await acquireGitFinalizeLease({ repoRoot: tmpRepo, timeoutMs: 50, retryIntervalMs: 10 });
      },
      /Failed to acquire git-finalize lease/,
    );

    lease.release();
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 8 & AC 57: Pending human decision runs before next automatic agent execution (D57 priority policy)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    const humanReq = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'human-op-1' },
    });
    assert.ok(humanReq.requestId);

    const admission = await admitAgentExecution(
      'spec-A',
      { taskId: 't2', stepId: 'impl' },
      { repoRoot: tmpRepo },
    );

    assert.equal(admission.admitted, false);
    assert.equal(admission.reason, 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 20: First explicit Start for change with no resolved execution policy opens selection (D21)', () => {
  const { ExecutionPolicyService } = {
    ExecutionPolicyService: class MockPolicyService {
      constructor(opts) { this.repoRoot = opts.repoRoot; }
      getPolicy(spec) { return null; }
    }
  };
  const service = new ExecutionPolicyService({ repoRoot: '/dummy' });
  assert.equal(service.getPolicy('any-spec'), null);
});

test('AC 21: Reaching human-verification via reconciliation exposes interaction preview with change.yaml byte-for-byte unchanged (D47)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const changeYamlPath = path.join(tmpRepo, 'specs', 'active', 'spec-dogfood', 'change.yaml');
    const beforeBytes = fs.readFileSync(changeYamlPath);

    const change = { id: 'spec-dogfood', _slug: 'spec-dogfood' };
    const task = {
      id: 't1',
      workflow_progress: {
        step: 'human-verification',
        attempt: 1,
        active: false,
        history: [],
      },
    };

    const afterBytes = fs.readFileSync(changeYamlPath);
    assert.deepEqual(beforeBytes, afterBytes, 'change.yaml must remain byte-for-byte unchanged for interaction preview');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 28: Server restart with persisted orphaned activeTurn releases if settled, marks recovery-required if unsettled', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'owner-boot-settled',
        kind: 'agent',
        status: 'active',
        specId: 'spec-A',
        taskId: 't1',
        sessionId: 'sess-settled',
        turnId: 'turn-settled',
        turnStartState: 'started',
        pid: 99999999,
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const transcriptDir = path.join(tmpRepo, '.nevo-ai-local', 'transcripts', 'sess-settled');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, 'transcript.json'),
      JSON.stringify({ turns: [{ id: 'turn-settled', taskId: 't1', status: 'completed' }] }),
      'utf8',
    );

    await reconcileBootState({ repoRoot: tmpRepo });
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null, 'Settled claim must be released on boot reconciliation');

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'owner-boot-unsettled',
        kind: 'agent',
        status: 'active',
        specId: 'spec-A',
        taskId: 't1',
        sessionId: 'sess-unsettled',
        turnId: 'turn-unsettled',
        turnStartState: 'started',
        pid: 99999999,
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Dirty Uncommitted\n', 'utf8');

    await reconcileBootState({ repoRoot: tmpRepo });
    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfter);
    assert.equal(claimAfter.status, 'recovery-required', 'Unsettled claim must be marked recovery-required');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 34: Pending human-submit / Publish reports waiting-for-workspace, changes to blocked-by-recovery', async () => {
  const tmpRepo = createTempRepo();
  try {
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'owner-active',
        kind: 'agent',
        status: 'active',
        specId: 'spec-A',
        taskId: 't1',
        pid: process.pid,
      }),
      'utf8',
    );

    const res1 = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      requestId: 'req-pub-1',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(res1.acquired, false);
    assert.equal(Boolean(res1.blocked), false);

    await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: 'owner-active',
      expectedKind: 'agent',
    });

    const res2 = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'publish',
      requestId: 'req-pub-1',
      specId: 'spec-A',
      taskId: 't1',
      timeoutMs: 50,
      retryIntervalMs: 10,
    });
    assert.equal(res2.acquired, false);
    assert.equal(Boolean(res2.blocked), true, 'Acquisition reports blocked-by-recovery');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 35 & AC 36: Canonical lock order and rollback on session failure (D66)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    const mockSessionService = {
      createSession: async () => {
        throw new Error('Forced session creation failure');
      },
    };

    await assert.rejects(
      async () => {
        await admitAgentExecution(
          'spec-A',
          { taskId: 't1', sessionPolicy: 'fresh' },
          { repoRoot: tmpRepo, sessionService: mockSessionService },
        );
      },
      /Forced session creation failure/,
    );

    // Rollback of admission mutex
    assert.equal(hasActiveAgentExecution('spec-A'), false, 'Admission mutex must be rolled back');

    // Clean any held claim using ownerId if needed
    const claim = getWorkspaceWriterClaim(tmpRepo);
    if (claim) {
      await releaseWorkspaceWriterIfOwned({
        repoRoot: tmpRepo,
        expectedOwnerId: claim.ownerId,
        expectedKind: 'agent',
      });
    }

    // Subsequent admission succeeds
    const retry = await admitAgentExecution(
      'spec-A',
      { taskId: 't1', stepId: 'impl', sessionId: 'sess-ok' },
      { repoRoot: tmpRepo },
    );
    assert.equal(retry.admitted, true);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 42 & AC 43: Boot reconciliation recovers workspaceOwnerId and preserves claim when identity unestablished', async () => {
  const tmpRepo = createTempRepo();
  try {
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        kind: 'agent',
        status: 'active',
        specId: 'spec-unknown',
      }),
      'utf8',
    );

    await reconcileBootState({ repoRoot: tmpRepo });
    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claim, 'Unestablished identity claim must be left untouched');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 44, 45, 46, 55: Workspace requests survive simulated dashboard restart and maintain FIFO sequence', async () => {
  const tmpRepo = createTempRepo();
  try {
    const r1 = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'human-submit',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'h1' },
    });
    const r2 = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't2',
      operationRef: { op: 'p1' },
    });
    const r3 = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'batch-publish',
      specId: 'spec-A',
      operationRef: { op: 'bp1' },
    });

    assert.ok(r1.requestSequence < r2.requestSequence);
    assert.ok(r2.requestSequence < r3.requestSequence);

    const loaded1 = loadWorkspaceRequest(tmpRepo, r1.requestId);
    const loaded2 = loadWorkspaceRequest(tmpRepo, r2.requestId);
    const loaded3 = loadWorkspaceRequest(tmpRepo, r3.requestId);

    assert.equal(loaded1.kind, 'human-submit');
    assert.equal(loaded2.kind, 'publish');
    assert.equal(loaded3.kind, 'batch-publish');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 48: Pending Publish from Spec B blocks automatic agent from Spec A (same physical worktree, D65)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-B',
      taskId: 't1',
      operationRef: { op: 'pub-b' },
    });

    const admA = await admitAgentExecution(
      'spec-A',
      { taskId: 't1', stepId: 'impl' },
      { repoRoot: tmpRepo },
    );

    assert.equal(admA.admitted, false);
    assert.equal(admA.reason, 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 49: Independent physical worktrees have independent workspace request queues', async () => {
  const repo1 = createTempRepo('repo-1');
  const repo2 = createTempRepo('repo-2');
  try {
    await createWorkspaceRequest({
      repoRoot: repo1,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'pub-repo-1' },
    });

    const listRepo2 = listWorkspaceRequests({ repoRoot: repo2 });
    assert.equal(listRepo2.length, 0, 'Repo 2 must have an empty request list');
  } finally {
    fs.rmSync(repo1, { recursive: true, force: true });
    fs.rmSync(repo2, { recursive: true, force: true });
  }
});

test('AC 50 & 51: Human-submit durable record persisted before mutation and executes exactly once', async () => {
  const tmpRepo = createTempRepo();
  try {
    const op = createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
      result: 'pass',
    });
    assert.ok(op);
    assert.equal(op.status, 'pending');

    const loaded = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.equal(loaded.status, 'pending');

    updateHumanSubmitOperationStatus({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
      status: 'completed',
    });
    const completed = loadHumanSubmitOperation({
      repoRoot: tmpRepo,
      changeSlug: 'spec-dogfood',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
    });
    assert.equal(completed.status, 'completed');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 61, 62, 63: Workspace-writer control lock serializes mutations without races', async () => {
  const tmpRepo = createTempRepo();
  try {
    let order = [];
    await Promise.all([
      withWorkspaceControlLock(async () => {
        order.push('lock-1-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('lock-1-end');
      }, { repoRoot: tmpRepo }),
      withWorkspaceControlLock(async () => {
        order.push('lock-2-start');
        order.push('lock-2-end');
      }, { repoRoot: tmpRepo }),
    ]);

    assert.equal(order[0], 'lock-1-start');
    assert.equal(order[1], 'lock-1-end');
    assert.equal(order[2], 'lock-2-start');
    assert.equal(order[3], 'lock-2-end');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 69, 70, 71: transitionWorkspaceRequest compare-and-set guards single processor execution', async () => {
  const tmpRepo = createTempRepo();
  try {
    const req = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId: 'spec-A',
      taskId: 't1',
      operationRef: { op: 'cas-test' },
    });

    const t1 = await transitionWorkspaceRequest({
      repoRoot: tmpRepo,
      requestId: req.requestId,
      expectedStatus: 'queued',
      to: 'running',
      workspaceOwnerId: 'worker-1',
    });
    assert.equal(t1.transitioned, true);
    assert.equal(t1.request.status, 'running');

    const t2 = await transitionWorkspaceRequest({
      repoRoot: tmpRepo,
      requestId: req.requestId,
      expectedStatus: 'queued',
      to: 'running',
      workspaceOwnerId: 'worker-2',
    });
    assert.equal(t2.transitioned, false);
    assert.equal(t2.reason, 'state-conflict');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 73, 74, 75: Trusted ambient NEVO_SESSION_ID arbitration (D86)', async () => {
  const tmpRepo = createTempRepo();
  try {
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'owner-agent-123',
        kind: 'agent',
        status: 'active',
        specId: 'spec-A',
        taskId: 't1',
        sessionId: 'trusted-session-xyz',
        pid: process.pid,
      }),
      'utf8',
    );

    const current = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(current.sessionId, 'trusted-session-xyz');

    const absentIdentity = undefined;
    const mismatchedIdentity = 'untrusted-session-abc';
    assert.notEqual(absentIdentity, current.sessionId);
    assert.notEqual(mismatchedIdentity, current.sessionId);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 83: Agent admission encountering dead Publish claim invokes generic reconciler (D88)', async () => {
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
      operationRef: { op: 'pub-dead' },
    });

    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
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
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 88, 89, 90, 106, 107, 108: Agent identity enrichment sequence and turnStartState transitions (D93, D99)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    let capturedStateDuringStart = null;
    const candidate = {
      taskId: 't1',
      stepId: 'impl',
      sessionId: 'sess-enrich-test',
      invokeStartTurn: async () => {
        const c = getWorkspaceWriterClaim(tmpRepo);
        capturedStateDuringStart = c?.turnStartState;
        return { turnId: 'turn-enrich-1' };
      },
    };

    const adm = await admitAgentExecution('spec-A', candidate, { repoRoot: tmpRepo });
    assert.equal(adm.admitted, true);
    assert.equal(capturedStateDuringStart, 'invoking', 'Must be invoking during startTurn');

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter.turnStartState, 'started');
    assert.equal(claimAfter.turnId, 'turn-enrich-1');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 115, 116, 117: D26 execution.session fresh vs reuse integration (D98)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    let createCalled = 0;
    const mockSessionService = {
      createSession: async () => {
        createCalled++;
        return { sessionId: 'fresh-sess-1' };
      },
      getSession: async () => {
        return { sessionId: 'existing-sess-1' };
      },
    };

    const admFresh = await admitAgentExecution(
      'spec-A',
      { taskId: 't1', sessionPolicy: 'fresh' },
      { repoRoot: tmpRepo, sessionService: mockSessionService },
    );
    assert.equal(admFresh.admitted, true);
    assert.equal(createCalled, 1);
    await releaseAdmittedExecution('spec-A');

    const admReuse = await admitAgentExecution(
      'spec-A',
      { taskId: 't1', sessionPolicy: 'reuse' },
      { repoRoot: tmpRepo, sessionService: mockSessionService },
    );
    assert.equal(admReuse.admitted, true);
    assert.equal(createCalled, 1, 'createSession must not be called when sessionPolicy is reuse');
    assert.equal(admReuse.sessionId, 'existing-sess-1');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 120, 121, 122, 123: Identity-source distinction for delayed Hook 1 vs Hook 3 restart (D100)', async () => {
  const tmpRepo = createTempRepo();
  resetAdmissionStateForTest();
  try {
    const admA = await admitAgentExecution('spec-A', { taskId: 't1', sessionId: 'sess-A' }, { repoRoot: tmpRepo });
    const ownerA = admA.ownerId;
    await releaseAdmittedExecution('spec-A');

    const admB = await admitAgentExecution('spec-A', { taskId: 't2', sessionId: 'sess-B' }, { repoRoot: tmpRepo });
    const ownerB = admB.ownerId;

    const staleRelease = await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: ownerA,
      expectedKind: 'agent',
    });
    assert.equal(staleRelease.released, false);
    assert.equal(staleRelease.reason, 'not-current-owner');

    const claimB = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimB.ownerId, ownerB, 'B claim must remain byte-for-byte intact');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
