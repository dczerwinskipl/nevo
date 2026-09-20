import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  verificationFilePath,
  FileHumanVerificationStore,
} from '../specs/workflow/human-verification-store.mjs';
import { HumanVerificationGate } from '../specs/workflow/gates/human-gate.mjs';
import { handleWorkflowVerifyHuman } from '../specs/workflow/cli.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';
import '../specs/workflow/actions/index.mjs';

function makeFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { base, repo: base };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('FileHumanVerificationStore and attempt scoping (AC6)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-human-verif-test'); });
  after(() => cleanupFixture(fx));

  test('constructs path scoped to attempt directory', () => {
    const p1 = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 1, 'my-gate');
    const expected1 = join(fx.repo, '.nevo-ai-local', 'human-verifications', 'demo-change', 'demo-task', 'review', 'attempt-1', 'my-gate.json');
    assert.equal(p1, expected1);

    const p2 = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 2, 'my-gate');
    const expected2 = join(fx.repo, '.nevo-ai-local', 'human-verifications', 'demo-change', 'demo-task', 'review', 'attempt-2', 'my-gate.json');
    assert.equal(p2, expected2);
  });

  test('signoff confirmed on attempt 1 does NOT satisfy query on attempt 2', () => {
    const store = new FileHumanVerificationStore({
      repoRoot: fx.repo,
      change: 'demo-change',
      task: 'demo-task',
    });

    // Confirm signoff on attempt 1
    const signoff = store.confirm({
      scope: 'task',
      targetId: 'demo-task',
      role: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });

    assert.equal(signoff.confirmed, true);
    assert.equal(signoff.attempt, 1);

    const filePath = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 1, 'human-review');
    assert.ok(existsSync(filePath), 'signoff file must exist in attempt-1 directory');

    // Query on attempt 1 finds the signoff
    const found1 = store.getSignoff({
      scope: 'task',
      targetId: 'demo-task',
      requiredRole: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });
    assert.ok(found1);
    assert.equal(found1.confirmed, true);
    assert.equal(found1.attempt, 1);

    // Query on attempt 2 does NOT find the signoff
    const found2 = store.getSignoff({
      scope: 'task',
      targetId: 'demo-task',
      requiredRole: 'owner',
      stepId: 'review',
      attempt: 2,
      gateId: 'human-review',
    });
    assert.equal(found2, null, 'attempt 2 query must return null when only attempt 1 is signed off');
  });

  test('HumanVerificationGate verification enforces attempt scoping via context.attempt on a single shared store/gate (corrective revision)', async () => {
    // A single store/gate pair, constructed with no attempt bound at all — attempt
    // identity must flow entirely through the per-call `context.attempt` the gate query
    // contract carries, not through hidden reader-instance state (which would trivially
    // "pass" this test even if the gate never actually threaded attempt through at all).
    const store = new FileHumanVerificationStore({
      repoRoot: fx.repo,
      change: 'demo-change',
      task: 'demo-task',
    });
    const gate = new HumanVerificationGate({ verificationReader: store });

    // Confirm on attempt 1 only
    store.confirm({
      scope: 'task',
      targetId: 'demo-task',
      role: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });

    const baseContext = {
      change: { id: 'demo-change' },
      task: { id: 'demo-task' },
      step: { id: 'review' },
      repoRoot: fx.repo,
    };

    const res1 = await gate.verify({ id: 'human-review' }, { ...baseContext, attempt: 1 });
    assert.equal(res1.passed, true);

    const res2 = await gate.verify({ id: 'human-review' }, { ...baseContext, attempt: 2 });
    assert.equal(res2.passed, false);
    assert.equal(res2.status, 'blocked');
  });
});

const STANDARD_V1_YAML = `id: standard-v1
title: "Standard Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: in-implementation
      completed: implemented
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    status:
      active: in-review
      completed: reviewed
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: human-verification
      - value: fail
        to: implementation
  human-verification:
    executor: human
    status:
      active: awaiting-human-verification
      completed: completed
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
`;

describe('workflow verify-human direct decisions (AC5)', () => {
  let fx;

  before(() => {
    const base = mkdtempSync(join(tmpdir(), 'nevo-human-decision-'));
    const repo = join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'user.email', 'test@example.com']);

    const workflowsDir = join(repo, '.nevo-ai', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, 'standard-v1.yaml'), STANDARD_V1_YAML);

    const activeDir = join(repo, 'specs', 'active');
    const changeDir = join(activeDir, 'demo-change');
    const tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
    writeFileSync(join(repo, 'root.txt'), 'initial\n');
    git(['add', '-A']);
    git(['commit', '-m', 'initial commit']);

    fx = { base, repo, activeDir, changeDir, tasksDir };
  });

  after(() => cleanupFixture(fx));

  test('transitions task directly to verified on --approve', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task
    status: awaiting-human-verification
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '01-demo-task.md'), '---\nid: demo-task\nstatus: awaiting-human-verification\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task setup']);

    const result = await handleWorkflowVerifyHuman('demo-change', 'demo-task', {
      approve: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(result.status, 'completed');
    const task = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task');
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.state, 'completed');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'human-verification');
    assert.equal(lastHistory.result, 'pass');
    assert.equal(lastHistory.transitioned_to, 'verified');
  });

  test('transitions task directly to implementation attempt 2 with feedback on --request-changes', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-reject
    status: awaiting-human-verification
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: active
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '02-demo-task-reject.md'), '---\nid: demo-task-reject\nstatus: awaiting-human-verification\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task reset']);

    const result = await handleWorkflowVerifyHuman('demo-change', 'demo-task-reject', {
      requestChanges: true,
      feedback: 'Please address retry test edge case',
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(result.status, 'completed');
    const task = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task-reject');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.current_step, 'human-verification');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'human-verification');
    assert.equal(lastHistory.result, 'fail');
    assert.equal(lastHistory.feedback, 'Please address retry test edge case');
    assert.equal(lastHistory.transitioned_to, 'implementation');
  });

  test('rejects --request-changes without --feedback', async () => {
    await assert.rejects(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task-reject', {
        requestChanges: true,
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
        silent: true,
      }),
      (err) => err instanceof CliError && /--feedback/.test(err.message)
    );
  });

  test('rejects specifying both --approve and --request-changes', async () => {
    await assert.rejects(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task-reject', {
        approve: true,
        requestChanges: true,
        feedback: 'conflict',
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
        silent: true,
      }),
      (err) => err instanceof CliError && /both/.test(err.message)
    );
  });

  test('Finding 1: review completed (phase=completed, nextStep=human-verification) -> verify-human --approve activates and finishes to verified', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-auto-activate-approve
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '03-auto-activate-approve.md'), '---\nid: demo-task-auto-activate-approve\nstatus: in-implementation\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task setup auto-activate approve']);

    const result = await handleWorkflowVerifyHuman('demo-change', 'demo-task-auto-activate-approve', {
      approve: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(result.status, 'completed');
    const task = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task-auto-activate-approve');
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.current_step, 'human-verification');
    assert.equal(task.workflow_progress.state, 'completed');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'human-verification');
    assert.equal(lastHistory.result, 'pass');
    assert.equal(lastHistory.transitioned_to, 'verified');
  });

  test('Finding 1: review completed (phase=completed, nextStep=human-verification) -> verify-human --request-changes activates and finishes to implementation attempt 2', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-auto-activate-reject
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          completed_at: "2026-01-01T00:00:00.000Z"
          transitioned_to: review
        - step: review
          attempt: 1
          completed_at: "2026-01-01T01:00:00.000Z"
          result: pass
          transitioned_to: human-verification
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '04-auto-activate-reject.md'), '---\nid: demo-task-auto-activate-reject\nstatus: in-implementation\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task setup auto-activate reject']);

    const result = await handleWorkflowVerifyHuman('demo-change', 'demo-task-auto-activate-reject', {
      requestChanges: true,
      feedback: 'Please fix performance regression in algorithm',
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(result.status, 'completed');
    const task = requireTask(requireChange('demo-change', fx.activeDir), 'demo-task-auto-activate-reject');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.current_step, 'human-verification');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'human-verification');
    assert.equal(lastHistory.result, 'fail');
    assert.equal(lastHistory.feedback, 'Please fix performance regression in algorithm');
    assert.equal(lastHistory.transitioned_to, 'implementation');
  });

  test('Finding 2: rejects human decision when active step is review (INVALID_HUMAN_DECISION_STEP)', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-review-active
    status: in-implementation
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '05-review-active.md'), '---\nid: demo-task-review-active\nstatus: in-implementation\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task setup review active']);

    await assert.rejects(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task-review-active', {
        approve: true,
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
        silent: true,
      }),
      (err) => err instanceof WorkflowError && (err.code === 'INVALID_HUMAN_DECISION_STEP' || err.code === 'WORKFLOW_STEP_EXECUTOR_MISMATCH')
    );
  });

  test('Finding 2: rejects human decision when active step is implementation (INVALID_HUMAN_DECISION_STEP)', async () => {
    const changeYaml = `id: demo-change
title: "Demo Change"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: demo-task-impl-active
    status: in-implementation
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(join(fx.changeDir, 'change.yaml'), changeYaml);
    writeFileSync(join(fx.tasksDir, '06-impl-active.md'), '---\nid: demo-task-impl-active\nstatus: in-implementation\n---\n# Task\n');

    execFileSync('git', ['-C', fx.repo, 'add', '-A']);
    execFileSync('git', ['-C', fx.repo, 'commit', '-m', 'task setup impl active']);

    await assert.rejects(
      () => handleWorkflowVerifyHuman('demo-change', 'demo-task-impl-active', {
        requestChanges: true,
        feedback: 'Cannot request changes while implementing',
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
        silent: true,
      }),
      (err) => err instanceof WorkflowError && (err.code === 'INVALID_HUMAN_DECISION_STEP' || err.code === 'WORKFLOW_STEP_EXECUTOR_MISMATCH')
    );
  });
});
