import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AgentSessionBindingService,
  createAgentSessionBindingService,
  readAgentExecutionContext,
} from '../server/ai/sessions/binding-service.mjs';

test('AgentSessionBindingService binds, updates, lists, and unbinds sessions asynchronously', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-test-'));
  try {
    const storageFile = join(tmpDir, 'sessions.json');
    const service = createAgentSessionBindingService({ storageFile });

    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const first = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-001',
      specId,
      taskId: '01-task',
      purpose: 'implementation',
    });

    assert.equal(first.provider, 'claude');
    assert.equal(first.providerSessionId, 'sess-001');
    assert.equal(first.specId, specId);
    assert.equal(first.taskId, '01-task');
    assert.equal(first.purpose, 'implementation');
    assert.ok(first.createdAt);
    assert.ok(first.lastSeenAt);

    // Verify written to disk
    const diskContent = JSON.parse(await readFile(storageFile, 'utf-8'));
    assert.equal(diskContent.length, 1);
    assert.equal(diskContent[0].providerSessionId, 'sess-001');

    // Re-bind with updated purpose / lastSeenAt (deduplication)
    const second = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-001',
      specId,
      taskId: '01-task',
      purpose: 'review',
    });

    assert.equal(second.purpose, 'review');
    const list = await service.listBindings({ specId });
    assert.equal(list.length, 1);

    // Bind second session for another task
    await service.bindSession({
      provider: 'antigravity',
      providerSessionId: 'sess-002',
      specId,
      taskId: '02-task',
    });

    const allBindings = await service.listBindings({ specId });
    assert.equal(allBindings.length, 2);

    const task1Bindings = await service.listBindings({ taskId: '01-task' });
    assert.equal(task1Bindings.length, 1);
    assert.equal(task1Bindings[0].provider, 'claude');

    const single = await service.getBinding('claude', 'sess-001');
    assert.equal(single?.providerSessionId, 'sess-001');

    await service.unbindSession('claude', 'sess-001');
    const afterUnbind = await service.listBindings();
    assert.equal(afterUnbind.length, 1);
    assert.equal(afterUnbind[0].provider, 'antigravity');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('bindSessionSync creates sessions.json, updates idempotently, and persists to disk', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-sync-test-'));
  try {
    const storageFile = join(tmpDir, 'nested', 'sessions.json');
    const service = createAgentSessionBindingService({ storageFile });
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';

    assert.equal(existsSync(storageFile), false);

    // First synchronous bind
    const binding = service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-sync-01',
      specId,
      taskId: '01-task',
      purpose: 'sync-test',
    });

    assert.ok(binding);
    assert.equal(existsSync(storageFile), true);

    // Read directly from disk
    const diskContent1 = JSON.parse(readFileSync(storageFile, 'utf-8'));
    assert.equal(diskContent1.length, 1);
    assert.equal(diskContent1[0].providerSessionId, 'sess-sync-01');
    assert.equal(diskContent1[0].taskId, '01-task');
    assert.equal(diskContent1[0].purpose, 'sync-test');

    // Re-bind same session synchronously with updated purpose
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-sync-01',
      specId,
      taskId: '01-task',
      purpose: 'updated-sync-test',
    });

    const diskContent2 = JSON.parse(readFileSync(storageFile, 'utf-8'));
    assert.equal(diskContent2.length, 1, 'Must not duplicate record');
    assert.equal(diskContent2[0].purpose, 'updated-sync-test');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('single-scope binding: task-scoped command specializes spec binding into single entry', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-scope-test-'));
  try {
    const storageFile = join(tmpDir, 'sessions.json');
    const service = createAgentSessionBindingService({ storageFile });
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';

    // Step 1: Spec-only bind (e.g. requireChange)
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-cmd-01',
      specId,
    });

    let diskContent = JSON.parse(readFileSync(storageFile, 'utf-8'));
    assert.equal(diskContent.length, 1);
    assert.equal(diskContent[0].taskId, undefined);

    // Step 2: Task-scoped bind in same command (e.g. requireTask)
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-cmd-01',
      specId,
      taskId: '02-task',
      purpose: 'task-step',
    });

    diskContent = JSON.parse(readFileSync(storageFile, 'utf-8'));
    assert.equal(diskContent.length, 1, 'Must specialize in-place, not create a second binding');
    assert.equal(diskContent[0].taskId, '02-task');
    assert.equal(diskContent[0].purpose, 'task-step');

    // Step 3: Subsequent spec-level command updates lastSeenAt without stripping taskId
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-cmd-01',
      specId,
      purpose: 'status-check',
    });

    diskContent = JSON.parse(readFileSync(storageFile, 'utf-8'));
    assert.equal(diskContent.length, 1);
    assert.equal(diskContent[0].taskId, '02-task', 'Must preserve taskId');
    assert.equal(diskContent[0].purpose, 'status-check');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('persistence failure is not silently reported as success', async () => {
  // Pass an impossible/directory collision file path
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-fail-test-'));
  try {
    // Make storageFile a directory itself so writing fails
    const service = createAgentSessionBindingService({ storageFile: tmpDir });
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';

    assert.throws(() => {
      service.bindSessionSync({
        provider: 'claude',
        providerSessionId: 'sess-fail',
        specId,
      });
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('readAgentExecutionContext strictly extracts NEVO_AGENT_PROVIDER and NEVO_AGENT_PROVIDER_SESSION_ID', () => {
  assert.equal(readAgentExecutionContext({}), null);

  const context = readAgentExecutionContext({
    NEVO_AGENT_PROVIDER: 'claude',
    NEVO_AGENT_PROVIDER_SESSION_ID: 'uuid-123',
  });
  assert.deepEqual(context, { provider: 'claude', providerSessionId: 'uuid-123' });

  // Disallow obsolete synthetic NEVO_AGENT_SESSION_ID alias
  const obsolete = readAgentExecutionContext({
    NEVO_AGENT_PROVIDER: 'claude',
    NEVO_AGENT_SESSION_ID: 'uuid-456',
  });
  assert.equal(obsolete, null, 'Must not accept obsolete NEVO_AGENT_SESSION_ID');
});

test('AgentSessionBindingService supports per-spec directory storage and migrates legacy sessions.json', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-dir-test-'));
  try {
    const legacyFile = join(tmpDir, 'sessions.json');
    const storageDir = join(tmpDir, 'sessions');
    const spec1 = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const spec2 = '70609aaf-bb62-40bf-a25e-bec65c583495';

    // Write legacy file with entries across two specs
    const legacyData = [
      { provider: 'claude', providerSessionId: 's1', specId: spec1, taskId: 't1' },
      { provider: 'mock', providerSessionId: 's2', specId: spec2, taskId: 't2' },
    ];
    await writeFile(legacyFile, JSON.stringify(legacyData, null, 2), 'utf-8');

    const service = createAgentSessionBindingService({ storageDir });

    // Listing spec1 should migrate and load only spec1's file
    const spec1Bindings = await service.listBindings({ specId: spec1 });
    assert.equal(spec1Bindings.length, 1);
    assert.equal(spec1Bindings[0].providerSessionId, 's1');

    // Legacy file should be cleaned up and per-spec files created
    assert.equal(existsSync(legacyFile), false);
    assert.equal(existsSync(join(storageDir, `${spec1}.json`)), true);
    assert.equal(existsSync(join(storageDir, `${spec2}.json`)), true);

    // Bind a new session for spec1
    await service.bindSession({
      provider: 'antigravity',
      providerSessionId: 's3',
      specId: spec1,
      purpose: 'New Task',
    });

    const updatedSpec1 = await service.listBindings({ specId: spec1 });
    assert.equal(updatedSpec1.length, 2);

    const spec2Bindings = await service.listBindings({ specId: spec2 });
    assert.equal(spec2Bindings.length, 1);
    assert.equal(spec2Bindings[0].providerSessionId, 's2');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('AgentSessionBindingService persists session mode preference and maintains session isolation', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-mode-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const service = createAgentSessionBindingService({ storageDir });

    // 1. Bind session A with explicit 'ask' mode
    const bindingA = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-A',
      specId,
      taskId: '01-task',
      mode: 'ask',
    });
    assert.equal(bindingA.mode, 'ask');

    // 2. Bind session B with default 'edit' mode
    const bindingB = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-B',
      specId,
      taskId: '02-task',
      mode: 'edit',
    });
    assert.equal(bindingB.mode, 'edit');

    // 3. Update session A mode to 'agent'
    const updatedA = await service.updateSessionMode('claude', 'sess-A', 'agent');
    assert.equal(updatedA.mode, 'agent');

    // 4. Verify session B was isolated and remains 'edit'
    const loadedB = await service.getBinding('claude', 'sess-B');
    assert.equal(loadedB.mode, 'edit');

    // 5. Reload from fresh service instance to verify disk persistence
    const reloadedService = createAgentSessionBindingService({ storageDir });
    const reloadedA = await reloadedService.getBinding('claude', 'sess-A');
    const reloadedB = await reloadedService.getBinding('claude', 'sess-B');
    assert.equal(reloadedA.mode, 'agent');
    assert.equal(reloadedB.mode, 'edit');

    // 6. Invalid mode throws AiValidationError
    await assert.rejects(() => service.updateSessionMode('claude', 'sess-A', 'invalid-mode'), {
      name: 'AiValidationError',
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Finding 2: cross-spec session mode update targets only newest spec and does not promote older spec', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-cross-spec-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specA = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const specB = '70609aaf-bb62-40bf-a25e-bec65c583495';
    const service = createAgentSessionBindingService({ storageDir });

    // 1. Bind to older spec A
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-cross-spec',
      specId: specA,
      taskId: '01-task',
      mode: 'edit',
      createdAt: '2026-08-20T10:00:00.000Z',
      lastSeenAt: '2026-08-20T10:00:00.000Z',
    });

    // 2. Bind to newer spec B
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-cross-spec',
      specId: specB,
      taskId: '02-task',
      mode: 'edit',
      createdAt: '2026-08-22T10:00:00.000Z',
      lastSeenAt: '2026-08-22T10:00:00.000Z',
    });

    // 3. Current binding must be spec B
    const currentBefore = await service.resolveCurrentBinding('claude', 'sess-cross-spec');
    assert.equal(currentBefore.specId, specB);

    // 4. Update session mode to 'agent'
    const updated = await service.updateSessionMode('claude', 'sess-cross-spec', 'agent');
    assert.equal(updated.specId, specB);
    assert.equal(updated.mode, 'agent');

    // 5. Verify spec A on disk was NOT modified (mode is still 'edit', lastSeenAt still 2026-08-20)
    const specABindings = await service.listBindings({ specId: specA });
    assert.equal(specABindings.length, 1);
    assert.equal(specABindings[0].mode, 'edit');
    assert.equal(specABindings[0].lastSeenAt, '2026-08-20T10:00:00.000Z');

    // 6. Verify spec B on disk WAS modified (mode is 'agent', lastSeenAt updated)
    const specBBindings = await service.listBindings({ specId: specB });
    assert.equal(specBBindings.length, 1);
    assert.equal(specBBindings[0].mode, 'agent');
    assert.notEqual(specBBindings[0].lastSeenAt, '2026-08-22T10:00:00.000Z');

    // 7. Subsequent resolveCurrentBinding still returns spec B
    const currentAfter = await service.resolveCurrentBinding('claude', 'sess-cross-spec');
    assert.equal(currentAfter.specId, specB);
    assert.equal(currentAfter.mode, 'agent');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Finding 2: deterministic tie-breaker for equal lastSeenAt records does not depend on file listing order', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-tie-breaker-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specAlpha = '11111111-1111-4111-8111-111111111111';
    const specBeta = '22222222-2222-4222-8222-222222222222';
    const service = createAgentSessionBindingService({ storageDir });

    const fixedTime = '2026-08-23T12:00:00.000Z';

    // Bind both with identical lastSeenAt and createdAt
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-tie',
      specId: specBeta,
      createdAt: fixedTime,
      lastSeenAt: fixedTime,
    });
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-tie',
      specId: specAlpha,
      createdAt: fixedTime,
      lastSeenAt: fixedTime,
    });

    // Stable tie-breaker must pick specAlpha (alphabetically lowest specId)
    const current = await service.resolveCurrentBinding('claude', 'sess-tie');
    assert.equal(current.specId, specAlpha);

    const currentSync = service.resolveCurrentBindingSync('claude', 'sess-tie');
    assert.equal(currentSync.specId, specAlpha);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Multi-spec session deletion: unbindSession removes session identity from ALL spec binding files (async & sync)', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-multi-spec-unbind-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specA = '33333333-3333-4333-8333-333333333333';
    const specB = '44444444-4444-4444-8444-444444444444';
    const service = createAgentSessionBindingService({ storageDir });

    // 1. Bind same provider session to spec A and spec B
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-multi-spec-1',
      specId: specA,
      taskId: 'task-a1',
    });
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-multi-spec-1',
      specId: specB,
      taskId: 'task-b1',
    });

    // Verify both specs hold bindings for this session
    assert.equal((await service.listBindings({ specId: specA })).length, 1);
    assert.equal((await service.listBindings({ specId: specB })).length, 1);
    assert.ok(await service.resolveCurrentBinding('claude', 'sess-multi-spec-1'));

    // 2. Unbind session globally
    await service.unbindSession('claude', 'sess-multi-spec-1');

    // 3. Verify ALL spec binding files are cleaned up
    assert.equal((await service.listBindings({ specId: specA })).length, 0, 'Spec A bindings must be empty');
    assert.equal((await service.listBindings({ specId: specB })).length, 0, 'Spec B bindings must be empty');
    assert.equal(
      await service.resolveCurrentBinding('claude', 'sess-multi-spec-1'),
      null,
      'Resolved current binding must be null',
    );

    // 4. Test synchronous variant (unbindSessionSync)
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-multi-spec-2',
      specId: specA,
      taskId: 'task-a2',
    });
    service.bindSessionSync({
      provider: 'claude',
      providerSessionId: 'sess-multi-spec-2',
      specId: specB,
      taskId: 'task-b2',
    });

    assert.equal(service.listBindingsSync({ specId: specA }).length, 1);
    assert.equal(service.listBindingsSync({ specId: specB }).length, 1);

    service.unbindSessionSync('claude', 'sess-multi-spec-2');

    assert.equal(service.listBindingsSync({ specId: specA }).length, 0);
    assert.equal(service.listBindingsSync({ specId: specB }).length, 0);
    assert.equal(service.resolveCurrentBindingSync('claude', 'sess-multi-spec-2'), null);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP DELETE /api/agent-sessions/:provider/:providerSessionId deletes multi-spec bindings and transcript globally', async () => {
  const { buildAiTestApp } = await import('./helpers/ai-test-app.mjs');
  const { AgentSessionService } = await import('../server/ai/sessions/service.mjs');
  const { SessionTranscriptCacheService } = await import('../server/ai/sessions/transcript-cache.mjs');
  const { createAgentProviderRegistry } = await import('../server/ai/providers/registry.mjs');

  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-http-delete-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const transcriptsDir = join(tmpDir, 'transcripts');
    const specA = '55555555-5555-4555-8555-555555555555';
    const specB = '66666666-6666-4666-8666-666666666666';
    const bindingService = createAgentSessionBindingService({ storageDir });
    const transcriptCache = new SessionTranscriptCacheService({ baseDir: transcriptsDir });
    const registry = createAgentProviderRegistry();
    registry.register({
      descriptor: { id: 'claude', label: 'Claude', title: 'Claude', defaultMode: 'edit', capabilities: {} },
      startTurn: async () => ({}),
      cancelTurn: async () => ({}),
    });

    const aiService = new AgentSessionService({ registry, bindingService, transcriptCache });

    // 1. Bind to multiple specs
    await bindingService.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-http-del',
      specId: specA,
      taskId: 't1',
    });
    await bindingService.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-http-del',
      specId: specB,
      taskId: 't2',
    });
    transcriptCache.recordUserMessage('claude', 'sess-http-del', { text: 'Hello' });
    await transcriptCache.flush('claude', 'sess-http-del');

    // 2. Dispatch DELETE request through the real Fastify app (app.inject(),
    // no network port) — the dashboard's AI capability is a real Fastify
    // route, not a hand-dispatched function to call directly.
    const app = await buildAiTestApp({ service: aiService, accessPolicy: () => true });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/agent-sessions/claude/sess-http-del',
        headers: { 'x-nevo-dashboard-action': '1' },
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { unbind: true, deleted: true });
    } finally {
      await app.close();
    }

    // 3. Verify global cleanup
    assert.equal((await bindingService.listBindings({ specId: specA })).length, 0);
    assert.equal((await bindingService.listBindings({ specId: specB })).length, 0);
    assert.equal(await bindingService.resolveCurrentBinding('claude', 'sess-http-del'), null);
    assert.equal((await transcriptCache.listPersistedSessions()).length, 0);
    assert.equal(existsSync(join(transcriptsDir, 'claude', 'sess-http-del.json')), false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('AC 5: Multi-task sessions maintain historical task bindings and allow explicit switching of activeTaskId', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-multi-task-binding-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const service = createAgentSessionBindingService({ storageDir });
    const specId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
    const firstBindingTime = '2026-09-10T10:00:00.000Z';
    const secondBindingTime = '2026-09-10T10:01:00.000Z';

    // 1. Initial binding for task-01
    const binding1 = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-multi-123',
      sessionId: 'sess-multi-123',
      specId,
      taskId: '01-first-task',
      step: 'implementation',
      attempt: 1,
      purpose: 'execution',
      createdAt: firstBindingTime,
      lastSeenAt: firstBindingTime,
    });

    assert.equal(binding1.activeTaskId, '01-first-task');
    assert.deepEqual(binding1.taskIds, ['01-first-task']);
    assert.equal(binding1.step, 'implementation');
    assert.equal(binding1.attempt, 1);

    // 2. Bind second task task-02 to the same session
    const binding2 = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-multi-123',
      sessionId: 'sess-multi-123',
      specId,
      taskId: '02-second-task',
      step: 'implementation',
      attempt: 1,
      purpose: 'execution',
      createdAt: secondBindingTime,
      lastSeenAt: secondBindingTime,
    });

    assert.equal(binding2.activeTaskId, '02-second-task');
    assert.deepEqual(binding2.taskIds, ['01-first-task', '02-second-task']);

    // 3. Query tasks for session: both should be present, sorted by recency
    const tasks = await service.getTasksForSession('claude', 'sess-multi-123', specId);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].taskId, '02-second-task');
    assert.equal(tasks[1].taskId, '01-first-task');

    // 4. Query sessions for each task
    const sessionsTask1 = await service.getSessionsForTask(specId, '01-first-task');
    assert.equal(sessionsTask1.length, 1);
    assert.equal(sessionsTask1[0].providerSessionId, 'sess-multi-123');

    const sessionsTask2 = await service.getSessionsForTask(specId, '02-second-task');
    assert.equal(sessionsTask2.length, 1);
    assert.equal(sessionsTask2[0].providerSessionId, 'sess-multi-123');

    // 5. Explicitly switch activeTaskId back to task-01 without modifying prior history
    const switched = await service.setActiveTaskId('claude', 'sess-multi-123', '01-first-task', specId);
    assert.equal(switched.activeTaskId, '01-first-task');
    assert.deepEqual(switched.taskIds, ['01-first-task', '02-second-task']);

    const tasksAfterSwitch = await service.getTasksForSession('claude', 'sess-multi-123', specId);
    assert.equal(tasksAfterSwitch.length, 2);
    assert.equal(tasksAfterSwitch[0].taskId, '01-first-task'); // most recent now
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// Regression: the current-binding projection must represent exactly ONE task identity.
// A prior version of resolveCurrentBinding/resolveCurrentBindingSync picked taskId from
// session.activeTaskId but independently picked step/attempt from whichever binding row
// (across ALL bound tasks) was most recently touched — so a newer binding for an inactive
// task could silently overwrite the active task's own step/attempt in the projection.
test('resolveCurrentBinding/resolveCurrentBindingSync: step/attempt always come from the activeTaskId binding, never a more-recently-touched binding for a different task', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-current-binding-task-scoping-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const service = createAgentSessionBindingService({ storageDir });
    const specId = 'b2c3d4e5-f6a7-4b2c-8d3e-4f5a6b7c8d9e';

    // Task 01 bound first, at implementation/attempt 2, touched EARLIER.
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-scoping-1',
      sessionId: 'sess-scoping-1',
      specId,
      taskId: '01',
      step: 'implementation',
      attempt: 2,
      lastSeenAt: '2026-09-10T10:00:00.000Z',
    });

    // Task 02 bound second, at review/attempt 1, touched LATER — this becomes active by
    // default (bindSession's own "this call's taskId becomes active" default), so switch
    // back to 01 explicitly afterward to exercise the actual scenario: activeTaskId='01'
    // while task 02 genuinely holds the most recently touched binding row.
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-scoping-1',
      sessionId: 'sess-scoping-1',
      specId,
      taskId: '02',
      step: 'review',
      attempt: 1,
      lastSeenAt: '2026-09-12T10:00:00.000Z',
    });

    const switched = await service.setActiveTaskId('claude', 'sess-scoping-1', '01', specId);
    assert.equal(switched.activeTaskId, '01');

    const current = await service.resolveCurrentBinding('claude', 'sess-scoping-1');
    assert.equal(current.taskId, '01', 'taskId must reflect the authoritative activeTaskId');
    assert.equal(current.activeTaskId, '01');
    assert.equal(current.step, 'implementation', 'step must come from task 01\'s own binding, not task 02\'s newer one');
    assert.equal(current.attempt, 2, 'attempt must come from task 01\'s own binding, not task 02\'s newer one');

    const currentSync = service.resolveCurrentBindingSync('claude', 'sess-scoping-1');
    assert.equal(currentSync.taskId, '01');
    assert.equal(currentSync.activeTaskId, '01');
    assert.equal(currentSync.step, 'implementation');
    assert.equal(currentSync.attempt, 2);

    // Switching the other way must scope step/attempt to task 02's own binding only.
    await service.setActiveTaskId('claude', 'sess-scoping-1', '02', specId);
    const currentAfterSwitch = await service.resolveCurrentBinding('claude', 'sess-scoping-1');
    assert.equal(currentAfterSwitch.taskId, '02');
    assert.equal(currentAfterSwitch.step, 'review');
    assert.equal(currentAfterSwitch.attempt, 1);

    // No activeTaskId at all -> no taskId, no step, no attempt. Never taskIds[0], never
    // the most recently touched binding across tasks.
    const bareSession = await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-scoping-2',
      sessionId: 'sess-scoping-2',
      specId,
      taskId: '03',
      step: 'implementation',
      attempt: 1,
    });
    assert.equal(bareSession.activeTaskId, '03');
    // Bind a second task to the same session without ever designating a primary, then
    // clear activeTaskId is not a supported operation — instead construct the neutral
    // state directly via createSession-style multi-task binding (activeTaskId: null).
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-scoping-3',
      sessionId: 'sess-scoping-3',
      specId,
      taskId: '04',
      activeTaskId: null,
      taskIds: ['04', '05'],
      step: 'implementation',
      attempt: 1,
    });
    await service.bindSession({
      provider: 'claude',
      providerSessionId: 'sess-scoping-3',
      sessionId: 'sess-scoping-3',
      specId,
      taskId: '05',
      activeTaskId: null,
      taskIds: ['04', '05'],
      step: 'review',
      attempt: 3,
      lastSeenAt: '2026-09-15T10:00:00.000Z',
    });
    const neutral = await service.resolveCurrentBinding('claude', 'sess-scoping-3');
    assert.equal(neutral.taskId, undefined, 'no activeTaskId means no authoritative taskId');
    assert.equal(neutral.activeTaskId, undefined);
    assert.equal(neutral.step, undefined, 'no activeTaskId means no step, never the newest binding\'s step');
    assert.equal(neutral.attempt, undefined, 'no activeTaskId means no attempt, never the newest binding\'s attempt');
    assert.deepEqual(neutral.taskIds, ['04', '05'], 'taskIds must still list both historically bound tasks');

    const neutralSync = service.resolveCurrentBindingSync('claude', 'sess-scoping-3');
    assert.equal(neutralSync.taskId, undefined);
    assert.equal(neutralSync.step, undefined);
    assert.equal(neutralSync.attempt, undefined);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('AC 3: Running workflow step start inside an environment with NEVO_SESSION_ID automatically creates and persists a SessionTaskBinding', async () => {
  const { handleWorkflowStepStart } = await import('../../specs/workflow/cli.mjs');
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-auto-bind-workflow-test-'));
  const originalEnvSession = process.env.NEVO_SESSION_ID;
  const originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;

  const specId = '33333333-3333-4333-8333-333333333333';
  const canonicalSessionId = '44444444-4444-4444-8444-444444444444';
  const createdBindingFile = join(tmpDir, '.nevo-ai-local', 'sessions', `${specId}.json`);

  try {
    const root = tmpDir;
    const activeDir = join(tmpDir, 'specs', 'active');
    const changeDir = join(activeDir, 'test-change');
    const workflowDir = join(tmpDir, '.nevo-ai', 'workflows');
    await mkdir(changeDir, { recursive: true });
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, 'standard.yaml'),
      `id: standard
title: Standard
type: standard
version: 1
sourceControl:
  enabled: false
steps:
  implementation:
    status:
      active: in-implementation
      completed: implemented
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: review
  review:
    status:
      active: in-review
      completed: reviewed
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: verified
`
    );

    await writeFile(
      join(changeDir, 'change.yaml'),
      `id: test-change
title: Test change
type: standard
status: draft
spec_id: "${specId}"
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: 01-task
    order: 1
    file: tasks/01-task.md
    status: in-implementation
`
    );
    const tasksDir = join(changeDir, 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, '01-task.md'), '# Task 01\n');

    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Nevo Test'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@nevo.local'], { cwd: tmpDir });
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir });

    process.env.NEVO_SESSION_ID = canonicalSessionId;
    process.env.NEVO_AGENT_PROVIDER = 'antigravity';

    const stepContext = await handleWorkflowStepStart('test-change', '01-task', {
      activeDir,
      repoRoot: root,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.attempt, 1);

    // Verify SessionTaskBinding was automatically created and persisted
    const bindingService = createAgentSessionBindingService({ storageDir: join(root, '.nevo-ai-local', 'sessions') });
    const binding = bindingService.resolveCurrentBindingSync('antigravity', canonicalSessionId);
    assert.ok(binding, 'Session binding should be automatically created');
    assert.equal(binding.sessionId, canonicalSessionId);
    assert.equal(binding.provider, 'antigravity');
    assert.equal(binding.specId, specId);
    assert.equal(binding.taskId, '01-task');
    assert.equal(binding.step, 'implementation');
    assert.equal(binding.attempt, 1);
  } finally {
    if (originalEnvSession !== undefined) process.env.NEVO_SESSION_ID = originalEnvSession;
    else delete process.env.NEVO_SESSION_ID;
    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;

    try {
      if (existsSync(createdBindingFile)) {
        await rm(createdBindingFile, { force: true });
      }
    } catch {}

    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Cross-process lost-update regression: two independent binding-service instances against the same storage directory never silently overwrite each other', async () => {
  // Reproduces the real failure mode: a long-running dashboard process and a
  // separately-spawned `workflow step start/finish` CLI process both hold their own
  // AgentSessionBindingService instance pointed at the same on-disk directory. Neither
  // instance is aware of the other's in-memory state — the only thing they share is the
  // filesystem. A stale cached read (rather than always reading fresh + a cross-process
  // lock around the read-modify-write cycle) would let one instance's mutation silently
  // discard the other's already-persisted change.
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-cross-process-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';

    // Two independent instances — never share a constructor, a cache, or any JS
    // reference — standing in for the dashboard server and the CLI process.
    const dashboard = createAgentSessionBindingService({ storageDir });
    const cli = createAgentSessionBindingService({ storageDir });

    const created = await dashboard.bindSession({
      provider: 'claude',
      specId,
      taskId: 'task-a',
      step: 'implementation',
      attempt: 1,
      purpose: 'initial',
    });
    const sessionId = created.sessionId;

    // The "dashboard" performs an unrelated READ first — under the old persistent
    // read-through cache, this would have populated a stale in-memory copy of the spec
    // document that later survives past the CLI's write below.
    await dashboard.getSession(sessionId);

    // The "CLI" (a fully independent instance) now writes a DIFFERENT logical field —
    // advancing the task's step/attempt, exactly as `workflow step start/finish` does.
    await cli.bindSession({
      provider: 'claude',
      sessionId,
      specId,
      taskId: 'task-a',
      step: 'verification',
      attempt: 2,
      purpose: 'initial',
    });

    // The "dashboard" now performs its own, unrelated mutation — e.g. correlating the
    // provider-native session id once Claude confirms it. If the dashboard instance were
    // still working from a stale cached document (pre-dating the CLI's write above), this
    // write would silently resurrect the old step/attempt and erase the CLI's update.
    await dashboard.setProviderSessionId(sessionId, 'claude-native-session-77');

    // Both processes' updates must be visible afterward, from either instance.
    const finalFromDashboard = await dashboard.getSession(sessionId);
    const finalFromCli = await cli.getSession(sessionId);
    for (const final of [finalFromDashboard, finalFromCli]) {
      assert.equal(final.providerSessionId, 'claude-native-session-77', 'dashboard update must be preserved');
    }

    const bindings = await dashboard.listBindings({ specId, taskId: 'task-a' });
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].step, 'verification', 'CLI update must not be lost by a later dashboard write');
    assert.equal(bindings[0].attempt, 2, 'CLI update must not be lost by a later dashboard write');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Cross-process lost-update regression: genuinely interleaved concurrent mutations from two instances both persist', async () => {
  // Same two-instance setup, but this time the mutations race concurrently (both fired
  // before either resolves) rather than being sequenced by the test. The file lock must
  // serialize them so neither read-modify-write cycle overlaps the other's.
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-cross-process-race-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';

    const instanceA = createAgentSessionBindingService({ storageDir });
    const instanceB = createAgentSessionBindingService({ storageDir });

    // Bind 10 distinct sessions concurrently from two independent instances, interleaved.
    // If a lost update ever occurs, the final session count will be less than 10.
    const writes = [];
    for (let i = 0; i < 10; i += 1) {
      const instance = i % 2 === 0 ? instanceA : instanceB;
      writes.push(
        instance.bindSession({
          provider: 'mock',
          specId,
          taskId: `task-${i}`,
          purpose: `concurrent-${i}`,
        }),
      );
    }
    await Promise.all(writes);

    const allSessions = await instanceA.listSessions({ specId });
    assert.equal(allSessions.length, 10, 'every concurrent write must survive — none may be lost to a racing writer');
    const purposes = new Set(allSessions.map((s) => s.purpose));
    for (let i = 0; i < 10; i += 1) {
      assert.ok(purposes.has(`concurrent-${i}`), `write ${i} must be present`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── Section 6: legacy flat-array migration provenance ──────────────────────────────────
// normalizeStorageContent() must never infer a "fake"/provisional providerSessionId from
// string equality between providerSessionId and sessionId — only the explicit
// `established: false` marker proves a placeholder. Equal values legitimately occur for
// real, established sessions (e.g. Claude, where Nevo passes its own canonical UUID as
// the provider's --session-id), and a legacy row with no separate `sessionId` field at
// all derives sessionId FROM providerSessionId, which would make an equality check trivially
// true and destroy a real identity.

test('Legacy migration: an established session whose real providerSessionId equals sessionId is preserved, not stripped', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-migration-established-'));
  try {
    const storageFile = join(tmpDir, 'sessions.json');
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const sharedId = '11111111-1111-4111-8111-111111111111';

    // Hand-crafted legacy flat-array row: no `established` marker at all (the common
    // case for older persisted data), providerSessionId genuinely equals sessionId.
    await writeFile(
      storageFile,
      JSON.stringify([
        {
          provider: 'claude',
          providerSessionId: sharedId,
          sessionId: sharedId,
          specId,
          taskId: '01-task',
          purpose: 'implementation',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ]),
      'utf-8',
    );

    const service = createAgentSessionBindingService({ storageFile });
    const session = await service.getSession(sharedId);
    assert.ok(session, 'migrated session must be found by canonical sessionId');
    assert.equal(session.providerSessionId, sharedId, 'a real established native id equal to sessionId must survive migration');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Legacy migration: a row explicitly marked established: false never surfaces a fabricated providerSessionId', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-binding-migration-placeholder-'));
  try {
    const storageFile = join(tmpDir, 'sessions.json');
    const specId = 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726';
    const placeholderId = '22222222-2222-4222-8222-222222222222';

    // Legacy lazy-establishment row: the provisional providerSessionId slot was filled
    // with the canonical sessionId itself pending real provider confirmation, and
    // explicitly marked as such via `established: false`.
    await writeFile(
      storageFile,
      JSON.stringify([
        {
          provider: 'claude',
          providerSessionId: placeholderId,
          sessionId: placeholderId,
          established: false,
          specId,
          taskId: '02-task',
          purpose: 'implementation',
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        },
      ]),
      'utf-8',
    );

    const service = createAgentSessionBindingService({ storageFile });
    const session = await service.getSession(placeholderId);
    assert.ok(session, 'migrated session must still be found by canonical sessionId');
    assert.equal(
      session.providerSessionId,
      undefined,
      'a placeholder explicitly marked established: false must never surface as a real providerSessionId',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
