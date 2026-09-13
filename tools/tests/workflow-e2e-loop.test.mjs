// Production standard workflow review loop and multi-attempt end-to-end integration proof (Task 05).
// Drives an isolated repository through the full lifecycle:
// implementation (attempt 1) -> review (attempt 1, fail) -> implementation (attempt 2)
// -> review (attempt 2, pass) -> human-verification (attempt 1) -> terminal verified.
// Strictly driven through public CLI handlers (handleWorkflowStepStart, handleWorkflowStepFinish,
// handleWorkflowVerifyHuman) using generic --input / --input-file JSON transport.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  handleWorkflowStepStart,
  handleWorkflowStepFinish,
  handleWorkflowVerifyHuman,
} from '../specs/workflow/cli.mjs';
import { loadOperationRecord } from '../specs/workflow/finish-operation.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
import { getCurrentRevision, getCommitInfo } from '../lib/git.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({
  prefix = 'nevo-e2e-loop',
  changeId = 'loop-change',
  taskId = 'loop-task',
} = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const root = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(root, ['init', '-q', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture Loop']);
  git(root, ['remote', 'add', 'origin', remote]);

  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYamlContent = [
    `id: ${changeId}`,
    `title: "${changeId}"`,
    `type: standard`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  definition: standard-v1`,
    `tasks:`,
    `  - id: ${taskId}`,
    `    order: 1`,
    `    file: tasks/01-task.md`,
    `    status: in-implementation`,
    '',
  ].join('\n');

  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent);

  writeFileSync(join(changeDir, 'tasks', '01-task.md'), [
    '---',
    `id: ${changeId}.${taskId}`,
    'status: draft',
    `change: ${changeId}`,
    'allowed_paths:',
    '  - src/**',
    '  - docs/**',
    '  - verified.txt',
    'forbidden_paths: []',
    '---',
    `# Task: ${taskId}`,
    '',
  ].join('\n'));

  // Load repository standard workflow definition — it declares sourceControl itself now.
  const standardWorkflowYaml = readFileSync(join(process.cwd(), '.nevo-ai', 'workflows', 'standard.yaml'), 'utf8');
  const workflowsDir = join(root, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'standard.yaml'), standardWorkflowYaml);
  writeFileSync(join(workflowsDir, 'standard-v1.yaml'), standardWorkflowYaml);

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'fixture-loop-pkg',
    version: '1.0.0',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));

  writeFileSync(join(root, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(root, 'root.txt'), 'root\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);

  return { root, remote, activeDir, changeId, taskId };
}

function cleanup(fx) {
  if (fx?.root) rmSync(fx.root, { recursive: true, force: true });
  if (fx?.remote) rmSync(fx.remote, { recursive: true, force: true });
}

const RT = { silent: true };

describe('Production standard workflow review loop and multi-attempt E2E proof (AC1, AC3, AC4)', () => {
  let fx;
  before(() => {
    fx = makeFixtureRepo();
  });
  after(() => cleanup(fx));

  test('Step 1: start implementation attempt 1', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'implementation');
    assert.equal(context.attempt, 1);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'implementing');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.current_attempt, 1);
    assert.equal(task.workflow_progress.state, 'active');
    assert.deepEqual(task.workflow_progress.history, []);
  });

  test('Step 2: finish implementation attempt 1 -> transitions to review', async () => {
    mkdirSync(join(fx.root, 'src'), { recursive: true });
    writeFileSync(join(fx.root, 'src', 'index.js'), 'export const version = 1;\n');

    const finishPayload = {
      'commit.title': 'implement task',
      include: ['*'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'implementation', attempt: 1 },
      to: { kind: 'step', step: 'review' },
    });

    const opRecord = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'implementation', 1);
    assert.equal(opRecord.status, 'completed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.current_attempt, 1);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 1);
    assert.equal(task.workflow_progress.history[0].step, 'implementation');
    assert.equal(task.workflow_progress.history[0].attempt, 1);
    assert.equal(task.workflow_progress.history[0].transitioned_to, 'review');
  });

  test('Step 3: start review attempt 1', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'review');
    assert.equal(context.attempt, 1);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'reviewing');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.current_attempt, 1);
    assert.equal(task.workflow_progress.state, 'active');
  });

  test('Step 4: finish review attempt 1 with result "fail" -> transitions back to implementation', async () => {
    mkdirSync(join(fx.root, 'docs'), { recursive: true });
    writeFileSync(join(fx.root, 'docs', 'audit-1.md'), 'Audit 1: Gaps found in version 1\n');

    const finishPayload = {
      result: 'fail',
      'commit.title': 'review: fail',
      include: ['*'],
      artifacts: ['docs/audit-1.md'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'review', attempt: 1 },
      result: 'fail',
      to: { kind: 'step', step: 'implementation' },
    });

    const opRecord = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'review', 1);
    assert.equal(opRecord.status, 'completed');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.current_attempt, 1);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 2);
    assert.equal(task.workflow_progress.history[1].step, 'review');
    assert.equal(task.workflow_progress.history[1].attempt, 1);
    assert.equal(task.workflow_progress.history[1].result, 'fail');
    assert.deepEqual(task.workflow_progress.history[1].artifacts, ['docs/audit-1.md']);
    assert.equal(task.workflow_progress.history[1].transitioned_to, 'implementation');
  });

  test('Step 5: start implementation attempt 2 (loop cycle)', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'implementation');
    assert.equal(context.attempt, 2);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'implementing');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.current_attempt, 2);
    assert.equal(task.workflow_progress.state, 'active');
  });

  test('Step 6: finish implementation attempt 2 -> transitions to review', async () => {
    writeFileSync(join(fx.root, 'src', 'index.js'), 'export const version = 2;\n');

    const finishPayload = {
      'commit.title': 'fix implementation',
      include: ['*'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'implementation', attempt: 2 },
      to: { kind: 'step', step: 'review' },
    });

    // Verify isolation: implementation attempt 1 and attempt 2 records both exist
    const op1 = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'implementation', 1);
    const op2 = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'implementation', 2);
    assert.equal(op1.status, 'completed');
    assert.equal(op2.status, 'completed');
    assert.notEqual(op1.operationId, op2.operationId);

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.current_attempt, 2);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 3);
    assert.equal(task.workflow_progress.history[2].step, 'implementation');
    assert.equal(task.workflow_progress.history[2].attempt, 2);
    assert.equal(task.workflow_progress.history[2].transitioned_to, 'review');
  });

  test('Step 7: start review attempt 2', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'review');
    assert.equal(context.attempt, 2);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'reviewing');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.current_attempt, 2);
    assert.equal(task.workflow_progress.state, 'active');
  });

  test('Step 8: finish review attempt 2 with result "pass" -> transitions to human-verification', async () => {
    writeFileSync(join(fx.root, 'docs', 'audit-2.md'), 'Audit 2: All acceptance criteria met\n');

    const finishPayload = {
      result: 'pass',
      'commit.title': 'review: pass',
      include: ['*'],
      artifacts: ['docs/audit-2.md'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'review', attempt: 2 },
      result: 'pass',
      to: { kind: 'step', step: 'human-verification' },
    });

    // Verify isolation: review attempt 1 and attempt 2 records both exist
    const op1 = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'review', 1);
    const op2 = loadOperationRecord(fx.root, fx.changeId, fx.taskId, 'review', 2);
    assert.equal(op1.status, 'completed');
    assert.equal(op2.status, 'completed');
    assert.notEqual(op1.operationId, op2.operationId);
    assert.equal(op1.resolvedInputs.result, 'fail');
    assert.equal(op2.resolvedInputs.result, 'pass');

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.current_attempt, 2);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 4);
    assert.equal(task.workflow_progress.history[3].step, 'review');
    assert.equal(task.workflow_progress.history[3].attempt, 2);
    assert.equal(task.workflow_progress.history[3].result, 'pass');
    assert.deepEqual(task.workflow_progress.history[3].artifacts, ['docs/audit-2.md']);
    assert.equal(task.workflow_progress.history[3].transitioned_to, 'human-verification');
  });

  test('Step 9: start human-verification attempt 1', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'human-verification');
    assert.equal(context.attempt, 1);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'awaiting-human-verification');
  });

  test('Step 10: human-verification request-changes -> transitions to implementation attempt 3', async () => {
    const result = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      ...RT,
      requestChanges: true,
      feedback: 'Operator requested retry for performance and edge cases',
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'human-verification', attempt: 1 },
      result: 'fail',
      to: { kind: 'step', step: 'implementation' },
    });

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 5);
    const last = task.workflow_progress.history[4];
    assert.equal(last.step, 'human-verification');
    assert.equal(last.attempt, 1);
    assert.equal(last.result, 'fail');
    assert.equal(last.feedback, 'Operator requested retry for performance and edge cases');
    assert.equal(last.transitioned_to, 'implementation');
  });

  test('Step 11: start implementation attempt 3 with previousTransition enriched', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'implementation');
    assert.equal(context.attempt, 3);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'implementing');
    assert.ok(context.previousTransition);
    assert.equal(context.previousTransition.from, 'human-verification');
    assert.equal(context.previousTransition.attempt, 1);
    assert.equal(context.previousTransition.result, 'fail');
    assert.equal(context.previousTransition.requestedChanges, 'Operator requested retry for performance and edge cases');
  });

  test('Step 12: finish implementation attempt 3 -> transitions to review', async () => {
    writeFileSync(join(fx.root, 'src', 'index.js'), 'export const version = 3;\n');

    const finishPayload = {
      'commit.title': 'fix implementation attempt 3',
      include: ['*'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'implementation', attempt: 3 },
      to: { kind: 'step', step: 'review' },
    });

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.current_attempt, 3);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 6);
  });

  test('Step 13: start review attempt 3', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'review');
    assert.equal(context.attempt, 3);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'reviewing');
  });

  test('Step 14: finish review attempt 3 with result "pass" -> transitions to human-verification', async () => {
    writeFileSync(join(fx.root, 'docs', 'audit-3.md'), 'Audit 3: Complete signoff\n');

    const finishPayload = {
      result: 'pass',
      'commit.title': 'review: pass attempt 3',
      include: ['*'],
      artifacts: ['docs/audit-3.md'],
    };

    const result = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      input: JSON.stringify(finishPayload),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'review', attempt: 3 },
      result: 'pass',
      to: { kind: 'step', step: 'human-verification' },
    });

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.current_attempt, 3);
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 7);
  });

  test('Step 15: start human-verification attempt 2', async () => {
    const context = await handleWorkflowStepStart(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(context.currentStep, 'human-verification');
    assert.equal(context.attempt, 2);
    assert.equal(context.runtimeState, 'active');
    assert.equal(context.semanticStatus, 'awaiting-human-verification');
  });

  test('Step 16: approve human-verification -> transitions to terminal verified', async () => {
    const result = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      ...RT,
      approve: true,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.transition, {
      from: { step: 'human-verification', attempt: 2 },
      result: 'pass',
      to: { kind: 'terminal', status: 'verified' },
    });

    const task = requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId);
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.state, 'completed');
    assert.equal(task.workflow_progress.history.length, 8);
    assert.equal(task.workflow_progress.history[7].step, 'human-verification');
    assert.equal(task.workflow_progress.history[7].attempt, 2);
    assert.equal(task.workflow_progress.history[7].result, 'pass');
    assert.equal(task.workflow_progress.history[7].transitioned_to, 'verified');
  });

  test('Step 17: repeated finish on terminal task reports already-completed without mutations', async () => {
    const commitsBefore = git(fx.root, ['rev-list', '--count', 'HEAD']).trim();

    const repeatResult = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
    });

    assert.equal(repeatResult.status, 'already-completed');
    assert.equal(git(fx.root, ['rev-list', '--count', 'HEAD']).trim(), commitsBefore);
  });

  test('Generic transport: accepts --input-file with JSON payload', async () => {
    const inputFilePath = join(fx.root, 'test-input.json');
    writeFileSync(inputFilePath, JSON.stringify({
      'commit.title': 'input file test',
      include: ['*'],
    }));

    // On terminal task, calling with --input-file reports already-completed cleanly
    const fileResult = await handleWorkflowStepFinish(fx.changeId, fx.taskId, {
      ...RT,
      activeDir: fx.activeDir,
      repoRoot: fx.root,
      inputFile: inputFilePath,
    });

    assert.equal(fileResult.status, 'already-completed');
  });

  test('Storage isolation verification across all attempts', () => {
    const base = join(fx.root, '.nevo-ai-local', 'workflow-operations', fx.changeId, fx.taskId);
    assert.ok(existsSync(join(base, 'implementation', 'attempt-1.json')));
    assert.ok(existsSync(join(base, 'implementation', 'attempt-2.json')));
    assert.ok(existsSync(join(base, 'implementation', 'attempt-3.json')));
    assert.ok(existsSync(join(base, 'review', 'attempt-1.json')));
    assert.ok(existsSync(join(base, 'review', 'attempt-2.json')));
    assert.ok(existsSync(join(base, 'review', 'attempt-3.json')));
    assert.ok(existsSync(join(base, 'human-verification', 'attempt-1.json')));
    assert.ok(existsSync(join(base, 'human-verification', 'attempt-2.json')));
  });
});
