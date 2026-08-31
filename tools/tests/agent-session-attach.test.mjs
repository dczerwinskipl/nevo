import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCanonicalSpec } from '../specs/identity.mjs';
import { handleAgentSessionAttach } from '../specs/agent-session.mjs';

test('resolveCanonicalSpec resolves both slug and UUID spec_id', () => {
  const bySlug = resolveCanonicalSpec('multi-provider-agent-sessions');
  assert.equal(bySlug.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(bySlug.slug, 'multi-provider-agent-sessions');

  const byUuid = resolveCanonicalSpec('d9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.specId, 'd9d40a17-cb1b-4cb5-b562-36f9bc75b726');
  assert.equal(byUuid.slug, 'multi-provider-agent-sessions');

  assert.throws(() => resolveCanonicalSpec('non-existent-slug-xyz'), { message: /Specification 'non-existent-slug-xyz' not found/ });
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
