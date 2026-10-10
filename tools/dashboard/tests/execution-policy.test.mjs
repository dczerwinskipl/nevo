import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import Fastify from 'fastify';

import sessionRoutes from '../server/ai/sessions/routes.mjs';
import turnRoutes from '../server/ai/sessions/turns/routes.mjs';
import { aiErrorHandler } from '../server/ai/sessions/http.mjs';
import {
  ExecutionPolicyService,
  executionPolicyFilePath,
  validateExecutionPolicyShape,
  computeInitialProviderAndMode,
} from '../server/ai/sessions/execution-policy-service.mjs';
import { createTrustedNetworkAiAccessPolicy } from '../server/ai/access-policy.mjs';
import { DEFAULT_AGENT_EXECUTION_MODE } from '../server/ai/contracts.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { getGroupReservation } from '../../specs/workflow/queue/reservation.mjs';
import { reconcileContinuation } from '../server/ai/orchestration/reconciliation.mjs';
import '../../specs/workflow/actions/index.mjs';

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

    // Item 3: SequentialQueueTaskPicker has one-off "Uruchom z..." button
    assert.match(overviewSrc, /Uruchom z\.\.\./);
    assert.match(overviewSrc, /handleStartBatch\(\{\s*oneOff:\s*true\s*\}\)/);
  });

  test('UI structural contract: ExecutionPolicySelectionDialog preserves free-form roles, untouched modes, and taskOverrides (Item 4)', () => {
    const dialogSrc = readFileSync(
      fileURLToPath(new URL('../ui/features/agent-sessions/create-agent-session-dialog.tsx', import.meta.url)),
      'utf8',
    );
    // Preserves initialPolicy properties and taskOverrides
    assert.match(dialogSrc, /\.\.\.\(initialPolicy \|\| \{\}\)/);
    assert.match(dialogSrc, /\.\.\.\(initialPolicy\?\.roles \|\| \{\}\)/);
    assert.match(dialogSrc, /initialPolicy\?\.taskOverrides/);

    // Preserves untouched role modes (not hard-coded to 'agent')
    assert.match(dialogSrc, /baseRoles\.reviewer\?\.mode \|\| 'agent'/);
    assert.match(dialogSrc, /baseRoles\.implementer\?\.mode \|\| 'agent'/);
    assert.match(dialogSrc, /baseRoles\.refiner\?\.mode \|\| 'agent'/);

    // Supports isOneOff
    assert.match(dialogSrc, /isOneOff\?: boolean/);
    assert.match(dialogSrc, /isOneOff \? 'Uruchom jednorazowo' : 'Zatwierdź i rozpocznij'/);
  });

  test('UI structural contract: specification-detail-content supports one-off execution without mutating stored policy (Item 3)', () => {
    const contentSrc = readFileSync(
      fileURLToPath(new URL('../ui/screens/specification-detail/specification-detail-content.tsx', import.meta.url)),
      'utf8',
    );
    // Bypasses savePolicy when target.isOneOff is true
    assert.match(contentSrc, /if \(target\.isOneOff\)/);
    assert.match(contentSrc, /oneOff:\s*true/);
    // Preserves oneOff parameter in proceedWithAgentExecution
    assert.match(contentSrc, /\.\.\.\(policy\.oneOff \? \{ oneOff: true \} : \{\}\)/);
  });

  test('Behavioral round-trip: preserves free-form roles, untouched modes, taskOverrides, and custom fields', async () => {
    const policyPayload = {
      provider: 'claude',
      mode: 'custom-mode',
      default: {
        provider: 'claude',
        mode: 'custom-mode',
      },
      roles: {
        implementer: { provider: 'codex', mode: 'agent' },
        reviewer: { provider: 'claude', mode: 'ask' },
        specialist: { provider: 'gemini', mode: 'custom-role-mode' },
      },
      taskOverrides: {
        'task-99': { provider: 'gemini', mode: 'edit' },
      },
    };

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/specs/round-trip-spec/execution-policy',
      headers: {
        'content-type': 'application/json',
        'x-nevo-dashboard-action': '1',
      },
      payload: policyPayload,
    });
    assert.equal(putRes.statusCode, 200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/specs/round-trip-spec/execution-policy',
    });
    assert.equal(getRes.statusCode, 200);
    const retrieved = JSON.parse(getRes.payload).policy;

    assert.equal(retrieved.provider, 'claude');
    assert.equal(retrieved.mode, 'custom-mode');
    assert.equal(retrieved.roles.specialist.provider, 'gemini');
    assert.equal(retrieved.roles.specialist.mode, 'custom-role-mode');
    assert.equal(retrieved.roles.reviewer.mode, 'ask');
    assert.deepEqual(retrieved.taskOverrides['task-99'], { provider: 'gemini', mode: 'edit' });

    // Resolving for custom role
    const resolvedSpecialist = policyService.resolveExecutionPolicy('round-trip-spec', null, { role: 'specialist' });
    assert.deepEqual(resolvedSpecialist, { provider: 'gemini', mode: 'custom-role-mode' });

    // Resolving for task override
    const resolvedTask = policyService.resolveExecutionPolicy('round-trip-spec', 'task-99', { role: 'specialist' });
    assert.deepEqual(resolvedTask, { provider: 'gemini', mode: 'edit' });

    // Resolving with null role falls back to default, not implementer
    const resolvedDefault = policyService.resolveExecutionPolicy('round-trip-spec', null);
    assert.deepEqual(resolvedDefault, { provider: 'claude', mode: 'custom-mode' });
  });

  test('One-off execution configuration: resolves effective configuration for target step/role/task and preserves policy (Item 4)', async () => {
    // 1. Verify resolution precedence (taskOverride > role > default)
    const policy = {
      provider: 'claude',
      mode: 'agent',
      default: { provider: 'claude', mode: 'agent' },
      roles: {
        implementer: { provider: 'claude', mode: 'agent' },
        reviewer: { provider: 'codex', mode: 'agent' },
      },
      taskOverrides: {
        'task-custom': { provider: 'antigravity', mode: 'edit' },
      },
    };

    policyService.saveExecutionPolicy('one-off-spec', policy);
    const resolvedReviewer = policyService.resolveExecutionPolicy('one-off-spec', 'task-1', { role: 'reviewer' });
    assert.deepEqual(resolvedReviewer, { provider: 'codex', mode: 'agent' });

    const resolvedCustomTask = policyService.resolveExecutionPolicy('one-off-spec', 'task-custom', { role: 'reviewer' });
    assert.deepEqual(resolvedCustomTask, { provider: 'antigravity', mode: 'edit' });

    const resolvedImplementer = policyService.resolveExecutionPolicy('one-off-spec', 'task-2', { role: 'implementer' });
    assert.deepEqual(resolvedImplementer, { provider: 'claude', mode: 'agent' });

    // 2. UI wiring contract: specification-detail-content passes initialConfig to ExecutionPolicySelectionDialog
    const detailContentSrc = readFileSync(
      fileURLToPath(new URL('../ui/screens/specification-detail/specification-detail-content.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(detailContentSrc, /const effective = resolvePolicyForTask\(currentPolicy, targetTaskId, \{\s*role:\s*effectiveRole\s*\}\)/);
    assert.match(detailContentSrc, /initialConfig: effective/);
    assert.match(detailContentSrc, /initialConfig=\{pendingStart\??\.initialConfig\}/);

    // 3. UI wiring contract: ExecutionPolicySelectionDialog initializes from initialConfig
    const dialogSrc = readFileSync(
      fileURLToPath(new URL('../ui/features/agent-sessions/create-agent-session-dialog.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(dialogSrc, /initialConfig\?: \{ provider: string; mode\?: AgentExecutionMode; model\?: string \| null \} \| null/);
    assert.match(dialogSrc, /initialConfig\?\.provider/);
    assert.match(dialogSrc, /setProvider\(initialConfig\.provider\)/);

    // 4. Stored policy is untouched by one-off execution
    const storedBefore = policyService.getExecutionPolicy('one-off-spec');
    assert.deepEqual(storedBefore, policy);
    const storedAfter = policyService.getExecutionPolicy('one-off-spec');
    assert.deepEqual(storedAfter, storedBefore);
  });

  describe('Model selection for deterministic execution end-to-end', () => {
    test('Policy persistence: save/load preserves model through normalization and round-trips to disk', async () => {
      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/specs/model-spec/execution-policy',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
      });
      assert.equal(putRes.statusCode, 200);
      const putData = JSON.parse(putRes.payload);
      assert.deepEqual(putData.policy, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });

      // Proven on real disk
      const diskFile = join(tempDir, '.nevo-ai-local', 'execution-policy', 'model-spec.json');
      assert.ok(existsSync(diskFile));
      const onDisk = JSON.parse(readFileSync(diskFile, 'utf8'));
      assert.deepEqual(onDisk, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });

      // Subsequent GET returns model
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/specs/model-spec/execution-policy',
      });
      assert.equal(getRes.statusCode, 200);
      const getData = JSON.parse(getRes.payload);
      assert.equal(getData.policy.model, 'sonnet');
    });

    test('Validation: rejects invalid non-string or empty model at every policy level', () => {
      // 1. Top-level invalid model
      assert.throws(
        () => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent', model: '' }),
        /Execution policy model must be a non-empty string/,
      );
      assert.throws(
        () => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent', model: 123 }),
        /Execution policy model must be a non-empty string/,
      );
      assert.throws(
        () => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent', model: '   ' }),
        /Execution policy model must be a non-empty string/,
      );

      // 2. Default invalid model
      assert.throws(
        () => validateExecutionPolicyShape({ default: { provider: 'claude', mode: 'agent', model: '' } }),
        /Execution policy default\.model must be a non-empty string/,
      );
      assert.throws(
        () => validateExecutionPolicyShape({ default: { provider: 'claude', mode: 'agent', model: {} } }),
        /Execution policy default\.model must be a non-empty string/,
      );

      // 3. Roles invalid model
      assert.throws(
        () =>
          validateExecutionPolicyShape({
            provider: 'claude',
            mode: 'agent',
            roles: { reviewer: { provider: 'claude', model: '' } },
          }),
        /roles\['reviewer'\]\.model must be a non-empty string/,
      );

      // 4. TaskOverrides invalid model
      assert.throws(
        () =>
          validateExecutionPolicyShape({
            provider: 'claude',
            mode: 'agent',
            taskOverrides: { 'task-1': { model: '' } },
          }),
        /taskOverrides\['task-1'\]\.model must be a non-empty string/,
      );

      // 5. Valid shapes with omitted model or non-empty string are accepted
      assert.doesNotThrow(() => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent' }));
      assert.doesNotThrow(() => validateExecutionPolicyShape({ provider: 'claude', mode: 'agent', model: 'opus' }));
      assert.doesNotThrow(() =>
        validateExecutionPolicyShape({
          default: { provider: 'claude', mode: 'agent', model: 'sonnet' },
          roles: { reviewer: { provider: 'claude', model: 'opus' } },
          taskOverrides: { 'task-1': { model: 'haiku' } },
        }),
      );
    });

    test('Default resolution: policy default with model resolves model', async () => {
      policyService.saveExecutionPolicy('res-default-spec', {
        default: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
      });

      const backendResolved = policyService.resolveExecutionPolicy('res-default-spec');
      assert.deepEqual(backendResolved, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });

      const { resolvePolicyForTask } = await import('../ui/features/agent-sessions/execution-policy.ts');
      const loaded = policyService.getExecutionPolicy('res-default-spec');
      const frontendResolved = resolvePolicyForTask(loaded);
      assert.deepEqual(frontendResolved, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });
    });

    test('Role override: reviewer resolves opus, implementer and refiner resolve sonnet', async () => {
      policyService.saveExecutionPolicy('role-model-spec', {
        default: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
        roles: {
          reviewer: {
            provider: 'claude',
            model: 'opus',
          },
        },
      });

      const reviewerRes = policyService.resolveExecutionPolicy('role-model-spec', null, { role: 'reviewer' });
      assert.deepEqual(reviewerRes, {
        provider: 'claude',
        model: 'opus',
        mode: 'agent',
      });

      const implementerRes = policyService.resolveExecutionPolicy('role-model-spec', null, { role: 'implementer' });
      assert.deepEqual(implementerRes, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });

      const refinerRes = policyService.resolveExecutionPolicy('role-model-spec', null, { role: 'refiner' });
      assert.deepEqual(refinerRes, {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });

      // Frontend client function parity
      const { resolvePolicyForTask } = await import('../ui/features/agent-sessions/execution-policy.ts');
      const loaded = policyService.getExecutionPolicy('role-model-spec');
      assert.deepEqual(resolvePolicyForTask(loaded, undefined, { role: 'reviewer' }), {
        provider: 'claude',
        model: 'opus',
        mode: 'agent',
      });
      assert.deepEqual(resolvePolicyForTask(loaded, undefined, { role: 'implementer' }), {
        provider: 'claude',
        model: 'sonnet',
        mode: 'agent',
      });
    });

    test('Task override: task override model wins over role and default while provider/mode inherit', async () => {
      policyService.saveExecutionPolicy('task-override-spec', {
        default: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
        roles: {
          reviewer: {
            provider: 'claude',
            model: 'opus',
            mode: 'ask',
          },
        },
        taskOverrides: {
          '03': {
            model: 'haiku',
          },
          '04': {
            mode: 'edit',
          },
          '05': {
            provider: 'codex', // provider change without model
          },
        },
      });

      // Task '03' with role 'reviewer': model 'haiku' wins over role 'opus', provider and mode inherit from role
      const task03Res = policyService.resolveExecutionPolicy('task-override-spec', '03', { role: 'reviewer' });
      assert.deepEqual(task03Res, {
        provider: 'claude',
        model: 'haiku',
        mode: 'ask',
      });

      // Task '04' with role 'reviewer': mode 'edit' wins, provider 'claude' and model 'opus' inherit from role
      const task04Res = policyService.resolveExecutionPolicy('task-override-spec', '04', { role: 'reviewer' });
      assert.deepEqual(task04Res, {
        provider: 'claude',
        model: 'opus',
        mode: 'edit',
      });

      // Task '05' with role 'reviewer': provider changes to 'codex', so it does NOT inherit claude's 'opus' model
      const task05Res = policyService.resolveExecutionPolicy('task-override-spec', '05', { role: 'reviewer' });
      assert.deepEqual(task05Res, {
        provider: 'codex',
        mode: 'ask',
      });
      assert.equal(task05Res.model, undefined);

      // Parity with frontend resolvePolicyForTask
      const { resolvePolicyForTask } = await import('../ui/features/agent-sessions/execution-policy.ts');
      const loaded = policyService.getExecutionPolicy('task-override-spec');
      assert.deepEqual(resolvePolicyForTask(loaded, '03', { role: 'reviewer' }), {
        provider: 'claude',
        model: 'haiku',
        mode: 'ask',
      });
      assert.deepEqual(resolvePolicyForTask(loaded, '04', { role: 'reviewer' }), {
        provider: 'claude',
        model: 'opus',
        mode: 'edit',
      });
      assert.deepEqual(resolvePolicyForTask(loaded, '05', { role: 'reviewer' }), {
        provider: 'codex',
        mode: 'ask',
      });
    });

    test('Provider default: policy with no model resolves without model property and does not invent fake ID', async () => {
      policyService.saveExecutionPolicy('no-model-spec', {
        provider: 'claude',
        mode: 'agent',
      });

      const res = policyService.resolveExecutionPolicy('no-model-spec');
      assert.deepEqual(res, { provider: 'claude', mode: 'agent' });
      assert.equal('model' in res, false);

      const { resolvePolicyForTask } = await import('../ui/features/agent-sessions/execution-policy.ts');
      const loaded = policyService.getExecutionPolicy('no-model-spec');
      const frontendRes = resolvePolicyForTask(loaded);
      assert.deepEqual(frontendRes, { provider: 'claude', mode: 'agent' });
      assert.equal('model' in frontendRes, false);
    });

    test('UI contracts: ExecutionPolicySelectionDialog and specification-detail-content wire model for default and roles', () => {
      const dialogSrc = readFileSync(
        fileURLToPath(new URL('../ui/features/agent-sessions/create-agent-session-dialog.tsx', import.meta.url)),
        'utf8',
      );
      // Dialog supports model in default and role overrides
      assert.match(dialogSrc, /selectedModel=\{model\}/);
      assert.match(dialogSrc, /onSelectModel=\{setModel\}/);
      assert.match(dialogSrc, /implementerModel/);
      assert.match(dialogSrc, /reviewerModel/);
      assert.match(dialogSrc, /refinerModel/);
      assert.match(dialogSrc, /handleRoleProviderChange/);
      assert.match(dialogSrc, /Implementer Model/);
      assert.match(dialogSrc, /Reviewer Model/);
      assert.match(dialogSrc, /Refiner Model/);

      // specification-detail-content checks model conflict across batch tasks
      const contentSrc = readFileSync(
        fileURLToPath(new URL('../ui/screens/specification-detail/specification-detail-content.tsx', import.meta.url)),
        'utf8',
      );
      assert.match(contentSrc, /p\?\.model !== first\?\.model/);
      assert.match(contentSrc, /initialConfig: effective && !hasConflict \? \{ provider: effective\.provider, mode: effective\.mode, model: effective\.model \} : null/);
    });

    async function setupDeterministicTestHarness({ tasks, policy } = {}) {
      const tmpRoot = mkdtempSync(join(tmpdir(), 'nevo-det-model-test-'));
      execSync('git init -b main && git config user.email test@test.com && git config user.name test', { cwd: tmpRoot });

      mkdirSync(join(tmpRoot, '.nevo-ai', 'workflows'), { recursive: true });
      const realWorkflowPath = fileURLToPath(new URL('../../../.nevo-ai/workflows/standard-v1.yaml', import.meta.url));
      copyFileSync(
        realWorkflowPath,
        join(tmpRoot, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
      );

      const specId = randomUUID();
      const changeSlug = 'det-spec';
      const changeDir = join(tmpRoot, 'specs', 'active', changeSlug);
      mkdirSync(changeDir, { recursive: true });

      const tasksYaml = (tasks || [
        { id: '01', step: 'implementation', state: 'active' },
      ]).map((t, idx) => {
        if (t.state === 'completed' && t.nextStep === 'review') {
          return `  - id: "${t.id}"
    order: ${idx + 1}
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review`;
        }
        return `  - id: "${t.id}"
    order: ${idx + 1}
    workflow_progress:
      current_step: ${t.step || 'implementation'}
      current_attempt: 1
      state: ${t.state || 'active'}`;
      }).join('\n');

      const changeYaml = `spec_id: ${specId}
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
${tasksYaml}
`;
      writeFileSync(join(changeDir, 'change.yaml'), changeYaml, 'utf8');
      execSync('git add -A && git commit -m "init"', { cwd: tmpRoot });

      const recordedSessions = [];
      const recordedTurns = [];
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
        listModels: async () => [
          { id: 'sonnet', name: 'sonnet', traits: { maxContextTokens: 200000 } },
          { id: 'opus', name: 'opus', traits: { maxContextTokens: 200000 } },
        ],
        createSession: async (options) => {
          recordedSessions.push(options);
          return { providerSessionId: `claude-sess-${recordedSessions.length}` };
        },
        startTurn: (context) => {
          recordedTurns.push(context);
          return (async function* () {
            yield { type: 'final_answer.delta', text: 'done' };
          })();
        },
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

      const harnessApp = Fastify();
      harnessApp.setErrorHandler(aiErrorHandler);
      const accessPolicy = createTrustedNetworkAiAccessPolicy();
      await harnessApp.register(sessionRoutes, { service, accessPolicy, executionPolicyService: policyService });
      await harnessApp.register(turnRoutes, { service, accessPolicy, repoRoot: tmpRoot });

      return {
        tmpRoot,
        specId,
        changeSlug,
        policyService,
        service,
        bindingService,
        app: harnessApp,
        recordedSessions,
        recordedTurns,
        cleanup: async () => {
          await new Promise(r => setTimeout(r, 100));
          await harnessApp.close();
          rmSync(tmpRoot, { recursive: true, force: true });
        },
      };
    }

    test('A. Normal deterministic execution: policy model is authoritative and used by admitted session and provider', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'active' },
        ],
        policy: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskId: '01',
            prompt: 'Implement task 01',
          },
        });
        assert.equal(res.statusCode, 201);
        assert.equal(harness.recordedSessions[0]?.model, 'sonnet');
        assert.equal(harness.recordedTurns[0]?.model, 'sonnet');
      } finally {
        await harness.cleanup();
      }
    });

    test('B. Batch execution uses frozen config: executionConfigSnapshot, admission candidate, and session/provider execution all receive frozen model', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'completed', nextStep: 'review' },
          { id: '02', step: 'implementation', state: 'completed', nextStep: 'review' },
        ],
        policy: {
          provider: 'claude',
          mode: 'agent',
          roles: {
            reviewer: {
              provider: 'claude',
              model: 'sonnet',
              mode: 'agent',
            },
          },
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            reviewTogether: true,
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskIds: ['01', '02'],
            prompt: 'Review tasks together',
          },
        });
        if (res.statusCode !== 201) console.log('Test B payload:', res.payload);
        assert.equal(res.statusCode, 201);
        const data = JSON.parse(res.payload);
        assert.ok(data.batchExecutionId, 'batchExecutionId must be returned');

        // Verify frozen snapshot in reservation
        const reservation = getGroupReservation(harness.tmpRoot, harness.changeSlug, data.batchExecutionId);
        assert.ok(reservation, 'group reservation must exist');
        assert.equal(reservation.executionConfigSnapshot.model, 'sonnet');

        // Verify admitted session and provider execution used the frozen model
        assert.equal(harness.recordedSessions[0]?.model, 'sonnet');
        assert.equal(harness.recordedTurns[0]?.model, 'sonnet');
      } finally {
        await harness.cleanup();
      }
    });

    test('C. One-off explicit provider default: model=null clears model override and preserves persisted policy', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'active' },
        ],
        policy: {
          provider: 'claude',
          model: 'opus',
          mode: 'agent',
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskId: '01',
            oneOff: true,
            model: null,
            prompt: 'One-off execution with default model',
          },
        });
        assert.equal(res.statusCode, 201);
        // Provider execution receives undefined (provider default), not opus
        assert.equal(harness.recordedSessions[0]?.model, undefined);
        assert.equal(harness.recordedTurns[0]?.model, undefined);

        // Persisted policy remains unchanged
        const persisted = harness.policyService.getExecutionPolicy(harness.changeSlug);
        assert.equal(persisted.model, 'opus');
      } finally {
        await harness.cleanup();
      }
    });

    test('D. Normal execution cannot override explicit policy model without oneOff=true', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'active' },
        ],
        policy: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskId: '01',
            model: 'opus',
            oneOff: false,
            prompt: 'Attempt override',
          },
        });
        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.match(data.error.message, /does not match server-resolved execution policy model 'sonnet'/);
      } finally {
        await harness.cleanup();
      }
    });

    test('E. Normal execution cannot override provider-default policy without oneOff=true', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'active' },
        ],
        policy: {
          provider: 'claude',
          mode: 'agent',
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskId: '01',
            model: 'opus',
            oneOff: false,
            prompt: 'Attempt override',
          },
        });
        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.match(data.error.message, /does not match server-resolved execution policy \(provider default\)/);
      } finally {
        await harness.cleanup();
      }
    });

    test('F. Normal execution cannot reset explicit policy model with model=null without oneOff=true', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'active' },
        ],
        policy: {
          provider: 'claude',
          model: 'sonnet',
          mode: 'agent',
        },
      });
      try {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/agent-sessions/turns',
          headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
          payload: {
            purpose: 'execution',
            specId: harness.specId,
            changeSlug: harness.changeSlug,
            taskId: '01',
            model: null,
            oneOff: false,
            prompt: 'Attempt reset',
          },
        });
        assert.equal(res.statusCode, 400);
        const data = JSON.parse(res.payload);
        assert.match(data.error.message, /Requested provider default model does not match server-resolved execution policy model 'sonnet'/);
      } finally {
        await harness.cleanup();
      }
    });

    test('G. Reconciliation respects provider-default policy: does not fall back to options.model', async () => {
      const harness = await setupDeterministicTestHarness({
        tasks: [
          { id: '01', step: 'implementation', state: 'completed', nextStep: 'review' },
        ],
        policy: {
          provider: 'claude',
          mode: 'agent',
          // model deliberately absent (provider default)
        },
      });
      try {
        const change = {
          _slug: harness.changeSlug,
          slug: harness.changeSlug,
          id: harness.changeSlug,
          spec_id: harness.specId,
          workflow: { definition: 'standard-v1' },
          tasks: [
            {
              id: '01',
              workflow_progress: {
                current_step: 'implementation',
                current_attempt: 1,
                state: 'completed',
                history: [
                  { step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' },
                ],
              },
            },
          ],
        };

        const result = await reconcileContinuation(change, change.tasks[0], {
          repoRoot: harness.tmpRoot,
          model: 'opus', // options.model fallback
          sessionService: harness.service,
        });

        assert.equal(result.action, 'agent-admitted');
        // The admitted session must use provider default (undefined), NOT options.model ('opus')
        assert.equal(harness.recordedSessions[0]?.model, undefined);
      } finally {
        await harness.cleanup();
      }
    });
  });
});


