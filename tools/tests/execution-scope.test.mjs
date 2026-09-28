import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateExecutionScope,
  assertExecutionScope,
  createTaskScope,
  createBatchScope,
  getScopeTaskIds,
  scopeContainsTask,
  normalizeExecutionScope,
} from '../specs/workflow/execution-scope.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  admitAgentExecution,
  getActiveAgentExecution,
  resetAdmissionStateForTest,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import { createAgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';

describe('ExecutionScope Model and Normalization', () => {
  it('validates single-task scopes correctly', () => {
    const scope = createTaskScope('task-1');
    assert.deepEqual(scope, { kind: 'task', taskId: 'task-1' });
    assert.equal(validateExecutionScope(scope).valid, true);
    assert.deepEqual(assertExecutionScope(scope), scope);
    assert.deepEqual(getScopeTaskIds(scope), ['task-1']);
    assert.equal(scopeContainsTask(scope, 'task-1'), true);
    assert.equal(scopeContainsTask(scope, 'task-2'), false);
  });

  it('validates batch scopes and enforces length >= 2', () => {
    const validBatch = createBatchScope(['task-1', 'task-2']);
    assert.deepEqual(validBatch, { kind: 'task-batch', taskIds: ['task-1', 'task-2'] });
    assert.equal(validateExecutionScope(validBatch).valid, true);
    assert.deepEqual(assertExecutionScope(validBatch), validBatch);
    assert.deepEqual(getScopeTaskIds(validBatch), ['task-1', 'task-2']);
    assert.equal(scopeContainsTask(validBatch, 'task-1'), true);
    assert.equal(scopeContainsTask(validBatch, 'task-2'), true);
    assert.equal(scopeContainsTask(validBatch, 'task-3'), false);

    // Reject size-1 batch
    const singleBatch = { kind: 'task-batch', taskIds: ['task-1'] };
    assert.equal(validateExecutionScope(singleBatch).valid, false);
    assert.throws(() => assertExecutionScope(singleBatch), /at least 2/);

    // Reject empty batch
    const emptyBatch = { kind: 'task-batch', taskIds: [] };
    assert.equal(validateExecutionScope(emptyBatch).valid, false);
    assert.throws(() => assertExecutionScope(emptyBatch), /at least 2/);

    // Reject duplicates in batch
    const duplicateBatch = { kind: 'task-batch', taskIds: ['task-1', 'task-1'] };
    assert.equal(validateExecutionScope(duplicateBatch).valid, false);
    assert.throws(() => assertExecutionScope(duplicateBatch), /duplicate/);
  });

  it('normalizes legacy and mixed execution scope inputs', () => {
    assert.deepEqual(normalizeExecutionScope({ taskId: 'legacy-1' }), {
      kind: 'task',
      taskId: 'legacy-1',
    });
    assert.deepEqual(normalizeExecutionScope({ taskIds: ['t1', 't2'] }), {
      kind: 'task-batch',
      taskIds: ['t1', 't2'],
    });
    assert.deepEqual(
      normalizeExecutionScope({ executionScope: { kind: 'task-batch', taskIds: ['t1', 't2'] } }),
      { kind: 'task-batch', taskIds: ['t1', 't2'] }
    );
    assert.equal(normalizeExecutionScope(null), null);
    assert.equal(normalizeExecutionScope({}), null);
  });
});

describe('WorkspaceWriter Claim Scope Normalization', () => {
  let tmpRepo;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'nevo-claim-test-'));
  });

  afterEach(() => {
    if (tmpRepo) {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it('persists and reads single-task scope mirroring taskId', async () => {
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-1',
      changeSlug: 'spec-1',
      taskId: 't1',
    });

    assert.equal(acquireRes.acquired, true);
    assert.deepEqual(acquireRes.claim.scope, { kind: 'task', taskId: 't1' });
    assert.equal(acquireRes.claim.taskId, 't1');

    const read = getWorkspaceWriterClaim(tmpRepo);
    assert.deepEqual(read.scope, { kind: 'task', taskId: 't1' });
    assert.equal(read.taskId, 't1');

    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: acquireRes.ownerId,
      expectedScope: { kind: 'task', taskId: 't1' },
    });
  });

  it('persists batch scope without scalar taskId', async () => {
    const batchScope = { kind: 'task-batch', taskIds: ['t1', 't2', 't3'] };
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tmpRepo,
      kind: 'agent',
      specId: 'spec-1',
      changeSlug: 'spec-1',
      scope: batchScope,
    });

    assert.equal(acquireRes.acquired, true);
    assert.deepEqual(acquireRes.claim.scope, batchScope);
    assert.equal(acquireRes.claim.taskId, undefined);

    const read = getWorkspaceWriterClaim(tmpRepo);
    assert.deepEqual(read.scope, batchScope);
    assert.equal(read.taskId, undefined);

    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedOwnerId: acquireRes.ownerId,
      expectedScope: batchScope,
    });
  });

  it('normalizes legacy claim file lacking scope into task scope', () => {
    const locksDir = join(tmpRepo, '.nevo-ai-local', 'locks');
    mkdirSync(locksDir, { recursive: true });
    writeFileSync(
      join(locksDir, 'workspace-writer.lock'),
      JSON.stringify({
        ownerId: 'legacy-owner',
        kind: 'agent',
        specId: 'spec-legacy',
        changeSlug: 'spec-legacy',
        taskId: 'legacy-task-1',
        claimedAt: new Date().toISOString(),
      })
    );

    const read = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(read);
    assert.deepEqual(read.scope, { kind: 'task', taskId: 'legacy-task-1' });
    assert.equal(read.taskId, 'legacy-task-1');
  });

  it('fails closed on corrupt claim file missing both scope and taskId for agent kind', () => {
    const locksDir = join(tmpRepo, '.nevo-ai-local', 'locks');
    mkdirSync(locksDir, { recursive: true });
    writeFileSync(
      join(locksDir, 'workspace-writer.lock'),
      JSON.stringify({
        ownerId: 'corrupt-owner',
        kind: 'agent',
        specId: 'spec-corrupt',
        changeSlug: 'spec-corrupt',
      })
    );

    const read = getWorkspaceWriterClaim(tmpRepo);
    assert.ok(read);
    assert.equal(read.status, 'recovery-required');
  });
});

describe('Batch AgentSession and Bindings', () => {
  let tmpDir;
  let bindingService;
  let sessionService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nevo-batch-session-test-'));
    bindingService = createAgentSessionBindingService({ storageFile: join(tmpDir, 'sessions.json') });
    sessionService = createAgentSessionService({
      registry: {
        list: () => ['mock-provider'],
        get: () => ({ id: 'mock-provider', displayName: 'Mock', defaultModel: 'mock-model', descriptor: { defaultMode: 'edit' } }),
      },
      bindingService,
    });
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates batch session with undefined activeTaskId and creates multi-member bindings', async () => {
    const batchScope = { kind: 'task-batch', taskIds: ['task-A', 'task-B', 'task-C'] };
    const session = await sessionService.createSession('mock-provider', {
      specId: 'spec-batch-1',
      executionScope: batchScope,
      stepId: 'implement',
      attempt: 1,
    });

    assert.equal(session.activeTaskId, undefined);
    assert.deepEqual(session.executionScope, batchScope);
    assert.deepEqual(session.taskIds, ['task-A', 'task-B', 'task-C']);

    // resolveCurrentBinding returns no task when activeTaskId is absent
    const currentBinding = await bindingService.resolveCurrentBinding('mock-provider', session.sessionId);
    assert.equal(currentBinding.taskId, undefined);
    assert.equal(currentBinding.activeTaskId, undefined);

    // resolveScopeBindings returns all member task bindings
    const scopeBindings = await bindingService.resolveScopeBindings(session.sessionId);
    assert.equal(scopeBindings.length, 3);
    const boundTaskIds = scopeBindings.map((b) => b.taskId);
    assert.deepEqual(boundTaskIds, ['task-A', 'task-B', 'task-C']);
    for (const b of scopeBindings) {
      assert.equal(b.sessionId, session.sessionId);
      assert.equal(b.step, 'implement');
      assert.equal(b.attempt, 1);
    }
  });
});

describe('Admission with Batch Scope', () => {
  let tmpRepo;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'nevo-admit-batch-test-'));
    resetAdmissionStateForTest();
  });

  afterEach(() => {
    resetAdmissionStateForTest();
    if (tmpRepo) {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it('admits batch execution, populates scope, and blocks duplicate admission on same spec', async () => {
    const batchScope = { kind: 'task-batch', taskIds: ['t1', 't2'] };
    const res1 = await admitAgentExecution('spec-batch', {
      scope: batchScope,
      changeSlug: 'spec-batch',
    }, { repoRoot: tmpRepo });

    assert.equal(res1.admitted, true);

    const active = getActiveAgentExecution('spec-batch');
    assert.ok(active);
    assert.deepEqual(active.scope, batchScope);
    assert.equal(active.taskId, undefined);

    // Second admission attempt on same spec (even for single member task) must be refused
    const res2 = await admitAgentExecution('spec-batch', {
      taskId: 't1',
      changeSlug: 'spec-batch',
    }, { repoRoot: tmpRepo });

    assert.equal(res2.admitted, false);
    assert.equal(res2.reason, 'ACTIVE_EXECUTION_EXISTS');

    await res1.reconcile({ settled: true });
  });
});
