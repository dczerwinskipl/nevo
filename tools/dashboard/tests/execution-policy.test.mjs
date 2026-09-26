import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import sessionRoutes from '../server/ai/sessions/routes.mjs';
import {
  ExecutionPolicyService,
  executionPolicyFilePath,
  validateExecutionPolicyShape,
  computeInitialProviderAndMode,
} from '../server/ai/sessions/execution-policy-service.mjs';
import { createTrustedNetworkAiAccessPolicy } from '../server/ai/access-policy.mjs';
import { DEFAULT_AGENT_EXECUTION_MODE } from '../server/ai/contracts.mjs';

describe('Task 26: Execution policy and mode selection (D21)', () => {
  let tempDir;
  let app;
  let policyService;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'nevo-exec-policy-test-'));
    policyService = new ExecutionPolicyService({ repoRoot: tempDir });
    app = Fastify();
    await app.register(sessionRoutes, {
      service: { repoRoot: tempDir },
      accessPolicy: createTrustedNetworkAiAccessPolicy(),
      executionPolicyService: policyService,
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('AC3: GET and PUT /api/specs/:slug/execution-policy round-trips a policy through the HTTP route and the .nevo-ai-local/execution-policy/<change>.json file on real filesystem', async () => {
    // 1. Initial GET returns policy: null
    const initialGet = await app.inject({
      method: 'GET',
      url: '/api/specs/my-test-change/execution-policy',
    });
    assert.equal(initialGet.statusCode, 200);
    const initialData = JSON.parse(initialGet.payload);
    assert.equal(initialData.policy, null);

    // 2. PUT stores the policy
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/specs/my-test-change/execution-policy',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'claude',
        mode: 'agent',
      },
    });
    assert.equal(putRes.statusCode, 200);
    const putData = JSON.parse(putRes.payload);
    assert.deepEqual(putData.policy, {
      provider: 'claude',
      mode: 'agent',
    });

    // 3. Proven against real filesystem
    const diskFile = join(tempDir, '.nevo-ai-local', 'execution-policy', 'my-test-change.json');
    assert.ok(existsSync(diskFile), 'Execution policy file must exist on disk at .nevo-ai-local/execution-policy/<change>.json');
    const onDisk = JSON.parse(readFileSync(diskFile, 'utf8'));
    assert.deepEqual(onDisk, {
      provider: 'claude',
      mode: 'agent',
    });

    // 4. Subsequent GET returns the persisted policy
    const secondGet = await app.inject({
      method: 'GET',
      url: '/api/specs/my-test-change/execution-policy',
    });
    assert.equal(secondGet.statusCode, 200);
    const secondData = JSON.parse(secondGet.payload);
    assert.deepEqual(secondData.policy, {
      provider: 'claude',
      mode: 'agent',
    });
  });

  test('AC4: taskOverrides entry for one task does not affect the change-level default read by any other task', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/specs/override-spec/execution-policy',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'claude',
        mode: 'agent',
        taskOverrides: {
          'task-special': {
            provider: 'codex',
            mode: 'edit',
          },
        },
      },
    });
    assert.equal(putRes.statusCode, 200);

    // Default resolution without taskId
    const defaultResolution = policyService.resolveExecutionPolicy('override-spec');
    assert.deepEqual(defaultResolution, { provider: 'claude', mode: 'agent' });

    // Task with override
    const specialTask = policyService.resolveExecutionPolicy('override-spec', 'task-special');
    assert.deepEqual(specialTask, { provider: 'codex', mode: 'edit' });

    // Other task without override reads change-level default
    const regularTask1 = policyService.resolveExecutionPolicy('override-spec', 'task-1');
    assert.deepEqual(regularTask1, { provider: 'claude', mode: 'agent' });

    const regularTask2 = policyService.resolveExecutionPolicy('override-spec', 'task-2');
    assert.deepEqual(regularTask2, { provider: 'claude', mode: 'agent' });
  });

  test('AC1 & AC2: change with no policy requires selection; once resolved, second start on different task reads change-level policy without asking', async () => {
    const slug = 'workflow-spec';

    // Step 1: No policy exists initially
    assert.equal(policyService.getExecutionPolicy(slug), null);

    // First start check: since policy is null, selection is required unconditionally
    const policyBeforeStart = policyService.getExecutionPolicy(slug);
    assert.equal(policyBeforeStart, null, 'No policy must exist before first start');

    // User completes selection UI and confirms
    policyService.saveExecutionPolicy(slug, {
      provider: 'claude',
      mode: 'agent',
    });

    // Step 2: Policy is now resolved
    const policyAfterStart = policyService.getExecutionPolicy(slug);
    assert.ok(policyAfterStart !== null);

    // Second start on task-A reads the change-level policy directly
    const taskAPolicy = policyService.resolveExecutionPolicy(slug, 'task-A');
    assert.deepEqual(taskAPolicy, { provider: 'claude', mode: 'agent' });

    // Second start on task-B reads the same change-level policy directly
    const taskBPolicy = policyService.resolveExecutionPolicy(slug, 'task-B');
    assert.deepEqual(taskBPolicy, { provider: 'claude', mode: 'agent' });
  });

  test('AC5: CreateAgentSessionDialog generic new session default-mode behavior is unchanged', () => {
    // 1. DEFAULT_AGENT_EXECUTION_MODE remains 'edit'
    assert.equal(DEFAULT_AGENT_EXECUTION_MODE, 'edit');

    // 2. computeInitialProviderAndMode defaults to 'agent' when supported by provider
    const claudeDescriptor = {
      id: 'claude',
      label: 'Claude',
      enabled: true,
      available: true,
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
      capabilities: {},
    };
    const res1 = computeInitialProviderAndMode([claudeDescriptor]);
    assert.equal(res1.provider, 'claude');
    assert.equal(res1.mode, 'agent');

    // 3. computeInitialProviderAndMode falls back to defaultMode ('edit') when 'agent' not supported
    const limitedDescriptor = {
      id: 'limited',
      label: 'Limited Agent',
      enabled: true,
      available: true,
      supportedModes: ['ask', 'edit'],
      defaultMode: 'edit',
      capabilities: {},
    };
    const res2 = computeInitialProviderAndMode([limitedDescriptor]);
    assert.equal(res2.provider, 'limited');
    assert.equal(res2.mode, 'edit');
  });

  test('Validation: rejects invalid slugs and payloads', () => {
    assert.throws(
      () => executionPolicyFilePath(tempDir, '../bad-slug'),
      /Invalid change slug/,
    );

    assert.throws(
      () => validateExecutionPolicyShape(null),
      /Execution policy must be an object/,
    );

    assert.throws(
      () => validateExecutionPolicyShape({ provider: '', mode: 'agent' }),
      /provider must be a non-empty string/,
    );

    assert.throws(
      () => validateExecutionPolicyShape({ provider: 'claude', mode: '   ' }),
      /mode must be a non-empty string/,
    );

    assert.throws(
      () => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent', taskOverrides: 'not-object' }),
      /taskOverrides must be an object/,
    );
  });

  test('UI structural contract: specification-detail-content gates agent start with execution policy and CreateAgentSessionDialog reuses picker', () => {
    const detailContentSrc = readFileSync(
      fileURLToPath(new URL('../ui/screens/specification-detail/specification-detail-content.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(detailContentSrc, /useExecutionPolicy/);
    assert.match(detailContentSrc, /ExecutionPolicySelectionDialog/);
    assert.match(detailContentSrc, /setPendingStart/);
    assert.match(detailContentSrc, /resolvePolicyForTask/);

    const dialogSrc = readFileSync(
      fileURLToPath(new URL('../ui/features/agent-sessions/create-agent-session-dialog.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(dialogSrc, /export function ProviderAndModePicker/);
    assert.match(dialogSrc, /export function ExecutionPolicySelectionDialog/);

    const policyClientSrc = readFileSync(
      fileURLToPath(new URL('../ui/features/agent-sessions/execution-policy.ts', import.meta.url)),
      'utf8',
    );
    assert.match(policyClientSrc, /export async function fetchExecutionPolicy/);
    assert.match(policyClientSrc, /export async function saveExecutionPolicy/);
    assert.match(policyClientSrc, /export function resolvePolicyForTask/);
    assert.match(policyClientSrc, /export function useExecutionPolicy/);
  });

  test('Role-based execution policy: supports default and per-role overrides (implementer, reviewer, refiner)', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/specs/multi-role-spec/execution-policy',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: {
        provider: 'claude',
        mode: 'agent',
        default: {
          provider: 'claude',
          mode: 'agent',
        },
        roles: {
          implementer: {
            provider: 'claude',
            mode: 'agent',
          },
          reviewer: {
            provider: 'codex',
            mode: 'agent',
          },
          refiner: {
            provider: 'claude',
            mode: 'agent',
          },
        },
        taskOverrides: {
          'task-special': {
            provider: 'gemini',
            mode: 'agent',
          },
        },
      },
    });
    assert.equal(putRes.statusCode, 200);

    // 1. Reviewer role resolves to codex
    const reviewerRes = policyService.resolveExecutionPolicy('multi-role-spec', null, { role: 'reviewer' });
    assert.deepEqual(reviewerRes, { provider: 'codex', mode: 'agent' });

    // 2. Implementer role resolves to claude
    const implementerRes = policyService.resolveExecutionPolicy('multi-role-spec', null, { role: 'implementer' });
    assert.deepEqual(implementerRes, { provider: 'claude', mode: 'agent' });

    // 3. Unconfigured role falls back to default
    const unknownRoleRes = policyService.resolveExecutionPolicy('multi-role-spec', null, { role: 'auditor' });
    assert.deepEqual(unknownRoleRes, { provider: 'claude', mode: 'agent' });

    // 4. Default without role
    const defaultRes = policyService.resolveExecutionPolicy('multi-role-spec');
    assert.deepEqual(defaultRes, { provider: 'claude', mode: 'agent' });

    // 5. Task override still takes precedence over role
    const taskOverrideRes = policyService.resolveExecutionPolicy('multi-role-spec', 'task-special', { role: 'reviewer' });
    assert.deepEqual(taskOverrideRes, { provider: 'gemini', mode: 'agent' });
  });

  test('UI structural contract: SequentialQueueTaskPicker renders role configuration and removes generic blocked remediation group derivation', () => {
    const overviewSrc = readFileSync(
      fileURLToPath(new URL('../ui/screens/specification-detail/specification-overview.tsx', import.meta.url)),
      'utf8',
    );
    // Role config badges/labels
    assert.match(overviewSrc, /Konfiguracja wykonawców:/);
    assert.match(overviewSrc, /Implementer:/);
    assert.match(overviewSrc, /Reviewer:/);
    assert.match(overviewSrc, /Refiner:/);
    assert.match(overviewSrc, /onConfigureExecutionPolicy/);

    // No derived remediation group from generic blocked / suspensions
    assert.doesNotMatch(overviewSrc, /gate\?\.state === 'blocked' \|\| \(gate\?\.blockedBy/);
    assert.doesNotMatch(overviewSrc, /\(t as any\)\.suspensions\?\.length > 0/);
  });
});
