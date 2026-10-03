import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildAiTestApp } from '../dashboard/tests/helpers/ai-test-app.mjs';
import { createMockAgentProvider } from '../dashboard/server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../dashboard/server/ai/providers/registry.mjs';
import { createAgentSessionService, assertTaskExecutionReadiness } from '../dashboard/server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../dashboard/server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../dashboard/server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import { getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';
import {
  resetAdmissionStateForTest,
  releaseAdmittedExecution,
  waitForActiveExecutionSettled,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { handleWorkflowStepStart, handleWorkflowStepFinish } from '../specs/workflow/cli.mjs';
import { saveOperationRecord, loadOperationRecord } from '../specs/workflow/operation-record.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function makeFixtureRepo({
  prefix = 'scenario-a',
  specId = '22222222-2222-4222-8222-222222222222',
  changeSlug = 'spec-scenario-a',
  taskId = 't1',
  taskStatus = 'in-progress',
  workflowProgress = null,
} = {}) {
  const remote = fs.mkdtempSync(path.join(tmpdir(), `nevo-remote-${prefix}-`));
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main'], { cwd: remote });

  const root = fs.mkdtempSync(path.join(tmpdir(), `nevo-repo-${prefix}-`));
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Scenario A Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'scenario-a@example.com'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });

  // package.json for test command exitGate
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'scenario-a-fixture',
        version: '1.0.0',
        scripts: { test: 'node -e "process.exit(0)"' },
      },
      null,
      2
    )
  );

  fs.writeFileSync(path.join(root, 'README.md'), '# Scenario A Fixture\n', 'utf8');
  fs.writeFileSync(path.join(root, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

  // Workflow definition: standard
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

  // Active spec
  const activeDir = path.join(root, 'specs', 'active');
  const specDir = path.join(activeDir, changeSlug);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  const progressSection = workflowProgress
    ? `    workflow_progress:
      current_step: ${workflowProgress.current_step}
      current_attempt: ${workflowProgress.current_attempt}
      state: ${workflowProgress.state}
      history:
${(workflowProgress.history || [])
  .map(
    (h) => `        - step: ${h.step}
          attempt: ${h.attempt}
          transitioned_to: ${h.transitioned_to}`
  )
  .join('\n')}
`
    : '';

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
    status: ${taskStatus}
${progressSection}  - id: t-draft
    file: tasks/t-draft.md
    status: draft
`,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tasksDir, `${taskId}.md`),
    `---
id: ${taskId}
status: ${taskStatus}
change: ${changeSlug}
allowed_paths:
  - src/*
  - README.md
forbidden_paths: []
---
# Task ${taskId}
`,
    'utf8'
  );

  fs.writeFileSync(
    path.join(tasksDir, 't-draft.md'),
    `---
id: t-draft
status: draft
change: ${changeSlug}
allowed_paths:
  - README.md
forbidden_paths: []
---
# Task t-draft
`,
    'utf8'
  );

  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'initial fixture']);
  git(root, ['push', '-u', 'origin', 'main']);

  return { root, remote, activeDir, specId, changeSlug, taskId };
}

async function createAiApp(repoRoot, specId) {
  const baseMock = createMockAgentProvider({ specId, taskIds: ['t1'], streamDelayMs: 1 });
  const registry = createAgentProviderRegistry([baseMock]);
  const transcriptCache = createTranscriptCacheService({
    baseDir: path.join(repoRoot, '.nevo-ai-local', 'transcripts'),
  });
  const bindingService = createAgentSessionBindingService({
    storageDir: path.join(repoRoot, '.nevo-ai-local', 'sessions'),
  });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({
    registry,
    turnRuntime,
    transcriptCache,
    bindingService,
    repoRoot,
  });
  const app = await buildAiTestApp({ service, repoRoot });
  const origCreate = service.createSession.bind(service);
  service.createSession = async (...args) => {
    try {
      return await origCreate(...args);
    } catch (e) {
      console.error('CREATE_SESSION_ERR:', e);
      throw e;
    }
  };
  const origStart = service.startTurn.bind(service);
  service.startTurn = async (...args) => {
    try {
      return await origStart(...args);
    } catch (e) {
      console.error('START_TURN_ERR:', e);
      throw e;
    }
  };
  return { app, service, turnRuntime, provider: baseMock };
}

describe('Scenario A: dirty baseline before activation', { concurrency: 1 }, () => {
  test('Acceptance Scenario A (1): Dirty baseline before activation creates session/turn with structured blocker, leaves progress untouched, and activates upon remediation', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-immediate',
      specId: '22222222-2222-4222-8222-222222222201',
      changeSlug: 'spec-scenario-a-1',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;
    let ai = null;

    try {
      ai = await createAiApp(fx.root, fx.specId);

      // Baseline: read exact change.yaml content before turn
      const changeYamlPath = path.join(fx.root, 'specs', 'active', fx.changeSlug, 'change.yaml');
      const initialChangeYaml = fs.readFileSync(changeYamlPath, 'utf8');

      // Introduce an uncommitted, unrelated dirty file
      const dirtyFile = path.join(fx.root, 'unrelated-dirty.txt');
      fs.writeFileSync(dirtyFile, 'dirty content\n', 'utf8');

      // Drive execution request through the real route path
      const res = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
          prompt: `Execute workflow task ${fx.taskId}`,
        },
      });

      // 1. Session and turn created (201 Created)
      assert.equal(res.statusCode, 201, `Expected 201 Created but got: ${res.body}`);
      const data = JSON.parse(res.body);
      assert.ok(data.sessionId, 'Response should contain sessionId');
      assert.ok(data.turnId, 'Response should contain turnId');
      assert.ok(data.ownerId, 'Response should contain ownerId');

      // 2. Workspace writer claim acquired with kind: 'agent'
      const liveClaim = getWorkspaceWriterClaim(fx.root);
      assert.ok(liveClaim, 'Live workspace writer claim must exist');
      assert.equal(liveClaim.kind, 'agent');
      assert.equal(liveClaim.ownerId, data.ownerId);
      assert.equal(liveClaim.specId, fx.specId);
      assert.equal(liveClaim.taskId, fx.taskId);

      // 3. Structured activation blocker is present on session and turn
      const readinessCheck = assertTaskExecutionReadiness(fx.specId, fx.taskId, fx.root);
      assert.ok(readinessCheck?.activationBlocked, 'Readiness check must report activationBlocked: true');
      assert.equal(readinessCheck.code, 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT');
      assert.ok(Array.isArray(readinessCheck.dirtyFiles));
      assert.ok(readinessCheck.dirtyFiles.includes('unrelated-dirty.txt'));

      const canonicalTurn = ai.turnRuntime.getCanonicalTurn(data.turnId);
      assert.ok(canonicalTurn, 'Canonical turn must exist in turnRuntime');
      assert.ok(canonicalTurn.prompt.includes('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'));
      assert.ok(canonicalTurn.prompt.includes('unrelated-dirty.txt'));

      // 4. workflow_progress on disk is byte-for-byte unchanged (unstarted / not yet activated)
      const currentChangeYaml = fs.readFileSync(changeYamlPath, 'utf8');
      assert.equal(currentChangeYaml, initialChangeYaml, 'change.yaml must be byte-for-byte unchanged');

      // 5. Remediation: remove the dirty file (simulating user instruction / cleanup)
      fs.unlinkSync(dirtyFile);

      // 6. Retry workflow step start with the admitted session ambient env
      process.env.NEVO_SESSION_ID = data.sessionId;
      const stepContext = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });

      assert.ok(stepContext, 'handleWorkflowStepStart must return StepContext');
      assert.equal(stepContext.currentStep, 'implementation');
      assert.equal(stepContext.runtimeState, 'active');

      // Progress is now activated
      const updatedChange = requireChange(fx.changeSlug, fx.activeDir);
      const updatedTask = requireTask(updatedChange, fx.taskId);
      assert.equal(updatedTask.workflow_progress?.state, 'active');
      assert.equal(updatedTask.workflow_progress?.current_step, 'implementation');
      assert.equal(updatedTask.workflow_progress?.current_attempt, 1);

      // Release admitted execution
      await releaseAdmittedExecution(fx.specId);
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test(
    'Acceptance Scenario A (2): Abandoned-remediation variant (F1/F4) terminates with resumable outcome, releases claim, and later execution succeeds upon remediation',
    async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-abandoned',
      specId: '22222222-2222-4222-8222-222222222202',
      changeSlug: 'spec-scenario-a-2',
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;
    let ai = null;

    try {
      ai = await createAiApp(fx.root, fx.specId);

      const changeYamlPath = path.join(fx.root, 'specs', 'active', fx.changeSlug, 'change.yaml');
      const initialChangeYaml = fs.readFileSync(changeYamlPath, 'utf8');

      // Introduce dirty file
      const dirtyFile = path.join(fx.root, 'unrelated-dirty.txt');
      fs.writeFileSync(dirtyFile, 'uncommitted file\n', 'utf8');

      // First turn execution admission
      const res1 = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      assert.equal(res1.statusCode, 201);
      const data1 = JSON.parse(res1.body);
      assert.ok(getWorkspaceWriterClaim(fx.root), 'Claim acquired for turn 1');

      // The turn ends WITHOUT remediating (dirty file is still present)
      const relRes = await releaseAdmittedExecution(fx.specId);

      // Assert: terminal classification is outcome: 'resumable', NEVER 'recovery-required'
      assert.equal(relRes.outcome, 'resumable', "Terminal classification outcome must be 'resumable'");
      assert.equal(relRes.released, true, 'Workspace writer claim must be released');
      assert.equal(relRes.markedRecovery, undefined, 'Must not be marked recovery-required');

      // Workspace-writer claim is released cleanly (null)
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be null after resumable release');

      // workflow_progress remains byte-for-byte unchanged (still unactivated)
      assert.equal(fs.readFileSync(changeYamlPath, 'utf8'), initialChangeYaml, 'change.yaml remains untouched');

      // Deterministically hold the second turn's provider execution open before admitting
      // it, so this test can observe the live claim before the mock turn's own background
      // completion could settle it. Never race HTTP 201 against the provider's natural
      // completion — the mock's streamDelayMs is short enough that the turn can otherwise
      // finish (and release the claim) before this test's own assertions run.
      let releaseSecondTurn;
      const secondTurnGate = new Promise((resolve) => {
        releaseSecondTurn = resolve;
      });
      const originalStartTurn = ai.provider.startTurn.bind(ai.provider);
      ai.provider.startTurn = async (opts) => {
        await secondTurnGate;
        return originalStartTurn(opts);
      };

      // Later execution is admitted again (Session 2) — the underlying provider turn is
      // held live (gated above) until explicitly released further down.
      const res2 = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      assert.equal(res2.statusCode, 201, 'Later execution should be admitted successfully (201)');
      const data2 = JSON.parse(res2.body);
      assert.notEqual(data2.turnId, data1.turnId, 'Must be a distinct turn');

      // Receives the same structured blocker
      const canonicalTurn2 = ai.turnRuntime.getCanonicalTurn(data2.turnId);
      assert.ok(canonicalTurn2.prompt.includes('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'));
      assert.ok(canonicalTurn2.prompt.includes('unrelated-dirty.txt'));

      // Claim held by Session 2 — deterministic, not timing-dependent: the turn is still
      // gated open, so no natural completion could have released it yet.
      const claim2 = getWorkspaceWriterClaim(fx.root);
      assert.ok(claim2, 'claim2 must exist after the second admission');
      assert.equal(claim2.sessionId, data2.sessionId);

      // Remediation and attempt activation happen while the turn is still live.
      fs.unlinkSync(dirtyFile);

      process.env.NEVO_SESSION_ID = data2.sessionId;
      const stepContext2 = await handleWorkflowStepStart(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(stepContext2.currentStep, 'implementation');
      assert.equal(stepContext2.runtimeState, 'active');

      const updatedTask = requireTask(requireChange(fx.changeSlug, fx.activeDir), fx.taskId);
      assert.equal(updatedTask.workflow_progress?.state, 'active');

      // Explicitly allow the provider turn to complete, then deterministically await its
      // own terminal settlement (Hook 1's real subscription path, not a manual trigger) —
      // never a sleep or poll.
      releaseSecondTurn();
      await waitForActiveExecutionSettled(fx.specId);

      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be released once the second turn settles');
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Acceptance Scenario A (3): Safely-replayable FINISH_OPERATION_UNRESOLVED admits execution with structured blocker, and retrying workflow step finish completes step', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-rep-finish',
      specId: '22222222-2222-4222-8222-222222222203',
      changeSlug: 'spec-scenario-a-3',
      workflowProgress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            transitioned_to: 'review',
          },
        ],
      },
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;
    let ai = null;

    try {
      // Record a safely-replayable finish operation record
      saveOperationRecord(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        operationId: 'op-replayable-immediate',
        status: 'running',
        resolvedInputs: {
          'commit.title': 'Finish implementation for task t1',
        },
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'pending' },
          { id: 'commit', status: 'pending' },
          { id: 'push', status: 'pending' },
          { id: 'transition', status: 'pending' },
        ],
      });

      ai = await createAiApp(fx.root, fx.specId);

      // Request deterministic execution
      const res = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      assert.equal(res.statusCode, 201, `Expected 201 Created but got: ${res.body}`);
      const data = JSON.parse(res.body);

      // Structured activation blocker is present on turn prompt
      const canonicalTurn = ai.turnRuntime.getCanonicalTurn(data.turnId);
      assert.ok(canonicalTurn.prompt.includes('FINISH_OPERATION_UNRESOLVED'));
      assert.ok(canonicalTurn.prompt.includes("retry 'workflow step finish'"));

      // Readiness check reports replayable finish
      const readiness = assertTaskExecutionReadiness(fx.specId, fx.taskId, fx.root);
      assert.equal(readiness.code, 'FINISH_OPERATION_UNRESOLVED');
      assert.equal(readiness.replayableFinish, true);

      // Remediation action exercised is retrying workflow step finish itself — NEVER an ad hoc git operation
      process.env.NEVO_SESSION_ID = data.sessionId;
      const finishRes = await handleWorkflowStepFinish(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });

      assert.ok(finishRes);
      assert.equal(finishRes.status, 'completed');

      // Operation record is now completed
      const recordAfter = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(recordAfter.status, 'completed');

      await releaseAdmittedExecution(fx.specId);
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Acceptance Scenario A (4): Abandoned-remediation variant for replayable finish terminates with resumable outcome and leaves record intact for later replay', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-rep-abandoned',
      specId: '22222222-2222-4222-8222-222222222204',
      changeSlug: 'spec-scenario-a-4',
      workflowProgress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            transitioned_to: 'review',
          },
        ],
      },
    });
    const savedEnvSession = process.env.NEVO_SESSION_ID;
    let ai = null;

    try {
      saveOperationRecord(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        operationId: 'op-replayable-abandoned',
        status: 'running',
        resolvedInputs: {
          'commit.title': 'Finish implementation for task t1',
        },
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'pending' },
          { id: 'commit', status: 'pending' },
          { id: 'push', status: 'pending' },
          { id: 'transition', status: 'pending' },
        ],
      });

      ai = await createAiApp(fx.root, fx.specId);

      // Admission 1
      const res1 = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      assert.equal(res1.statusCode, 201);
      const data1 = JSON.parse(res1.body);

      // Turn ends without finishing
      const relRes = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes.outcome, 'resumable', 'Terminal classification must be resumable');
      assert.equal(relRes.released, true);
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim released');

      // Durable operation record remains intact (status: 'running')
      const loadedOp = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.ok(loadedOp);
      assert.equal(loadedOp.status, 'running');

      // Admission 2 (later execution)
      const res2 = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      assert.equal(res2.statusCode, 201);
      const data2 = JSON.parse(res2.body);

      // Replay finish to completion in second execution
      process.env.NEVO_SESSION_ID = data2.sessionId;
      const finishRes = await handleWorkflowStepFinish(fx.changeSlug, fx.taskId, {
        repoRoot: fx.root,
        activeDir: fx.activeDir,
      });
      assert.equal(finishRes.status, 'completed');

      const finalOp = loadOperationRecord(fx.root, fx.changeSlug, fx.taskId, 'implementation', 1);
      assert.equal(finalOp.status, 'completed');

      await releaseAdmittedExecution(fx.specId);
    } finally {
      if (savedEnvSession !== undefined) process.env.NEVO_SESSION_ID = savedEnvSession;
      else delete process.env.NEVO_SESSION_ID;
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Acceptance Scenario A (5): Non-replayable FINISH_OPERATION_UNRESOLVED (status: blocked/unknown) fails closed (409 Conflict) and never creates session/turn', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-non-rep',
      specId: '22222222-2222-4222-8222-222222222205',
      changeSlug: 'spec-scenario-a-5',
      workflowProgress: {
        current_step: 'implementation',
        current_attempt: 1,
        state: 'completed',
        history: [
          {
            step: 'implementation',
            attempt: 1,
            transitioned_to: 'review',
          },
        ],
      },
    });
    let ai = null;

    try {
      // Non-replayable finish operation record (status: 'blocked')
      saveOperationRecord(fx.root, {
        change: fx.changeSlug,
        task: fx.taskId,
        step: 'implementation',
        attempt: 1,
        operationId: 'op-blocked-finish',
        status: 'blocked',
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'blocked' },
        ],
      });

      ai = await createAiApp(fx.root, fx.specId);

      const res = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: fx.taskId,
          purpose: 'execution',
        },
      });

      // Fails closed with 409 Conflict
      assert.equal(res.statusCode, 409, `Expected 409 Conflict but got: ${res.statusCode} ${res.body}`);
      const data = JSON.parse(res.body);
      assert.equal(data.error.code, 'NO_RUNNABLE_TASK');

      // No claim was acquired
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'No workspace claim should be acquired');
    } finally {
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Acceptance Scenario A (6): Admission-blocking readiness failure (TASK_UNPUBLISHED) fails closed (409 Conflict) and never creates session/turn', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-unpublished',
      specId: '22222222-2222-4222-8222-222222222206',
      changeSlug: 'spec-scenario-a-6',
    });
    let ai = null;

    try {
      ai = await createAiApp(fx.root, fx.specId);

      // Request execution for t-draft (status: draft)
      const res = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: {
          'content-type': 'application/json',
          'x-nevo-dashboard-action': '1',
        },
        payload: {
          provider: 'mock',
          specId: fx.specId,
          changeSlug: fx.changeSlug,
          taskId: 't-draft',
          purpose: 'execution',
        },
      });

      // Fails closed with 409 Conflict
      assert.equal(res.statusCode, 409, `Expected 409 Conflict but got: ${res.statusCode} ${res.body}`);
      const data = JSON.parse(res.body);
      assert.equal(data.error.code, 'NO_RUNNABLE_TASK');

      // No claim was acquired
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'No workspace claim should be acquired');
    } finally {
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });

  test('Acceptance Scenario A (7) / Case E: Existing-session route (POST /:sessionId/turns) — the route the UI\'s explicit "Start agent step" now uses — honors the workflow\'s own session policy (fresh, here) rather than reusing the URL\'s session, and still admits for activation-only remediation with correct bootstrap; abandoned remediation settles resumable', async () => {
    resetAdmissionStateForTest();
    const fx = makeFixtureRepo({
      prefix: 'scen-a-existing-session',
      specId: '22222222-2222-4222-8222-222222222207',
      changeSlug: 'spec-scenario-a-7',
    });
    let ai = null;

    try {
      ai = await createAiApp(fx.root, fx.specId);

      // 1. Introduce a dirty, out-of-scope file and admit a first turn via the no-sessionId
      //    route to establish an existing session bound to the task (abandoned without
      //    remediating, exactly like Scenario A (2), so nothing ever genuinely advances —
      //    this avoids any risk of automatic continuation picking up a different step).
      const dirtyFile = path.join(fx.root, 'unrelated-dirty.txt');
      fs.writeFileSync(dirtyFile, 'uncommitted file\n', 'utf8');

      const res1 = await ai.app.inject({
        method: 'POST',
        url: '/api/agent-sessions/turns',
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: { provider: 'mock', specId: fx.specId, changeSlug: fx.changeSlug, taskId: fx.taskId, purpose: 'execution' },
      });
      assert.equal(res1.statusCode, 201);
      const data1 = JSON.parse(res1.body);

      // Deterministically await the first turn's own natural terminal settlement (never a
      // manual force-release here) — the turn-runtime's per-session "live turn" tracking
      // only clears once the turn itself goes terminal, so reusing this same sessionId for
      // a second turn below must not race that.
      const relRes1 = await waitForActiveExecutionSettled(fx.specId);
      assert.equal(relRes1.outcome, 'resumable');
      assert.equal(getWorkspaceWriterClaim(fx.root), null);

      // Deterministically hold the second turn's provider execution open — never race
      // HTTP 202 against the mock's own fast background completion (same technique as
      // Acceptance Scenario A (2) above).
      let releaseSecondTurn;
      const secondTurnGate = new Promise((resolve) => {
        releaseSecondTurn = resolve;
      });
      const originalStartTurn = ai.provider.startTurn.bind(ai.provider);
      ai.provider.startTurn = async (opts) => {
        await secondTurnGate;
        return originalStartTurn(opts);
      };

      // 2. Explicit execution through the EXISTING-session route — this is the exact route
      //    agent-session-page.tsx's handleStartAgentStep now uses (POST /:sessionId/turns
      //    with purpose: 'execution' + taskId), invoked from inside data1's session. This
      //    task's entry step has no incoming transition, so its session policy defaults to
      //    'fresh' (same as the canonical new-session route) — session-policy unification
      //    means this must still admit a brand-new session, never silently reuse
      //    data1.sessionId merely because that's the URL the action was invoked from.
      const res2 = await ai.app.inject({
        method: 'POST',
        url: `/api/agent-sessions/${data1.sessionId}/turns`,
        headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
        payload: {
          purpose: 'execution',
          taskId: fx.taskId,
          changeSlug: fx.changeSlug,
          message: `Execute the current workflow step for task ${fx.taskId}.`,
          userMessage: `Execute the current workflow step for task ${fx.taskId}.`,
        },
      });
      assert.equal(res2.statusCode, 202, `Expected 202 Accepted but got: ${res2.statusCode} ${res2.body}`);
      const data2 = JSON.parse(res2.body);
      assert.notEqual(data2.sessionId, data1.sessionId, 'Fresh session policy must win over the URL the action was invoked from');
      assert.equal(data2.isNewSession, true);

      // Workflow bootstrap contains the same structured activation blocker — the
      // preActivationBlocker/resumable semantics introduced in 3e5ddd6a remain intact
      // after session-policy unification.
      const canonicalTurn2 = ai.turnRuntime.getCanonicalTurn(data2.turnId);
      assert.ok(canonicalTurn2.prompt.includes('DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT'));
      assert.ok(canonicalTurn2.prompt.includes('unrelated-dirty.txt'));

      // Execution was admitted: claim exists for the newly-admitted session —
      // deterministic, not timing-dependent, since the turn is still gated open.
      const claim2 = getWorkspaceWriterClaim(fx.root);
      assert.ok(claim2, 'Claim must exist for the admitted remediation turn');
      assert.equal(claim2.sessionId, data2.sessionId);

      // 3. Explicitly allow the provider turn to complete (abandoned, no remediation),
      //    then deterministically await its own terminal settlement.
      releaseSecondTurn();
      const relRes2 = await waitForActiveExecutionSettled(fx.specId);
      assert.equal(relRes2.outcome, 'resumable', "Must settle resumable, never recovery-required (ADR-0009)");
      assert.equal(relRes2.released, true);
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be released; no recovery-required state remains');
    } finally {
      if (ai?.app) await ai.app.close();
      if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
      resetAdmissionStateForTest();
      if (fx?.root) fs.rmSync(fx.root, { recursive: true, force: true });
      if (fx?.remote) fs.rmSync(fx.remote, { recursive: true, force: true });
    }
  });
});
