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
import { resolveCanonicalSpec, buildContextPacket, loadChange } from '../specs/service.mjs';
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
