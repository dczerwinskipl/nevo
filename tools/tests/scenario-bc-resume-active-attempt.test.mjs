// Acceptance Scenario B & C — resuming an active attempt (D1/D3/D4). Proves, at the real
// admission/activation/settlement call chain (not a unit test of any single helper), that a
// different session (Scenario B) and the same session's next turn (Scenario C) share exactly
// one mechanism for resuming a safely-terminated active attempt: no attempt increment, no
// re-activation side effect, no duplicate dependency consumption, and a normal
// `workflow step finish` completes the step. Also proves the out-of-scope-dirty diagnostic is
// non-blocking and that a genuinely ambiguous in-flight start-operation record still fails
// closed to `recovery-required` for both variants, never conflated with `resumable`.

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
import { saveStartOperation } from '../specs/workflow/start-operation.mjs';
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
  execFileSync('git', ['config', 'user.name', 'Scenario BC Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'scenario-bc@example.com'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'scenario-bc-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(root, 'README.md'), '# Scenario BC Fixture\n', 'utf8');
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

function depDir(fx) {
  return path.join(fx.root, '.nevo-ai-local', 'dependency-consumption', fx.changeSlug, fx.taskId, 'implementation');
}

describe('Acceptance Scenario B & C: resuming an active attempt', { concurrency: 1 }, () => {
  test('Scenario B: a different session resumes the same active attempt — no attempt increment, no re-activation, exactly one dependency-consumption record, finishes normally', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-bc-b',
      specId: '33333333-3333-4333-8333-333333333301',
      changeSlug: 'spec-scenario-bc-1',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      // 1. First execution (session A) is admitted and activates the step.
      const adm1 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-a', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm1.admitted, true, 'First execution must be admitted');

      process.env.NEVO_SESSION_ID = 'sess-a';
      const start1 = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        silent: true,
      });
      assert.equal(start1.currentStep, 'implementation');
      assert.equal(start1.attempt, 1);

      const record1 = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.ok(record1, 'Dependency consumption record must exist after first activation');
      assert.equal(record1.consumptionSequence, 1);
      assert.deepEqual(fs.readdirSync(depDir(fx)), ['attempt-1.json']);

      // 2. Mutate a file inside the task's allowed scope — expected work-in-progress.
      fs.writeFileSync(path.join(fx.root, 'in-scope.txt'), 'work in progress\n', 'utf8');

      // 3. The turn ends WITHOUT calling `workflow step finish` — the normal state of any
      //    unfinished step. Must settle resumable, never recovery-required.
      const relRes1 = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes1.outcome, 'resumable', "Must settle resumable, never recovery-required");
      assert.equal(relRes1.released, true);
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be released');

      const taskAfterRelease = requireTask(requireChange(fx.changeSlug, fx.activeDir), fx.taskId);
      assert.equal(taskAfterRelease.workflow_progress?.state, 'active', 'workflow_progress must remain active');
      assert.equal(taskAfterRelease.workflow_progress?.current_attempt, 1, 'Attempt must not be incremented by the release');

      // 4. A DIFFERENT session (Scenario B) is admitted next for the same task.
      const adm2 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-b', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm2.admitted, true, 'A different session must be admitted to resume the same active attempt');
      const claim2 = getWorkspaceWriterClaim(fx.root);
      assert.ok(claim2);
      assert.equal(claim2.sessionId, 'sess-b');
      assert.notEqual(claim2.ownerId, adm1.ownerId, 'Resuming execution must be a distinct owner from the terminated one');

      // 5. Resuming `workflow step start` must return the SAME (step, attempt) — no
      //    re-activation side effect, no duplicate dependency consumption.
      process.env.NEVO_SESSION_ID = 'sess-b';
      const start2 = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        silent: true,
      });
      assert.equal(start2.currentStep, 'implementation');
      assert.equal(start2.attempt, 1, 'Resuming must not allocate a new attempt');

      const record2 = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.ok(record2);
      assert.equal(record2.consumptionSequence, 1, 'Resuming must not allocate a new consumption sequence');
      assert.equal(record2.createdAt, record1.createdAt, 'Resuming must not re-record dependency consumption');
      assert.deepEqual(fs.readdirSync(depDir(fx)), ['attempt-1.json'], 'Exactly one consumption record for (step, attempt 1)');

      // 6. The resumed execution can call `workflow step finish` normally to complete the step.
      const finishRes = await handleWorkflowStepFinish(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        input: JSON.stringify({ 'commit.title': `Finish implementation for task ${fx.taskId}` }),
      });
      assert.ok(finishRes);
      assert.equal(finishRes.status, 'completed');

      const relRes2 = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes2.outcome, 'completed', 'A genuine transition must classify as completed');
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Scenario C: the same session\'s next turn resumes the same active attempt — identical outcomes as Scenario B', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-bc-c',
      specId: '33333333-3333-4333-8333-333333333302',
      changeSlug: 'spec-scenario-bc-2',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      // 1. First turn (session A) admits and activates.
      const adm1 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-same', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm1.admitted, true);

      process.env.NEVO_SESSION_ID = 'sess-same';
      const start1 = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        silent: true,
      });
      assert.equal(start1.attempt, 1);

      const record1 = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(record1.consumptionSequence, 1);

      fs.writeFileSync(path.join(fx.root, 'in-scope.txt'), 'work in progress\n', 'utf8');

      // 2. Turn ends without finishing.
      const relRes1 = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes1.outcome, 'resumable');
      assert.equal(getWorkspaceWriterClaim(fx.root), null);

      // 3. The SAME session's next turn (Scenario C) resumes the same active attempt.
      const adm2 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-same', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm2.admitted, true, 'The same session must be able to resume its own abandoned active attempt');
      assert.notEqual(adm2.ownerId, adm1.ownerId, 'A new turn is a distinct owner even for the same session');

      const start2 = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        silent: true,
      });
      assert.equal(start2.attempt, 1, 'No attempt increment on same-session resume');

      const record2 = loadDependencyConsumption(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(record2.consumptionSequence, 1);
      assert.equal(record2.createdAt, record1.createdAt, 'No re-activation side effect on same-session resume');
      assert.deepEqual(fs.readdirSync(depDir(fx)), ['attempt-1.json']);

      // 4. Finishes normally.
      const finishRes = await handleWorkflowStepFinish(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
        input: JSON.stringify({ 'commit.title': `Finish implementation for task ${fx.taskId}` }),
      });
      assert.equal(finishRes.status, 'completed');

      const relRes2 = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes2.outcome, 'completed');
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Out-of-scope dirty files left behind before a resumable release are a non-blocking diagnostic and never prevent resuming', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-bc-diag',
      specId: '33333333-3333-4333-8333-333333333303',
      changeSlug: 'spec-scenario-bc-3',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      const adm1 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-a', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm1.admitted, true);

      process.env.NEVO_SESSION_ID = 'sess-a';
      await handleWorkflowStepStart(fx.changeSlug, fx.taskId, { repoRoot: fx.root, activeDir: fx.activeDir, silent: true });

      // In-scope work-in-progress plus an out-of-scope (not in allowed_paths) dirty file.
      fs.writeFileSync(path.join(fx.root, 'in-scope.txt'), 'wip\n', 'utf8');
      fs.mkdirSync(path.join(fx.root, 'unrelated-dir'), { recursive: true });
      fs.writeFileSync(path.join(fx.root, 'unrelated-dir', 'stray.txt'), 'out of scope\n', 'utf8');

      const relRes = await releaseAdmittedExecution(fx.specId);
      // Out-of-scope dirty files must never escalate a safely-ending turn to recovery-required
      // — the substantive, non-blocking half of this acceptance criterion.
      assert.equal(relRes.outcome, 'resumable', 'Out-of-scope dirty files must not block the resumable release');
      assert.equal(relRes.released, true);
      assert.equal(getWorkspaceWriterClaim(fx.root), null);

      // KNOWN GAP (reported, not fixed here — tools/dashboard/server/ai/** is forbidden for
      // this task): `assessExecutionSettlement` (task 05) already computes
      // `outOfScopeDirty`/`outOfScopeDirtyPaths` for this exact case, but `admission.mjs`'s
      // `reconcileHook1` (task 06) never copies those fields onto the hookOutcome it returns
      // from `releaseAdmittedExecution` — only `{ settled, outcome, released }` survives. So
      // "present as a non-blocking diagnostic on the classification result the resuming
      // execution can read" (this task's own acceptance criterion) is not yet true at the
      // orchestration boundary this test exercises, only inside the lower-level classifier
      // task 05 already unit-tests. Asserting the diagnostic here would either duplicate that
      // out-of-scope unit coverage or fail against the real current behavior; flagged for the
      // owner instead of silently asserting around it.
      assert.deepEqual(relRes, { settled: false, outcome: 'resumable', released: true });

      // The next execution can still resume despite the out-of-scope dirty file remaining.
      const adm2 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-b', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm2.admitted, true, 'Resuming must not be blocked by a leftover out-of-scope dirty file');

      await releaseAdmittedExecution(fx.specId);
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Contrast case: a genuinely ambiguous in-flight start-operation record classifies recovery-required and blocks both a different-session and a same-session re-admission', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-bc-ambiguous',
      specId: '33333333-3333-4333-8333-333333333304',
      changeSlug: 'spec-scenario-bc-4',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;

    try {
      const adm1 = await admitAgentExecution(fx.specId, { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-a', changeSlug: fx.changeSlug }, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(adm1.admitted, true);

      process.env.NEVO_SESSION_ID = 'sess-a';
      await handleWorkflowStepStart(fx.changeSlug, fx.taskId, { repoRoot: fx.root, activeDir: fx.activeDir, silent: true });

      // Simulate a genuinely ambiguous, still in-flight start-operation record for this
      // exact (step, attempt) — distinct from the normal 'completed' record idempotency
      // leaves behind, and distinct from the safely-resumable cases above.
      saveStartOperation(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        status: 'running',
        consumptionSequence: 1,
      });

      const relRes = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes.outcome, 'recovery-required', 'An ambiguous in-flight start-operation record must never classify as resumable');
      assert.equal(relRes.markedRecovery, true);

      const claimAfter = getWorkspaceWriterClaim(fx.root);
      assert.ok(claimAfter);
      assert.equal(claimAfter.status, 'recovery-required');

      // Blocks a DIFFERENT session (the Scenario B shape of re-admission).
      const admDifferentSession = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-b', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admDifferentSession.admitted, false, 'recovery-required must block a different session too');
      assert.equal(admDifferentSession.reason, 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY');

      // Blocks the SAME session's next turn (the Scenario C shape of re-admission) just as
      // unconditionally — recovery-required is never conflated with resumable regardless of
      // which session attempts to resume.
      const admSameSession = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-a', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admSameSession.admitted, false, 'recovery-required must block the same session too');
      assert.equal(admSameSession.reason, 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY');
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
      fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });
});
