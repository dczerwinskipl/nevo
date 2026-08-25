import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentSessionBindingService,
  createAgentSessionBindingService,
  readAgentExecutionContext,
} from '../ai/binding-service.mjs';
import { resolveCanonicalSpec } from '../specs/identity.mjs';
import { buildContextPacket } from '../specs/context.mjs';
import { loadChange } from '../specs/store.mjs';
import { handleAgentSessionAttach } from '../specs.mjs';

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

test('resolveCanonicalSpec resolves both slug and UUID spec_id', () => {
  const bySlug = resolveCanonicalSpec('multi-provider-agent-sessions');
  assert.equal(bySlug.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(bySlug.slug, 'multi-provider-agent-sessions');

  const byUuid = resolveCanonicalSpec('d9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.slug, 'multi-provider-agent-sessions');

  assert.throws(() => resolveCanonicalSpec('non-existent-slug-xyz'), { message: /Specification 'non-existent-slug-xyz' not found/ });
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

test('handleAgentSessionAttach attaches session to resolved spec and task', async () => {
  const binding = await handleAgentSessionAttach({
    spec: 'multi-provider-agent-sessions',
    task: 'session-binding-and-execution-context',
    provider: 'claude',
    sessionId: 'session-attached-test',
    purpose: 'testing',
  });

  assert.equal(binding.provider, 'claude');
  assert.equal(binding.providerSessionId, 'session-attached-test');
  assert.equal(binding.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(binding.taskId, 'session-binding-and-execution-context');
  assert.equal(binding.purpose, 'testing');
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
    await assert.rejects(
      () => service.updateSessionMode('claude', 'sess-A', 'invalid-mode'),
      { name: 'AiValidationError' }
    );
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
    assert.equal(await service.resolveCurrentBinding('claude', 'sess-multi-spec-1'), null, 'Resolved current binding must be null');

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
  const { handleAiRequest } = await import('../../tools/dashboard/server/ai-routes.mjs');
  const { AiSessionService } = await import('../../tools/ai/service.mjs');
  const { SessionTranscriptCacheService } = await import('../../tools/ai/transcript-cache.mjs');
  const { createAiAdapterRegistry } = await import('../../tools/ai/registry.mjs');

  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-http-delete-test-'));
  try {
    const storageDir = join(tmpDir, 'sessions');
    const transcriptsDir = join(tmpDir, 'transcripts');
    const specA = '55555555-5555-4555-8555-555555555555';
    const specB = '66666666-6666-4666-8666-666666666666';
    const bindingService = createAgentSessionBindingService({ storageDir });
    const transcriptCache = new SessionTranscriptCacheService({ baseDir: transcriptsDir });
    const registry = createAiAdapterRegistry();
    registry.register({
      descriptor: { id: 'claude', label: 'Claude', title: 'Claude', defaultMode: 'edit', capabilities: {} },
      startTurn: async () => ({}),
      cancelTurn: async () => ({}),
    });

    const aiService = new AiSessionService({ registry, bindingService, transcriptCache });

    // 1. Bind to multiple specs
    await bindingService.bindSession({ provider: 'claude', providerSessionId: 'sess-http-del', specId: specA, taskId: 't1' });
    await bindingService.bindSession({ provider: 'claude', providerSessionId: 'sess-http-del', specId: specB, taskId: 't2' });
    transcriptCache.recordUserMessage('claude', 'sess-http-del', { text: 'Hello' });
    await transcriptCache.flush('claude', 'sess-http-del');

    // 2. Dispatch DELETE request
    let responseStatus = 0;
    let responseJson = null;

    const handled = await handleAiRequest({
      request: {
        headers: {
          'x-nevo-dashboard-action': '1',
          host: 'localhost:3000',
        },
      },
      response: {},
      method: 'DELETE',
      url: new URL('http://localhost:3000/api/agent-sessions/claude/sess-http-del'),
      service: aiService,
      accessPolicy: () => true,
      sendJson: (_res, status, data) => {
        responseStatus = status;
        responseJson = data;
      },
      readJsonBody: async () => ({}),
    });

    assert.equal(handled, true);
    assert.equal(responseStatus, 200);
    assert.deepEqual(responseJson, { unbind: true, deleted: true });

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
