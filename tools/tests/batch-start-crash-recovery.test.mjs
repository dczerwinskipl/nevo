// Test suite for Batch Start Crash Recovery (Task 03, AC1, D28, D37).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { loadBatchStartRecord } from '../specs/workflow/batch-start/record.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('AC1: Batch start crash recovery activates remaining members without re-activating already activated members', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-crash-recovery-'));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, 'crash-spec');
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );

  try {
    fs.writeFileSync(
      path.join(changeDir, 'change.yaml'),
      `id: crash-spec
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: task-A
    title: Task A
    order: 1
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
  - id: task-B
    title: Task B
    order: 2
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
  - id: task-C
    title: Task C
    order: 3
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

    fs.writeFileSync(path.join(taskDir, 'task-A.md'), '# Task A\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'task-B.md'), '# Task B\n', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'task-C.md'), '# Task C\n', 'utf8');

    execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });

    // Create reservation for tasks A, B, C targeting review step
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: 'crash-spec',
      taskIds: ['task-A', 'task-B', 'task-C'],
      batchExecutionId: 'batch-crash-id-123',
      executionConfigSnapshot: {
        provider: 'mock',
        model: 'mock-model',
        contextCapacity: { status: 'unknown' },
      },
    });

    const sessionId = 'session-crash-recovery-1';
    const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'crash-spec.json'),
      JSON.stringify({
        sessions: [{
          sessionId,
          batchExecutionId: reservation.batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: 'crash-spec', taskIds: ['task-A', 'task-B', 'task-C'] },
        }],
        bindings: [],
      }, null, 2),
      'utf8'
    );

    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: 'crash-spec',
      sessionId,
      turnId: 'turn-crash-1',
      scope: { kind: 'task-batch', taskIds: ['task-A', 'task-B', 'task-C'] },
      batchExecutionId: reservation.batchExecutionId,
    });

    // 1. First execution crashes after activating member task-A
    await assert.rejects(
      async () => {
        await executeBatchStart({
          repoRoot: tmpRoot,
          activeDir,
          changeSlug: 'crash-spec',
          batchExecutionId: reservation.batchExecutionId,
          sessionId,
          _crashAfterTaskId: 'task-A',
        });
      },
      /SIMULATED_CRASH_AFTER_task-A/
    );

    // Verify state after crash
    const recordAfterCrash = loadBatchStartRecord(tmpRoot, 'crash-spec', reservation.batchExecutionId);
    assert.ok(recordAfterCrash, 'Batch-start operation record must exist on disk');
    assert.equal(recordAfterCrash.status, 'running');
    assert.equal(recordAfterCrash.memberStages['task-A']?.status, 'completed');
    assert.equal(recordAfterCrash.memberStages['task-B'], undefined);
    assert.equal(recordAfterCrash.memberStages['task-C'], undefined);

    const taskAActivatedAt = recordAfterCrash.memberStages['task-A'].activatedAt;
    assert.ok(taskAActivatedAt);

    // Verify task-A was activated in change.yaml, but B and C remain unactivated
    const midChangeRaw = fs.readFileSync(path.join(changeDir, 'change.yaml'), 'utf8');
    assert.ok(midChangeRaw.includes('current_step: review'));

    // 2. Resume / restart execution
    const resumeResult = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: 'crash-spec',
      batchExecutionId: reservation.batchExecutionId,
      sessionId,
    });

    assert.ok(resumeResult);
    assert.equal(resumeResult.batchExecutionId, reservation.batchExecutionId);

    // 3. Verify that member A was NOT re-activated (its activation timestamp and stage are preserved)
    const finalRecord = loadBatchStartRecord(tmpRoot, 'crash-spec', reservation.batchExecutionId);
    assert.ok(finalRecord);
    assert.equal(finalRecord.status, 'completed');
    assert.equal(finalRecord.memberStages['task-A'].activatedAt, taskAActivatedAt);
    assert.equal(finalRecord.memberStages['task-B'].status, 'completed');
    assert.equal(finalRecord.memberStages['task-C'].status, 'completed');

    // 4. Verify no start-operation.mjs records were created
    const startOpDir = path.join(tmpRoot, '.nevo-ai-local', 'workflow-start-operations');
    assert.equal(fs.existsSync(startOpDir), false, 'start-operation.mjs records must not be read/written');
    const depConsDir = path.join(tmpRoot, '.nevo-ai-local', 'dependency-consumption');
    assert.equal(fs.existsSync(depConsDir), false, 'dependency-consumption records must not be read/written');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
