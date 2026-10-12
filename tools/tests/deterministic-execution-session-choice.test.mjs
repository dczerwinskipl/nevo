// Automated tests for server session-choice resolution (task 02 of session-continuity-choice)
// Verifies candidate derivation via reuseFrom, policy choice validation, and distinct error codes.
// Run: node --test tools/tests/deterministic-execution-session-choice.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  deriveReuseCandidate,
  SessionChoiceValidationError,
} from '../dashboard/server/ai/orchestration/deterministic-execution-plan.mjs';
import { buildAiTestApp } from '../dashboard/tests/helpers/ai-test-app.mjs';
import { createMockAgentProvider } from '../dashboard/server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../dashboard/server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../dashboard/server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../dashboard/server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import { resetAdmissionStateForTest, releaseAdmittedExecution, waitForActiveExecutionSettled } from '../dashboard/server/ai/orchestration/admission.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SPEC_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'spec-session-choice';

function createTempRepo(prefix) {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Session Choice Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'session-choice@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Session Choice Test\n', 'utf8');
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

  const implSessionId = '11111111-1111-4111-8111-111111111111';
  const reviewSessionId = '22222222-2222-4222-8222-222222222222';

  const specDir = path.join(dir, 'specs', 'active', SLUG);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'change.yaml'),
    `id: ${SLUG}
spec_id: ${SPEC_ID}
title: "Session Choice Spec"
status: in-progress
workflow:
  mode: deterministic
  definition: choice-workflow
tasks:
  - id: task1
    title: "Task with impl and review history"
    status: in-implementation
    file: tasks/task1.md
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          result: pass
          sessionId: "${implSessionId}"
          completed_at: "2026-09-28T09:00:00Z"
        - step: review
          attempt: 1
          transitioned_to: implementation
          result: fail
          sessionId: "${reviewSessionId}"
          completed_at: "2026-09-28T10:00:00Z"
  - id: taskNoCandidate
    title: "Task with review history but no implementation session"
    status: in-implementation
    file: tasks/taskNoCandidate.md
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: completed
      history:
        - step: review
          attempt: 1
          transitioned_to: implementation
          result: fail
          sessionId: "${reviewSessionId}"
          completed_at: "2026-09-28T10:00:00Z"
`,
  );
  fs.writeFileSync(path.join(specDir, 'overview.md'), '# Overview\n');
  fs.writeFileSync(path.join(tasksDir, 'task1.md'), '---\nid: task1\nstatus: in-implementation\n---\n# Task 1\n');
  fs.writeFileSync(path.join(tasksDir, 'taskNoCandidate.md'), '---\nid: taskNoCandidate\nstatus: in-implementation\n---\n# Task No Candidate\n');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' });

  return { dir, implSessionId, reviewSessionId };
}

function makeProvider(id) {
  const p = createMockAgentProvider({ streamDelayMs: 1 });
  p.descriptor = { ...p.descriptor, id, label: id };
  return p;
}

async function createApp(tmpRepo) {
  const registry = createAgentProviderRegistry([makeProvider('claude'), makeProvider('codex'), makeProvider('gemini')]);
  const transcriptCache = createTranscriptCacheService({ baseDir: path.join(tmpRepo, '.nevo-ai-local', 'transcripts') });
  const bindingService = createAgentSessionBindingService({ storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService, repoRoot: tmpRepo });
  const app = await buildAiTestApp({ service, repoRoot: tmpRepo });
  return { app, service, turnRuntime, bindingService };
}

test('Candidate derivation: with reuseFrom: implementation, selects implementation session even when later review session exists', async () => {
  const { dir: tmpRepo, implSessionId, reviewSessionId } = createTempRepo('candidate-derivation');
  try {
    const task = {
      id: 'task1',
      workflow_progress: {
        history: [
          { step: 'implementation', attempt: 1, sessionId: implSessionId },
          { step: 'review', attempt: 1, sessionId: reviewSessionId },
        ],
      },
    };

    // Transition with reuseFrom: 'implementation'
    const candidateWithReuseFrom = await deriveReuseCandidate({
      task,
      matchedTransition: { execution: { session: 'reuse', reuseFrom: 'implementation' } },
      repoRoot: tmpRepo,
    });
    assert.ok(candidateWithReuseFrom);
    assert.equal(candidateWithReuseFrom.sessionId, implSessionId);
    assert.equal(candidateWithReuseFrom.step, 'implementation');
    assert.equal(candidateWithReuseFrom.attempt, 1);

    // Transition without reuseFrom falls back to latest step in history
    const candidateWithoutReuseFrom = await deriveReuseCandidate({
      task,
      matchedTransition: { execution: { session: 'reuse' } },
      repoRoot: tmpRepo,
    });
    assert.ok(candidateWithoutReuseFrom);
    assert.equal(candidateWithoutReuseFrom.sessionId, reviewSessionId);
    assert.equal(candidateWithoutReuseFrom.step, 'review');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Policy choice: sessionPolicy: fresh creates new session; sessionPolicy: reuse appends to candidate session', async () => {
  const { dir: tmpRepo, implSessionId } = createTempRepo('policy-choice');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
      roles: { implementer: { provider: 'claude', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);
    await ai.bindingService.bindSession({
      sessionId: implSessionId,
      providerSessionId: 'prov-impl-1',
      provider: 'claude',
      specId: SPEC_ID,
      taskId: 'task1',
      activeTaskId: 'task1',
      purpose: 'execution',
      mode: 'agent',
    });

    // 1. Request with sessionPolicy: 'fresh' against default 'reuse' transition
    const resFresh = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'task1',
        sessionPolicy: 'fresh',
      },
    });
    assert.equal(resFresh.statusCode, 201);
    const dataFresh = JSON.parse(resFresh.body);
    assert.notEqual(dataFresh.sessionId, implSessionId, 'fresh policy must create new session');
    await waitForActiveExecutionSettled(SPEC_ID);

    // 2. Request with sessionPolicy: 'reuse' appends to candidate session
    const resReuse = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'task1',
        sessionPolicy: 'reuse',
      },
    });
    assert.equal(resReuse.statusCode, 201);
    const dataReuse = JSON.parse(resReuse.body);
    assert.equal(dataReuse.sessionId, implSessionId, 'reuse policy must reuse candidate implementation session');

    await releaseAdmittedExecution(SPEC_ID);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Distinct error codes: SESSION_POLICY_NOT_ALLOWED, SESSION_ID_MISMATCH, REUSE_CANDIDATE_NOT_FOUND, PROVIDER_MISMATCH', async () => {
  const { dir: tmpRepo, implSessionId } = createTempRepo('error-codes');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
      roles: { implementer: { provider: 'claude', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);
    await ai.bindingService.bindSession({
      sessionId: implSessionId,
      providerSessionId: 'prov-impl-1',
      provider: 'claude',
      specId: SPEC_ID,
      taskId: 'task1',
      activeTaskId: 'task1',
      purpose: 'execution',
      mode: 'agent',
    });

    // Error 1: SESSION_POLICY_NOT_ALLOWED
    const resPolicyNotAllowed = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'task1',
        sessionPolicy: 'unsupported_policy',
      },
    });
    assert.equal(resPolicyNotAllowed.statusCode, 400);
    const errPolicy = JSON.parse(resPolicyNotAllowed.body);
    assert.equal(errPolicy.error.code, 'SESSION_POLICY_NOT_ALLOWED');

    // Error 2: SESSION_ID_MISMATCH
    const resMismatch = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'task1',
        sessionPolicy: 'reuse',
        sessionId: '00000000-0000-4000-8000-999999999999',
      },
    });
    assert.equal(resMismatch.statusCode, 400);
    const errMismatch = JSON.parse(resMismatch.body);
    assert.equal(errMismatch.error.code, 'SESSION_ID_MISMATCH');

    // Error 3: REUSE_CANDIDATE_NOT_FOUND (via HTTP inject on taskNoCandidate)
    const resNoCandidate = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'taskNoCandidate',
        sessionPolicy: 'reuse',
      },
    });
    assert.equal(resNoCandidate.statusCode, 400);
    const errNoCandidate = JSON.parse(resNoCandidate.body);
    assert.equal(errNoCandidate.error.code, 'REUSE_CANDIDATE_NOT_FOUND');
    assert.match(errNoCandidate.error.message, /requires session reuse, but no exact predecessor session could be resolved from step 'implementation'/);

    // Error 4: PROVIDER_MISMATCH (when target role provider differs from candidate session's provider)
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'codex',
      mode: 'agent',
      roles: { implementer: { provider: 'codex', mode: 'agent' } }, // differs from candidate session's provider 'claude'
    }, { repoRoot: tmpRepo });

    const resProviderMismatch = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        specId: SPEC_ID,
        changeSlug: SLUG,
        taskId: 'task1',
        sessionPolicy: 'reuse',
      },
    });
    assert.equal(resProviderMismatch.statusCode, 400);
    const errProviderMismatch = JSON.parse(resProviderMismatch.body);
    assert.equal(errProviderMismatch.error.code, 'PROVIDER_MISMATCH');
    assert.match(errProviderMismatch.error.message, /differs from target role provider/);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
