// Comprehensive tests for Batch Start and Context Bootstrap (Task 03, AC3, AC4, AC5, AC6, AC7, AC8).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGroupReservation, releaseGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter, forceReleaseWorkspaceWriterUnsafe } from '../specs/workflow/workspace-writer.mjs';
import { loadBatchStartRecord } from '../specs/workflow/batch-start/record.mjs';
import { computeWorkspaceDeltaFingerprint } from '../specs/workflow/batch-start/workspace-baseline.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function setupBatchSessionAndClaim(tmpRoot, specId, taskIds, batchExecutionId, sessionId = 'session-batch-test') {
  const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `${specId}.json`),
    JSON.stringify({
      sessions: [{
        sessionId,
        batchExecutionId,
        executionScope: { kind: 'task-batch', changeSlug: specId, taskIds: [...taskIds] },
      }],
      bindings: [],
    }, null, 2),
    'utf8'
  );

  await acquireWorkspaceWriter({
    repoRoot: tmpRoot,
    kind: 'agent',
    specId,
    sessionId,
    turnId: `turn-${sessionId}-1`,
    scope: { kind: 'task-batch', taskIds: [...taskIds] },
    batchExecutionId,
  });

  return sessionId;
}

function setupTestRepo(slug = 'batch-spec', customWorkflow = null) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-start-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'root commit'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });

  if (customWorkflow) {
    fs.writeFileSync(path.join(workflowDir, 'custom.yaml'), customWorkflow, 'utf8');
  } else {
    fs.copyFileSync(
      path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
      path.join(workflowDir, 'standard.yaml')
    );
  }

  return { tmpRoot, activeDir, changeDir, taskDir, workflowDir };
}

test('AC3 & AC4: BatchContext has crossTask overlap findings, role-agnostic lineage, and AgentSession has parentSessionId: null', async () => {
  // Use a custom workflow with non-standard role names: builder -> auditor
  const customWorkflowYaml = `id: custom-v1
title: "Custom Role Workflow"
type: standard
version: 1
entryStep: build
sourceControl:
  enabled: true
  push: true
steps:
  build:
    status:
      active: building
      completed: built
    purpose: "Build the code"
    expectedWork:
      summary: "Build"
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: audit
        execution:
          session: fresh
          role: auditor
  audit:
    status:
      active: auditing
      completed: audited
    purpose: "Audit the build"
    expectedWork:
      summary: "Audit"
    entryGates: []
    exitGates: []
    finalize: []
    transitions:
      - to: verified
        outcome: success
`;

  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo('role-spec', customWorkflowYaml);

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: role-spec
spec_id: "aaaaaaaa-0003-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: custom.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    allowed_paths:
      - src/shared.js
      - src/t1.js
    workflow_progress:
      current_step: build
      current_attempt: 1
      state: completed
      history:
        - step: build
          attempt: 1
          status: completed
          transitioned_to: audit
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    allowed_paths:
      - src/shared.js
      - src/t2.js
    workflow_progress:
      current_step: build
      current_attempt: 1
      state: completed
      history:
        - step: build
          attempt: 1
          status: completed
          transitioned_to: audit
`,
      'utf8'
    );

    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'shared.js'), 'export const shared = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), 'export const t1 = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't2.js'), 'export const t2 = 2;\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit with shared file'], { cwd: tmpRoot });

    // Establish predecessor sessions bound to prior step 'build'
    const bindingService = createAgentSessionBindingService(tmpRoot);
    bindingService.bindSessionSync({
      sessionId: 'session-builder-t1',
      provider: 'mock',
      providerSessionId: 'p-t1',
      specId: 'aaaaaaaa-0003-4000-a000-000000000001',
      taskId: 't1',
      step: 'build',
      attempt: 1,
    });
    bindingService.bindSessionSync({
      sessionId: 'session-builder-t2',
      provider: 'mock',
      providerSessionId: 'p-t2',
      specId: 'aaaaaaaa-0003-4000-a000-000000000001',
      taskId: 't2',
      step: 'build',
      attempt: 1,
    });

    // Create batch reservation
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'role-spec',
      taskIds: ['t1', 't2'],
      batchExecutionId: 'batch-role-exec-1',
      executionConfigSnapshot: {
        provider: 'mock',
        model: 'mock-model',
        contextCapacity: { status: 'unknown' },
      },
    });

    // Create batch session with executionScope
    const batchSessionId = 'session-batch-auditor';
    bindingService.bindSessionSync({
      sessionId: batchSessionId,
      provider: 'mock',
      providerSessionId: 'p-batch',
      specId: 'aaaaaaaa-0003-4000-a000-000000000001',
      step: 'audit',
      batchExecutionId: reservation.batchExecutionId,
      executionScope: {
        kind: 'task-batch',
        taskIds: ['t1', 't2'],
      },
    });

    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: 'aaaaaaaa-0003-4000-a000-000000000001',
      sessionId: batchSessionId,
      turnId: 'turn-batch-1',
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId: reservation.batchExecutionId,
    });

    // Execute batch start
    const result = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: 'role-spec',
      batchExecutionId: reservation.batchExecutionId,
      sessionId: batchSessionId,
    });

    assert.ok(result.batchContext);
    const { batchContext } = result;

    // AC3: crossTask overlap findings are present with affectedTaskIds
    assert.ok(batchContext.crossTask);
    assert.ok(Array.isArray(batchContext.crossTask.findings));
    const sharedFinding = batchContext.crossTask.findings.find(f =>
      f.paths?.includes('src/shared.js') || f.sharedPath === 'src/shared.js' || f.path === 'src/shared.js'
    );
    assert.ok(sharedFinding, 'Should detect shared.js overlap across t1 and t2');
    assert.deepEqual(sharedFinding.affectedTaskIds.sort(), ['t1', 't2']);

    // AC3 & AC4: Role-agnostic predecessorSession lineage
    assert.ok(Array.isArray(batchContext.predecessorSessions));
    assert.equal(batchContext.predecessorSessions.length, 2);
    const t1Lineage = batchContext.predecessorSessions.find(p => p.taskId === 't1');
    const t2Lineage = batchContext.predecessorSessions.find(p => p.taskId === 't2');
    assert.equal(t1Lineage?.sessionId, 'session-builder-t1');
    assert.equal(t2Lineage?.sessionId, 'session-builder-t2');

    // AC4: AgentSession record has parentSessionId: null and predecessorSessions persisted
    const storedSession = bindingService.getSessionSync(batchSessionId);
    assert.equal(storedSession.parentSessionId, null);
    assert.deepEqual(storedSession.predecessorSessions, [
      { taskId: 't1', sessionId: 'session-builder-t1', priorStep: 'build', priorAttempt: 1 },
      { taskId: 't2', sessionId: 'session-builder-t2', priorStep: 'build', priorAttempt: 1 },
    ]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC5: Reviewer work requires zero independent workflow step start calls', async () => {
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo('single-call-spec');

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: single-call-spec
spec_id: "aaaaaaaa-0004-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`,
      'utf8'
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'single-call-spec',
      taskIds: ['t1', 't2'],
      executionConfigSnapshot: { provider: 'mock', model: 'm', contextCapacity: { status: 'unknown' } },
    });

    const sessionId = await setupBatchSessionAndClaim(
      tmpRoot,
      'aaaaaaaa-0004-4000-a000-000000000001',
      ['t1', 't2'],
      reservation.batchExecutionId,
      'session-single-call'
    );

    // Exactly one call to executeBatchStart activates both members
    const result = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: 'single-call-spec',
      batchExecutionId: reservation.batchExecutionId,
      sessionId,
    });

    assert.ok(result);
    assert.equal(result.batchContext.executionScope.taskIds.length, 2);

    // Verify both are now in step 'review' and state 'active'
    const postChangeRaw = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.ok(postChangeRaw.includes('current_step: review'));
    assert.equal(postChangeRaw.includes('state: completed'), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC6: Base readiness failure blocks bootstrap with zero activations; barrier rejects raw single-task start and unreserved tasks', async () => {
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo('readiness-spec');

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: readiness-spec
spec_id: "aaaaaaaa-0005-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: draft
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`,
      'utf8'
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    // Try to execute batch start when t1 is draft (unpublished)
    const badRes = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'readiness-spec',
      taskIds: ['t1', 't2'],
      executionConfigSnapshot: { provider: 'mock', model: 'm', contextCapacity: { status: 'unknown' } },
    });

    const badSessionId = await setupBatchSessionAndClaim(
      tmpRoot,
      'aaaaaaaa-0005-4000-a000-000000000001',
      ['t1', 't2'],
      badRes.batchExecutionId,
      'session-readiness-bad'
    );

    await assert.rejects(
      async () => {
        await executeBatchStart({
          repoRoot: tmpRoot,
          activeDir,
          changeSlug: 'readiness-spec',
          batchExecutionId: badRes.batchExecutionId,
          sessionId: badSessionId,
        });
      },
      { code: 'TASK_UNPUBLISHED' }
    );

    // Verify ZERO activations occurred: t2 remains in completed implementation, not active review
    const postFailRaw = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.equal(postFailRaw.includes('current_step: review'), false);
    assert.equal(postFailRaw.includes('state: active'), false);

    // Now fix t1 to be valid and ready for review
    await releaseGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'readiness-spec',
      batchExecutionId: badRes.batchExecutionId,
    });
    await forceReleaseWorkspaceWriterUnsafe({ repoRoot: tmpRoot });

    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: readiness-spec
spec_id: "aaaaaaaa-0005-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: task-D
    order: 3
    title: Task D (outside batch)
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`,
      'utf8'
    );
    fs.writeFileSync(path.join(taskDir, 'task-D.md'), '# Task D\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Fix t1'], { cwd: tmpRoot });

    // Create reservation for t1 and t2 under batch X
    const batchXRes = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'readiness-spec',
      taskIds: ['t1', 't2'],
      batchExecutionId: 'batch-X-id',
      executionConfigSnapshot: { provider: 'mock', model: 'm', contextCapacity: { status: 'unknown' } },
    });

    // 1. Raw single-task workflow step start on barriered t1 is rejected
    await assert.rejects(
      async () => {
        await handleWorkflowStepStart('readiness-spec', 't1', {
          repoRoot: tmpRoot,
          activeDir,
        });
      },
      { code: 'TASK_BARRIERED' }
    );

    // 2. A competing batch Y trying to reserve t1 or start t1 is rejected
    await assert.rejects(
      async () => {
        await createGroupReservation({
          repoRoot: tmpRoot,
          changeSlug: 'readiness-spec',
          taskIds: ['t1', 'task-D'],
          batchExecutionId: 'batch-Y-id',
        });
      },
      { code: 'TASK_ALREADY_RESERVED' }
    );

    const batchXSessionId = await setupBatchSessionAndClaim(
      tmpRoot,
      'aaaaaaaa-0005-4000-a000-000000000001',
      ['t1', 't2'],
      'batch-X-id',
      'session-batch-x'
    );

    // 3. Batch X cannot be started with task-D which is outside its scope
    await assert.rejects(
      async () => {
        await executeBatchStart({
          repoRoot: tmpRoot,
          activeDir,
          changeSlug: 'readiness-spec',
          batchExecutionId: 'batch-X-id',
          taskIds: ['t1', 't2', 'task-D'], // scope mismatch
          sessionId: batchXSessionId,
        });
      },
      (err) => err.code === 'EXECUTION_SCOPE_MISMATCH' || err.code === 'BATCH_IDENTITY_MISMATCH'
    );

    // 4. Authenticated batch X successfully activates t1 and t2
    const batchXResult = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: 'readiness-spec',
      batchExecutionId: 'batch-X-id',
      sessionId: batchXSessionId,
    });
    assert.ok(batchXResult);
    assert.deepEqual(batchXResult.batchContext.executionScope.taskIds, ['t1', 't2']);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC7: Workspace baseline and delta fingerprint recorded after activation and changes on mutation', async () => {
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo('baseline-spec');

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: baseline-spec
spec_id: "aaaaaaaa-0006-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`,
      'utf8'
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'baseline-spec',
      taskIds: ['t1', 't2'],
      executionConfigSnapshot: { provider: 'mock', model: 'm', contextCapacity: { status: 'unknown' } },
    });

    const sessionId = await setupBatchSessionAndClaim(
      tmpRoot,
      'aaaaaaaa-0006-4000-a000-000000000001',
      ['t1', 't2'],
      reservation.batchExecutionId,
      'session-baseline'
    );

    const result = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: 'baseline-spec',
      batchExecutionId: reservation.batchExecutionId,
      sessionId,
    });

    assert.ok(result.workspaceBaseline);
    assert.ok(result.workspaceBaseline.baseRevision);
    const baselineFingerprint = result.workspaceBaseline.fingerprint;

    // Mutating a tracked file changes the recomputed fingerprint
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1 (modified)\n', 'utf8');
    const modifiedFingerprint = computeWorkspaceDeltaFingerprint(tmpRoot);
    assert.notDeepEqual(modifiedFingerprint, baselineFingerprint);

    // Creating an untracked source file changes the fingerprint
    fs.writeFileSync(path.join(tmpRoot, 'untracked.txt'), 'hello\n', 'utf8');
    const untrackedFingerprint = computeWorkspaceDeltaFingerprint(tmpRoot);
    assert.notDeepEqual(untrackedFingerprint, modifiedFingerprint);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC8: Mismatched trusted identity rejects batch-start before any member is touched', async () => {
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo('identity-spec');

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: identity-spec
spec_id: "aaaaaaaa-0007-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: t2
    order: 2
    title: Task 2
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
`,
      'utf8'
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'identity-spec',
      taskIds: ['t1', 't2'],
      batchExecutionId: 'batch-ident-1',
      executionConfigSnapshot: { provider: 'mock', model: 'm', contextCapacity: { status: 'unknown' } },
    });

    const bindingService = createAgentSessionBindingService(tmpRoot);
    // Bind session with executionScope targeting different tasks
    bindingService.bindSessionSync({
      sessionId: 'session-mismatched',
      provider: 'mock',
      providerSessionId: 'p-mismatch',
      specId: 'identity-spec',
      executionScope: {
        kind: 'task-batch',
        taskIds: ['other-task-1', 'other-task-2'],
      },
    });

    await assert.rejects(
      async () => {
        await executeBatchStart({
          repoRoot: tmpRoot,
          activeDir,
          changeSlug: 'identity-spec',
          batchExecutionId: reservation.batchExecutionId,
          sessionId: 'session-mismatched',
        });
      },
      { code: 'BATCH_IDENTITY_MISMATCH' }
    );

    // Verify tasks were NOT touched (remain state: completed, not active)
    const postRejectRaw = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.equal(postRejectRaw.includes('state: active'), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
