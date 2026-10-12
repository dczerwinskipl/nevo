// Corrective tests (batch-execution-generalization, task 10) proving the real
// production route (tools/dashboard/server/ai/sessions/turns/routes.mjs) admits a
// brand-new, dependency-ordered implementation batch — not only the pre-correction
// 'reviewer'-only path. Every existing passing test for tasks 02-08 called
// createGroupReservation/executeBatchStart directly, never through this route, so the
// hardcoded `compat.role !== 'reviewer'` rejection (predating this change) was never
// exercised against a real implementation batch until now.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import Fastify from 'fastify';

import sessionRoutes from '../server/ai/sessions/routes.mjs';
import turnRoutes from '../server/ai/sessions/turns/routes.mjs';
import { aiErrorHandler } from '../server/ai/sessions/http.mjs';
import { ExecutionPolicyService } from '../server/ai/sessions/execution-policy-service.mjs';
import { createTrustedNetworkAiAccessPolicy } from '../server/ai/access-policy.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { getGroupReservation } from '../../specs/workflow/queue/reservation.mjs';
import '../../specs/workflow/actions/index.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function setupHarness({ tasksYaml, policy } = {}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'nevo-production-batch-admission-'));
  execSync('git init -q -b main', { cwd: tmpRoot });
  execSync('git config user.email test@test.com', { cwd: tmpRoot });
  execSync('git config user.name test', { cwd: tmpRoot });

  mkdirSync(join(tmpRoot, '.nevo-ai', 'workflows'), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    join(tmpRoot, '.nevo-ai', 'workflows', 'standard.yaml'),
  );

  const specId = randomUUID();
  const changeSlug = 'production-batch-spec';
  const changeDir = join(tmpRoot, 'specs', 'active', changeSlug);
  const taskDir = join(changeDir, 'tasks');
  mkdirSync(taskDir, { recursive: true });

  const changeYaml = `id: ${changeSlug}
spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
${tasksYaml}
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  execSync('git add -A && git commit -m init', { cwd: tmpRoot });

  const recordedSessions = [];
  const mockProvider = {
    descriptor: {
      id: 'claude',
      label: 'Claude',
      enabled: true,
      capabilities: { canOverrideTurnModel: true },
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'agent',
    },
    isAvailable: () => ({ available: true }),
    listModels: async () => [{ id: 'sonnet', name: 'sonnet', traits: { maxContextTokens: 200000 } }],
    createSession: async (options) => {
      recordedSessions.push(options);
      return { providerSessionId: `claude-sess-${recordedSessions.length}` };
    },
    startTurn: () => (async function* () {
      yield { type: 'final_answer.delta', text: 'done' };
    })(),
    cancelTurn: async () => ({}),
  };

  const registry = createAgentProviderRegistry([mockProvider]);
  const transcriptCache = createTranscriptCacheService({ baseDir: join(tmpRoot, '.nevo-ai-local', 'transcripts') });
  const bindingService = createAgentSessionBindingService({ storageDir: join(tmpRoot, '.nevo-ai-local', 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService, repoRoot: tmpRoot });
  const policyService = new ExecutionPolicyService({ repoRoot: tmpRoot });
  if (policy) {
    policyService.saveExecutionPolicy(changeSlug, policy);
  }

  return {
    tmpRoot,
    specId,
    changeSlug,
    recordedSessions,
    async withApp(fn) {
      const app = Fastify();
      app.setErrorHandler(aiErrorHandler);
      const accessPolicy = createTrustedNetworkAiAccessPolicy();
      await app.register(sessionRoutes, { service, accessPolicy, executionPolicyService: policyService });
      await app.register(turnRoutes, { service, accessPolicy, repoRoot: tmpRoot });
      try {
        return await fn(app);
      } finally {
        await app.close();
      }
    },
    cleanup() {
      rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

function freshTaskYaml(id, order, { dependsOn = [], allowedPaths = [] } = {}) {
  const deps = dependsOn.length ? `\n    depends_on: [${dependsOn.join(', ')}]` : '';
  const paths = allowedPaths.length
    ? `\n    allowed_paths:\n${allowedPaths.map((p) => `      - ${p}`).join('\n')}`
    : '';
  return `  - id: ${id}
    order: ${order}
    title: Task ${id}
    status: approved${deps}${paths}`;
}

test('A brand-new, dependency-ordered implementation batch (no incoming role) is admitted through the real production route', async () => {
  const harness = setupHarness({
    tasksYaml: [
      freshTaskYaml('t1', 1, { allowedPaths: ['src/t1.js'] }),
      freshTaskYaml('t2', 2, { dependsOn: ['t1'], allowedPaths: ['src/t2.js'] }),
      freshTaskYaml('t3', 3, { dependsOn: ['t1'], allowedPaths: ['src/t3.js'] }),
    ].join('\n'),
    policy: { provider: 'claude', model: 'sonnet', mode: 'agent' },
  });
  try {
    await harness.withApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId: harness.specId,
          changeSlug: harness.changeSlug,
          taskIds: ['t1', 't2', 't3'],
          prompt: 'Implement t1, t2, t3',
        },
      });
      if (res.statusCode !== 201) {
        assert.fail(`Expected 201, got ${res.statusCode}: ${res.payload}`);
      }
      const data = JSON.parse(res.payload);
      assert.ok(data.batchExecutionId, 'batchExecutionId must be returned');

      const reservation = getGroupReservation(harness.tmpRoot, harness.changeSlug, data.batchExecutionId);
      assert.ok(reservation, 'group reservation must exist');
      assert.deepEqual(reservation.taskIds.slice().sort(), ['t1', 't2', 't3']);

      assert.equal(harness.recordedSessions.length, 1, 'exactly one session must be created for the whole batch');
    });
  } finally {
    harness.cleanup();
  }
});

test('A genuinely incompatible mixed-contract selection is still rejected, naming the incompatible task', async () => {
  const harness = setupHarness({
    tasksYaml: [
      // t1 is a fresh entry-step task — targets 'implementation' with no incoming role.
      freshTaskYaml('t1', 1, { allowedPaths: ['src/t1.js'] }),
      // t2 already finished 'implementation' and targets 'review' with role
      // 'reviewer' — a genuinely different resulting contract than t1's.
      `  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    allowed_paths:
      - src/t2.js
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review`,
    ].join('\n'),
    policy: { provider: 'claude', model: 'sonnet', mode: 'agent' },
  });
  try {
    await harness.withApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId: harness.specId,
          changeSlug: harness.changeSlug,
          taskIds: ['t1', 't2'],
          prompt: 'Execute t1, t2',
        },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.match(body.error?.message || '', /t2/);
    });
  } finally {
    harness.cleanup();
  }
});

test('A selected task with an unsatisfied dependency outside the batch is still rejected', async () => {
  const harness = setupHarness({
    tasksYaml: [
      // t-outside is NOT part of the selected batch and is not implemented/verified.
      freshTaskYaml('t-outside', 1, { allowedPaths: ['src/outside.js'] }),
      freshTaskYaml('t1', 2, { dependsOn: ['t-outside'], allowedPaths: ['src/t1.js'] }),
      freshTaskYaml('t2', 3, { dependsOn: ['t1'], allowedPaths: ['src/t2.js'] }),
    ].join('\n'),
    policy: { provider: 'claude', model: 'sonnet', mode: 'agent' },
  });
  try {
    await harness.withApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId: harness.specId,
          changeSlug: harness.changeSlug,
          taskIds: ['t1', 't2'],
          prompt: 'Execute t1, t2',
        },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.match(body.error?.message || '', /t1/);
    });
  } finally {
    harness.cleanup();
  }
});

test('A same-batch dependency (member depends only on another member of the same selected batch) does not block admission', async () => {
  const harness = setupHarness({
    tasksYaml: [
      freshTaskYaml('t1', 1, { allowedPaths: ['src/t1.js'] }),
      freshTaskYaml('t2', 2, { dependsOn: ['t1'], allowedPaths: ['src/t2.js'] }),
    ].join('\n'),
    policy: { provider: 'claude', model: 'sonnet', mode: 'agent' },
  });
  try {
    await harness.withApp(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          reviewTogether: true,
          specId: harness.specId,
          changeSlug: harness.changeSlug,
          taskIds: ['t1', 't2'],
          prompt: 'Execute t1, t2',
        },
      });
      if (res.statusCode !== 201) {
        assert.fail(`Expected 201, got ${res.statusCode}: ${res.payload}`);
      }
      const data = JSON.parse(res.payload);
      assert.ok(data.batchExecutionId);
    });
  } finally {
    harness.cleanup();
  }
});
