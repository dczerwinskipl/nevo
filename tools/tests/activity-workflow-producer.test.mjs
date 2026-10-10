// Tests for workflow step activity producer (task 06, ai-spec-history).
// Covers AC 1 - AC 14.
// Run: node --test tools/tests/activity-workflow-producer.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readActivities, activityFilePath } from '../specs/activity/store.mjs';
import { SYSTEM_ACTOR, resolveAgentSessionActor, resolveUserActor } from '../specs/activity/actor-resolver.mjs';
import {
  WORKFLOW_STEP_STARTED,
  WORKFLOW_STEP_COMPLETED,
  stepStartedActivityId,
  stepCompletedActivityId,
  validateStepStartedData,
  validateStepCompletedData,
} from '../specs/activity/producers/workflow.mjs';
import { autoBindAgentSession } from '../specs.mjs';
import { handleWorkflowStepStart, handleWorkflowStepFinish } from '../specs/workflow/cli.mjs';
import { startHumanStep, submitHumanStepResult } from '../specs/workflow/human-step/operations.mjs';
import { finishStep } from '../specs/workflow/finish-operation.mjs';
import { saveOperationRecord, loadOperationRecord } from '../specs/workflow/operation-record.mjs';
import { requireChange, requireTask, setTaskWorkflowState } from '../specs/store.mjs';
import { normalizeWorkflowDefinition } from '../specs/workflow/index.mjs';
import { createDefaultGateRegistry, MemoryCommandVerificationStore, MemoryHumanVerificationReader } from '../specs/workflow/index.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

const SPEC_ID = '00000000-0000-4000-8000-000000000001';

const STANDARD_WORKFLOW_YAML = `id: standard-wf
title: "Standard Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  implementation:
    status:
      active: implementing
      completed: implemented
    entryGates: []
    exitGates:
      - type: command
        command: "node -e \\"process.exit(0)\\""
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        outcome: success
`;

const HUMAN_WORKFLOW_YAML = `id: human-wf
title: "Human Step Workflow"
type: standard
version: 1
sourceControl:
  enabled: true
  push: false
steps:
  review:
    executor: human
    status:
      active: reviewing
      completed: reviewed
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
      - value: fail
        to: rework
`;

function makeFixtureRepo({
  prefix = 'nevo-act-prod',
  changeId = 'demo-change',
  taskId = 'demo-task',
  workflowId = 'standard-wf',
  workflowYaml = STANDARD_WORKFLOW_YAML,
} = {}) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  git(remote, ['init', '-q', '--bare', '--initial-branch=main']);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(repo, ['init', '-q', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test-actor@example.com']);
  git(repo, ['config', 'user.name', 'Test Actor']);
  git(repo, ['remote', 'add', 'origin', remote]);

  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });

  const changeYamlContent = [
    `id: ${changeId}`,
    `spec_id: ${SPEC_ID}`,
    `title: "Demo Change"`,
    `type: standard`,
    `status: draft`,
    `workflow:`,
    `  mode: deterministic`,
    `  definition: ${workflowId}`,
    `tasks:`,
    `  - id: ${taskId}`,
    `    order: 1`,
    `    file: tasks/01-task.md`,
    `    status: in-implementation`,
    '',
  ].join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYamlContent);

  const taskMdContent = [
    '---',
    `id: ${taskId}`,
    'status: draft',
    `change: ${changeId}`,
    'allowed_paths:',
    '  - "*"',
    'forbidden_paths: []',
    '---',
    `# Task: ${taskId}`,
    '',
    '## Verification',
    '',
    '```bash',
    'node -e "process.exit(0)"',
    '```',
    '',
  ].join('\n');
  writeFileSync(join(changeDir, 'tasks', '01-task.md'), taskMdContent);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${workflowId}.yaml`), workflowYaml);

  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'root\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);

  return { repo, remote, activeDir, changeId, taskId, workflowId };
}

function cleanupFixture(fx) {
  if (fx?.repo) {
    try { rmSync(fx.repo, { recursive: true, force: true }); } catch {}
  }
  if (fx?.remote) {
    try { rmSync(fx.remote, { recursive: true, force: true }); } catch {}
  }
}

function makeGateRegistry() {
  const cmdStore = new MemoryCommandVerificationStore();
  cmdStore.recordCommandResult({ command: 'npm test', action: 'test', passed: true });
  return createDefaultGateRegistry({
    commandRunner: async () => ({ passed: true, exitCode: 0 }),
    commandVerificationStore: cmdStore,
    humanVerificationReader: new MemoryHumanVerificationReader([]),
  });
}

describe('Workflow step activity producer contract', () => {
  test('constants and ID formatting', () => {
    assert.equal(WORKFLOW_STEP_STARTED, 'workflow.step.started');
    assert.equal(WORKFLOW_STEP_COMPLETED, 'workflow.step.completed');

    const startedId = stepStartedActivityId('spec-1', 'task-1', 'impl', 1);
    assert.equal(startedId, 'workflow.step.started:spec-1:task-1:impl:1');

    const completedId = stepCompletedActivityId('spec-1', 'task-1', 'impl', 1);
    assert.equal(completedId, 'workflow.step.completed:spec-1:task-1:impl:1');
  });

  test('validateStepStartedData validates valid and invalid payloads', () => {
    const valid = validateStepStartedData({ step: 'impl', attempt: 1 });
    assert.equal(valid.valid, true);

    const missingStep = validateStepStartedData({ attempt: 1 });
    assert.equal(missingStep.valid, false);

    const invalidAttempt = validateStepStartedData({ step: 'impl', attempt: 0 });
    assert.equal(invalidAttempt.valid, false);

    const notAnObject = validateStepStartedData('not an object');
    assert.equal(notAnObject.valid, false);
  });

  test('validateStepCompletedData validates valid and invalid payloads', () => {
    const valid = validateStepCompletedData({
      step: 'impl',
      attempt: 1,
      result: 'pass',
      transitioned_to: 'verified',
      artifacts: ['a.txt'],
      feedback: 'Good work',
      findings: [],
    });
    assert.equal(valid.valid, true);

    const invalidAttempt = validateStepCompletedData({ attempt: -1 });
    assert.equal(invalidAttempt.valid, false);

    const invalidArtifacts = validateStepCompletedData({ attempt: 1, artifacts: 'not-array' });
    assert.equal(invalidArtifacts.valid, false);

    const invalidFeedback = validateStepCompletedData({ attempt: 1, feedback: 123 });
    assert.equal(invalidFeedback.valid, false);
  });
});

describe('autoBindAgentSession return value contract (AC 7, AC 8)', () => {
  let fx;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fx = makeFixtureRepo({ prefix: 'nevo-bind-test' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupFixture(fx);
  });

  test('AC 7: autoBindAgentSession returns bindSessionSync result including resolved sessionId for context with only provider + providerSessionId', () => {
    process.env.NEVO_AGENT_PROVIDER = 'claude';
    process.env.NEVO_AGENT_PROVIDER_SESSION_ID = 'test-provider-session-xyz';
    delete process.env.NEVO_SESSION_ID;

    const change = requireChange(fx.changeId, fx.activeDir);
    const result = autoBindAgentSession(change, fx.taskId, 'execution', { repoRoot: fx.repo, activeDir: fx.activeDir });

    assert.ok(result, 'autoBindAgentSession should return a result');
    assert.equal(typeof result.sessionId, 'string', 'sessionId should be resolved to a string');
    assert.match(result.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'should be a valid UUID');
    assert.equal(result.provider, 'claude');
    assert.equal(result.providerSessionId, 'test-provider-session-xyz');
    assert.equal(result.specId, SPEC_ID);
  });

  test('AC 8: autoBindAgentSession returns null when there is no execution context, no valid specId, or binding throws', () => {
    delete process.env.NEVO_AGENT_PROVIDER;
    delete process.env.NEVO_AGENT_PROVIDER_SESSION_ID;
    delete process.env.NEVO_SESSION_ID;

    const change = requireChange(fx.changeId, fx.activeDir);
    const noContext = autoBindAgentSession(change, fx.taskId, 'execution', { repoRoot: fx.repo, activeDir: fx.activeDir });
    assert.equal(noContext, null);

    process.env.NEVO_AGENT_PROVIDER = 'claude';
    process.env.NEVO_AGENT_PROVIDER_SESSION_ID = 'test-sess';
    const invalidSpecChange = { id: 'invalid-change', spec_id: 'not-a-uuid' };
    const invalidSpec = autoBindAgentSession(invalidSpecChange, fx.taskId, 'execution', { repoRoot: fx.repo });
    assert.equal(invalidSpec, null);

    const noSpecChange = { id: 'no-spec' };
    const noSpec = autoBindAgentSession(noSpecChange, fx.taskId, 'execution', { repoRoot: fx.repo });
    assert.equal(noSpec, null);
  });
});

describe('Workflow step activity emission end-to-end', () => {
  let fx;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (fx) cleanupFixture(fx);
  });

  test('AC 1 & AC 6: Normal agent step start + finish produces one queryable workflow.step.started and one workflow.step.completed activity; repeat step start deduplicates', async () => {
    fx = makeFixtureRepo({ prefix: 'nevo-agent-flow' });
    process.env.NEVO_AGENT_PROVIDER = 'claude';
    process.env.NEVO_AGENT_PROVIDER_SESSION_ID = 'claude-agent-sess-1';
    delete process.env.NEVO_SESSION_ID;

    const opts = { activeDir: fx.activeDir, repoRoot: fx.repo, silent: true };

    // Step start
    await handleWorkflowStepStart(fx.changeId, fx.taskId, opts);

    // Calling step start a second time for the same active attempt (AC 6)
    await handleWorkflowStepStart(fx.changeId, fx.taskId, opts);

    let activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Repeated step start should dedup to exactly one activity');
    assert.equal(activities[0].type, WORKFLOW_STEP_STARTED);
    assert.equal(activities[0].scope.specId, SPEC_ID);
    assert.equal(activities[0].scope.taskId, fx.taskId);
    assert.equal(activities[0].actor.type, 'agent-session');
    assert.equal(activities[0].data.step, 'implementation');
    assert.equal(activities[0].data.attempt, 1);

    // Step finish
    const input = JSON.stringify({ 'commit.title': 'Complete implementation task' });
    await handleWorkflowStepFinish(fx.changeId, fx.taskId, { ...opts, input });

    activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 2, 'Should have exactly started and completed activities');
    const started = activities.find(a => a.type === WORKFLOW_STEP_STARTED);
    const completed = activities.find(a => a.type === WORKFLOW_STEP_COMPLETED);

    assert.ok(started);
    assert.ok(completed);
    assert.equal(completed.actor.type, 'agent-session');
    assert.equal(completed.data.step, 'implementation');
    assert.equal(completed.data.attempt, 1);
    assert.equal(completed.data.transitioned_to, 'verified');

    const change = requireChange(fx.changeId, fx.activeDir);
    const task = requireTask(change, fx.taskId);
    const historyEntry = task.workflow_progress.history[0];
    assert.equal(completed.data.attempt, historyEntry.attempt);
    assert.equal(completed.data.transitioned_to, historyEntry.transitioned_to);
  });

  test('AC 2, AC 3, AC 6: Human-owned step start (startHumanStep) and finish (submitHumanStepResult) attribute user actor, and repeat start dedups', async () => {
    fx = makeFixtureRepo({
      prefix: 'nevo-human-flow',
      workflowId: 'human-wf',
      workflowYaml: HUMAN_WORKFLOW_YAML,
    });

    const change = requireChange(fx.changeId, fx.activeDir);
    const task = requireTask(change, fx.taskId);
    const definition = normalizeWorkflowDefinition({
      id: 'human-wf',
      steps: {
        review: {
          executor: 'human',
          status: { active: 'reviewing', completed: 'reviewed' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ value: 'pass', to: 'verified' }],
        },
      },
    });

    const context = { repoRoot: fx.repo, activeDir: fx.activeDir, gateRegistry: makeGateRegistry() };

    // AC 2 & AC 6: startHumanStep
    startHumanStep(change, task, definition, context);
    // Call twice to verify deduplication
    const actRes = startHumanStep(change, task, definition, context);

    let activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Calling startHumanStep twice should produce exactly one activity');
    assert.equal(activities[0].type, WORKFLOW_STEP_STARTED);
    assert.equal(activities[0].actor.type, 'user');
    assert.equal(activities[0].actor.id, 'test-actor@example.com');
    assert.equal(activities[0].data.step, 'review');
    assert.equal(activities[0].data.attempt, 1);

    // AC 3: submitHumanStepResult
    await submitHumanStepResult(change, actRes.task, definition, context, {
      result: 'pass',
      'commit.title': 'Human approves review',
    });

    activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 2);
    const completed = activities.find(a => a.type === WORKFLOW_STEP_COMPLETED);
    assert.ok(completed);
    assert.equal(completed.actor.type, 'user');
    assert.equal(completed.actor.id, 'test-actor@example.com');
    assert.notEqual(completed.actor.type, 'system');
    assert.equal(completed.data.step, 'review');
    assert.equal(completed.data.result, 'pass');
    assert.equal(completed.data.transitioned_to, 'verified');
  });

  test('AC 4 & AC 5: Crash window recovery and repeat resume deduplication', async () => {
    fx = makeFixtureRepo({ prefix: 'nevo-crash-rec' });
    const change = requireChange(fx.changeId, fx.activeDir);
    const task = requireTask(change, fx.taskId);
    const definition = normalizeWorkflowDefinition({
      id: 'standard-wf',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'verified' }],
        },
      },
    });

    // Simulate crash: workflow history already persisted via setTaskWorkflowState,
    // operation record's update-task stage still pending/running, no activity recorded
    setTaskWorkflowState(change, fx.taskId, {
      status: 'verified',
      workflowProgress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [{ step: 'implementation', attempt: 1, completed_at: '2026-10-10T00:00:00.000Z', transitioned_to: 'verified' }],
      },
    });

    saveOperationRecord(fx.repo, {
      operationId: 'op-crash-1',
      change: fx.changeId,
      task: fx.taskId,
      step: 'implementation',
      attempt: 1,
      actor: { type: 'agent-session', id: 'session-crashed' },
      status: 'running',
      resolvedInputs: { 'commit.title': 'Resumed commit' },
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running', intent: { step: 'implementation', attempt: 1, fromState: 'active', toState: 'completed', transitioned_to: 'verified', terminalStatus: 'verified' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    const baseParams = {
      change,
      task: requireTask(freshChange(fx.activeDir), fx.taskId),
      definition,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, sourceControl: { enabled: true, push: false } },
      activeDir: fx.activeDir,
      gateRegistry: makeGateRegistry(),
      inputs: { 'commit.title': 'Resumed commit' },
    };

    function freshChange(dir) {
      return requireChange(fx.changeId, dir);
    }

    // AC 4: Resume finishStep
    const res1 = await finishStep(baseParams);
    assert.equal(res1.status, 'completed');

    let activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Exactly one completed activity should result from recovery');
    assert.equal(activities[0].type, WORKFLOW_STEP_COMPLETED);
    assert.equal(activities[0].actor.id, 'session-crashed');

    // AC 5: Simulate second independent resume where update-task is already completed
    const res2 = await finishStep(baseParams);
    assert.equal(res2.status, 'already-completed');

    activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Second resume must not duplicate the activity');
  });

  test('AC 9 & AC 10: Durable actor capture on brand-new operation vs resume under different actor', async () => {
    fx = makeFixtureRepo({ prefix: 'nevo-actor-dur' });
    const change = requireChange(fx.changeId, fx.activeDir);
    const definition = normalizeWorkflowDefinition({
      id: 'standard-wf',
      steps: {
        step1: {
          status: { active: 's1-active', completed: 's1-completed' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'step2' }],
        },
        step2: {
          status: { active: 's2-active', completed: 's2-completed' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'verified' }],
        },
      },
    });

    const actorA = { type: 'agent-session', id: 'session-actor-A' };
    const actorB = { type: 'agent-session', id: 'session-actor-B' };

    setTaskWorkflowState(change, fx.taskId, {
      workflowProgress: { current_step: 'step1', current_attempt: 1, state: 'active', history: [] },
    });

    // AC 9: Explicit actor passed into finishStep on brand-new operation
    const res = await finishStep({
      change,
      task: requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId),
      definition,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, sourceControl: { enabled: true, push: false } },
      activeDir: fx.activeDir,
      gateRegistry: makeGateRegistry(),
      inputs: { 'commit.title': 'Finish step 1' },
      actor: actorA,
    });
    assert.equal(res.status, 'completed');

    let activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1);
    assert.deepEqual(activities[0].actor, actorA, 'Brand-new finish must use actorA');

    // AC 10: Simulate crash after state write on step2, created by Actor A
    setTaskWorkflowState(change, fx.taskId, {
      workflowProgress: {
        current_step: 'step2',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'step1', attempt: 1, completed_at: 'x', transitioned_to: 'step2' },
          { step: 'step2', attempt: 1, completed_at: 'y', transitioned_to: 'verified' },
        ],
      },
      status: 'verified',
    });

    saveOperationRecord(fx.repo, {
      operationId: 'op-actor-dur',
      change: fx.changeId,
      task: fx.taskId,
      step: 'step2',
      attempt: 1,
      actor: actorA, // Durably captured as Actor A
      status: 'running',
      resolvedInputs: { 'commit.title': 'Finish step 2' },
      operations: [
        { id: 'verify-gates', status: 'completed' },
        { id: 'update-task', status: 'running', intent: { step: 'step2', attempt: 1, fromState: 'active', toState: 'completed', transitioned_to: 'verified', terminalStatus: 'verified' } },
        { id: 'commit', status: 'pending' },
        { id: 'push', status: 'pending' },
        { id: 'transition', status: 'pending' },
      ],
    });

    // Now Actor B (or no actor) resumes the finish
    const resumeRes = await finishStep({
      change,
      task: requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId),
      definition,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, sourceControl: { enabled: true, push: false } },
      activeDir: fx.activeDir,
      gateRegistry: makeGateRegistry(),
      inputs: { 'commit.title': 'Finish step 2' },
      actor: actorB, // Resuming call passes Actor B
    });
    assert.equal(resumeRes.status, 'completed');

    activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    const step2Completed = activities.find(a => a.data.step === 'step2');
    assert.ok(step2Completed);
    assert.deepEqual(step2Completed.actor, actorA, 'Resume must attribute original Actor A, not resuming Actor B or SYSTEM_ACTOR');
  });

  test('AC 11 & AC 12: Retry on already-completed when activity recording previously failed', async () => {
    fx = makeFixtureRepo({ prefix: 'nevo-retry-comp' });
    const change = requireChange(fx.changeId, fx.activeDir);
    const definition = normalizeWorkflowDefinition({
      id: 'standard-wf',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'verified' }],
        },
      },
    });

    const actorA = { type: 'agent-session', id: 'session-actor-A' };
    setTaskWorkflowState(change, fx.taskId, {
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active', history: [] },
    });

    const actPath = activityFilePath(SPEC_ID, { repoRoot: fx.repo });
    // Create a directory at the file path to simulate disk write failure
    mkdirSync(actPath, { recursive: true });

    const finishParams = {
      change,
      task: requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId),
      definition,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, sourceControl: { enabled: true, push: false } },
      activeDir: fx.activeDir,
      gateRegistry: makeGateRegistry(),
      inputs: { 'commit.title': 'Initial finish' },
      actor: actorA,
    };

    // 1. Initial finish completes successfully even though recordActivity failed (AC 13)
    const res1 = await finishStep(finishParams);
    assert.equal(res1.status, 'completed');

    // Remove the blocking directory so subsequent writes can succeed
    rmSync(actPath, { recursive: true, force: true });
    assert.equal(readActivities(SPEC_ID, { repoRoot: fx.repo }).length, 0, 'No activity recorded due to simulated disk error');

    // 2. AC 11: Call finishStep again (already-completed short circuit)
    const freshChange = requireChange(fx.changeId, fx.activeDir);
    const freshTask = requireTask(freshChange, fx.taskId);
    const res2 = await finishStep({
      ...finishParams,
      change: freshChange,
      task: freshTask,
    });
    assert.equal(res2.status, 'already-completed');

    let activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Missed activity should now be recorded via retry on already-completed');
    assert.equal(activities[0].type, WORKFLOW_STEP_COMPLETED);
    assert.deepEqual(activities[0].actor, actorA);
    assert.equal(activities[0].data.step, 'implementation');
    assert.equal(activities[0].data.transitioned_to, 'verified');

    // 3. AC 12: Call finishStep yet again — idempotent, no duplicate produced
    const res3 = await finishStep({
      ...finishParams,
      change: freshChange,
      task: freshTask,
    });
    assert.equal(res3.status, 'already-completed');

    activities = readActivities(SPEC_ID, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Subsequent finish call should not produce duplicate activity');
  });

  test('AC 13: Activity recording failure does not prevent finishStep from completing successfully', async () => {
    fx = makeFixtureRepo({ prefix: 'nevo-throw-rec' });
    const change = requireChange(fx.changeId, fx.activeDir);
    const definition = normalizeWorkflowDefinition({
      id: 'standard-wf',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          entryGates: [],
          exitGates: [],
          finalize: [{ id: 'commit-and-push' }],
          transitions: [{ to: 'verified' }],
        },
      },
    });

    setTaskWorkflowState(change, fx.taskId, {
      workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'active', history: [] },
    });

    const actPath = activityFilePath(SPEC_ID, { repoRoot: fx.repo });
    mkdirSync(actPath, { recursive: true });

    const res = await finishStep({
      change,
      task: requireTask(requireChange(fx.changeId, fx.activeDir), fx.taskId),
      definition,
      context: { repoRoot: fx.repo, activeDir: fx.activeDir, sourceControl: { enabled: true, push: false } },
      activeDir: fx.activeDir,
      gateRegistry: makeGateRegistry(),
      inputs: { 'commit.title': 'Finish with broken activity store' },
    });

    assert.equal(res.status, 'completed', 'finishStep must complete successfully despite recordActivity failure');
  });
});
