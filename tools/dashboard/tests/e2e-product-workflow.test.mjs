import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildDashboardApp } from '../server/index.mjs';
import { handleWorkflowStepStart, handleWorkflowStepFinish } from '../../specs/workflow/cli.mjs';
import { requireChange, requireTask } from '../../specs/store.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';

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

const AI_PROVIDERS_CONFIG = `version: 1
providers:
  mock:
    enabled: true
`;

function createGitFixture(prefix = 'nevo-e2e-product-workflow-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });

  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Nevo E2E Tester']);
  git(['config', 'user.email', 'tester@nevo.local']);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'standard-v1.yaml'), STANDARD_V1_YAML);

  const localAiDir = join(repo, '.nevo-ai-local');
  mkdirSync(localAiDir, { recursive: true });
  writeFileSync(join(localAiDir, 'ai-providers.yaml'), AI_PROVIDERS_CONFIG);

  const activeDir = join(repo, 'specs', 'active');
  const archiveDir = join(repo, 'specs', 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'e2e-workflow-pkg', version: '1.0.0', type: 'module' }, null, 2),
  );
  writeFileSync(join(repo, 'root.txt'), 'initial\n');
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);

  return {
    base,
    repo,
    activeDir,
    archiveDir,
    git,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {}
    },
  };
}

async function waitForSessionTurn(app, sessionId, maxAttempts = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/agent-sessions/${sessionId}`,
    });
    if (res.statusCode === 200) {
      const session = res.json().session;
      if (session?.turns && session.turns.length > 0) {
        const lastTurn = session.turns[session.turns.length - 1];
        const turnStatus = lastTurn.status?.status ?? lastTurn.status;
        const turnOutcome = lastTurn.status?.outcome ?? lastTurn.terminalOutcome?.outcome;
        if (turnStatus === 'terminal' || turnOutcome === 'completed' || lastTurn.status === 'completed') {
          return session;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for session ${sessionId} turn completion.`);
}

function control(payload = {}) {
  return {
    headers: {
      'content-type': 'application/json',
      'x-nevo-dashboard-action': '1',
    },
    payload,
  };
}

describe('Task 03: End-to-End Application Bootstrap & Product Workflow (18-Step Proof)', () => {
  let fx;
  let app;
  const specId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
  const changeSlug = 'test-spec';
  const taskId = '01';
  let changeDir;
  let tasksDir;
  let originalEnvSession;
  let originalEnvProvider;

  before(async () => {
    originalEnvSession = process.env.NEVO_SESSION_ID;
    originalEnvProvider = process.env.NEVO_AGENT_PROVIDER;

    fx = createGitFixture();

    changeDir = join(fx.activeDir, changeSlug);
    tasksDir = join(changeDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(changeDir, 'change.yaml'),
      `id: ${changeSlug}
title: "Test Specification"
type: standard
status: in-implementation
spec_id: "${specId}"
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: "${taskId}"
    order: 1
    file: tasks/01-task.md
    status: in-implementation
    allowed_paths:
      - src/**
      - specs/active/${changeSlug}/reviews/**
`,
    );

    writeFileSync(
      join(tasksDir, '01-task.md'),
      `---
id: ${changeSlug}.${taskId}
status: in-implementation
change: ${changeSlug}
allowed_paths:
  - src/**
  - specs/active/${changeSlug}/reviews/**
---
# Task 01: Core Feature
`,
    );

    fx.git(['add', '-A']);
    fx.git(['commit', '-m', 'add test-spec change and task 01']);

    app = await buildDashboardApp({
      config: {
        root: fx.repo,
        activeDir: fx.activeDir,
        archiveDir: fx.archiveDir,
      },
    });
  });

  after(async () => {
    if (originalEnvSession !== undefined) process.env.NEVO_SESSION_ID = originalEnvSession;
    else delete process.env.NEVO_SESSION_ID;

    if (originalEnvProvider !== undefined) process.env.NEVO_AGENT_PROVIDER = originalEnvProvider;
    else delete process.env.NEVO_AGENT_PROVIDER;

    if (app) await app.close();
    if (fx) fx.cleanup();
  });

  let implementationSession;
  let reviewerSession;
  let sessionAfterTurn1;
  let headBeforeReviewFail;

  test('Step 1: Create agent conversation for spec test-spec, task 01', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      ...control({
        specId,
        taskId,
        taskIds: [taskId],
        provider: 'mock',
        mode: 'edit',
      }),
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.session);
    implementationSession = body.session;
  });

  test('Step 2: Canonical AgentSession created and durably persisted with UUID sessionId before provider execution', async () => {
    assert.ok(implementationSession.sessionId);
    assert.match(
      implementationSession.sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'sessionId must be a canonical UUID',
    );
    assert.equal(implementationSession.providerSessionId, undefined, 'providerSessionId should initially be absent');

    const resGet = await app.inject({
      method: 'GET',
      url: `/api/agent-sessions/${implementationSession.sessionId}`,
    });
    assert.equal(resGet.statusCode, 200);
    assert.equal(resGet.json().session.sessionId, implementationSession.sessionId);
  });

  test('Step 3: First turn receives deterministic workflow bootstrap header and clean userMessage', async () => {
    const resTurn = await app.inject({
      method: 'POST',
      url: `/api/agent-sessions/${implementationSession.sessionId}/turns`,
      ...control({
        message: 'Implement task 01 acceptance criteria',
      }),
    });
    assert.ok([200, 202].includes(resTurn.statusCode));

    sessionAfterTurn1 = await waitForSessionTurn(app, implementationSession.sessionId);
    assert.ok(sessionAfterTurn1.turns && sessionAfterTurn1.turns.length > 0);
    const firstTurn = sessionAfterTurn1.turns[0];
    assert.equal(
      firstTurn.userMessage?.text,
      'Implement task 01 acceptance criteria',
      'userMessage must be clean conversational text',
    );
  });

  test('Step 4: Agent process runs workflow step start -> SessionTaskBinding created automatically via ambient NEVO_SESSION_ID', async () => {
    process.env.NEVO_SESSION_ID = implementationSession.sessionId;
    process.env.NEVO_AGENT_PROVIDER = 'mock';

    const stepContext = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.attempt, 1);
    assert.equal(stepContext.runtimeState, 'active');

    const bindingService = createAgentSessionBindingService({
      storageDir: join(fx.repo, '.nevo-ai-local', 'sessions'),
    });
    const binding = bindingService.resolveCurrentBindingSync('mock', implementationSession.sessionId);
    assert.ok(binding, 'SessionTaskBinding must be automatically created on step start');
    assert.equal(binding.sessionId, implementationSession.sessionId);
    assert.equal(binding.taskId, taskId);
    assert.equal(binding.step, 'implementation');
    assert.equal(binding.attempt, 1);
  });

  test('Step 5: Provider-native identity is correlated to the same AgentSession without changing canonical sessionId', async () => {
    assert.ok(sessionAfterTurn1.providerSessionId, 'providerSessionId should be correlated after provider run');
    assert.equal(sessionAfterTurn1.sessionId, implementationSession.sessionId, 'canonical sessionId remains constant');

    const resChat = await app.inject({
      method: 'GET',
      url: `/api/agent-sessions/${implementationSession.sessionId}/chat`,
    });
    assert.equal(resChat.statusCode, 200);
    const chatData = resChat.json();
    assert.equal(chatData.session.sessionId, implementationSession.sessionId);
    assert.equal(chatData.session.providerSessionId, sessionAfterTurn1.providerSessionId);
  });

  test('Step 6: Implementation finish transitions to review; git branch committed and tagged', async () => {
    mkdirSync(join(fx.repo, 'src'), { recursive: true });
    writeFileSync(join(fx.repo, 'src', 'feature.txt'), 'Feature 01 implementation attempt 1\n');

    const finishResult = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        'commit.title': 'feat: implement task 01',
      }),
    });

    assert.equal(finishResult.status, 'completed');
    assert.equal(finishResult.transition.to.step, 'review');

    const lastCommitSubject = fx.git(['log', '-1', '--pretty=%s']).trim();
    assert.equal(lastCommitSubject, 'feat: implement task 01');

    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.state, 'completed');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'implementation');
    assert.equal(lastHistory.transitioned_to, 'review');
  });

  test('Step 7: Implementation agent stops (no autonomous handover)', async () => {
    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.state, 'completed');
  });

  test('Step 8: Reviewer session explicitly started for task 01', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      ...control({
        specId,
        taskId,
        taskIds: [taskId],
        provider: 'mock',
        mode: 'edit',
        purpose: 'review',
      }),
    });

    assert.equal(res.statusCode, 201);
    reviewerSession = res.json().session;
    assert.ok(reviewerSession.sessionId);
    assert.notEqual(reviewerSession.sessionId, implementationSession.sessionId);
  });

  test('Step 9: Reviewer step start resolves review #1', async () => {
    process.env.NEVO_SESSION_ID = reviewerSession.sessionId;

    const stepContext = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'review');
    assert.equal(stepContext.attempt, 1);
    assert.equal(stepContext.runtimeState, 'active');
  });

  test('Step 10: Review fails, writes review artifact, calls step finish with result fail', async () => {
    const reviewsDir = join(changeDir, 'reviews');
    mkdirSync(reviewsDir, { recursive: true });
    writeFileSync(
      join(reviewsDir, 'task-01-attempt-1.md'),
      '# Review Attempt 1: Failed\nUnit tests failed on boundary conditions.\n',
    );

    headBeforeReviewFail = fx.git(['rev-parse', 'HEAD']).trim();

    const finishResult = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        result: 'fail',
        feedback: 'Unit tests failed',
        artifacts: [`specs/active/${changeSlug}/reviews/task-01-attempt-1.md`],
        'commit.title': 'review(01): fail attempt 1',
      }),
    });

    assert.equal(finishResult.status, 'completed');
  });

  test('Step 11: Task transitions directly to in-implementation attempt 2 (commit HEAD verified untouched / implementation preserved)', async () => {
    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.state, 'completed');

    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'review');
    assert.equal(lastHistory.attempt, 1);
    assert.equal(lastHistory.result, 'fail');
    assert.equal(lastHistory.transitioned_to, 'implementation');
    assert.deepEqual(lastHistory.artifacts, [`specs/active/${changeSlug}/reviews/task-01-attempt-1.md`]);

    const commits = fx.git(['log', '-2', '--pretty=%H %P']).trim();
    assert.ok(commits.includes(headBeforeReviewFail), 'Implementation commit is preserved');
  });

  test('Step 12: Next implementation context receives review feedback and artifact in previousTransition', async () => {
    process.env.NEVO_SESSION_ID = implementationSession.sessionId;

    const stepContext = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(stepContext.currentStep, 'implementation');
    assert.equal(stepContext.attempt, 2);
    assert.ok(stepContext.previousTransition, 'previousTransition must be populated');
    assert.equal(stepContext.previousTransition.from, 'review');
    assert.equal(stepContext.previousTransition.attempt, 1);
    assert.equal(stepContext.previousTransition.result, 'fail');
    assert.equal(stepContext.previousTransition.requestedChanges, 'Unit tests failed');
    assert.deepEqual(stepContext.previousTransition.artifacts, [`specs/active/${changeSlug}/reviews/task-01-attempt-1.md`]);
  });

  test('Step 13: Implementation #2 finishes -> review #2 runs and passes', async () => {
    writeFileSync(join(fx.repo, 'src', 'feature.txt'), 'Feature 01 implementation attempt 2 (fixed)\n');

    const finishImpl2 = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        'commit.title': 'fix: address review feedback for task 01',
      }),
    });
    assert.equal(finishImpl2.status, 'completed');

    process.env.NEVO_SESSION_ID = reviewerSession.sessionId;

    const review2Context = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });
    assert.equal(review2Context.currentStep, 'review');
    assert.equal(review2Context.attempt, 2);

    const finishReview2 = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        result: 'pass',
        'commit.title': 'review(01): pass attempt 2',
      }),
    });
    assert.equal(finishReview2.status, 'completed');
  });

  test('Step 14: Task transitions to awaiting-human-verification with generic start-step', async () => {
    const resActions = await app.inject({
      method: 'GET',
      url: `/api/specs/active/${changeSlug}/actions`,
    });

    assert.equal(resActions.statusCode, 200);
    const actionsData = resActions.json();
    assert.ok(actionsData.tasks[taskId]);
    assert.deepEqual(actionsData.tasks[taskId].availableActions, ['start-step']);

    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    assert.equal(task.status, 'in-implementation');
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.equal(task.workflow_progress.state, 'completed');
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'review');
    assert.equal(lastHistory.result, 'pass');
    assert.equal(lastHistory.transitioned_to, 'human-verification');
  });

  test('Step 15: Human [ Request changes ] dispatches POST human-decision -> transitions to implementation #3', async () => {
    const resReject = await app.inject({
      method: 'POST',
      url: `/api/specs/${changeSlug}/tasks/${taskId}/workflow/human-decision`,
      payload: {
        decision: 'request-changes',
        feedback: 'Please add documentation comments to feature 01',
      },
    });

    assert.equal(resReject.statusCode, 200);
    assert.equal(resReject.json().ok, true);

    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    const lastHistory = task.workflow_progress.history[task.workflow_progress.history.length - 1];
    assert.equal(lastHistory.step, 'human-verification');
    assert.equal(lastHistory.result, 'fail');
    assert.equal(lastHistory.transitioned_to, 'implementation');
    assert.equal(lastHistory.feedback, 'Please add documentation comments to feature 01');
  });

  test('Step 16: Implementation #3 finishes and review #3 passes -> task reaches awaiting-human-verification', async () => {
    process.env.NEVO_SESSION_ID = implementationSession.sessionId;

    const impl3Context = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });
    assert.equal(impl3Context.currentStep, 'implementation');
    assert.equal(impl3Context.attempt, 3);
    assert.equal(impl3Context.previousTransition.requestedChanges, 'Please add documentation comments to feature 01');

    writeFileSync(
      join(fx.repo, 'src', 'feature.txt'),
      '/** Feature 01 documentation */\nFeature 01 implementation attempt 3 (documented)\n',
    );

    const finishImpl3 = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        'commit.title': 'docs: add documentation comments for task 01',
      }),
    });
    assert.equal(finishImpl3.status, 'completed');

    process.env.NEVO_SESSION_ID = reviewerSession.sessionId;

    const review3Context = await handleWorkflowStepStart(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });
    assert.equal(review3Context.currentStep, 'review');
    assert.equal(review3Context.attempt, 3);

    const finishReview3 = await handleWorkflowStepFinish(changeSlug, taskId, {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
      input: JSON.stringify({
        result: 'pass',
        'commit.title': 'review(01): pass attempt 3',
      }),
    });
    assert.equal(finishReview3.status, 'completed');

    const resActions = await app.inject({
      method: 'GET',
      url: `/api/specs/active/${changeSlug}/actions`,
    });
    assert.deepEqual(resActions.json().tasks[taskId].availableActions, ['start-step']);
  });

  test('Step 17: Human [ Approve ] dispatches POST human-decision -> transitions to verified with clean tree commit', async () => {
    const headBeforeApprove = fx.git(['rev-parse', 'HEAD']).trim();

    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/specs/${changeSlug}/tasks/${taskId}/workflow/human-decision`,
      payload: {
        decision: 'approve',
      },
    });

    assert.equal(resApprove.statusCode, 200);
    assert.equal(resApprove.json().ok, true);

    const change = requireChange(changeSlug, fx.activeDir);
    const task = requireTask(change, taskId);
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.current_step, 'human-verification');
    assert.equal(task.workflow_progress.state, 'completed');

    const headAfterApprove = fx.git(['rev-parse', 'HEAD']).trim();
    assert.notEqual(headAfterApprove, headBeforeApprove, 'New verification commit must be created');

    const lastCommitSubject = fx.git(['log', '-1', '--pretty=%s']).trim();
    assert.match(lastCommitSubject, /verify\(01\): approve human verification/);
  });

  test('Step 18: Git working tree is clean; session history reflects multiple participating sessions', async () => {
    const porcelain = fx.git(['status', '--porcelain']).trim();
    assert.equal(porcelain, '', 'Working tree must be clean');

    const resSessions = await app.inject({
      method: 'GET',
      url: `/api/agent-sessions?specId=${specId}`,
    });
    assert.equal(resSessions.statusCode, 200);

    const sessions = resSessions.json().sessions;
    assert.ok(sessions.length >= 2, 'Must reflect multiple participating sessions');

    const sessionIds = sessions.map((s) => s.sessionId);
    assert.ok(sessionIds.includes(implementationSession.sessionId), 'Implementation session must be present');
    assert.ok(sessionIds.includes(reviewerSession.sessionId), 'Reviewer session must be present');
  });
});
