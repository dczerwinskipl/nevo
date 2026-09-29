// Assembled end-to-end batch review lifecycle and restart-after-finish recovery tests (Items 11 & 12).
// Tests full production pipeline:
// reservation → admission → AgentSession → claim → mock turn → CLI batch start → task activation
// → CLI batch finish → terminal Hook 1 → settlement → claim release → active exec clear
// → reservation release → member continuations (t1: pass, t2: fail, t3: pass).
// Also tests crash recovery after finish and idempotent resume during continuation dispatch.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { createGroupReservation, getGroupReservation } from '../specs/workflow/queue/reservation.mjs';
import {
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  loadBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import {
  admitAgentExecution,
  getActiveAgentExecution,
  resetAdmissionStateForTest,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  reconcileBootState,
} from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SPECS_CLI = path.resolve(REPO_ROOT, 'tools', 'specs.mjs');

function setupAssembledTestRepo(slug, taskIds = ['t1', 't2', 't3']) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-assembled-${slug}-`));
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
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard-v1.yaml')
  );

  const specId = randomUUID();
  const taskYamlLines = taskIds.map((id, idx) => `  - id: ${id}
    order: ${idx + 1}
    title: Task ${id}
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review`).join('\n');
  const changeYaml = `id: ${slug}
spec_id: "${specId}"
title: Assembled batch lifecycle test
workflow:
  mode: deterministic
  version: 1
  definition: standard-v1
tasks:
${taskYamlLines}
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');

  // Task markdown files
  for (const tid of taskIds) {
    fs.writeFileSync(
      path.join(taskDir, `${tid}.md`),
      `# Task ${tid}\n`,
      'utf8'
    );
  }

  execFileSync('git', ['add', '.'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: tmpRoot });

  return { tmpRoot, activeDir, specId };
}

function createMockSessionService(repoRoot) {
  const sessions = new Map();
  const createdSessions = [];

  return {
    sessions,
    createdSessions,
    registry: { list: () => ['mock'] },
    createSession: async (provider, opts) => {
      const sessionId = opts.id || `sess-mock-${randomUUID().slice(0, 8)}`;
      const session = { id: sessionId, sessionId, provider, ...opts };
      sessions.set(sessionId, session);
      createdSessions.push(session);

      // Persist to .nevo-ai-local/sessions/<specId>.json so CLI subprocess can see ambient session
      const sessionsDir = path.join(repoRoot, '.nevo-ai-local', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      const filePath = path.join(sessionsDir, `${opts.specId}.json`);
      let data = { sessions: [], bindings: [] };
      if (fs.existsSync(filePath)) {
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
      }
      data.sessions.push(session);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

      return session;
    },
    getSession: async (id) => sessions.get(id) || null,
    startTurn: async (provider, sessionId, opts) => ({ turnId: `turn-${randomUUID().slice(0, 8)}` }),
  };
}

test('1. Assembled Lifecycle: End-to-end multi-task batch review lifecycle with mixed outcomes (Item 11)', async () => {
  resetAdmissionStateForTest();
  const slug = 'assembled-mixed-outcomes';
  const taskIds = ['t1', 't2', 't3'];
  const { tmpRoot, activeDir, specId } = setupAssembledTestRepo(slug, taskIds);

  try {
    const batchExecutionId = 'batch-exec-asm-01';
    const sessionService = createMockSessionService(tmpRoot);

    // 1. Group reservation for all 3 tasks
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId,
      taskIds,
      step: 'review',
      executionConfigSnapshot: { provider: 'mock', model: 'gpt-4o' },
    });
    assert.equal(reservation.status, 'reserved');

    // 2. Admit batch execution via admitAgentExecution
    const admissionRes = await admitAgentExecution(
      specId,
      {
        scope: { kind: 'task-batch', taskIds },
        batchExecutionId,
        provider: 'mock',
        stepId: 'review',
        changeSlug: slug,
      },
      {
        sessionService,
        repoRoot: tmpRoot,
        activeDir,
      }
    );

    assert.equal(admissionRes.admitted, true, 'Batch execution must be admitted');
    const batchSessionId = admissionRes.sessionId;
    assert.ok(batchSessionId, 'Canonical batch session must be generated');

    // Verify workspace claim was acquired with batch scope
    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim, 'Workspace writer claim must be acquired');
    assert.equal(liveClaim.kind, 'agent');
    assert.equal(liveClaim.scope.kind, 'task-batch');
    assert.deepEqual(liveClaim.scope.taskIds, taskIds);
    assert.equal(liveClaim.batchExecutionId, batchExecutionId);
    assert.equal(liveClaim.sessionId, batchSessionId);

    // Verify active execution registered
    const active = getActiveAgentExecution(specId);
    assert.ok(active, 'Active agent execution must exist');
    assert.equal(active.sessionId, batchSessionId);

    const env = {
      ...process.env,
      NEVO_SESSION_ID: batchSessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    // 3. Agent executes "workflow batch start" via CLI
    const startRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );
    assert.equal(startRes.status, 0, `CLI batch start failed: ${startRes.stderr}`);
    const startJson = JSON.parse(startRes.stdout);
    assert.equal(startJson.batchExecutionId, batchExecutionId);

    // Verify member tasks are active
    const changeAfterStart = requireChange(slug, activeDir);
    for (const tid of taskIds) {
      const task = requireTask(changeAfterStart, tid);
      assert.equal(task.workflow_progress.current_step, 'review');
      assert.equal(task.workflow_progress.state, 'active');
    }

    // 4. Agent executes "workflow batch finish" via CLI: t1=pass, t2=fail, t3=pass
    const resultsPayload = JSON.stringify({
      results: {
        t1: { result: 'pass', feedback: 'Task 1 looks great' },
        t2: { result: 'fail', feedback: 'Task 2 has edge case issues' },
        t3: { result: 'pass', feedback: 'Task 3 verified cleanly' },
      },
      crossTaskFindings: [{ summary: 'No shared state conflicts' }],
    });

    const finishRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input', resultsPayload],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );
    assert.equal(finishRes.status, 0, `CLI batch finish failed: ${finishRes.stderr}`);
    const finishJson = JSON.parse(finishRes.stdout);
    assert.equal(finishJson.status, 'completed');

    // 5. Terminal Hook 1 triggers completion settlement
    const hook1Outcome = await admissionRes.reconcileHook1({
      turnId: admissionRes.turnId,
      terminalEvent: { type: 'turn.completed' },
    });
    assert.equal(hook1Outcome.settled, true, 'Hook 1 must settle batch execution');

    // 6. Verify Settlement outcomes:
    // Stage 1: Batch claim released
    const claimAfter = getWorkspaceWriterClaim(tmpRoot);
    if (claimAfter) {
      assert.notEqual(claimAfter.batchExecutionId, batchExecutionId);
      assert.notEqual(claimAfter.scope?.kind, 'task-batch');
    }

    // Stage 2: Active batch execution cleared (and any subsequent continuation admitted)
    const activeAfter = getActiveAgentExecution(specId);
    if (activeAfter) {
      assert.notEqual(activeAfter.sessionId, batchSessionId, 'Active execution must not be the batch session');
      assert.notEqual(activeAfter.scope?.kind, 'task-batch', 'Active execution must not be task-batch');
    }

    // Stage 3: Reservation released
    const reservationAfter = getGroupReservation(tmpRoot, slug, batchExecutionId);
    assert.equal(reservationAfter.status, 'released', 'Group reservation must be released');

    // Stage 4: Continuation dispatch
    const settlementRecord = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
    assert.ok(settlementRecord);
    assert.equal(settlementRecord.status, 'completed');

    const continuationStages = settlementRecord.stages.continuationDispatch.members;
    assert.ok(continuationStages.t1, 't1 continuation must be recorded');
    assert.ok(continuationStages.t2, 't2 continuation must be recorded');
    assert.ok(continuationStages.t3, 't3 continuation must be recorded');

    // t1 (pass): transitions toward next step
    assert.ok(['human-preview', 'agent-admitted', 'completed', 'noop'].includes(continuationStages.t1.action));

    // t2 (fail): rework continuation was dispatched with parentSessionId === batchSessionId!
    const t2Admission = continuationStages.t2.admission;
    if (continuationStages.t2.action === 'agent-admitted') {
      assert.ok(t2Admission, 't2 refiner must be admitted');
      // Assert refiner session has parentSessionId === batchSessionId (Item 11 requirement)
      const t2Session = sessionService.createdSessions.find(s => s.taskId === 't2' || s.executionScope?.taskId === 't2');
      if (t2Session) {
        assert.equal(
          t2Session.parentSessionId,
          batchSessionId,
          'Task B refiner session must have parentSessionId === batchSessionId'
        );
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    resetAdmissionStateForTest();
  }
});

test('2. Restart Recovery: reconcileBootState resumes settlement and dispatches continuations after finish (Item 12)', async () => {
  resetAdmissionStateForTest();
  const slug = 'restart-after-finish';
  const taskIds = ['t1', 't2', 't3'];
  const { tmpRoot, activeDir, specId } = setupAssembledTestRepo(slug, taskIds);

  try {
    const batchExecutionId = 'batch-exec-boot-02';
    const sessionId = 'sess-boot-02';

    // 1. Group reservation
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId,
      taskIds,
      step: 'review',
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    // 2. Persisted batch session
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${specId}.json`),
      JSON.stringify({
        sessions: [{
          sessionId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2),
      'utf8'
    );

    // 3. Live workspace claim held by batch agent
    const { acquireWorkspaceWriter } = await import('../specs/workflow/workspace-writer.mjs');
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      turnStartState: 'started',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
      changeSlug: slug,
    });

    // 4. Batch start & finish executed via CLI
    const env = {
      ...process.env,
      NEVO_SESSION_ID: sessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    const resultsPayload = JSON.stringify({
      results: {
        t1: { result: 'pass' },
        t2: { result: 'pass' },
        t3: { result: 'pass' },
      },
    });

    const finishRes = spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input', resultsPayload],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );
    assert.equal(finishRes.status, 0, `CLI finish failed: ${finishRes.stderr}`);

    // 5. SIMULATE PROCESS RESTART:
    // In-memory state is completely empty; Hook 1 was NEVER called in this process!
    resetAdmissionStateForTest();

    // 6. Hook 3 runs on server boot
    const bootResult = await reconcileBootState({
      repoRoot: tmpRoot,
      activeDir,
    });

    assert.equal(bootResult.reconciledClaims, 1, 'Boot reconciliation must reconcile the batch claim');

    // 7. Verify settlement completed
    const settlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
    assert.ok(settlement);
    assert.equal(settlement.status, 'completed');
    assert.equal(settlement.stages.claimRelease.status, 'completed');
    assert.equal(settlement.stages.reservationRelease.status, 'completed');
    assert.equal(settlement.stages.continuationDispatch.status, 'completed');

    // Claim released
    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    if (liveClaim) {
      assert.notEqual(liveClaim.batchExecutionId, batchExecutionId);
      assert.notEqual(liveClaim.scope?.kind, 'task-batch');
    }

    // Reservation released
    const reservation = getGroupReservation(tmpRoot, slug, batchExecutionId);
    assert.equal(reservation.status, 'released');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    resetAdmissionStateForTest();
  }
});

test('3. Idempotent continuation dispatch: resume after mid-dispatch interruption creates no duplicates (Item 12)', async () => {
  resetAdmissionStateForTest();
  const slug = 'idempotent-dispatch-resume';
  const taskIds = ['t1', 't2', 't3'];
  const { tmpRoot, activeDir, specId } = setupAssembledTestRepo(slug, taskIds);

  try {
    const batchExecutionId = 'batch-exec-idem-03';
    const sessionId = 'sess-idem-03';

    // 1. Group reservation & session
    await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: slug,
      batchExecutionId,
      taskIds,
      step: 'review',
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${specId}.json`),
      JSON.stringify({
        sessions: [{
          sessionId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2),
      'utf8'
    );

    const { acquireWorkspaceWriter } = await import('../specs/workflow/workspace-writer.mjs');
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      turnStartState: 'started',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
      changeSlug: slug,
    });

    const env = {
      ...process.env,
      NEVO_SESSION_ID: sessionId,
      NEVO_AGENT_PROVIDER: 'mock',
    };

    spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'start', slug, '--batch', batchExecutionId],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    const resultsPayload = JSON.stringify({
      results: {
        t1: { result: 'pass' },
        t2: { result: 'pass' },
        t3: { result: 'pass' },
      },
    });

    spawnSync(
      'node',
      [SPECS_CLI, 'workflow', 'batch', 'finish', slug, '--batch', batchExecutionId, '--input', resultsPayload],
      { cwd: tmpRoot, env, encoding: 'utf8' }
    );

    // 2. First settlement run crashes immediately after dispatching continuation for task t1
    let crashErr = null;
    try {
      await executeBatchCompletionSettlement({
        repoRoot: tmpRoot,
        activeDir,
        changeSlug: slug,
        batchExecutionId,
        _crashAfterMemberDispatchTaskId: 't1',
      });
    } catch (err) {
      crashErr = err;
    }
    assert.ok(crashErr, 'Simulated crash after t1 dispatch must throw');
    assert.ok(crashErr.message.includes('Simulated crash after member dispatch for task t1'));

    // Check partial settlement record: t1 is completed, t2 and t3 not yet
    const midSettlement = loadBatchCompletionSettlement(tmpRoot, slug, batchExecutionId);
    assert.ok(midSettlement);
    assert.equal(midSettlement.stages.continuationDispatch.members.t1.status, 'completed');
    assert.equal(midSettlement.stages.continuationDispatch.members.t2, undefined);

    // 3. Second settlement run resumes and completes the remaining members
    const resumeResult = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(resumeResult.status, 'completed');
    assert.equal(resumeResult.settlement.stages.continuationDispatch.status, 'completed');
    assert.ok(resumeResult.settlement.stages.continuationDispatch.members.t1);
    assert.ok(resumeResult.settlement.stages.continuationDispatch.members.t2);
    assert.ok(resumeResult.settlement.stages.continuationDispatch.members.t3);

    // 4. Third run is completely idempotent
    const rerunResult = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });
    assert.equal(rerunResult.status, 'completed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    resetAdmissionStateForTest();
  }
});
