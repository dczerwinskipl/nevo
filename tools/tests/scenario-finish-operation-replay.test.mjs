// Acceptance Scenario — finish-operation replay across a terminated execution (D2's second
// amendment). Proves, through the real admission/settlement/finish call chain (not a direct
// unit call to any single helper), that the identical replayable-vs-ambiguous rule governs
// both sides of the lifecycle: admitting a new execution against an existing finish-operation
// record (already covered by Scenario A's tasks 3/4), and classifying a terminating execution
// that left one behind (this task). A replayable record releases the claim as `resumable` and
// lets a different agent resume `workflow step finish` to completion with no duplicate side
// effects; a non-replayable record stays `recovery-required` and blocks ordinary admission.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  admitAgentExecution,
  releaseAdmittedExecution,
  resetAdmissionStateForTest,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';
import { handleWorkflowStepStart, handleWorkflowStepFinish } from '../specs/workflow/cli.mjs';
import { saveOperationRecord, loadOperationRecord } from '../specs/workflow/operation-record.mjs';
import { loadDependencyConsumption } from '../specs/workflow/dependency-consumption.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({ prefix, specId, changeSlug, taskId = 't1' }) {
  const remote = fs.mkdtempSync(path.join(tmpdir(), `nevo-remote-${prefix}-`));
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main'], { cwd: remote });

  const root = fs.mkdtempSync(path.join(tmpdir(), `nevo-repo-${prefix}-`));
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Scenario Finish Replay Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'scenario-finish-replay@example.com'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'scenario-finish-replay-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(root, 'README.md'), '# Scenario Finish Replay Fixture\n', 'utf8');
  fs.writeFileSync(path.join(root, 'in-scope.txt'), 'initial\n', 'utf8');
  fs.writeFileSync(path.join(root, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

  const wfDir = path.join(root, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, 'standard.yaml'),
    `id: standard
title: "Standard Specification Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: implementation
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    consumesDependencies: true
    purpose: "Implement task"
    expectedWork:
      summary: "Write code"
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
        continuation: auto
        releasesDependencies: true
        execution:
          session: fresh
          role: reviewer
  review:
    status:
      active: reviewing
      completed: reviewed
    purpose: "Review task"
    expectedWork:
      summary: "Review code"
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        outcome: success
`,
    'utf8'
  );

  const activeDir = path.join(root, 'specs', 'active');
  const specDir = path.join(activeDir, changeSlug);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  fs.writeFileSync(
    path.join(specDir, 'change.yaml'),
    `schema_version: '1.0'
id: '${changeSlug}'
spec_id: '${specId}'
title: "${changeSlug}"
type: standard
status: draft
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: ${taskId}
    file: tasks/${taskId}.md
    status: in-progress
`,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tasksDir, `${taskId}.md`),
    `---
id: ${taskId}
status: in-progress
change: ${changeSlug}
allowed_paths:
  - in-scope.txt
  - README.md
forbidden_paths: []
---
# Task ${taskId}
`,
    'utf8'
  );

  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'initial fixture']);
  git(root, ['push', '-u', 'origin', 'main']);

  return { root, remote, activeDir, specId, changeSlug, taskId };
}

describe('Acceptance Scenario: finish-operation replay across a terminated execution', { concurrency: 1 }, () => {
  test('Positive (replayable): X\'s turn terminates mid-finish with a replayable record — resumable, claim released, record intact; Y is admitted and resumes finish to completion with no duplicate side effects', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-finish-replay-pos',
      specId: '77777777-7777-4777-8777-777777777701',
      changeSlug: 'spec-finish-replay-1',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      // 1. Agent X is admitted and activates the step (consumesDependencies: true records
      //    exactly one consumption for (implementation, attempt 1)).
      const admX = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-x', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admX.admitted, true);

      process.env.NEVO_SESSION_ID = 'sess-x';
      await handleWorkflowStepStart(fx.changeSlug, fx.taskId, { repoRoot: fx.root, activeDir: fx.activeDir, silent: true });

      const depRecordBefore = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.ok(depRecordBefore);
      assert.equal(depRecordBefore.consumptionSequence, 1);

      // 2. X enters the durable finish operation but its turn ends before it completes —
      //    the record is left behind mid-flight (verify-gates done, everything else still
      //    pending), status: 'running' (provably replayable per D2's shared classifier).
      saveOperationRecord(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        operationId: 'op-replay-positive',
        status: 'running',
        resolvedInputs: {
          'commit.title': `Finish implementation for task ${fx.taskId}`,
        },
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'pending' },
          { id: 'commit', status: 'pending' },
          { id: 'push', status: 'pending' },
          { id: 'transition', status: 'pending' },
        ],
      });

      const recordBeforeRelease = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.ok(recordBeforeRelease);
      assert.equal(recordBeforeRelease.status, 'running');

      const taskBeforeRelease = requireTask(requireChange(fx.changeSlug, fx.activeDir), fx.taskId);
      const historyLengthBefore = taskBeforeRelease.workflow_progress?.history?.length || 0;

      // 3. X's turn is confirmed terminal. Terminal reconciliation must classify this as
      //    resumable (never recovery-required) — D2's second amendment, applied on the
      //    settlement side.
      const relRes = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes.outcome, 'resumable', 'A replayable in-flight finish-operation record must classify resumable, never recovery-required');
      assert.equal(relRes.released, true);

      // 4. Claim is released; the durable finish-operation record is left completely intact
      //    (byte-for-byte, verified by reading it before and after classification).
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be released');
      const recordAfterRelease = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.deepEqual(recordAfterRelease, recordBeforeRelease, 'The finish-operation record must be left byte-for-byte intact by classification');

      // workflow_progress itself is untouched by classification (not advanced).
      const taskAfterRelease = requireTask(requireChange(fx.changeSlug, fx.activeDir), fx.taskId);
      assert.equal(taskAfterRelease.workflow_progress?.history?.length || 0, historyLengthBefore);

      // 5. Agent Y is admitted for the same task (ordinary admission — no special flag).
      const admY = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-y', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admY.admitted, true, 'Agent Y must be admitted against a replayable finish-operation record');
      assert.notEqual(admY.ownerId, admX.ownerId);

      // 6. Y invokes the ordinary `workflow step finish` — no special "replay" flag or code
      //    path, just the normal command.
      process.env.NEVO_SESSION_ID = 'sess-y';
      const finishRes = await handleWorkflowStepFinish(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });

      // 7. The finish operation completes, resuming X's exact record (same operationId —
      //    proof it was resumed, not re-planned from scratch) rather than starting over.
      assert.ok(finishRes);
      assert.equal(finishRes.status, 'completed');
      const finalOp = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(finalOp.status, 'completed');
      assert.equal(finalOp.operationId, 'op-replay-positive', 'Finish must resume the exact record X left behind, not plan a new one');

      // 8. No duplicate workflow transition: workflow_progress.history gains exactly one
      //    new entry for this step/attempt, not two.
      const taskAfterFinish = requireTask(requireChange(fx.changeSlug, fx.activeDir), fx.taskId);
      assert.equal((taskAfterFinish.workflow_progress?.history?.length || 0), historyLengthBefore + 1, 'Exactly one new history entry, never a duplicate');

      // No duplicate dependency consumption and no attempt increment for this step.
      const depRecordAfter = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(depRecordAfter.consumptionSequence, 1);
      assert.equal(depRecordAfter.createdAt, depRecordBefore.createdAt, 'No duplicate dependency consumption for (implementation, attempt 1)');
      const depDir = path.join(fx.root, '.nevo-ai-local', 'dependency-consumption', fx.changeSlug, fx.taskId, 'implementation');
      assert.deepEqual(fs.readdirSync(depDir), ['attempt-1.json']);

      await releaseAdmittedExecution(fx.specId);
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Negative (ambiguous): X\'s turn terminates with a non-replayable finish-operation record — recovery-required, claim NOT released; a subsequent admission is blocked', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-finish-replay-neg',
      specId: '77777777-7777-4777-8777-777777777702',
      changeSlug: 'spec-finish-replay-2',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      const admX = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-x', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admX.admitted, true);

      process.env.NEVO_SESSION_ID = 'sess-x';
      await handleWorkflowStepStart(fx.changeSlug, fx.taskId, { repoRoot: fx.root, activeDir: fx.activeDir, silent: true });

      // X's finish-operation record reaches a non-replayable (ambiguous) state.
      saveOperationRecord(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        operationId: 'op-replay-negative',
        status: 'blocked',
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'blocked' },
        ],
      });

      const relRes = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes.outcome, 'recovery-required', 'A non-replayable in-flight finish-operation record must classify recovery-required, never resumable');
      assert.equal(relRes.markedRecovery, true);

      // Claim is NOT released — it is marked recovery-required instead.
      const claimAfter = getWorkspaceWriterClaim(fx.root);
      assert.ok(claimAfter, 'Claim must still exist (not released)');
      assert.equal(claimAfter.status, 'recovery-required');

      // A subsequent admission attempt for the same task fails — ordinary writable
      // admission is never granted merely because the record exists.
      const admY = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-y', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admY.admitted, false, 'A recovery-required claim must block ordinary admission');
      assert.equal(admY.reason, 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY');
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });
});
