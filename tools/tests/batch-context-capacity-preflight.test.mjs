// Test suite for Batch Context Capacity Preflight (Task 03, D34, D38).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  preflightBatchCapacity,
  buildCanonicalProspectivePayload,
} from '../specs/workflow/batch-start/index.mjs';
import { createGroupReservation, releaseGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { loadBatchStartRecord } from '../specs/workflow/batch-start/record.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('AC2: Context-capacity preflight rejects over-budget payload with zero activations and handles unknown capacity', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-preflight-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, 'cap-spec');
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );

  try {
    const tasks = [
      {
        id: 'task-1',
        title: 'Task 1 Title',
        order: 1,
        status: 'in-implementation',
        allowed_paths: ['src/a.js'],
        forbidden_paths: ['src/b.js'],
        acceptance_criteria: ['Must work properly'],
        rawContent: 'Detailed task 1 instructions and acceptance criteria',
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'completed',
          history: [{ step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' }],
        },
      },
      {
        id: 'task-2',
        title: 'Task 2 Title',
        order: 2,
        status: 'in-implementation',
        allowed_paths: ['src/b.js'],
        forbidden_paths: ['src/a.js'],
        acceptance_criteria: ['Must pass tests'],
        rawContent: 'Detailed task 2 instructions and acceptance criteria',
        workflow_progress: {
          current_step: 'implementation',
          current_attempt: 1,
          state: 'completed',
          history: [{ step: 'implementation', attempt: 1, status: 'completed', transitioned_to: 'review' }],
        },
      },
    ];

    const change = {
      id: 'cap-spec',
      _slug: 'cap-spec',
      workflow: { mode: 'deterministic', definition: 'standard.yaml' },
      tasks,
    };

    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: cap-spec
spec_id: "aaaaaaaa-0002-4000-a000-000000000001"
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: task-1
    title: Task 1 Title
    order: 1
    status: in-implementation
    allowed_paths:
      - src/a.js
    forbidden_paths:
      - src/b.js
    acceptance_criteria:
      - Must work properly
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          status: completed
          transitioned_to: review
  - id: task-2
    title: Task 2 Title
    order: 2
    status: in-implementation
    allowed_paths:
      - src/b.js
    forbidden_paths:
      - src/a.js
    acceptance_criteria:
      - Must pass tests
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

    fs.writeFileSync(path.join(taskDir, 'task-1.md'), '# Task 1\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'task-2.md'), '# Task 2\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    // 1. Canonical payload is deterministic and uses LF
    const payload = buildCanonicalProspectivePayload({ change, tasks });
    assert.ok(payload.includes('TASK: task-1'));
    assert.ok(payload.includes('TASK: task-2'));
    assert.equal(payload.includes('\r\n'), false);
    const estimatedUpperBound = Buffer.byteLength(payload, 'utf8');
    assert.ok(estimatedUpperBound > 0);

    // 2. Frozen known capacity: over-budget fails with BATCH_CONTEXT_TOO_LARGE
    const overBudgetRes = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'cap-spec',
      taskIds: ['task-1', 'task-2'],
      executionConfigSnapshot: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        contextCapacity: {
          status: 'known',
          maxContextTokens: Math.floor(estimatedUpperBound / 2), // deliberately too small
          source: 'test',
        },
      },
    });

    const preflightOver = preflightBatchCapacity({
      change,
      tasks,
      reservation: overBudgetRes,
    });
    assert.equal(preflightOver.passed, false);
    assert.equal(preflightOver.code, 'BATCH_CONTEXT_TOO_LARGE');

    const specId = 'aaaaaaaa-0002-4000-a000-000000000001';
    const sessionId = 'session-cap-test';
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${specId}.json`),
      JSON.stringify({
        sessions: [{
          sessionId,
          specId,
          batchExecutionId: overBudgetRes.batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: 'cap-spec', taskIds: ['task-1', 'task-2'] },
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
      turnId: 'turn-cap-1',
      scope: { kind: 'task-batch', taskIds: ['task-1', 'task-2'] },
      batchExecutionId: overBudgetRes.batchExecutionId,
    });

    // Executing batch start must fail closed with BATCH_CONTEXT_TOO_LARGE and ZERO member activations
    await assert.rejects(
      async () => {
        await executeBatchStart({
          repoRoot: tmpRoot,
          activeDir,
          changeSlug: 'cap-spec',
          batchExecutionId: overBudgetRes.batchExecutionId,
          sessionId,
        });
      },
      { code: 'BATCH_CONTEXT_TOO_LARGE' }
    );

    // Check that neither task was activated: both remain in state: completed at implementation
    const postFailChangeRaw = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.ok(postFailChangeRaw.includes('state: completed'));
    assert.equal(postFailChangeRaw.includes('state: active'), false);

    // 3. Frozen unknown capacity: does not invent a limit and proceeds
    await releaseGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'cap-spec',
      batchExecutionId: overBudgetRes.batchExecutionId,
      reason: 'test-preflight-rejected',
    });

    const unknownCapRes = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'cap-spec',
      taskIds: ['task-1', 'task-2'],
      batchExecutionId: 'unknown-cap-batch-id',
      executionConfigSnapshot: {
        provider: 'custom',
        model: 'unknown-model',
        contextCapacity: {
          status: 'unknown',
          reason: 'model-not-in-catalog',
        },
      },
    });

    const preflightUnknown = preflightBatchCapacity({
      change,
      tasks,
      reservation: unknownCapRes,
    });
    assert.equal(preflightUnknown.passed, true);
    assert.equal(preflightUnknown.status, 'unknown');
    assert.equal(preflightUnknown.reason, 'model-not-in-catalog');

    // 4. Overriding capacity via live caller argument is impossible: preflight reads frozen reservation only
    const modelSuppliedArgs = {
      change,
      tasks,
      reservation: overBudgetRes,
      // Attempt to spoof capacity
      contextCapacity: { status: 'known', maxContextTokens: 1000000 },
    };
    const spoofAttempt = preflightBatchCapacity(modelSuppliedArgs);
    assert.equal(spoofAttempt.passed, false);
    assert.equal(spoofAttempt.code, 'BATCH_CONTEXT_TOO_LARGE');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
