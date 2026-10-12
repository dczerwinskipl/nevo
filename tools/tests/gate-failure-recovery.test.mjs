import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { finishStep, planFinish } from '../specs/workflow/finish-operation.mjs';
import { normalizeWorkflowDefinition } from '../specs/workflow/definitions/schema.mjs';
import {
  createDefaultGateRegistry,
  CommandGate,
  CommandCatalog,
  MemoryCommandVerificationStore,
  MemoryHumanVerificationReader,
  saveOperationRecord,
  loadOperationRecord,
  PreconditionError,
} from '../specs/workflow/index.mjs';
import { assessExecutionSettlement } from '../specs/workflow/execution-settlement.mjs';
import { handleWorkflowStepFinish } from '../specs/workflow/cli.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

const REVIEW_WORKFLOW_DEF = normalizeWorkflowDefinition({
  id: 'review-recovery-v1',
  title: 'Review Recovery Workflow',
  type: 'standard',
  version: 1,
  steps: {
    implementation: {
      status: { active: 'in-implementation', completed: 'implemented' },
      entryGates: [],
      actions: [],
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'review' }],
    },
    review: {
      status: { active: 'in-review', completed: 'reviewed' },
      entryGates: [],
      actions: [],
      exitGates: [
        { type: 'command', action: 'test', when: ['pass'] },
      ],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [
        {
          value: 'pass',
          to: 'verified',
          outcome: 'success',
        },
        {
          value: 'fail',
          to: 'implementation',
          action: {
            feedback: {
              required: true,
            },
          },
          continuation: 'auto',
          invalidatesDependencyRelease: true,
        },
      ],
    },
  },
});

function setupRepoFixture(prefix = 'nevo-gate-recovery') {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test Runner']);
  git(repo, ['config', 'user.email', 'test@runner.local']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'hello root\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: initial repo root']);
  git(repo, ['push', '-u', 'origin', 'main']);

  const specsActive = join(repo, 'specs', 'active');
  const changeDir = join(specsActive, 'demo-change');
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const changeYaml = [
    'id: demo-change',
    'title: Demo Change',
    'status: in-implementation',
    'tasks:',
    '  - id: t1',
    '    file: tasks/01-t1.md',
    '    status: in-implementation',
    '    workflow_progress:',
    '      current_step: review',
    '      current_attempt: 1',
    '      state: active',
    '      history:',
    '        - step: implementation',
    '          attempt: 1',
    '          completed_at: "2026-10-10T00:00:00.000Z"',
    '          transitioned_to: review',
    '',
  ].join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const taskMd = [
    '---',
    'id: demo-change.t1',
    'status: in-implementation',
    'allowed_paths:',
    '  - allowed.txt',
    '---',
    '# T1',
    '',
    '## Acceptance criteria',
    '- criteria 1',
    '',
    '## Verification',
    'npm test',
    '',
  ].join('\n');
  writeFileSync(join(tasksDir, '01-t1.md'), taskMd);

  writeFileSync(join(repo, 'allowed.txt'), 'allowed content\n');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'chore: add demo-change setup']);
  git(repo, ['push', 'origin', 'main']);

  return { repo, remote };
}

describe('Gate-failure recovery and failure taxonomy (Task 06)', () => {
  let fixture;

  beforeEach(() => {
    fixture = setupRepoFixture('nevo-task06');
  });

  afterEach(() => {
    try {
      rmSync(fixture.repo, { recursive: true, force: true });
      rmSync(fixture.remote, { recursive: true, force: true });
    } catch {}
  });

  test('First pass blocked by red gate, then fail accepted without RESOLVED_INPUT_CONFLICT (AC1)', async () => {
    const cmdStore = new MemoryCommandVerificationStore();
    const humanReader = new MemoryHumanVerificationReader([]);
    const failingGateRegistry = createDefaultGateRegistry({
      commandRunner: async () => ({ passed: false, exitCode: 1, stdout: '', stderr: 'AssertionError: test failed' }),
      commandVerificationStore: cmdStore,
      humanVerificationReader: humanReader,
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    // Turn 1: Attempt finish with pass -> red gate blocks
    const turn1Result = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
      inputs: { result: 'pass', 'commit.title': 'review(t1): approve' },
      gateRegistry: failingGateRegistry,
    });

    assert.equal(turn1Result.status, 'blocked');
    assert.equal(turn1Result.stage, 'verify-gates');
    assert.equal(turn1Result.blockers.length, 1);

    // Verify durable record state: status is running (replayable), verify-gates is failed, update-task is pending
    const inFlightRecord = loadOperationRecord(fixture.repo, 'demo-change', 't1', 'review', 1);
    assert.ok(inFlightRecord);
    assert.equal(inFlightRecord.status, 'running');
    const verifyStage = inFlightRecord.operations.find(o => o.id === 'verify-gates');
    assert.equal(verifyStage.status, 'failed');
    const updateTaskStage = inFlightRecord.operations.find(o => o.id === 'update-task');
    assert.equal(updateTaskStage.status, 'pending');

    // Turn 2: Attempt finish with fail + feedback -> accepted without RESOLVED_INPUT_CONFLICT
    const turn2Result = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
      inputs: {
        result: 'fail',
        feedback: 'Tests failed: assertion error in math assertions',
        'commit.title': 'review(t1): request changes due to failing tests',
      },
      gateRegistry: failingGateRegistry,
    });

    assert.equal(turn2Result.status, 'completed');
    assert.equal(turn2Result.transition.result, 'fail');
    assert.equal(turn2Result.transition.to.step, 'implementation');

    // Verify task workflow progress history recorded the fail review with feedback
    const updatedChange = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const updatedTask = requireTask(updatedChange, 't1');
    const history = updatedTask.workflow_progress.history;
    const lastEntry = history[history.length - 1];
    assert.equal(lastEntry.step, 'review');
    assert.equal(lastEntry.result, 'fail');
    assert.equal(lastEntry.transitioned_to, 'implementation');
    assert.equal(lastEntry.feedback, 'Tests failed: assertion error in math assertions');
  });

  test('After a red gate, assessExecutionSettlement reports resumable, not recovery-required (AC2)', async () => {
    const cmdStore = new MemoryCommandVerificationStore();
    const humanReader = new MemoryHumanVerificationReader([]);
    const failingGateRegistry = createDefaultGateRegistry({
      commandRunner: async () => ({ passed: false, exitCode: 1, stdout: '', stderr: 'AssertionError: test failed' }),
      commandVerificationStore: cmdStore,
      humanVerificationReader: humanReader,
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    // Attempt finish with pass -> red gate blocks
    const res = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
      inputs: { result: 'pass', 'commit.title': 'review(t1): approve' },
      gateRegistry: failingGateRegistry,
    });
    assert.equal(res.status, 'blocked');

    // Assess execution settlement: must report outcome: resumable
    const settlement = await assessExecutionSettlement({
      repoRoot: fixture.repo,
      changeSlug: 'demo-change',
      taskId: 't1',
      activeDir: join(fixture.repo, 'specs', 'active'),
    });

    assert.equal(settlement.settled, false);
    assert.equal(settlement.outcome, 'resumable');
    assert.equal(settlement.reason, 'in-flight-finish-operation');
    assert.equal(settlement.details.replayable, true);
  });

  describe('Failure taxonomy: runner exception => blocked with reason; red exit code => failed (AC3)', () => {
    test('Runner exception returns status: blocked with reason and does not persist to store', async () => {
      const store = new MemoryCommandVerificationStore();
      const throwingRunner = async () => {
        throw new Error('Process spawn failed: ECONNRESET');
      };

      const gate = new CommandGate({
        runner: throwingRunner,
        verificationStore: store,
      });

      const result = await gate.verify({ action: 'test' }, { repoRoot: fixture.repo });
      assert.equal(result.passed, false);
      assert.equal(result.status, 'blocked');
      assert.match(result.message, /Process spawn failed: ECONNRESET/);
      assert.match(result.details.reason, /Process spawn failed: ECONNRESET/);
      assert.match(result.details.error, /Process spawn failed: ECONNRESET/);

      // Verify nothing recorded in store as passed or failed
      const inspectRes = await gate.inspect({ action: 'test' }, { repoRoot: fixture.repo });
      assert.equal(inspectRes.status, 'pending');
    });

    test('Red exit code returns status: failed with exitCode and records in store', async () => {
      const store = new MemoryCommandVerificationStore();
      const failingRunner = async () => ({
        passed: false,
        exitCode: 101,
        stdout: '',
        stderr: 'cargo test failed',
      });

      const gate = new CommandGate({
        runner: failingRunner,
        verificationStore: store,
      });

      const result = await gate.verify({ action: 'test' }, { repoRoot: fixture.repo });
      assert.equal(result.passed, false);
      assert.equal(result.status, 'failed');
      assert.equal(result.details.exitCode, 101);

      // Verify store recorded failed state
      const inspectRes = await gate.inspect({ action: 'test' }, { repoRoot: fixture.repo });
      assert.equal(inspectRes.status, 'failed');
    });
  });

  test('Input change after update-task started is still rejected (AC4)', async () => {
    const cmdStore = new MemoryCommandVerificationStore();
    const humanReader = new MemoryHumanVerificationReader([]);
    const gateRegistry = createDefaultGateRegistry({
      commandRunner: async () => ({ passed: true, exitCode: 0, stdout: 'ok', stderr: '' }),
      commandVerificationStore: cmdStore,
      humanVerificationReader: humanReader,
    });

    // Seed an in-flight operation record where update-task has already started (status: 'running')
    saveOperationRecord(fixture.repo, {
      operationId: 'inflight-update-task-started',
      change: 'demo-change',
      task: 't1',
      step: 'review',
      attempt: 1,
      status: 'running',
      resolvedInputs: { result: 'pass', 'commit.title': 'review(t1): approve' },
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running', intent: { step: 'review', attempt: 1 } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    // Attempting to change result to 'fail' must be rejected with RESOLVED_INPUT_CONFLICT
    await assert.rejects(
      () => finishStep({
        change,
        task,
        definition: REVIEW_WORKFLOW_DEF,
        context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
        inputs: {
          result: 'fail',
          feedback: 'Attempting to change pinned result',
          'commit.title': 'review(t1): reject',
        },
        gateRegistry,
      }),
      (err) => {
        assert.ok(err instanceof PreconditionError);
        assert.equal(err.code, 'RESOLVED_INPUT_CONFLICT');
        return true;
      }
    );
  });

  test('After an expired/timed-out ask_user interaction, finish --input with fail + feedback still completes (AC5)', async () => {
    const cmdStore = new MemoryCommandVerificationStore();
    const humanReader = new MemoryHumanVerificationReader([]);
    const failingGateRegistry = createDefaultGateRegistry({
      commandRunner: async () => ({ passed: false, exitCode: 1, stdout: '', stderr: 'AssertionError: test failed' }),
      commandVerificationStore: cmdStore,
      humanVerificationReader: humanReader,
    });

    const change = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const task = requireTask(change, 't1');

    // Step 1: Reviewer runs finish with 'pass' -> red test blocks
    const turn1 = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
      inputs: { result: 'pass', 'commit.title': 'review(t1): approve' },
      gateRegistry: failingGateRegistry,
    });
    assert.equal(turn1.status, 'blocked');

    // Step 2: Reviewer asks user a question via ask_user tool (simulated: question asked, token expires / times out).
    // The ask_user tool error or timeout leaves no engine mutation.
    // The reviewer now submits fail + feedback via CLI handleWorkflowStepFinish with --input:
    const inputPayload = JSON.stringify({
      result: 'fail',
      feedback: 'ask_user interaction timed out waiting for author input; failing review due to red test gate',
      'commit.title': 'review(t1): request changes after ask_user timeout',
    });

    // Provide the same gate registry via buildWorkflowGateRegistry / DI
    const turn2 = await finishStep({
      change,
      task,
      definition: REVIEW_WORKFLOW_DEF,
      context: { repoRoot: fixture.repo, activeDir: join(fixture.repo, 'specs', 'active') },
      inputs: JSON.parse(inputPayload),
      gateRegistry: failingGateRegistry,
    });

    assert.equal(turn2.status, 'completed');
    assert.equal(turn2.transition.result, 'fail');
    assert.equal(turn2.transition.to.step, 'implementation');

    // Task workflow state moved to implementation with feedback recorded
    const updatedChange = requireChange('demo-change', join(fixture.repo, 'specs', 'active'));
    const updatedTask = requireTask(updatedChange, 't1');
    const history = updatedTask.workflow_progress.history;
    const lastEntry = history[history.length - 1];
    assert.equal(lastEntry.step, 'review');
    assert.equal(lastEntry.result, 'fail');
    assert.match(lastEntry.feedback, /ask_user interaction timed out/);
  });
});
