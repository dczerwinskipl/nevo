// Verifies single-task execution converges on the same shared orchestration
// primitives the batch path uses, after tasks 01-03 (batch-execution-generalization):
// no separate queue/scheduler survives alongside it, and a single task's own Start/
// finish never fabricates batch-only machinery (groupReservation/BatchContext). New
// test file only — no production code changed; any divergence found here is a finding
// to report, resolved by whichever of tasks 01-03 actually owns the affected code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import '../specs/workflow/actions/index.mjs';
import { reconcileWorkflowPosition } from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import { getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';
import { getGroupReservation } from '../specs/workflow/queue/reservation.mjs';
import { loadBatchStartRecord } from '../specs/workflow/batch-start/record.mjs';
import { finishStep } from '../specs/workflow/finish-operation.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SPEC_ID = 'eeeeeeee-0001-4000-e000-000000000001';

// Structurally identical to the real .nevo-ai/workflows/standard.yaml (same steps,
// consumesDependencies/releasesDependencies/continuation/session/role) but with
// exitGates: [] — the same, already-documented reason task 07's own acceptance test
// uses this fixture (tools/tests/acceptance-initial-implementation-batch.test.mjs's own
// FINDING comment): finishStep's 'command'-type exit gates need a verification store
// this test (like the batch path) does not wire up; orthogonal to what AC4 verifies.
const STANDARD_WORKFLOW_YAML = `id: standard-v1
title: "Standard Specification Workflow"
type: standard
version: 1
entryStep: implementation
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    consumesDependencies: true
    purpose: "Perform the approved implementation work for the task within declared scope."
    expectedWork:
      summary: "Modify code within allowed_paths."
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
    purpose: "Independent quality review."
    expectedWork:
      summary: "Audit implementation."
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
        outcome: success
      - value: fail
        to: implementation
        continuation: auto
        invalidatesDependencyRelease: true
        execution:
          session: fresh
          role: refiner
`;

function setupTestRepo(slug) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-single-task-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'standard.yaml'), STANDARD_WORKFLOW_YAML, 'utf8');

  return { tmpRoot, activeDir, changeDir, taskDir };
}

function writeChangeYaml(changeDir, slug, taskYaml) {
  fs.writeFileSync(
    path.join(changeDir, 'change.yaml'),
    `id: ${slug}
spec_id: ${SPEC_ID}
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
${taskYaml}
`,
    'utf8',
  );
}

function commitAll(tmpRoot, message) {
  execFileSync('git', ['add', '-A'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-m', message], { cwd: tmpRoot });
}

function reservationFilePath(tmpRoot, slug) {
  return path.join(tmpRoot, '.nevo-ai-local', 'batch-reservations', `${slug}.json`);
}

test('AC1 & AC2: a single brand-new task Start resolves readiness and admits via a plain task-scoped workspace claim — no queue file, no groupReservation, no BatchContext fabricated', async () => {
  const slug = 'ac1-ac2';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug);
  try {
    writeChangeYaml(
      changeDir,
      slug,
      `  - id: t1
    order: 1
    title: Task 1
    status: approved
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    commitAll(tmpRoot, 'Initial commit');

    // A brand-new task's very first "manual Start" is the explicit CLI entry point
    // (`node tools/specs.mjs workflow step start`), not an automatic continuation —
    // continuation: auto only applies to a step already in progress transitioning to
    // the next one (AC3, below). This is the literal function `workflow step start`
    // invokes.
    await handleWorkflowStepStart(slug, 't1', { repoRoot: tmpRoot, activeDir });

    // AC1: no queue file / no batch-reservation record exists anywhere — the single-
    // task path never created one to begin with.
    assert.equal(fs.existsSync(reservationFilePath(tmpRoot, slug)), false, 'No batch-reservations file must exist');
    assert.equal(getGroupReservation(tmpRoot, slug, 'any-batch-id'), null);

    // AC2: no BatchContext / batch-start record was fabricated for this single task.
    assert.equal(loadBatchStartRecord(tmpRoot, slug, 'any-batch-id'), null);

    // The resulting workspace-writer claim is a plain single-task claim — observably
    // simpler than a batch's (scope.kind: 'task', not 'task-batch', no batchExecutionId).
    const claim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(claim, 'A workspace-writer claim must exist after admission');
    assert.equal(claim.scope?.kind, 'task');
    assert.equal(claim.scope?.taskId, 't1');
    assert.equal(claim.batchExecutionId, undefined, 'A single-task claim must carry no batchExecutionId at all');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC3: same-task auto-continuation (continuation: auto) admits the next step end to end with no queue involvement', async () => {
  const slug = 'ac3';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug);
  try {
    // t1 already finished 'implementation' (phase: completed, pointing at 'review') —
    // the exact shape finishStep itself leaves behind; this test starts from that
    // post-finish state directly to isolate the continuation step in isolation.
    writeChangeYaml(
      changeDir,
      slug,
      `  - id: t1
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
          transitioned_to: review
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    commitAll(tmpRoot, 'Initial commit');

    const change = requireChange(slug, activeDir);
    const task = requireTask(change, 't1');

    const result = await reconcileWorkflowPosition(change, task, { repoRoot: tmpRoot, activeDir });

    assert.equal(result.action, 'agent-admitted', 'continuation: auto must admit the next step (review) directly');
    assert.equal(result.nextStep, 'review');
    assert.equal(result.admission?.admitted, true);

    assert.equal(fs.existsSync(reservationFilePath(tmpRoot, slug)), false, 'No batch-reservations file must exist for a single-task continuation');
    assert.equal(getGroupReservation(tmpRoot, slug, 'any-batch-id'), null);

    const claim = getWorkspaceWriterClaim(tmpRoot);
    assert.equal(claim.scope?.kind, 'task');
    assert.equal(claim.batchExecutionId, undefined);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AC4: a single task\'s own finish reuses the identical finishStep function the batch path\'s per-member Stage 4 calls — not a second, independently maintained implementation', async () => {
  // Static identity check: batch-finish/operation.mjs imports `finishStep` from the
  // same module this test itself imports it from — by ES module semantics, that is
  // necessarily the same function object, not a parallel reimplementation.
  const batchFinishSource = fs.readFileSync(
    path.join(REPO_ROOT, 'tools', 'specs', 'workflow', 'batch-finish', 'operation.mjs'),
    'utf8',
  );
  assert.match(
    batchFinishSource,
    /import\s*\{\s*finishStep\s*\}\s*from\s*['"]\.\.\/finish-operation\.mjs['"]/,
    'batch-finish/operation.mjs must import finishStep from the single-task finish-operation.mjs module, not its own copy',
  );
  assert.equal(typeof finishStep, 'function');

  // Functional proof: calling finishStep directly for a single, non-batch task
  // completes the same way (verify-gates -> update-task -> commit -> push -> transition)
  // the batch Stage 4 loop relies on for every member.
  const slug = 'ac4';
  const { tmpRoot, activeDir, changeDir, taskDir } = setupTestRepo(slug);
  try {
    writeChangeYaml(
      changeDir,
      slug,
      `  - id: t1
    order: 1
    title: Task 1
    status: in-implementation
    allowed_paths:
      - src/t1.js
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`,
    );
    fs.writeFileSync(path.join(taskDir, 't1.md'), '# Task 1\n', 'utf8');
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 't1.js'), "export const t1 = 'implemented';\n", 'utf8');
    commitAll(tmpRoot, 'Initial commit');

    const change = requireChange(slug, activeDir);
    const task = requireTask(change, 't1');

    const result = await finishStep({
      change,
      task,
      definition: (await import('../specs/workflow/definitions/loader.mjs')).loadWorkflowDefinition('standard.yaml', { repoRoot: tmpRoot }),
      context: {
        repoRoot: tmpRoot,
        activeDir,
        sourceControl: { enabled: true, push: false },
      },
      inputs: { 'commit.title': 'feat: implement t1' },
      activeDir,
    });

    assert.equal(result.status, 'completed');
    assert.ok(result.commit, 'A real commit stage result must be present — the same stage batch members go through');

    const changeAfter = requireChange(slug, activeDir);
    const taskAfter = requireTask(changeAfter, 't1');
    assert.equal(taskAfter.workflow_progress.state, 'completed');
    const lastEntry = taskAfter.workflow_progress.history[taskAfter.workflow_progress.history.length - 1];
    assert.equal(lastEntry.transitioned_to, 'review');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
