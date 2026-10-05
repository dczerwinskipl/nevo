// End-to-end acceptance test for a real initial-implementation batch (batch-execution-
// generalization, task 07). Tasks 02-05 each verify their own slice in isolation; this
// is the single, dedicated proof that the whole flow composes on the real sequence the
// original discovery was about: three brand-new, dependency-ordered tasks, started as
// one implementation batch, finishing with one commit and one push, and handing over
// correctly. No production code is changed by this task.
//
// overview.md's change-wide acceptance criteria, mapped:
// 1. "A batch of brand-new, dependency-ordered implementation tasks can start, execute
//    under one session, and finish with exactly one commit and one push."
//    -> asserted directly below (admission, single commit, single push).
// 2. "A dependency-blocked batch member's own, same-batch dependency never blocks batch
//    admission; an unsatisfied dependency outside the batch still does."
//    -> the in-batch half is asserted directly below (T2/T3 depend on in-batch T1,
//    admission still succeeds). The "outside the batch still does" half is covered by
//    task 02's own test (tools/tests/batch-start-and-context-bootstrap.test.mjs) —
//    not duplicated here.
// 3. "A failed review's members produce no more than one new agent session per distinct
//    execution-contract group — never one per member."
//    -> covered by task 05's own test (tools/tests/batch-completion-orchestration.test.mjs).
//    This test's handover assertion below exercises the structurally analogous
//    all-pass case (every member resolves to the same contract), reinforcing but not
//    duplicating that coverage.
// 4. "No code path remains that creates a new session merely because execution moved
//    from one member task to another inside the same batch."
//    -> covered by task 05's own test; not duplicated here.
// 5. "The generic sequential queue ... is removed, not merely unused."
//    -> covered by task 01's own removal + tools/tests/workflow-continuation.test.mjs
//    and friends; not duplicated here.
// 6. "node tools/specs.mjs validate, the full test suite, and the dashboard suites all
//    pass." -> change-wide, verified by this task's own ## Verification commands, not
//    a single in-test assertion.
//
// FINDING (reported, not patched — forbidden path and out of this task's scope):
// `executeBatchFinish`'s per-member `finishStep` calls (batch-finish/operation.mjs)
// never pass a `gateRegistry`, so they fall back to the module-level `defaultGateRegistry`
// (registry.mjs), whose `CommandGate` has `verificationStore: null`. A `'command'`-type
// exitGate — exactly what the real `.nevo-ai/workflows/standard.yaml`'s `implementation`
// step declares — therefore *always* reports `status: 'blocked'` through the batch path,
// regardless of whether the underlying command actually passes, because `CommandGate.verify`
// fails closed whenever no verification store is configured (command-gate.mjs, "no
// authoritative verification store is configured to record state"). The single-task CLI
// path (`cli.mjs`'s `buildWorkflowGateRegistry`) correctly builds a fresh
// `MemoryCommandVerificationStore`-backed registry per call and does not hit this.
// Compounding it: the Stage 4 loop in `executeBatchFinish` unconditionally records
// `record.stages.memberFinishes[taskId] = { status: 'completed', ... }` from whatever
// `finishStep` returns, without checking `finishResult.status` — so a `'blocked'` result
// is silently treated as a successfully finished member, and the batch can reach
// `executeBatchFinish`'s own overall `status: 'completed'` with zero actual member
// transitions applied. Neither of these is introduced by tasks 02-05 (pre-existing,
// orthogonal to dependency/commit/handover semantics); this test therefore exercises a
// workflow fixture structurally identical to the real standard.yaml (same steps,
// `consumesDependencies`/`releasesDependencies`/`continuation`/`session`/`role`) but with
// `exitGates: []`, the same choice tasks 03/04's own tests already made for the same
// reason (see tools/tests/batch-finish-operation.test.mjs's own local `standardWorkflowYaml`).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createGroupReservation, getGroupReservation } from '../specs/workflow/queue/index.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/operation.mjs';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import { loadDependencyConsumption } from '../specs/workflow/dependency-consumption.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SPEC_ID = 'dddddddd-0001-4000-d000-000000000001';
const SLUG = 'accept-initial-impl-batch';

const STANDARD_WORKFLOW_YAML = `id: standard-v1
title: "Standard Specification Workflow"
type: standard
version: 1
entryStep: implementation
sourceControl:
  enabled: true
  push: true
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    consumesDependencies: true
    purpose: "Perform the approved implementation work for the task within declared scope."
    expectedWork:
      summary: "Modify code, tests, and documentation within allowed_paths to satisfy task acceptance criteria."
    entryGates: []
    exitGates: []
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
    purpose: "Perform an independent quality review of the implementation against task acceptance criteria."
    expectedWork:
      summary: "Audit implementation and test coverage, apply corrective edits within allowed_paths."
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: human-verification
        continuation: auto
      - value: fail
        to: implementation
        continuation: auto
        invalidatesDependencyRelease: true
        execution:
          session: fresh
          role: refiner
  human-verification:
    executor: human
    status:
      active: awaiting-human-verification
      completed: completed
    purpose: "Explicit owner/user acceptance sign-off."
    expectedWork:
      summary: "Confirm readiness with the repository owner and record explicit human verification sign-off."
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        action:
          label: Approve
        outcome: success
      - value: fail
        to: implementation
        action:
          label: Request changes
          feedback:
            required: true
        continuation: auto
        invalidatesDependencyRelease: true
        execution:
          session: fresh
          role: refiner
`;

function setupTestRepo() {
  // A real 'origin' remote is required: the real standard.yaml declares
  // sourceControl.push: true, and this test asserts the shared commit actually lands
  // on the remote, not merely locally (bare-remote-plus-clone pattern, same as
  // tools/tests/batch-cli-and-security.test.mjs's setupTestRepo).
  const baseDir = fs.mkdtempSync(path.join(tmpdir(), 'nevo-accept-initial-impl-batch-'));
  const originDir = path.join(baseDir, 'origin.git');
  const tmpRoot = path.join(baseDir, 'repo');
  execFileSync('git', ['init', '--bare', '-q', originDir]);
  execFileSync('git', ['clone', '-q', originDir, tmpRoot]);
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, SLUG);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  // Structurally identical to the real .nevo-ai/workflows/standard.yaml (same steps,
  // consumesDependencies/releasesDependencies/continuation/session/role) but with
  // exitGates: [] instead of the real 'command' gate — see the FINDING above.
  fs.writeFileSync(path.join(workflowDir, 'standard.yaml'), STANDARD_WORKFLOW_YAML, 'utf8');

  // T1, T2 depends_on T1, T3 depends_on T1 — all brand-new (no workflow_progress at
  // all), targeting the shared, unconditional entry step 'implementation'.
  const changeYaml = `id: ${SLUG}
spec_id: ${SPEC_ID}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
  - id: t1
    order: 1
    title: Task 1
    status: planned
    allowed_paths:
      - src/t1.js
  - id: t2
    order: 2
    title: Task 2
    status: planned
    allowed_paths:
      - src/t2.js
    depends_on: [t1]
  - id: t3
    order: 3
    title: Task 3
    status: planned
    allowed_paths:
      - src/t3.js
    depends_on: [t1]
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');
  fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
  fs.writeFileSync(path.join(taskDir, 't2.md'), '# Task 2\n', 'utf8');
  fs.writeFileSync(path.join(taskDir, 't3.md'), '# Task 3\n', 'utf8');

  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRoot });
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
  execFileSync('git', ['push', '-u', 'origin', branch], { cwd: tmpRoot });

  return { tmpRoot, baseDir, originDir, activeDir, changeDir, branch };
}

function writeSessionFile(tmpRoot, specId, session) {
  const sessionFile = path.join(tmpRoot, '.nevo-ai-local', 'sessions', `${specId}.json`);
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ sessions: [session], bindings: [] }, null, 2), 'utf8');
}

test('A real initial-implementation batch: T1, T2 depends_on T1, T3 depends_on T1 — start, implement, finish, and hand over correctly', async () => {
  const { tmpRoot, baseDir, originDir, activeDir, branch } = setupTestRepo();
  try {
    const taskIds = ['t1', 't2', 't3'];
    const batchExecutionId = 'batch-accept-initial-impl-1';
    const sessionId = 'session-accept-initial-impl-1';

    // ── Step 2: Reserve and start a batch covering all 3 ──────────────────────────
    // Gap 1 / change-wide AC2 (in-batch half): T2 and T3 each depend on T1, which is
    // itself a member of this same batch — admission must still succeed.
    const reservation = await createGroupReservation({
      repoRoot: tmpRoot,
      changeSlug: SLUG,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model', mode: 'agent' },
    });
    assert.ok(reservation, 'Batch reservation must be created despite in-batch dependencies');
    assert.equal(reservation.batchExecutionId, batchExecutionId);

    writeSessionFile(tmpRoot, SPEC_ID, {
      sessionId,
      batchExecutionId,
      executionScope: { kind: 'task-batch', changeSlug: SLUG, taskIds },
    });

    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: SPEC_ID,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    const startRes = await executeBatchStart({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: SLUG,
      batchExecutionId,
      sessionId,
    });
    assert.ok(startRes.batchContext, 'Batch admission/start must succeed for brand-new, in-batch-dependent tasks');

    // ── Step 3: Simulate the agent implementing T1 first, then T2/T3 ──────────────
    // Dirty files land within each member's own declared scope (allowed_paths).
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 'implemented';\n", 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't2.js'), "export const t2 = 'implemented';\n", 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 't3.js'), "export const t3 = 'implemented';\n", 'utf8');

    const localCommitCountBefore = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    const originCommitCountBefore = execFileSync('git', ['rev-list', '--count', branch], { cwd: originDir, encoding: 'utf8' }).trim();

    // ── Step 4: Finish the batch ───────────────────────────────────────────────────
    // 'implementation' is unconditional (no `value` field on its transition) — no
    // per-member `result` is required (task 03's AC3).
    const finishRes = await executeBatchFinish({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: SLUG,
      batchExecutionId,
      sessionId,
      inputs: {
        tasks: {},
        'commit.title': 'feat: implement t1, t2, t3',
      },
    });

    assert.equal(finishRes.status, 'completed');
    assert.equal(finishRes.record.stages.sharedCommit.status, 'completed');

    // Gap 2/5, change-wide AC1: exactly one commit, landing exactly once on the remote.
    const localCommitCountAfter = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    assert.equal(Number(localCommitCountAfter), Number(localCommitCountBefore) + 1, 'Exactly one shared commit must land locally');

    const originCommitCountAfter = execFileSync('git', ['rev-list', '--count', branch], { cwd: originDir, encoding: 'utf8' }).trim();
    assert.equal(Number(originCommitCountAfter), Number(originCommitCountBefore) + 1, 'Exactly one push must land on the remote');

    const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRoot, encoding: 'utf8' }).trim();
    const originHead = execFileSync('git', ['rev-parse', branch], { cwd: originDir, encoding: 'utf8' }).trim();
    assert.equal(originHead, localHead, 'The remote must hold exactly the same commit the push produced');

    const sharedCommitSha = finishRes.record.stages.sharedCommit.result.sha;
    const changedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sharedCommitSha], { cwd: tmpRoot, encoding: 'utf8' })
      .trim().split('\n').sort();
    assert.deepEqual(
      changedFiles,
      ['src/t1.js', 'src/t2.js', 'src/t3.js', `specs/active/${SLUG}/change.yaml`].sort(),
      'The one shared commit must cover every member\'s own changes',
    );

    // Every member's own workflow transition was correctly applied: `finishStep`
    // leaves the task's own step ('implementation') marked 'completed', with its
    // history recording where it transitioned to — 'review' only becomes the task's
    // own `current_step` once that next step is formally started (resolveWorkflowPosition,
    // step-runner.mjs), which is exactly what this test's settlement/handover step below
    // exercises.
    const changeAfterFinish = requireChange(SLUG, activeDir);
    for (const taskId of taskIds) {
      const task = requireTask(changeAfterFinish, taskId);
      assert.equal(task.workflow_progress.current_step, 'implementation', `${taskId} must still name 'implementation' as its own completed step`);
      assert.equal(task.workflow_progress.state, 'completed', `${taskId} must be marked 'completed' on 'implementation'`);
      const lastEntry = task.workflow_progress.history[task.workflow_progress.history.length - 1];
      assert.equal(lastEntry.step, 'implementation');
      assert.equal(lastEntry.attempt, 1);
      assert.equal(lastEntry.transitioned_to, 'review');
    }

    // Gap 6: T2's and T3's dependency-consumption on T1 is recorded with T1's real
    // release epoch, using each member's own pre-allocated consumptionSequence.
    const t2Consumption = loadDependencyConsumption(tmpRoot, SLUG, 't2', 'implementation', 1);
    assert.ok(t2Consumption, 'T2 must have a recorded dependency-consumption entry');
    assert.deepEqual(t2Consumption.dependencies, [
      { taskId: 't1', releaseEpoch: { step: 'implementation', attempt: 1 } },
    ]);
    assert.equal(t2Consumption.consumptionSequence, 1);

    const t3Consumption = loadDependencyConsumption(tmpRoot, SLUG, 't3', 'implementation', 1);
    assert.ok(t3Consumption, 'T3 must have a recorded dependency-consumption entry');
    assert.deepEqual(t3Consumption.dependencies, [
      { taskId: 't1', releaseEpoch: { step: 'implementation', attempt: 1 } },
    ]);
    assert.equal(t3Consumption.consumptionSequence, 1);

    const t1Consumption = loadDependencyConsumption(tmpRoot, SLUG, 't1', 'implementation', 1);
    assert.ok(t1Consumption, 'T1 must have its own (empty) dependency-consumption entry recorded');
    assert.deepEqual(t1Consumption.dependencies, []);

    // ── Step 5: Settlement / handover dispatch ─────────────────────────────────────
    // All three members resolve to the identical resulting contract (implementation ->
    // review, role reviewer, session fresh) — Gap 6's partitioning must therefore admit
    // exactly ONE new batch covering all three, never one session per member.
    const settleRes = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      changeSlug: SLUG,
      batchExecutionId,
      sessionId,
    });

    assert.equal(settleRes.settled, true);
    assert.equal(settleRes.status, 'completed');

    const settlement = loadBatchCompletionSettlement(tmpRoot, SLUG, batchExecutionId);
    assert.ok(settlement, 'Settlement record must exist');
    assert.equal(settlement.status, 'completed');
    assert.equal(settlement.stages.continuationDispatch.status, 'completed');

    const members = settlement.stages.continuationDispatch.members;
    const newBatchExecutionIds = new Set(taskIds.map((id) => members[id]?.batchExecutionId));
    assert.equal(newBatchExecutionIds.size, 1, 'All three members must share exactly one new handover batchExecutionId');
    assert.notEqual([...newBatchExecutionIds][0], batchExecutionId, 'The handover batch must be a NEW batch, not the original one');
    for (const taskId of taskIds) {
      assert.equal(members[taskId]?.status, 'completed');
      assert.deepEqual([...members[taskId]?.groupTaskIds].sort(), taskIds.slice().sort());
    }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
