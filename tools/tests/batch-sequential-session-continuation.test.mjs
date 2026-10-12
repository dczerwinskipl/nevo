// Automated tests for batch sequential session continuation (Task 05 of session-continuity-choice, D3).
// Verifies:
// 1. Three tasks with candidates run as three turns in their three sessions, in selected order, never overlapping.
// 2. A task with no candidate or a provider mismatch rejects the whole request and starts nothing.
// 3. A non-settling middle turn stops the chain and leaves later tasks recorded as not started.
// 4. After a simulated restart the chain's remaining members are still recorded and resume or report explicitly.
//
// Run: node --test tools/tests/batch-sequential-session-continuation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

import { buildAiTestApp } from '../dashboard/tests/helpers/ai-test-app.mjs';
import { createMockAgentProvider } from '../dashboard/server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../dashboard/server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../dashboard/server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../dashboard/server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import {
  resetAdmissionStateForTest,
  releaseAdmittedExecution,
  getActiveAgentExecution,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import {
  resumeSequentialContinuationForSpec,
  sweepAllPendingHandovers,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';
import {
  loadSequentialContinuationChain,
  getActiveSequentialContinuationChain,
} from '../specs/workflow/queue/sequential-continuation.mjs';
import { executionPolicyService } from '../dashboard/server/ai/sessions/execution-policy-service.mjs';
import { releaseWorkspaceWriterIfOwned } from '../specs/workflow/workspace-writer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SPEC_ID = '77777777-7777-4777-8777-777777777777';
const SLUG = 'spec-seq-continuation';

function createTempRepo(prefix) {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Seq Continuation Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'seq-test@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Seq Continuation Test\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

  const wfDir = path.join(dir, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, 'choice-workflow.yaml'),
    JSON.stringify({
      id: 'choice-workflow',
      version: 1,
      entryStep: 'implementation',
      steps: {
        implementation: {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'implemented' },
          transitions: [
            {
              value: 'pass',
              to: 'review',
              execution: { session: 'fresh', allow: ['fresh', 'reuse'], reuseFrom: 'implementation', role: 'reviewer' },
            },
            {
              value: 'fail',
              to: 'implementation',
              execution: { session: 'reuse', allow: ['reuse', 'fresh'], reuseFrom: 'implementation', role: 'implementer' },
            },
          ],
        },
        review: {
          executor: 'agent',
          status: { active: 'in-review', completed: 'reviewed' },
          transitions: [
            {
              value: 'fail',
              to: 'implementation',
              execution: { session: 'reuse', allow: ['reuse', 'fresh'], reuseFrom: 'implementation', role: 'implementer' },
            },
            { value: 'pass', to: 'verified', outcome: 'success' },
          ],
        },
      },
    }, null, 2),
    'utf8',
  );

  const sess1 = '11111111-1111-4111-8111-111111111111';
  const sess2 = '22222222-2222-4222-8222-222222222222';
  const sess3 = '33333333-3333-4333-8333-333333333333';

  const specDir = path.join(dir, 'specs', 'active', SLUG);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'change.yaml'),
    `id: ${SLUG}
spec_id: ${SPEC_ID}
title: "Seq Continuation Spec"
status: in-progress
workflow:
  mode: deterministic
  definition: choice-workflow
tasks:
  - id: task1
    title: "Task 1"
    status: in-implementation
    file: tasks/task1.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          result: pass
          sessionId: "${sess1}"
          completed_at: "2026-09-28T09:00:00Z"
  - id: task2
    title: "Task 2"
    status: in-implementation
    file: tasks/task2.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          result: pass
          sessionId: "${sess2}"
          completed_at: "2026-09-28T09:10:00Z"
  - id: task3
    title: "Task 3"
    status: in-implementation
    file: tasks/task3.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          result: pass
          sessionId: "${sess3}"
          completed_at: "2026-09-28T09:20:00Z"
  - id: taskNoCandidate
    title: "Task with no candidate"
    status: in-implementation
    file: tasks/taskNoCandidate.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
`,
  );
  fs.writeFileSync(path.join(specDir, 'overview.md'), '# Overview\n');
  fs.writeFileSync(path.join(tasksDir, 'task1.md'), '---\nid: task1\nstatus: in-implementation\n---\n# Task 1\n');
  fs.writeFileSync(path.join(tasksDir, 'task2.md'), '---\nid: task2\nstatus: in-implementation\n---\n# Task 2\n');
  fs.writeFileSync(path.join(tasksDir, 'task3.md'), '---\nid: task3\nstatus: in-implementation\n---\n# Task 3\n');
  fs.writeFileSync(path.join(tasksDir, 'taskNoCandidate.md'), '---\nid: taskNoCandidate\nstatus: in-implementation\n---\n# Task No Candidate\n');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' });

  return { dir, sess1, sess2, sess3 };
}

function makeProvider(id) {
  const p = createMockAgentProvider({ streamDelayMs: 1 });
  p.descriptor = { ...p.descriptor, id, label: id };
  return p;
}

async function createApp(tmpRepo) {
  const registry = createAgentProviderRegistry([makeProvider('claude'), makeProvider('codex')]);
  const transcriptCache = createTranscriptCacheService({ baseDir: path.join(tmpRepo, '.nevo-ai-local', 'transcripts') });
  const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService, repoRoot: tmpRepo });
  const app = await buildAiTestApp({ service, repoRoot: tmpRepo });
  return { app, service, turnRuntime, bindingService };
}

async function bindTestSession(ai, sessionId, taskId, provider = 'claude') {
  await ai.bindingService.bindSession({
    sessionId,
    providerSessionId: `prov-${sessionId}`,
    provider,
    specId: SPEC_ID,
    taskId,
    activeTaskId: taskId,
    purpose: 'execution',
    mode: 'agent',
  });
  await ai.service.createSession({ provider, specId: SPEC_ID, taskId, sessionId });
}

function advanceTaskProgress(tmpRepo, taskId, step = 'review') {
  const changePath = path.join(tmpRepo, 'specs', 'active', SLUG, 'change.yaml');
  const raw = fs.readFileSync(changePath, 'utf8');
  const doc = YAML.parse(raw);
  const task = doc.tasks?.find((t) => t.id === taskId);
  if (task && task.workflow_progress) {
    if (!Array.isArray(task.workflow_progress.history)) {
      task.workflow_progress.history = [];
    }
    task.workflow_progress.history.push({
      step,
      attempt: 1,
      result: 'pass',
      completed_at: '2026-09-28T12:00:00Z',
    });
  }
  fs.writeFileSync(changePath, YAML.stringify(doc), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: tmpRepo });
  execFileSync('git', ['commit', '-m', `advance progress for ${taskId}`], { cwd: tmpRepo });
}

test('batch sequential session continuation: 3 tasks run as 3 turns in their 3 sessions, never overlapping', async () => {
  const { dir: tmpRepo, sess1, sess2, sess3 } = createTempRepo('three-turns');
  let ai = null;
  try {
    ai = await createApp(tmpRepo);

    // Register sessions in bindingService with provider 'claude'
    await bindTestSession(ai, sess1, 'task1', 'claude');
    await bindTestSession(ai, sess2, 'task2', 'claude');
    await bindTestSession(ai, sess3, 'task3', 'claude');

    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
    }, { repoRoot: tmpRepo });

    // Request batch continuation across task1, task2, task3
    const res = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskIds: ['task1', 'task2', 'task3'],
        batchContinuation: true,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sess1, 'First turn starts in candidate session 1');
    assert.ok(body.chainId, 'Chain id returned');

    let chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.status, 'running');
    assert.equal(chain.currentTaskIndex, 0);
    assert.equal(chain.tasks[0].status, 'running');
    assert.equal(chain.tasks[1].status, 'not-started');
    assert.equal(chain.tasks[2].status, 'not-started');

    // Settle turn 1 cleanly
    advanceTaskProgress(tmpRepo, 'task1', 'review');
    await releaseAdmittedExecution(SPEC_ID);

    chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.currentTaskIndex, 1);
    assert.equal(chain.tasks[0].status, 'completed');
    assert.equal(chain.tasks[1].status, 'running');
    assert.equal(chain.tasks[1].sessionId, sess2, 'Second turn runs in candidate session 2');
    assert.equal(chain.tasks[2].status, 'not-started');

    // Settle turn 2 cleanly
    advanceTaskProgress(tmpRepo, 'task2', 'review');
    await releaseAdmittedExecution(SPEC_ID);

    chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.currentTaskIndex, 2);
    assert.equal(chain.tasks[1].status, 'completed');
    assert.equal(chain.tasks[2].status, 'running');
    assert.equal(chain.tasks[2].sessionId, sess3, 'Third turn runs in candidate session 3');

    // Settle turn 3 cleanly
    advanceTaskProgress(tmpRepo, 'task3', 'review');
    await releaseAdmittedExecution(SPEC_ID);

    chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.status, 'completed');
    assert.equal(chain.tasks[2].status, 'completed');
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('batch sequential session continuation: rejects whole request if any task has no candidate or provider mismatch', async () => {
  const { dir: tmpRepo, sess1 } = createTempRepo('validation-reject');
  let ai = null;
  try {
    ai = await createApp(tmpRepo);

    await bindTestSession(ai, sess1, 'task1', 'claude');

    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
    }, { repoRoot: tmpRepo });

    // Request with task1 (valid) and taskNoCandidate (missing candidate)
    const resNoCandidate = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskIds: ['task1', 'taskNoCandidate'],
        batchContinuation: true,
      },
    });

    assert.equal(resNoCandidate.statusCode, 400);
    const body = JSON.parse(resNoCandidate.body);
    assert.equal(body.error.taskId, 'taskNoCandidate');
    assert.match(body.error.message, /taskNoCandidate/i);
    assert.equal(getActiveAgentExecution(SPEC_ID), null, 'Nothing is started');

    // Provider mismatch: candidate session uses 'claude', but policy uses 'codex'
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'codex',
      mode: 'agent',
    }, { repoRoot: tmpRepo });

    const resMismatch = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskIds: ['task1'],
        batchContinuation: true,
      },
    });

    assert.equal(resMismatch.statusCode, 400);
    const mismatchBody = JSON.parse(resMismatch.body);
    assert.equal(mismatchBody.error.taskId, 'task1');
    assert.equal(mismatchBody.error.code, 'PROVIDER_MISMATCH');
    assert.equal(getActiveAgentExecution(SPEC_ID), null, 'Nothing is started');
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('batch sequential session continuation: non-settling middle turn stops chain and leaves later tasks recorded as not-started', async () => {
  const { dir: tmpRepo, sess1, sess2, sess3 } = createTempRepo('middle-turn-stops');
  let ai = null;
  try {
    ai = await createApp(tmpRepo);

    await bindTestSession(ai, sess1, 'task1', 'claude');
    await bindTestSession(ai, sess2, 'task2', 'claude');
    await bindTestSession(ai, sess3, 'task3', 'claude');

    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
    }, { repoRoot: tmpRepo });

    const res = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskIds: ['task1', 'task2', 'task3'],
        batchContinuation: true,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);

    // Settle turn 1 cleanly
    advanceTaskProgress(tmpRepo, 'task1', 'review');
    await releaseAdmittedExecution(SPEC_ID);

    let chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.currentTaskIndex, 1);
    assert.equal(chain.tasks[1].status, 'running');

    // Turn 2 does NOT settle cleanly: release execution without advancing task progress (leaves resumable)
    await releaseAdmittedExecution(SPEC_ID);

    chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.status, 'stopped', 'Chain is stopped');
    assert.notEqual(chain.tasks[1].status, 'completed', 'Task 2 did not complete');
    assert.equal(chain.tasks[2].status, 'not-started', 'Task 3 remains not-started');
    assert.equal(getActiveAgentExecution(SPEC_ID), null, 'Task 3 was not started');

    // Query status endpoint GET /api/agent-sessions/chains/:chainId
    const statusRes = await ai.app.inject({
      method: 'GET',
      url: `/api/agent-sessions/chains/${body.chainId}`,
    });
    assert.equal(statusRes.statusCode, 200);
    const statusData = JSON.parse(statusRes.body);
    assert.equal(statusData.chain.status, 'stopped');
    assert.equal(statusData.chain.tasks[2].status, 'not-started');
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('batch sequential session continuation: simulated restart reloads chain and sweepAllPendingHandovers resumes it', async () => {
  const { dir: tmpRepo, sess1, sess2, sess3 } = createTempRepo('simulated-restart');
  let ai = null;
  try {
    ai = await createApp(tmpRepo);

    await bindTestSession(ai, sess1, 'task1', 'claude');
    await bindTestSession(ai, sess2, 'task2', 'claude');
    await bindTestSession(ai, sess3, 'task3', 'claude');

    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
    }, { repoRoot: tmpRepo });

    const res = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskIds: ['task1', 'task2', 'task3'],
        batchContinuation: true,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);

    // Settle turn 1 cleanly before simulated crash
    advanceTaskProgress(tmpRepo, 'task1', 'review');
    await releaseWorkspaceWriterIfOwned({
      repoRoot: tmpRepo,
      expectedKind: 'agent',
      expectedSpecId: SPEC_ID,
      expectedChangeSlug: SLUG,
    });

    // Simulate restart: close app, reset in-memory state (Hook 1 never ran before crash)
    await ai.app.close();
    await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();

    // Re-create app from scratch
    ai = await createApp(tmpRepo);

    // Run sweepAllPendingHandovers (executed on boot reconciliation)
    await sweepAllPendingHandovers({
      repoRoot: tmpRepo,
      options: { sessionService: ai.service, turnRuntime: ai.turnRuntime },
    });

    const chain = loadSequentialContinuationChain(tmpRepo, SLUG, body.chainId);
    assert.equal(chain.currentTaskIndex, 1, 'Resumed and advanced to task 2');
    assert.equal(chain.tasks[0].status, 'completed');
    assert.equal(chain.tasks[1].status, 'running');
    assert.equal(chain.tasks[1].sessionId, sess2);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
