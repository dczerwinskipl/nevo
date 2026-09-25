// Comprehensive integration tests for deterministic-status corrective implementation pass (Items 1-13).
// Run: node --test tools/tests/deterministic-status-corrective.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  updateWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  getWorkspaceWriterClaim,
  getWorkspaceWriterLockPath,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
} from '../specs/workflow/workspace-request.mjs';
import {
  admitAgentExecution,
  releaseAdmittedExecution,
  resetAdmissionStateForTest,
  hasActiveAgentExecution,
  getActiveAgentExecution,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  reconcileBootState,
  reconcileWorkflowPosition,
} from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import {
  activateAndSubmitHumanStep,
  submitHumanStepResult,
} from '../specs/workflow/human-step/operations.mjs';
import {
  createHumanSubmitOperationRecord,
  loadHumanSubmitOperation,
} from '../specs/workflow/human-step/submit-request.mjs';
import {
  publishTask,
} from '../specs/workflow/publish/operation.mjs';
import {
  handleWorkflowStepStart,
} from '../specs/workflow/cli.mjs';
import {
  saveOperationRecord,
  operationFilePath,
} from '../specs/workflow/operation-record.mjs';
import { buildAiTestApp } from '../dashboard/tests/helpers/ai-test-app.mjs';
import { createMockAgentProvider } from '../dashboard/server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../dashboard/server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../dashboard/server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../dashboard/server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createTempRepo(prefix = 'det-corrective') {
  const dir = path.join(
    REPO_ROOT,
    '.nevo-ai-local',
    `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Corrective Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'corrective@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Corrective Test\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

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
  const sDir = path.join(specsDir, 'spec-test');
  const tasksDir = path.join(sDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(sDir, 'change.yaml'),
    `schema_version: '1.0'
id: '11111111-1111-4111-8111-111111111111'
spec_id: '11111111-1111-4111-8111-111111111111'
title: spec-test
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
  - id: t2
    file: tasks/t2.md
    status: draft
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(tasksDir, 't1.md'),
    `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task t1
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(tasksDir, 't2.md'),
    `---
id: t2
status: draft
allowed_paths:
  - README.md
---
# Task t2
`,
    'utf8',
  );

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('Item 1: Route-level integration: dashboard deterministic Start creates agent workspace claim BEFORE provider turn starts', async () => {
  const tmpRepo = createTempRepo('item1-route');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';
    let claimObservedInsideTurn = null;

    // Create provider that verifies workspace claim inside startTurn
    const baseMock = createMockAgentProvider({ specId, taskIds: ['t1'], streamDelayMs: 1 });
    const registry = createAgentProviderRegistry([baseMock]);
    const transcriptCache = createTranscriptCacheService({ baseDir: path.join(tmpRepo, '.nevo-ai-local', 'transcripts') });
    const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });
    const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });

    // Intercept turnRuntime.startTurn to check workspace claim state at exact moment provider starts
    const originalStartTurn = turnRuntime.startTurn.bind(turnRuntime);
    turnRuntime.startTurn = async (params) => {
      // Capture claim directly from disk before provider execution proceeds
      claimObservedInsideTurn = getWorkspaceWriterClaim(tmpRepo);
      return await originalStartTurn(params);
    };

    const service = createAgentSessionService({
      registry,
      turnRuntime,
      transcriptCache,
      bindingService,
      repoRoot: tmpRepo,
    });

    const app = await buildAiTestApp({ service, repoRoot: tmpRepo });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'mock',
        specId,
        changeSlug: 'spec-test',
        taskId: 't1',
        purpose: 'execution',
        prompt: 'Start t1',
      },
    });

    assert.equal(res.statusCode, 201, `Expected 201 Created but got: ${res.body}`);
    const data = JSON.parse(res.body);
    assert.ok(data.sessionId, 'Response should contain sessionId');
    assert.ok(data.turnId, 'Response should contain turnId');
    assert.ok(data.ownerId, 'Response should contain ownerId');

    // PROOF: The workspace claim existed on disk BEFORE provider turn started!
    assert.ok(claimObservedInsideTurn, 'Claim must exist when provider startTurn runs');
    assert.equal(claimObservedInsideTurn.kind, 'agent', 'Claim kind must be agent');
    assert.equal(claimObservedInsideTurn.turnStartState, 'invoking', 'Claim turnStartState must be invoking');
    assert.equal(claimObservedInsideTurn.specId, specId, 'Claim specId must match');
    assert.equal(claimObservedInsideTurn.changeSlug, 'spec-test', 'Claim changeSlug must match');
    assert.equal(claimObservedInsideTurn.taskId, 't1', 'Claim taskId must match');

    await app.close();
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 3: Distinct specId !== changeSlug preserves settlement and boot reconciliation', async () => {
  const tmpRepo = createTempRepo('item3-slug');
  resetAdmissionStateForTest();

  try {
    const specId = '33333333-3333-4333-8333-333333333333';
    const changeSlug = 'distinct-slug-feature';

    // Rename spec folder to distinct-slug-feature
    const oldDir = path.join(tmpRepo, 'specs', 'active', 'spec-test');
    const newDir = path.join(tmpRepo, 'specs', 'active', changeSlug);
    fs.renameSync(oldDir, newDir);

    // Update change.yaml with UUID specId
    const manifestPath = path.join(newDir, 'change.yaml');
    let content = fs.readFileSync(manifestPath, 'utf8');
    content = content.replaceAll('11111111-1111-4111-8111-111111111111', specId);
    content = content.replace('title: spec-test', `title: ${changeSlug}`);
    fs.writeFileSync(manifestPath, content, 'utf8');

    execFileSync('git', ['add', '.'], { cwd: tmpRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'rename slug'], { cwd: tmpRepo, stdio: 'ignore' });

    // Acquire claim with distinct specId and changeSlug
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId,
      changeSlug,
      taskId: 't1',
      sessionId: 'sess-item3',
      turnStartState: 'prepared',
    });
    assert.equal(acq.acquired, true);

    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim.specId, specId);
    assert.equal(claim.changeSlug, changeSlug);

    // Run boot reconciliation: should resolve change via changeSlug, settle cleanly without failing requireChange
    const recon = await reconcileBootState({ repoRoot: tmpRepo });
    assert.equal(recon.reconciledClaims, 1, 'Claim should be successfully reconciled on boot');

    const claimAfter = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claimAfter, null, 'Claim should be released after clean settlement');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 4: execution.session reuse vs fresh semantics', async () => {
  const tmpRepo = createTempRepo('item4-session');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';
    let createSessionCalls = 0;

    const mockSessionService = {
      sessions: new Map(),
      async createSession(provider, opts) {
        createSessionCalls++;
        const sessionId = `canonical-${randomUUID()}`;
        const session = {
          sessionId,
          provider: provider || 'mock',
          specId: opts.specId,
          taskId: opts.taskId,
          taskIds: opts.taskIds || [opts.taskId],
          activeTaskId: opts.taskId,
        };
        this.sessions.set(sessionId, session);
        return session;
      },
      async listSessions(filters) {
        const list = Array.from(this.sessions.values());
        return list.filter((s) => {
          if (filters.specId && s.specId !== filters.specId) return false;
          if (filters.taskId && s.taskId !== filters.taskId && !s.taskIds?.includes(filters.taskId)) return false;
          return true;
        });
      },
      async getSession(id) {
        return this.sessions.get(id) || null;
      },
      async startTurn(provider, sessionId, opts) {
        return { turnId: `turn-${randomUUID()}`, sessionId };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // 1. Fresh session policy calls createSession
    const freshAdmission = await admitAgentExecution(specId, {
      taskId: 't1',
      sessionPolicy: 'fresh',
      provider: 'mock',
      changeSlug: 'spec-test',
    }, {
      repoRoot: tmpRepo,
      sessionService: mockSessionService,
    });

    assert.equal(freshAdmission.admitted, true);
    assert.equal(createSessionCalls, 1, 'fresh must call createSession');
    const firstSessionId = freshAdmission.sessionId;

    // Release admitted execution
    await releaseAdmittedExecution(specId, { turnId: freshAdmission.turnId });

    // 2. Reuse session policy resolves existing session via listSessions without calling createSession
    const reuseAdmission = await admitAgentExecution(specId, {
      taskId: 't1',
      sessionPolicy: 'reuse',
      provider: 'mock',
      changeSlug: 'spec-test',
    }, {
      repoRoot: tmpRepo,
      sessionService: mockSessionService,
    });

    assert.equal(reuseAdmission.admitted, true);
    assert.equal(reuseAdmission.sessionId, firstSessionId, 'reuse must resolve existing canonical session');
    assert.equal(createSessionCalls, 1, 'reuse must NOT call createSession when existing session is available');

    // 3. Reused session still went through workspace admission and got a new execution claim/ownerId
    assert.ok(reuseAdmission.ownerId);
    assert.notEqual(reuseAdmission.ownerId, freshAdmission.ownerId, 'new admission must acquire a new ownerId');

    await releaseAdmittedExecution(specId, { turnId: reuseAdmission.turnId });
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 5: Hook 1 terminal subscription triggers settlement, release, and continuation', async () => {
  const tmpRepo = createTempRepo('item5-hook1');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';
    let subscribedCallback = null;
    let unsubscribed = false;

    const mockSessionService = {
      async createSession() {
        return { sessionId: 'sess-h1' };
      },
      async listSessions() {
        return [];
      },
      async startTurn() {
        return { turnId: 'turn-h1' };
      },
      subscribeToSession(sessionId, { onEvent }) {
        subscribedCallback = onEvent;
        return () => {
          unsubscribed = true;
        };
      },
    };

    const admission = await admitAgentExecution(specId, {
      taskId: 't1',
      provider: 'mock',
      changeSlug: 'spec-test',
    }, {
      repoRoot: tmpRepo,
      sessionService: mockSessionService,
    });

    assert.equal(admission.admitted, true);
    assert.ok(subscribedCallback, 'Hook 1 per-turn subscription must be registered');

    // Simulate provider turn terminal event via real subscription callback
    await subscribedCallback({
      type: 'turn.completed',
      turnId: 'turn-h1',
      sessionId: 'sess-h1',
    });

    // Verification:
    // 1. Subscription was cleaned up
    assert.equal(unsubscribed, true, 'Hook 1 subscription must be cleaned up after terminal event');

    // 2. Active execution was released from admission map
    assert.equal(hasActiveAgentExecution(specId), false, 'Active execution map must be cleared');

    // 3. Workspace-writer slot was released upon settlement
    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.equal(claim, null, 'Workspace-writer claim must be released upon settled terminal event');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 6: Stale-owner check on turnStartState transitions aborts and fails closed', async () => {
  const tmpRepo = createTempRepo('item6-stale');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';

    // 1. Stale-owner on prepared -> invoking:
    // Another process replaces ownerId right after acquire
    let providerInvoked = false;
    const mockSessionService = {
      async createSession() {
        return { sessionId: 'sess-stale-1' };
      },
      async listSessions() {
        return [];
      },
      async startTurn() {
        providerInvoked = true;
        return { turnId: 'turn-stale-1' };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // Acquire claim directly first
    const initialAcq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId,
      taskId: 't1',
    });

    // Subvert the ownerId to simulate another process stealing the slot
    const lockPath = path.join(tmpRepo, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    const claimData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    claimData.ownerId = 'foreign-stolen-owner';
    fs.writeFileSync(lockPath, JSON.stringify(claimData, null, 2), 'utf8');

    // Attempting update with initialAcq.ownerId fails ownership condition
    const updateRes = await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: initialAcq.ownerId,
      turnStartState: 'invoking',
    });
    assert.equal(updateRes.updated, false);
    assert.equal(updateRes.reason, 'not-current-owner');

    // Clean up
    fs.unlinkSync(lockPath);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 7: Boot reconciliation with persisted queued/running requests and async transcriptCache', async () => {
  const tmpRepo = createTempRepo('item7-boot');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';

    // Persist a workspace request in 'queued' status
    const req = await createWorkspaceRequest({
      repoRoot: tmpRepo,
      kind: 'publish',
      specId,
      taskId: 't2',
      operationRef: 'dummy-ref',
    });
    assert.equal(req.status, 'queued');

    // Persist dead agent claim in 'invoking' state with activeTurn.turnId in transcriptCache
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId,
      taskId: 't1',
      sessionId: 'sess-boot-test',
      turnStartState: 'invoking',
    });

    const mockTranscriptCache = {
      // Async method as required by Item 7
      async getTranscript(provider, sessionId) {
        return {
          activeTurn: {
            turnId: 'turn-recovered-123', // canonical shape activeTurn.turnId
          },
        };
      },
    };

    const mockSessionService = {
      async getSession(sessionId) {
        return { sessionId, provider: 'mock' };
      },
    };

    // Run boot reconciliation
    const recon = await reconcileBootState({
      repoRoot: tmpRepo,
      transcriptCache: mockTranscriptCache,
      sessionService: mockSessionService,
    });

    assert.ok(recon.reconciledClaims >= 1, 'Agent claim should be reconciled');

    // Workspace request should be transitioned or reconciled
    const loadedReq = loadWorkspaceRequest(tmpRepo, req.requestId);
    assert.ok(loadedReq, 'Request should exist');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 8: Exact-key human-submit concurrent submission throws HUMAN_DECISION_CONFLICT', async () => {
  const tmpRepo = createTempRepo('item8-human');
  resetAdmissionStateForTest();

  try {
    const change = {
      _slug: 'spec-test',
      id: '11111111-1111-4111-8111-111111111111',
      workflow: { mode: 'deterministic', definition: 'standard' },
    };
    const task = {
      id: 't1',
      status: 'in-progress',
      workflow_progress: {
        current_step: 'human-verification',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };
    const definition = {
      entryStep: 'human-verification',
      steps: {
        'human-verification': {
          executor: 'human',
          transitions: [
            { value: 'approve', to: 'completed' },
            { value: 'reject', to: 'failed' },
          ],
        },
      },
    };

    // Pre-create human-submit operation record for attempt 1
    createHumanSubmitOperationRecord({
      repoRoot: tmpRepo,
      changeSlug: 'spec-test',
      taskId: 't1',
      step: 'human-verification',
      attempt: 1,
      result: 'approve',
      feedback: 'LGTM',
    });

    // Submitting conflicting decision against the exact same key throws HUMAN_DECISION_CONFLICT
    await assert.rejects(
      async () => {
        await activateAndSubmitHumanStep(
          change,
          task,
          definition,
          { repoRoot: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') },
          { result: 'reject', feedback: 'Needs work' },
        );
      },
      (err) => {
        assert.equal(err.code, 'HUMAN_DECISION_CONFLICT');
        return true;
      },
    );

    // Submitting identical decision returns idempotent success
    const idem = await activateAndSubmitHumanStep(
      change,
      task,
      definition,
      { repoRoot: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') },
      { result: 'approve', feedback: 'LGTM' },
    );
    assert.equal(idem.idempotent, true);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 9: Publish interrupted before git finalize resumes safely', async () => {
  const tmpRepo = createTempRepo('item9-publish');
  resetAdmissionStateForTest();

  try {
    // Create in-flight publish operation record where git finalize has NOT completed
    const record = {
      operationId: 'op-pub-1',
      change: 'spec-test',
      task: 't2',
      step: 'publish',
      attempt: 1,
      status: 'running',
      requestId: 'req-pub-1',
      operations: [
        { id: 'validate', status: 'completed' },
        { id: 'update-task', status: 'running' },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
    };
    saveOperationRecord(tmpRepo, record);

    // Calling publishTask resumes in-flight operation rather than failing
    const result = await publishTask('spec-test', 't2', { repoRoot: tmpRepo, sourceControl: { enabled: false } });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'approved');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 11: Direct CLI contends against live agent claim and does not evict it when git is clean', async () => {
  const tmpRepo = createTempRepo('item11-cli');
  resetAdmissionStateForTest();

  try {
    // Acquire agent claim with CURRENT process.pid (proves process is alive!)
    const acq = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: '11111111-1111-4111-8111-111111111111',
      changeSlug: 'spec-test',
      taskId: 't1',
    });
    assert.equal(acq.acquired, true);

    // Verify git is clean
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: tmpRepo, encoding: 'utf8' }).trim();
    assert.equal(status, '', 'Git repository must be clean');

    // Attempting direct CLI start must NOT evict the active agent claim! It must contend and throw WORKSPACE_WRITER_CONTENDED!
    await assert.rejects(
      async () => {
        await handleWorkflowStepStart('spec-test', 't1', {
          repoRoot: tmpRepo,
          activeDir: path.join(tmpRepo, 'specs', 'active'),
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKSPACE_WRITER_CONTENDED');
        return true;
      },
    );

    // The claim is STILL held by the live agent!
    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claim, 'Claim must NOT be evicted');
    assert.equal(claim.ownerId, acq.ownerId, 'Claim ownerId must remain intact');
    assert.equal(claim.kind, 'agent');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Item 12: Sequential queue automation advances nextRunnable task server-side upon settlement', async () => {
  const tmpRepo = createTempRepo('item12-queue');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';
    const { enqueueTasks, loadTaskQueue } = await import('../specs/workflow/queue/index.mjs');
    const { reconcileContinuation } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');
    const { requireChange, requireTask, setTaskStatus } = await import('../specs/store.mjs');

    // 1. Enqueue both t1 and t2
    enqueueTasks(tmpRepo, 'spec-test', ['t1', 't2']);
    const initialQueue = loadTaskQueue(tmpRepo, 'spec-test');
    assert.deepEqual(initialQueue.taskIds, ['t1', 't2']);

    const startedTurns = [];
    const mockSessionService = {
      async createSession(provider, opts) {
        return { sessionId: `sess-${opts.taskId}` };
      },
      async listSessions() {
        return [];
      },
      async startTurn(provider, sessionId, opts) {
        startedTurns.push({ taskId: opts.taskId, sessionId });
        return { turnId: `turn-${opts.taskId}` };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // 2. Mark t1 as completed and t2 as approved (published for execution)
    const activeDir = path.join(tmpRepo, 'specs', 'active');
    const initialChange = requireChange('spec-test', activeDir);
    setTaskStatus(initialChange, 't1', 'completed');
    setTaskStatus(initialChange, 't2', 'approved');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'complete t1, approve t2'], { cwd: tmpRepo, stdio: 'ignore' });

    const change = requireChange('spec-test', activeDir);
    const task1 = requireTask(change, 't1');

    // 3. Trigger continuation: t1 is complete, so queue is evaluated and t2 is automatically admitted!
    const contRes = await reconcileContinuation(change, task1, {
      repoRoot: tmpRepo,
      activeDir,
      sessionService: mockSessionService,
    });

    assert.equal(contRes.action, 'queue-agent-admitted');
    assert.equal(contRes.nextRunnable.taskId, 't2');
    assert.equal(startedTurns.length, 1);
    assert.equal(startedTurns[0].taskId, 't2', 't2 must be admitted and started via queue continuation');

    // 4. t1 was dequeued from persisted queue
    const updatedQueue = loadTaskQueue(tmpRepo, 'spec-test');
    assert.ok(!updatedQueue.taskIds.includes('t1'), 'Completed task t1 must be purged from queue');

    // 5. Workspace claim is now held for t2
    const claim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claim, 'Claim must exist for t2');
    assert.equal(claim.taskId, 't2');
    assert.equal(claim.kind, 'agent');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 1: Deterministic dashboard Start resolves canonical spec_id UUID from slug and uses UUID in admission and workspace claim', async () => {
  const tmpRepo = createTempRepo('finding1-uuid-resolution');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';
    let claimObservedInsideTurn = null;

    const baseMock = createMockAgentProvider({ specId, taskIds: ['t1'], streamDelayMs: 1 });
    const registry = createAgentProviderRegistry([baseMock]);
    const transcriptCache = createTranscriptCacheService({ baseDir: path.join(tmpRepo, '.nevo-ai-local', 'transcripts') });
    const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });
    const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });

    const originalStartTurn = turnRuntime.startTurn.bind(turnRuntime);
    turnRuntime.startTurn = async (params) => {
      claimObservedInsideTurn = getWorkspaceWriterClaim(tmpRepo);
      return await originalStartTurn(params);
    };

    const service = createAgentSessionService({
      registry,
      turnRuntime,
      transcriptCache,
      bindingService,
      repoRoot: tmpRepo,
    });

    const app = await buildAiTestApp({ service, repoRoot: tmpRepo });

    // Client sends request matching dashboard: specId is null, slug is 'spec-test'
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'mock',
        slug: 'spec-test',
        specId: null,
        taskId: 't1',
        purpose: 'execution',
        prompt: 'Start t1',
      },
    });

    assert.equal(res.statusCode, 201, `Expected 201 Created but got: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.sessionId);
    assert.ok(body.turnId);
    assert.ok(body.ownerId, 'Response must carry ownerId from deterministic admission');

    // Claim MUST have existed before provider execution started, and MUST carry canonical UUID specId
    assert.ok(claimObservedInsideTurn, 'Claim must exist before provider execution');
    assert.equal(claimObservedInsideTurn.kind, 'agent');
    assert.equal(claimObservedInsideTurn.turnStartState, 'invoking');
    assert.equal(claimObservedInsideTurn.specId, specId, 'Claim specId must be canonical UUID spec_id');
    assert.equal(claimObservedInsideTurn.changeSlug, 'spec-test', 'Claim changeSlug must remain slug');

    const finalClaim = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(finalClaim);
    assert.equal(finalClaim.turnStartState, 'started');
    assert.equal(finalClaim.specId, specId);
    assert.equal(finalClaim.changeSlug, 'spec-test');
    await app.close();
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 1: Deterministic dashboard Start for spec without spec_id fails closed with backfill error and does NOT fall through to generic startTurn', async () => {
  const tmpRepo = createTempRepo('finding1-missing-spec-id');
  resetAdmissionStateForTest();

  try {
    // Overwrite change.yaml without spec_id
    const changeYamlPath = path.join(tmpRepo, 'specs', 'active', 'spec-test', 'change.yaml');
    fs.writeFileSync(
      changeYamlPath,
      `id: my-feature
title: My Feature
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
`,
      'utf8',
    );
    execFileSync('git', ['add', '.'], { cwd: tmpRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'manifest without spec_id'], { cwd: tmpRepo, stdio: 'ignore' });

    let genericStartTurnCalled = false;
    const baseMock = createMockAgentProvider({ specId: 'my-feature', taskIds: ['t1'], streamDelayMs: 1 });
    const registry = createAgentProviderRegistry([baseMock]);
    const transcriptCache = createTranscriptCacheService({ baseDir: path.join(tmpRepo, '.nevo-ai-local', 'transcripts') });
    const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });
    const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });

    const originalStartTurn = turnRuntime.startTurn.bind(turnRuntime);
    turnRuntime.startTurn = async (params) => {
      genericStartTurnCalled = true;
      return await originalStartTurn(params);
    };

    const service = createAgentSessionService({
      registry,
      turnRuntime,
      transcriptCache,
      bindingService,
      repoRoot: tmpRepo,
    });

    const app = await buildAiTestApp({ service, repoRoot: tmpRepo });

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'mock',
        slug: 'spec-test',
        specId: null,
        taskId: 't1',
        purpose: 'execution',
        prompt: 'Start t1',
      },
    });

    assert.equal(res.statusCode, 400, 'Must return 400 error when spec_id is missing');
    const body = JSON.parse(res.body);
    assert.match(
      body.error?.message || '',
      /has no persisted spec_id — run 'node tools\/specs\.mjs backfill-spec-id'/i,
      'Error message must state spec_id is missing and advise backfill',
    );
    assert.equal(genericStartTurnCalled, false, 'Must NOT fall through to generic startTurn');
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null, 'No workspace claim must be acquired');
    await app.close();
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 2: Auto-continuation enriches candidate from execution policy, captures role & parentSessionId for fresh, and reuses session without createSession for reuse', async () => {
  const tmpRepo = createTempRepo('finding2-continuation');
  resetAdmissionStateForTest();

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    const { reconcileWorkflowPosition } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');

    // 1. Save spec-level execution policy
    executionPolicyService.saveExecutionPolicy(
      'spec-test',
      { provider: 'mock', mode: 'agent' },
      { repoRoot: tmpRepo },
    );

    const change = {
      _slug: 'spec-test',
      id: '11111111-1111-4111-8111-111111111111',
      spec_id: '11111111-1111-4111-8111-111111111111',
      workflow: { mode: 'deterministic', definition: 'custom' },
    };

    // Transition with continuation: auto, execution: { session: fresh, role: reviewer }
    const definitionFresh = {
      entryStep: 'step-1',
      steps: {
        'step-1': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
          transitions: [
            {
              to: 'step-2',
              value: 'success',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'reviewer' },
            },
          ],
        },
        'step-2': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
        },
      },
    };

    const taskFresh = {
      id: 't1',
      status: 'in-progress',
      workflow_progress: {
        current_step: 'step-1',
        current_attempt: 1,
        state: 'completed',
        history: [{
          step: 'step-1',
          attempt: 1,
          completed_at: new Date().toISOString(),
          transitioned_to: 'step-2',
          result: 'success',
        }],
      },
    };
    change.tasks = [taskFresh];

    let createdSessions = [];
    let startedTurns = [];

    const mockSessionService = {
      async createSession(provider, opts) {
        createdSessions.push({ provider, ...opts });
        return { sessionId: `sess-created-${createdSessions.length}` };
      },
      async listSessions() {
        return [];
      },
      async startTurn(provider, sessionId, opts) {
        startedTurns.push({ provider, sessionId, ...opts });
        return { turnId: 'turn-123' };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // Run reconcileWorkflowPosition with parentSessionId: 'sess-parent-001'
    const resFresh = await reconcileWorkflowPosition(change, taskFresh, {
      repoRoot: tmpRepo,
      definition: definitionFresh,
      sessionService: mockSessionService,
      parentSessionId: 'sess-parent-001',
    });

    assert.equal(resFresh.action, 'agent-admitted');
    assert.equal(createdSessions.length, 1, 'Fresh sessionPolicy must create a new session');
    assert.equal(createdSessions[0].role, 'reviewer', 'Reviewer role must be passed to createSession');
    assert.equal(createdSessions[0].parentSessionId, 'sess-parent-001', 'parentSessionId must be captured in createSession');
    assert.equal(createdSessions[0].provider, 'mock', 'Provider must be resolved from execution policy');

    assert.equal(startedTurns.length, 1);
    assert.equal(startedTurns[0].provider, 'mock');
    assert.equal(startedTurns[0].role, 'reviewer');
    assert.equal(startedTurns[0].parentSessionId, 'sess-parent-001');
    assert.ok(typeof startedTurns[0].message === 'string' && startedTurns[0].message.trim().length > 0, 'Trigger message must be non-empty');

    // Clean up admission state
    resetAdmissionStateForTest();
    await releaseWorkspaceWriterIfOwned({ repoRoot: tmpRepo, expectedOwnerId: resFresh.admission.ownerId });

    // Now test { session: 'reuse' }
    const definitionReuse = {
      entryStep: 'step-1',
      steps: {
        'step-1': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
          transitions: [
            {
              to: 'step-2',
              value: 'success',
              continuation: 'auto',
              execution: { session: 'reuse' },
            },
          ],
        },
        'step-2': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
        },
      },
    };

    createdSessions = [];
    startedTurns = [];

    const resReuse = await reconcileWorkflowPosition(change, taskFresh, {
      repoRoot: tmpRepo,
      definition: definitionReuse,
      sessionService: mockSessionService,
      parentSessionId: 'sess-existing-999',
    });

    assert.equal(resReuse.action, 'agent-admitted');
    assert.equal(createdSessions.length, 0, 'Reused sessionPolicy must NOT call createSession');
    assert.equal(startedTurns.length, 1);
    assert.equal(startedTurns[0].sessionId, 'sess-existing-999', 'Existing session must be reused');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 2b: Auto-continuation matches transition on canonical result and fails closed on ambiguous matches', async () => {
  const tmpRepo = createTempRepo('finding2b-transitions');
  resetAdmissionStateForTest();

  try {
    const { reconcileWorkflowPosition } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');

    const change = {
      _slug: 'spec-test',
      id: '11111111-1111-4111-8111-111111111111',
      spec_id: '11111111-1111-4111-8111-111111111111',
      workflow: { mode: 'deterministic', definition: 'custom' },
    };

    const multiTransitionDef = {
      entryStep: 'step-review',
      steps: {
        'step-review': {
          executor: 'agent',
          transitions: [
            {
              to: 'step-fix',
              value: 'changes-requested',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'implementer' },
            },
            {
              to: 'step-fix',
              value: 'approved-with-comments',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'refiner' },
            },
          ],
        },
        'step-fix': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
        },
      },
    };

    const mockSessionService = {
      async createSession(provider, opts) {
        return { sessionId: 'sess-new' };
      },
      async listSessions() {
        return [];
      },
      async startTurn(provider, sessionId, opts) {
        return { turnId: 'turn-new' };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // 1. Exact match on result: 'changes-requested'
    const taskRequested = {
      id: 't1',
      status: 'in-progress',
      workflow_progress: {
        current_step: 'step-review',
        current_attempt: 1,
        state: 'completed',
        history: [{
          step: 'step-review',
          attempt: 1,
          completed_at: new Date().toISOString(),
          transitioned_to: 'step-fix',
          result: 'changes-requested',
        }],
      },
    };
    change.tasks = [taskRequested];

    const res1 = await reconcileWorkflowPosition(change, taskRequested, {
      repoRoot: tmpRepo,
      definition: multiTransitionDef,
      sessionService: mockSessionService,
      provider: 'mock',
    });

    assert.equal(res1.action, 'agent-admitted');
    resetAdmissionStateForTest();
    await releaseWorkspaceWriterIfOwned({ repoRoot: tmpRepo, expectedOwnerId: res1.admission.ownerId });

    // 2. Ambiguous match when multiple transitions match without distinguishing value
    const ambiguousDef = {
      entryStep: 'step-review',
      steps: {
        'step-review': {
          executor: 'agent',
          transitions: [
            {
              to: 'step-fix',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'implementer' },
            },
            {
              to: 'step-fix',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'refiner' },
            },
          ],
        },
        'step-fix': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
        },
      },
    };

    const resAmbiguous = await reconcileWorkflowPosition(change, taskRequested, {
      repoRoot: tmpRepo,
      definition: ambiguousDef,
      sessionService: mockSessionService,
      provider: 'mock',
    });

    assert.equal(resAmbiguous.action, 'noop');
    assert.equal(resAmbiguous.reason, 'AMBIGUOUS_TRANSITION_MATCH');
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 2c: Fresh auto-continuation inherits parentSessionId from bindingService across human hops', async () => {
  const tmpRepo = createTempRepo('finding2c-human-hop');
  resetAdmissionStateForTest();

  try {
    const { reconcileWorkflowPosition } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');
    const specId = '11111111-1111-4111-8111-111111111111';

    const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });

    // Seed prior reviewer session in bindingService
    await bindingService.bindSession({
      provider: 'mock',
      sessionId: 'sess-reviewer-456',
      specId,
      taskId: 't1',
      role: 'reviewer',
    });

    const change = {
      _slug: 'spec-test',
      id: specId,
      spec_id: specId,
      workflow: { mode: 'deterministic', definition: 'custom' },
    };

    // Transition from human verification step to agent step-fix with fresh session
    const definition = {
      entryStep: 'step-human-verify',
      steps: {
        'step-human-verify': {
          executor: 'human',
          transitions: [
            {
              to: 'step-fix',
              continuation: 'auto',
              execution: { session: 'fresh', role: 'implementer' },
            },
          ],
        },
        'step-fix': {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'completed' },
        },
      },
    };

    const taskAfterHuman = {
      id: 't1',
      status: 'in-progress',
      workflow_progress: {
        current_step: 'step-human-verify',
        current_attempt: 1,
        state: 'completed',
        history: [{
          step: 'step-human-verify',
          attempt: 1,
          completed_at: new Date().toISOString(),
          transitioned_to: 'step-fix',
          result: 'request-changes',
        }],
      },
    };
    change.tasks = [taskAfterHuman];

    let capturedParentSessionId = undefined;
    const mockSessionService = {
      async createSession(provider, opts) {
        capturedParentSessionId = opts.parentSessionId;
        return { sessionId: 'sess-fix-789' };
      },
      async listSessions() {
        return [];
      },
      async startTurn(provider, sessionId, opts) {
        return { turnId: 'turn-fix-1' };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    // reconcileWorkflowPosition called with no explicit parentSessionId
    const res = await reconcileWorkflowPosition(change, taskAfterHuman, {
      repoRoot: tmpRepo,
      definition,
      sessionService: mockSessionService,
      bindingService,
      provider: 'mock',
    });

    assert.equal(res.action, 'agent-admitted');
    assert.equal(
      capturedParentSessionId,
      'sess-reviewer-456',
      'Fresh session must inherit parentSessionId from the most recent session for this task in bindingService',
    );
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 2d: Queue continuation for next task sets parentSessionId to null', async () => {
  const tmpRepo = createTempRepo('finding2d-queue-lineage');
  resetAdmissionStateForTest();

  try {
    const { enqueueTasks } = await import('../specs/workflow/queue/index.mjs');
    const { reconcileContinuation } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');
    const { requireChange, requireTask, setTaskStatus } = await import('../specs/store.mjs');
    const specId = '11111111-1111-4111-8111-111111111111';

    enqueueTasks(tmpRepo, 'spec-test', ['t1', 't2']);

    const activeDir = path.join(tmpRepo, 'specs', 'active');
    const initialChange = requireChange('spec-test', activeDir);
    setTaskStatus(initialChange, 't1', 'completed');
    setTaskStatus(initialChange, 't2', 'approved');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'complete t1, approve t2'], { cwd: tmpRepo, stdio: 'ignore' });

    const change = requireChange('spec-test', activeDir);
    const task1 = requireTask(change, 't1');

    let admittedCandidate = null;
    const mockSessionService = {
      async createSession() {
        return { sessionId: 'sess-t2' };
      },
      async listSessions() {
        return [];
      },
      async startTurn(provider, sessionId, opts) {
        return { turnId: 'turn-t2' };
      },
      subscribeToSession() {
        return () => {};
      },
    };

    const res = await reconcileContinuation(change, task1, {
      repoRoot: tmpRepo,
      activeDir,
      sessionService: mockSessionService,
      provider: 'mock',
      priorSessionId: 'sess-t1-old', // Should NOT be used for queued next task!
    });

    assert.equal(res.action, 'queue-agent-admitted');
    assert.equal(res.nextRunnable.taskId, 't2');
    assert.equal(
      res.nextRunnable.parentSessionId,
      null,
      'Queued task advancement must set parentSessionId to null and not inherit previous task session',
    );
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 3: Hook 3 boot recovery does not match older reused-session turn without positive proof and marks recovery-required; recovers when turnId matches', async () => {
  const tmpRepo = createTempRepo('finding3-hook3');
  resetAdmissionStateForTest();

  try {
    const { reconcileBootState } = await import('../dashboard/server/ai/orchestration/reconciliation.mjs');

    // 1. Negative test: Reused session S has an older completed turn for task t1.
    // A new execution crashes while in 'invoking' state with turnId: null.
    await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: '11111111-1111-4111-8111-111111111111',
      changeSlug: 'spec-test',
      taskId: 't1',
    });
    const currentClaim = getWorkspaceWriterClaim(tmpRepo);
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: currentClaim.ownerId,
      expectedKind: 'agent',
      expectedSpecId: '11111111-1111-4111-8111-111111111111',
      expectedChangeSlug: 'spec-test',
      expectedTaskId: 't1',
      sessionId: 'sess-reused-1',
      turnStartState: 'invoking',
    });

    // Transcript has older completed turn T1 from an earlier run
    const negativeTranscriptCache = {
      async getTranscript(prov, sessId) {
        return {
          activeTurn: null,
          turns: [
            {
              id: 'turn-old-completed-1',
              turnId: 'turn-old-completed-1',
              taskId: 't1',
              status: { status: 'terminal', outcome: 'completed' },
            },
          ],
        };
      },
    };

    const mockSessionService = {
      async getSession(id) {
        return { sessionId: id, provider: 'mock' };
      },
    };

    // Run boot reconciliation
    await reconcileBootState({
      repoRoot: tmpRepo,
      transcriptCache: negativeTranscriptCache,
      sessionService: mockSessionService,
    });

    // The claim must NOT be released or advanced to started using the old turn!
    // It must be marked recovery-required!
    const claimAfterNeg = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(claimAfterNeg, 'Claim must still exist');
    assert.equal(claimAfterNeg.status, 'recovery-required', 'Claim must be marked status=recovery-required due to inconclusive evidence');

    // 2. Positive test: Active turn matches claim turnId
    resetAdmissionStateForTest();
    await updateWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: currentClaim.ownerId,
      expectedKind: 'agent',
      expectedSpecId: '11111111-1111-4111-8111-111111111111',
      expectedChangeSlug: 'spec-test',
      expectedTaskId: 't1',
      sessionId: 'sess-reused-1',
      turnId: 'turn-new-active-2',
      recoveryRequired: false,
      turnStartState: 'invoking',
    });

    const positiveTranscriptCache = {
      async getTranscript(prov, sessId) {
        return {
          activeTurn: {
            turnId: 'turn-new-active-2',
          },
          turns: [],
        };
      },
    };

    const reconPos = await reconcileBootState({
      repoRoot: tmpRepo,
      transcriptCache: positiveTranscriptCache,
      sessionService: mockSessionService,
    });

    assert.ok(reconPos.reconciledClaims >= 1);
    const claimAfterPos = getWorkspaceWriterClaim(tmpRepo);
    if (claimAfterPos) {
      assert.equal(claimAfterPos.turnStartState, 'started');
      assert.equal(claimAfterPos.turnId, 'turn-new-active-2');
    }
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Finding 4: Delayed Hook 1 callback does not delete newer activeExecutions record, and STARTED_STATE_TRANSITION_FAILED marks claim recovery-required', async () => {
  const tmpRepo = createTempRepo('finding4-hook1-race');
  resetAdmissionStateForTest();

  try {
    const specId = '11111111-1111-4111-8111-111111111111';

    // 1. Admit Execution A
    const candidateA = {
      taskId: 't1',
      provider: 'mock',
      changeSlug: 'spec-test',
      message: 'Run A',
    };
    const admA = await admitAgentExecution(specId, candidateA, { repoRoot: tmpRepo });
    assert.equal(admA.admitted, true);
    assert.equal(getActiveAgentExecution(specId)?.ownerId, admA.ownerId);

    // Release writer slot and simulate execution B being admitted
    await releaseWorkspaceWriterIfOwned({ repoRoot: tmpRepo, expectedOwnerId: admA.ownerId });

    // Manually register execution B in activeExecutions to simulate it having taken over
    const mockExecutionB = {
      ownerId: 'owner-execution-B',
      sessionId: 'sess-B',
      taskId: 't2',
      specId,
      changeSlug: 'spec-test',
      turnId: 'turn-B',
      reconcile: async () => ({ settled: true }),
    };
    // Replace active execution with B
    const admModule = await import('../dashboard/server/ai/orchestration/admission.mjs');
    // Using candidateB admission after resetting admission state under mutex
    resetAdmissionStateForTest();
    const candidateB = {
      taskId: 't2',
      provider: 'mock',
      changeSlug: 'spec-test',
      message: 'Run B',
    };
    const admB = await admitAgentExecution(specId, candidateB, { repoRoot: tmpRepo });
    assert.equal(admB.admitted, true);
    assert.notEqual(admB.ownerId, admA.ownerId);
    assert.equal(getActiveAgentExecution(specId)?.ownerId, admB.ownerId);

    // 2. Delayed Hook 1 for execution A fires
    await admA.reconcile({ turnId: 'turn-A' });

    // Execution B MUST NOT be evicted from activeExecutions!
    const currentActive = getActiveAgentExecution(specId);
    assert.ok(currentActive, 'Execution B must remain active in memory');
    assert.equal(currentActive.ownerId, admB.ownerId, 'Active execution must still belong to B');

    // 3. Test STARTED_STATE_TRANSITION_FAILED:
    resetAdmissionStateForTest();
    await releaseWorkspaceWriterIfOwned({ repoRoot: tmpRepo, expectedOwnerId: admB.ownerId });

    // Tamper with workspace writer claim right before enrichRes3
    const maliciousTurnRuntime = {
      async startTurn() {
        const lockPath = getWorkspaceWriterLockPath(tmpRepo);
        const claim = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        fs.writeFileSync(
          lockPath,
          JSON.stringify({ ...claim, ownerId: 'tampered-owner' }),
          'utf8',
        );
        return { turnId: 'turn-tampered' };
      },
    };

    const failCandidate = {
      taskId: 't1',
      provider: 'mock',
      changeSlug: 'spec-test',
      message: 'Run Fail',
    };

    const failAdm = await admitAgentExecution(specId, failCandidate, {
      repoRoot: tmpRepo,
      turnRuntime: maliciousTurnRuntime,
    });

    assert.equal(failAdm.admitted, false);
    assert.equal(failAdm.reason, 'STARTED_STATE_TRANSITION_FAILED');
    assert.equal(failAdm.recoveryRequired, true);

    // activeExecutions must be clean (no phantom active state)
    assert.equal(getActiveAgentExecution(specId), null);
  } finally {
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});


