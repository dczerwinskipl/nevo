// Real multi-step CLI/E2E proof (Task 13): comprehensive acceptance proof for the
// deterministic multi-step workflow foundation (D18-D37).
//
// Driven strictly through the public CLI handlers (handleWorkflowStepStart,
// handleWorkflowStepFinish, handleWorkflowVerifyHuman) against isolated fixture repositories.
// No test in this suite hand-edits change.yaml/task files to simulate progress, and no test
// calls internal gate/action APIs directly in place of a CLI call (AC8).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
  handleWorkflowVerifyHuman,
} from '../specs/workflow/cli.mjs';
import { loadOperationRecord, saveOperationRecord } from '../specs/workflow/finish-operation.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
import { getCurrentRevision, getCommitInfo } from '../lib/git.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { WorkflowDefinitionError } from '../specs/workflow/errors.mjs';
import { parseWorkflowDefinition } from '../specs/workflow/definitions/loader.mjs';
import { defaultActionRegistry } from '../specs/workflow/registry.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({
  prefix = 'nevo-multi-step-e2e',
  changeId = 'fixture-change',
  taskId = 'fixture-task',
  workflowId = 'fixture-workflow',
  workflowYaml,
  workflowVersion,
  extraChangeYaml = '',
} = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture MultiStep']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const versionLine = workflowVersion !== undefined ? `  version: ${workflowVersion}\n` : '';
  const changeYamlContent = [
    `id: ${changeId}`,
    `title: "${changeId}"`,
    `type: standard`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  definition: ${workflowId}`,
    versionLine,
    extraChangeYaml,
    `tasks:`,
    `  - id: ${taskId}`,
    `    order: 1`,
    `    file: tasks/01-task.md`,
    `    status: in-implementation`,
    '',
  ].filter(Boolean).join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent);

  writeFileSync(join(changeDir, 'tasks', '01-task.md'), [
    '---',
    `id: ${changeId}.${taskId}`,
    'status: draft',
    `change: ${changeId}`,
    'allowed_paths:',
    '  - src/**',
    'forbidden_paths: []',
    '---',
    `# Task: ${taskId}`,
    '',
  ].join('\n'));

  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${workflowId}.yaml`), workflowYaml);

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-multi-step-pkg',
    version: '1.0.0',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);

  return { root, remote, activeDir, changeId, taskId, workflowId };
}

function cleanup(fx) {
  if (fx?.root) rmSync(fx.root, { recursive: true, force: true });
  if (fx?.remote) rmSync(fx.remote, { recursive: true, force: true });
}

const RT = { silent: true };

// ── Primary 3-Step Fixture Definition (A -> B -> C -> verified) ───────────────
const PRIMARY_WORKFLOW_YAML = `id: primary-3step
title: "Primary Three Step Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: step-a
steps:
  step-a:
    status:
      active: authoring
      completed: authored
    purpose: "Author initial task changes"
    expectedWork:
      summary: "Write first slice of code"
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: step-b
  step-b:
    status:
      active: auditing
      completed: audited
    purpose: "Audit and refine changes"
    expectedWork:
      summary: "Audit code and test coverage"
    entryGates: []
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: step-c
  step-c:
    status:
      active: verifying
      completed: verified-signoff
    purpose: "Explicit human acceptance sign-off"
    expectedWork:
      summary: "Review by owner before terminal acceptance"
    entryGates: []
    exitGates:
      - type: human
        required: true
        id: owner-signoff
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Multi-step workflow end-to-end acceptance proof (AC1, AC2, AC3, AC4, AC5, AC6, AC10)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-multi-primary',
      changeId: 'primary-change',
      taskId: 'primary-task',
      workflowId: 'primary-3step',
      workflowYaml: PRIMARY_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  test('AC1: fresh workflow step start resolves entryStep A, persisting current_step: A, state: active (D37 case A)', async () => {
    const stepContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(stepContext.currentStep, 'step-a');
    assert.equal(stepContext.runtimeState, 'active');
    assert.equal(stepContext.semanticStatus, 'authoring');
    assert.equal(stepContext.nextStepGuidance?.onSuccess, 'step-b');
    assert.equal(stepContext.stepStatus, 'in-progress');
    assert.ok(stepContext.stepContract?.purpose.includes('Author initial task changes'));

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'step-a');
    assert.equal(task.workflow_progress.state, 'active');
    assert.deepEqual(task.workflow_progress.history, []);
  });

  test('AC2: repeated step start while active resumes step A without mutation (D37 case B)', async () => {
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();

    const resumedContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(resumedContext.currentStep, 'step-a');
    assert.equal(resumedContext.runtimeState, 'active');
    assert.equal(resumedContext.semanticStatus, 'authoring');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'step-a');
    assert.equal(task.workflow_progress.state, 'active');
    assert.deepEqual(task.workflow_progress.history, []);
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore);
  });

  let commitShaA;

  test('AC2, AC3: finishing step A persists current_step: A, state: completed, and transitioned_to: B in same commit', async () => {
    mkdirSync(join(fx.root, 'src'), { recursive: true });
    writeFileSync(join(fx.root, 'src', 'a.js'), 'export const stepA = "done";\n');

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish step A',
      include: '*',
    });

    assert.equal(result.status, 'completed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    // D37: current_step STAYS step-a, state is completed, history has transitioned_to: step-b
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'step-a');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 1);
    assert.equal(task.workflow_progress.history[0].step, 'step-a');
    assert.equal(task.workflow_progress.history[0].transitioned_to, 'step-b');

    commitShaA = getCurrentRevision(fx.root);
    const info = getCommitInfo(fx.root, commitShaA);
    assert.equal(info.subject, 'Finish step A');

    // Remote is up to date
    assert.equal(git(fx.remote, ['rev-parse', 'main']).trim(), commitShaA);
  });

  test('AC2: repeated step finish immediately after step A completion returns already-completed', async () => {
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();

    const repeated = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(repeated.status, 'already-completed');
    assert.equal(repeated.result.commit.sha, commitShaA);
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore);
  });

  test('AC2, AC10: only the NEXT workflow step start activates step B (current_step: B, state: active, no new history entry)', async () => {
    const stepContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(stepContext.currentStep, 'step-b');
    assert.equal(stepContext.runtimeState, 'active');
    assert.equal(stepContext.semanticStatus, 'auditing');
    assert.equal(stepContext.nextStepGuidance?.onSuccess, 'step-c');
    assert.ok(stepContext.stepContract?.purpose.includes('Audit and refine changes'));

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'step-b');
    assert.equal(task.workflow_progress.state, 'active');
    // History records completions only — activating step B adds no new history entry
    assert.equal(task.workflow_progress.history.length, 1);
  });

  let commitShaB;

  test('AC4, AC10: finishing step B produces its own distinct commit and moves progress to C (D23 step-aware operation identity)', async () => {
    writeFileSync(join(fx.root, 'src', 'b.js'), 'export const stepB = "audited";\n');

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish step B',
      include: '*',
    });

    assert.equal(result.status, 'completed');

    commitShaB = getCurrentRevision(fx.root);
    // D23: Step B produces its own distinct commit rather than returning A's cached completed result
    assert.notEqual(commitShaB, commitShaA);

    const info = getCommitInfo(fx.root, commitShaB);
    assert.equal(info.subject, 'Finish step B');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'step-b');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 2);
    assert.equal(task.workflow_progress.history[1].step, 'step-b');
    assert.equal(task.workflow_progress.history[1].transitioned_to, 'step-c');

    assert.equal(git(fx.remote, ['rev-parse', 'main']).trim(), commitShaB);
  });

  test('AC4, AC5: next step start activates step C with blocked HumanVerificationGate', async () => {
    const stepContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(stepContext.currentStep, 'step-c');
    assert.equal(stepContext.runtimeState, 'active');
    assert.equal(stepContext.semanticStatus, 'verifying');
    assert.equal(stepContext.nextStepGuidance?.onSuccess, 'verified');

    const humanGate = stepContext.finishContract.gates.find(g => g.gateType === 'human');
    assert.ok(humanGate, 'human gate must be present in finish contract');
    assert.equal(humanGate.status, 'blocked');
    assert.equal(humanGate.id, 'owner-signoff');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'step-c');
    assert.equal(task.workflow_progress.state, 'active');
    assert.equal(task.workflow_progress.history.length, 2);
  });

  test('AC5: step finish against C reports blocked and mutates nothing while unconfirmed', async () => {
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();

    const attempt = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Attempt finish C without verification',
      include: '*',
    });

    assert.equal(attempt.status, 'blocked');
    assert.equal(attempt.blockers.length, 1);
    assert.equal(attempt.blockers[0].gateType, 'human');
    assert.equal(attempt.blockers[0].id, 'owner-signoff');

    // Zero mutation: no commit, no state advance
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore);
    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'step-c');
    assert.equal(task.workflow_progress.state, 'active');
    assert.equal(task.workflow_progress.history.length, 2);
  });

  let commitShaC;

  test('AC5, AC6: verify-human --confirm satisfies the gate, and step finish completes C to terminal verified status atomically (D28, D37)', async () => {
    const confirmation = handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      ...RT,
      confirm: true,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });
    assert.equal(confirmation.confirmed, true);

    writeFileSync(join(fx.root, 'src', 'c.js'), 'export const stepC = "signed-off";\n');

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finalize step C',
      include: '*',
    });

    assert.equal(result.status, 'completed');

    commitShaC = getCurrentRevision(fx.root);
    assert.notEqual(commitShaC, commitShaB);

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    // D28 & D37 terminal precedence:
    // 1. task.status written to canonical terminal status 'verified'
    // 2. workflow_progress.state = 'completed'
    // 3. current_step is left populated naming 'step-c' (NEVER cleared or nulled)
    // 4. history contains 3 entries with final entry transitioned_to: 'verified'
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.current_step, 'step-c');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 3);
    assert.equal(task.workflow_progress.history[2].step, 'step-c');
    assert.equal(task.workflow_progress.history[2].transitioned_to, 'verified');

    assert.equal(git(fx.remote, ['rev-parse', 'main']).trim(), commitShaC);
  });

  test('AC6: subsequent workflow step start reports workflow complete, never re-resolves entryStep, and never consults task.status (D37)', async () => {
    const stepContext = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(stepContext.currentStep, null);
    assert.equal(stepContext.stepStatus, 'complete');
    assert.equal(stepContext.runtimeState, 'completed');
    assert.ok(stepContext.instructions.includes('Workflow complete'));
    assert.equal(stepContext.nextStepGuidance, null);

    // Ensure change.yaml was not reverted to entryStep
    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.current_step, 'step-c');
    assert.equal(task.workflow_progress.state, 'completed');
  });

  test('AC6: repeated finish after terminal completion returns already-completed', async () => {
    const repeated = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(repeated.status, 'already-completed');
    assert.equal(repeated.result.commit.sha, commitShaC);
  });
});

// ── Gate Isolation Between Steps (AC3) ─────────────────────────────────────────
const GATE_ISOLATION_WORKFLOW_YAML = `id: gate-isolation-workflow
title: "Gate Isolation Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: step-1
steps:
  step-1:
    status:
      active: working-1
      completed: done-1
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: step-2
  step-2:
    status:
      active: working-2
      completed: done-2
    exitGates:
      - type: command
        command: "node -e \\"process.exit(1)\\""
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Gate isolation between workflow steps (AC3)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-gate-iso',
      changeId: 'iso-change',
      taskId: 'iso-task',
      workflowId: 'gate-isolation-workflow',
      workflowYaml: GATE_ISOLATION_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  test('a failing command gate configured on step 2 does not affect finishing step 1', async () => {
    await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    writeFileSync(join(fx.root, 'step1.txt'), 'step 1 work\n');

    // Step 1 exit gate is `action: test` (passes). Step 2 has `process.exit(1)` (failing gate).
    // Step 1 finish must succeed cleanly regardless of Step 2's gate.
    const result1 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish step 1',
      include: '*',
    });

    assert.equal(result1.status, 'completed');
    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'step-1');
    assert.equal(task.workflow_progress.state, 'completed');
  });

  test('step 2 is blocked by its own failing gate once step 2 is activated', async () => {
    await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    writeFileSync(join(fx.root, 'step2.txt'), 'step 2 work\n');

    // Step 2 exit gate fails
    const result2 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Attempt finish step 2',
      include: '*',
    });

    assert.equal(result2.status, 'blocked');
    assert.equal(result2.blockers.length, 1);
    assert.equal(result2.blockers[0].gateType, 'command');
    assert.equal(result2.blockers[0].status, 'failed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'step-2');
    assert.equal(task.workflow_progress.state, 'active');
  });
});

// ── Retry/Resume Semantics Per Individual Step (AC7) ──────────────────────────
const RETRY_RESUME_WORKFLOW_YAML = `id: retry-resume-workflow
title: "Retry Resume Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: step-first
steps:
  step-first:
    status:
      active: first-active
      completed: first-done
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: step-second
  step-second:
    status:
      active: second-active
      completed: second-done
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Step-level retry/resume semantics and crash reconciliation across steps (AC7)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-retry-step',
      changeId: 'retry-change',
      taskId: 'retry-task',
      workflowId: 'retry-resume-workflow',
      workflowYaml: RETRY_RESUME_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  let commitShaFirst;

  test('finishing step-first completes and creates commit without interference', async () => {
    await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    writeFileSync(join(fx.root, 'first.txt'), 'first work\n');

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish step first',
      include: '*',
    });

    assert.equal(result.status, 'completed');
    commitShaFirst = getCurrentRevision(fx.root);

    const recordA = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'step-first');
    assert.ok(recordA);
    assert.equal(recordA.status, 'completed');
  });

  test('an interruption crafted during step-second finalize does not affect step-first progress, and resuming step-second completes cleanly (AC7)', async () => {
    await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });

    // In-flight operation record for step-second: inputs resolved, commit pending
    saveOperationRecord(fx.root, {
      operationId: 'crafted-step-second-op',
      change: fx.changeId,
      task: fx.taskId,
      step: 'step-second',
      status: 'running',
      resolvedInputs: {
        'commit.title': 'Finish step second resumed',
        'commit.message': '',
        include: ['*'],
        exclude: [],
      },
      operations: [
        { id: 'verify-gates', status: 'pending' },
        { id: 'update-task', status: 'pending' },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    // Attempting to supply conflicting title fails closed
    await assert.rejects(
      () => handleWorkflowStepFinish(fx.changeId, fx.taskId, {
        ...RT,
        activeDir: fx.activeDir,
        repoRoot: fx.root,
        title: 'Different conflicting title',
      }),
      /Conflicting finish inputs supplied/
    );

    // Step-first operation record and commit remain completely untouched
    const recordA = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'step-first');
    assert.equal(recordA.status, 'completed');
    assert.equal(recordA.step, 'step-first');

    // Resuming with no inputs reads persisted resolvedInputs and completes step-second
    writeFileSync(join(fx.root, 'second.txt'), 'second work\n');

    const resumeResult = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(resumeResult.status, 'completed');

    const commitShaSecond = getCurrentRevision(fx.root);
    assert.notEqual(commitShaSecond, commitShaFirst);

    const info = getCommitInfo(fx.root, commitShaSecond);
    assert.equal(info.subject, 'Finish step second resumed');

    const recordB = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'step-second');
    assert.equal(recordB.status, 'completed');
    assert.equal(recordB.step, 'step-second');

    // Step-first remains unchanged
    const recordAAfter = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'step-first');
    assert.equal(recordAAfter.status, 'completed');
  });
});

// ── Step- and Gate-Scoped Human Verification (AC11, AC12) ─────────────────────
const MULTI_HUMAN_WORKFLOW_YAML = `id: multi-human-workflow
title: "Multi Human Verification Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: review-step
steps:
  review-step:
    status:
      active: in-review
      completed: reviewed
    exitGates:
      - type: human
        required: true
        id: review-gate
    finalize:
      - id: commit-and-push
    transitions:
      - to: approval-step
  approval-step:
    status:
      active: in-approval
      completed: approved
    exitGates:
      - type: human
        required: true
        id: approval-gate
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Step- and gate-scoped human verification sign-off identity (AC11, D24)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-scoped-human',
      changeId: 'human-scope-change',
      taskId: 'human-scope-task',
      workflowId: 'multi-human-workflow',
      workflowYaml: MULTI_HUMAN_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  test('confirming a human gate on review-step does NOT satisfy the human gate on approval-step', async () => {
    // 1. Activate review-step
    await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });

    // Review step is blocked before confirmation
    const blockedReview = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish review',
      include: '*',
    });
    assert.equal(blockedReview.status, 'blocked');
    assert.equal(blockedReview.blockers[0].id, 'review-gate');

    // Confirm review-step gate
    handleWorkflowVerifyHuman(fx.changeId, fx.taskId, { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });

    writeFileSync(join(fx.root, 'review.txt'), 'reviewed\n');
    const finishReview = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish review',
      include: '*',
    });
    assert.equal(finishReview.status, 'completed');

    // 2. Activate approval-step
    await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });

    // Attempting to finish approval-step must still be BLOCKED: review-step's confirmation does NOT satisfy approval-step
    writeFileSync(join(fx.root, 'approval.txt'), 'approved\n');
    const blockedApproval = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish approval',
      include: '*',
    });

    assert.equal(blockedApproval.status, 'blocked');
    assert.equal(blockedApproval.blockers[0].id, 'approval-gate');

    // Now confirm approval-step gate
    handleWorkflowVerifyHuman(fx.changeId, fx.taskId, { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });

    const finishApproval = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish approval',
      include: '*',
    });
    assert.equal(finishApproval.status, 'completed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'verified');
  });
});

// ── Multi-Human Gate Disambiguation Within One Step (AC12, D30) ───────────────
const DUAL_HUMAN_WORKFLOW_YAML = `id: dual-human-workflow
title: "Dual Human Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: signoff
steps:
  signoff:
    status:
      active: signing-off
      completed: signed-off
    exitGates:
      - type: human
        required: true
        id: arch-signoff
      - type: human
        required: true
        id: security-signoff
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Multiple human gates on the same step requiring explicit --gate disambiguation (AC12, D30)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-dual-human',
      changeId: 'dual-human-change',
      taskId: 'dual-human-task',
      workflowId: 'dual-human-workflow',
      workflowYaml: DUAL_HUMAN_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  test('requires explicit --gate <id> when multiple human gates exist, and each must be confirmed independently', async () => {
    await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });

    // Calling verify-human without --gate fails closed
    assert.throws(
      () => handleWorkflowVerifyHuman(fx.changeId, fx.taskId, { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root }),
      (err) => err instanceof CliError && err.message.includes('specify --gate <id> to disambiguate')
    );

    // Calling with non-matching gate fails closed
    assert.throws(
      () => handleWorkflowVerifyHuman(fx.changeId, fx.taskId, { ...RT, confirm: true, gate: 'unknown-gate', activeDir: fx.activeDir, repoRoot: fx.root }),
      (err) => err instanceof CliError && err.message.includes('does not match any human-verification gate')
    );

    // Confirm only arch-signoff
    const conf1 = handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      ...RT,
      confirm: true,
      gate: 'arch-signoff',
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });
    assert.equal(conf1.confirmed, true);

    writeFileSync(join(fx.root, 'signoff.txt'), 'signoff content\n');

    // Finish attempt is STILL blocked by security-signoff
    const stillBlocked = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Attempt finish',
      include: '*',
    });
    assert.equal(stillBlocked.status, 'blocked');
    assert.equal(stillBlocked.blockers.length, 1);
    assert.equal(stillBlocked.blockers[0].id, 'security-signoff');

    // Confirm security-signoff
    const conf2 = handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      ...RT,
      confirm: true,
      gate: 'security-signoff',
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });
    assert.equal(conf2.confirmed, true);

    // Now finish succeeds
    const finish = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Finish signoff',
      include: '*',
    });
    assert.equal(finish.status, 'completed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'verified');
  });
});

// ── Safe Identifier Constraints at Schema Time (AC12, D30) ───────────────────
describe('Safe, unique identifier schema constraints (AC12, D30)', () => {
  const actions = defaultActionRegistry.list();

  test('step name with invalid characters fails schema validation', () => {
    const invalidYaml = `id: bad-step-id
title: "Bad Step ID"
type: standard
version: 1
steps:
  "invalid.step.name":
    status:
      active: active-status
      completed: completed-status
    transitions:
      - to: verified
`;
    assert.throws(
      () => parseWorkflowDefinition(invalidYaml, { knownActions: actions }),
      (err) => err instanceof WorkflowDefinitionError && err.message.includes('must be a non-empty identifier matching')
    );
  });

  test('multiple human gates with duplicate ids fail schema validation', () => {
    const duplicateHumanYaml = `id: duplicate-human
title: "Duplicate Human"
type: standard
version: 1
steps:
  step-one:
    status:
      active: active-status
      completed: completed-status
    exitGates:
      - type: human
        id: shared-id
      - type: human
        id: shared-id
    transitions:
      - to: verified
`;
    assert.throws(
      () => parseWorkflowDefinition(duplicateHumanYaml, { knownActions: actions }),
      (err) => err instanceof WorkflowDefinitionError && err.message.includes('duplicate human-verification gate id')
    );
  });

  test('multiple human gates missing explicit ids fail schema validation', () => {
    const missingHumanYaml = `id: missing-human-ids
title: "Missing Human IDs"
type: standard
version: 1
steps:
  step-one:
    status:
      active: active-status
      completed: completed-status
    exitGates:
      - type: human
      - type: human
    transitions:
      - to: verified
`;
    assert.throws(
      () => parseWorkflowDefinition(missingHumanYaml, { knownActions: actions }),
      (err) => err instanceof WorkflowDefinitionError && err.message.includes('each must have an explicit, unique \'id\'')
    );
  });
});

// ── Version Compatibility Fail-Closed (AC13, D26) ─────────────────────────────
describe('Version compatibility check fails closed via CLI handlers (AC13, D26)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-version-mismatch',
      changeId: 'ver-change',
      taskId: 'ver-task',
      workflowId: 'primary-3step',
      workflowYaml: PRIMARY_WORKFLOW_YAML, // definition version is 1
      workflowVersion: 2, // change manifest claims version 2
    });
  });
  after(() => cleanup(fx));

  test('workflow step start rejects version mismatch with WorkflowDefinitionError naming both versions', async () => {
    await assert.rejects(
      () => handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root }),
      (err) =>
        err instanceof WorkflowDefinitionError &&
        err.message.includes('Workflow version mismatch') &&
        err.message.includes('effective workflow version 2') &&
        err.message.includes('is version 1')
    );
  });

  test('workflow step finish rejects version mismatch with WorkflowDefinitionError naming both versions', async () => {
    await assert.rejects(
      () => handleWorkflowStepFinish(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root }),
      (err) =>
        err instanceof WorkflowDefinitionError &&
        err.message.includes('Workflow version mismatch') &&
        err.message.includes('effective workflow version 2') &&
        err.message.includes('is version 1')
    );
  });
});

// ── Second Differently-Shaped Fixture (AC9) ───────────────────────────────────
// Proves that multi-step sequencing is generic and driven entirely by the definition,
// with 4 distinct steps and completely different names/semantic statuses.
const FOUR_STEP_WORKFLOW_YAML = `id: custom-4step-pipeline
title: "Four Step Pipeline"
type: standard
version: 1
sourceControl:
  enabled: true
  push: true
entryStep: intake
steps:
  intake:
    status:
      active: ingesting
      completed: ingested
    purpose: "Ingest task requirements"
    expectedWork:
      summary: "Prepare initial task state"
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: analysis
  analysis:
    status:
      active: analyzing
      completed: analyzed
    purpose: "Analyze architectural impacts"
    expectedWork:
      summary: "Document design analysis"
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: execution
  execution:
    status:
      active: executing
      completed: executed
    purpose: "Execute code modifications"
    expectedWork:
      summary: "Write production code changes"
    exitGates:
      - type: command
        action: test
    finalize:
      - id: commit-and-push
    transitions:
      - to: signoff
  signoff:
    status:
      active: validating
      completed: validated
    purpose: "Final human acceptance"
    expectedWork:
      summary: "Explicit operator confirmation"
    exitGates:
      - type: human
        required: true
        id: operator-signoff
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
`;

describe('Second, differently-shaped 4-step workflow through identical CLI path (AC9)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo({
      prefix: 'nevo-4step-pipeline',
      changeId: 'pipeline-change',
      taskId: 'pipeline-task',
      workflowId: 'custom-4step-pipeline',
      workflowYaml: FOUR_STEP_WORKFLOW_YAML,
    });
  });
  after(() => cleanup(fx));

  test('progresses through intake -> analysis -> execution -> signoff -> verified using only CLI handlers', async () => {
    // ── Phase 1: intake ──────────────────────────────────────────────────────
    const ctx1 = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(ctx1.currentStep, 'intake');
    assert.equal(ctx1.runtimeState, 'active');
    assert.equal(ctx1.semanticStatus, 'ingesting');
    assert.equal(ctx1.nextStepGuidance?.onSuccess, 'analysis');

    writeFileSync(join(fx.root, 'intake.json'), '{"ingested": true}\n');
    const fin1 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Complete intake',
      include: '*',
    });
    assert.equal(fin1.status, 'completed');

    // ── Phase 2: analysis ────────────────────────────────────────────────────
    const ctx2 = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(ctx2.currentStep, 'analysis');
    assert.equal(ctx2.runtimeState, 'active');
    assert.equal(ctx2.semanticStatus, 'analyzing');
    assert.equal(ctx2.nextStepGuidance?.onSuccess, 'execution');

    writeFileSync(join(fx.root, 'analysis.md'), '# Analysis\n');
    const fin2 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Complete analysis',
      include: '*',
    });
    assert.equal(fin2.status, 'completed');

    // ── Phase 3: execution ───────────────────────────────────────────────────
    const ctx3 = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(ctx3.currentStep, 'execution');
    assert.equal(ctx3.runtimeState, 'active');
    assert.equal(ctx3.semanticStatus, 'executing');
    assert.equal(ctx3.nextStepGuidance?.onSuccess, 'signoff');

    writeFileSync(join(fx.root, 'execution.js'), 'export const executed = true;\n');
    const fin3 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Complete execution',
      include: '*',
    });
    assert.equal(fin3.status, 'completed');

    // ── Phase 4: signoff ─────────────────────────────────────────────────────
    const ctx4 = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(ctx4.currentStep, 'signoff');
    assert.equal(ctx4.runtimeState, 'active');
    assert.equal(ctx4.semanticStatus, 'validating');
    assert.equal(ctx4.nextStepGuidance?.onSuccess, 'verified');

    // Human verification required
    const signoffBlocked = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Complete signoff without human',
      include: '*',
    });
    assert.equal(signoffBlocked.status, 'blocked');

    handleWorkflowVerifyHuman(fx.changeId, fx.taskId, { ...RT, confirm: true, activeDir: fx.activeDir, repoRoot: fx.root });

    writeFileSync(join(fx.root, 'signoff.txt'), 'signoff verified\n');
    const fin4 = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      title: 'Complete signoff',
      include: '*',
    });
    assert.equal(fin4.status, 'completed');

    // ── Terminal Verification ────────────────────────────────────────────────
    const finalTask = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(finalTask.status, 'verified');
    assert.equal(finalTask.workflow_progress.current_step, 'signoff');
    assert.equal(finalTask.workflow_progress.state, 'completed');
    assert.equal(finalTask.workflow_progress.history.length, 4);
    assert.deepEqual(
      finalTask.workflow_progress.history.map(h => ({ step: h.step, target: h.transitioned_to })),
      [
        { step: 'intake', target: 'analysis' },
        { step: 'analysis', target: 'execution' },
        { step: 'execution', target: 'signoff' },
        { step: 'signoff', target: 'verified' },
      ]
    );

    // Final start confirms completion
    const finalCtx = await handleWorkflowStepStart(fx.changeId, fx.taskId, { ...RT, activeDir: fx.activeDir, repoRoot: fx.root });
    assert.equal(finalCtx.currentStep, null);
    assert.equal(finalCtx.stepStatus, 'complete');
    assert.equal(finalCtx.runtimeState, 'completed');
  });
});
