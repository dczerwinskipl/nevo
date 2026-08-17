import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentSessionBindingService,
  createAgentSessionBindingService,
  readAgentExecutionContext,
} from '../ai/binding-service.mjs';
import { resolveCanonicalSpec } from '../specs/service.mjs';
import { handleAgentSessionAttach } from '../specs.mjs';

test('AgentSessionBindingService binds, updates, lists, and unbinds sessions', async () => {
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

test('resolveCanonicalSpec resolves both slug and UUID spec_id', () => {
  const bySlug = resolveCanonicalSpec('multi-provider-agent-sessions');
  assert.equal(bySlug.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(bySlug.slug, 'multi-provider-agent-sessions');

  const byUuid = resolveCanonicalSpec('d9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.slug, 'multi-provider-agent-sessions');

  assert.throws(() => resolveCanonicalSpec('non-existent-slug-xyz'), { message: /Specification 'non-existent-slug-xyz' not found/ });
});

test('readAgentExecutionContext extracts provider and session ID from environment', () => {
  assert.equal(readAgentExecutionContext({}), null);

  const context = readAgentExecutionContext({
    NEVO_AGENT_PROVIDER: 'claude',
    NEVO_AGENT_PROVIDER_SESSION_ID: 'uuid-123',
  });
  assert.deepEqual(context, { provider: 'claude', providerSessionId: 'uuid-123' });

  const fallback = readAgentExecutionContext({
    NEVO_AGENT_PROVIDER: 'antigravity',
    NEVO_AGENT_SESSION_ID: 'uuid-456',
  });
  assert.deepEqual(fallback, { provider: 'antigravity', providerSessionId: 'uuid-456' });
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
