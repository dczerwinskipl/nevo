// Regression coverage for the shared deterministic execution plan resolver
// (tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs): both HTTP
// entry points — POST /api/agent-sessions/turns (new session) and
// POST /api/agent-sessions/:sessionId/turns (existing session) — must resolve the exact
// same authoritative execution plan (target step, role, session policy, execution
// policy, exact predecessor session) for a given task. Workflow session policy must
// always win over which URL the caller happened to call.
// Run: node --test tools/tests/deterministic-execution-session-policy-unification.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { buildAiTestApp } from '../dashboard/tests/helpers/ai-test-app.mjs';
import { createMockAgentProvider } from '../dashboard/server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../dashboard/server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../dashboard/server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../dashboard/server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../dashboard/server/ai/sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';
import { resetAdmissionStateForTest, releaseAdmittedExecution, waitForActiveExecutionSettled } from '../dashboard/server/ai/orchestration/admission.mjs';
import { getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SPEC_ID = '55555555-5555-4555-8555-555555555555';
const SLUG = 'spec-session-policy';

// One workflow covering all four cases:
// - taskFresh: history shows a 'pass' result -> targets 'review' (session: fresh, role: reviewer)
// - taskReuse: history shows a 'fail' result -> targets 'fixup' (session: reuse, role: fixer)
// - taskEntry: no history at all -> targets 'implementation' (entry step, no transition, defaults to fresh)
function createTempRepo(prefix) {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Session Policy Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'session-policy@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Session Policy Test\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

  const wfDir = path.join(dir, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, 'session-policy-workflow.yaml'),
    JSON.stringify({
      id: 'session-policy-workflow',
      version: 1,
      entryStep: 'implementation',
      steps: {
        implementation: {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'implemented' },
          transitions: [
            { value: 'fail', to: 'fixup', execution: { session: 'reuse', role: 'fixer' } },
            { value: 'pass', to: 'review', execution: { session: 'fresh', role: 'reviewer' } },
          ],
        },
        fixup: {
          executor: 'agent',
          status: { active: 'in-fixup', completed: 'fixed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
        review: {
          executor: 'agent',
          status: { active: 'in-review', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    }, null, 2),
    'utf8',
  );

  const predecessorSessionId = '00000000-0000-4000-8000-00000000000a';
  const specDir = path.join(dir, 'specs', 'active', SLUG);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'change.yaml'),
    `id: ${SLUG}
spec_id: ${SPEC_ID}
title: "Session Policy Test Spec"
status: in-progress
workflow:
  mode: deterministic
  definition: session-policy-workflow
tasks:
  - id: taskFresh
    title: "Fresh transition task"
    status: in-implementation
    file: tasks/taskFresh.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          result: pass
          completed_at: "2026-09-28T09:00:00Z"
  - id: taskReuse
    title: "Reuse transition task"
    status: in-implementation
    file: tasks/taskReuse.md
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: fixup
          result: fail
          sessionId: "${predecessorSessionId}"
          completed_at: "2026-09-28T09:00:00Z"
  - id: taskEntry
    title: "Entry step task"
    status: in-implementation
    file: tasks/taskEntry.md
`,
  );
  fs.writeFileSync(path.join(specDir, 'overview.md'), '# Overview\n');
  fs.writeFileSync(path.join(tasksDir, 'taskFresh.md'), '---\nid: taskFresh\nstatus: in-implementation\n---\n# Fresh\n');
  fs.writeFileSync(path.join(tasksDir, 'taskReuse.md'), '---\nid: taskReuse\nstatus: in-implementation\n---\n# Reuse\n');
  fs.writeFileSync(path.join(tasksDir, 'taskEntry.md'), '---\nid: taskEntry\nstatus: in-implementation\n---\n# Entry\n');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial fixture'], { cwd: dir, stdio: 'ignore' });
  return { dir, predecessorSessionId };
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

test('Case A: a fresh-policy transition requested from an existing (unrelated) session still creates a fresh session, with correct role/provider resolution', async () => {
  const { dir: tmpRepo } = createTempRepo('case-a-fresh');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
      roles: { reviewer: { provider: 'codex', mode: 'agent' }, fixer: { provider: 'gemini', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);

    // 1. Admit taskFresh once via the new-session route to obtain an existing session
    //    bound to this task (simulating "the user is sitting inside a session for this
    //    task already").
    const res1 = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: { purpose: 'execution', specId: SPEC_ID, changeSlug: SLUG, taskId: 'taskFresh' },
    });
    assert.equal(res1.statusCode, 201, `Expected 201 but got ${res1.statusCode} ${res1.body}`);
    const data1 = JSON.parse(res1.body);
    assert.equal(data1.provider, 'codex', 'First admission must resolve reviewer-role provider');
    await waitForActiveExecutionSettled(SPEC_ID);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null);

    // 2. Explicit execution through the EXISTING-session route, reusing data1.sessionId in
    //    the URL. The transition still declares session: fresh -> the workflow policy must
    //    win: a brand-new session must be admitted, never data1.sessionId.
    const res2 = await ai.app.inject({
      method: 'POST',
      url: `/api/agent-sessions/${data1.sessionId}/turns`,
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        taskId: 'taskFresh',
        changeSlug: SLUG,
        message: 'Execute the current workflow step for task taskFresh.',
      },
    });
    assert.equal(res2.statusCode, 202, `Expected 202 but got ${res2.statusCode} ${res2.body}`);
    const data2 = JSON.parse(res2.body);

    assert.notEqual(data2.sessionId, data1.sessionId, 'A fresh-policy transition must never execute inside the existing session');
    assert.equal(data2.isNewSession, true);
    assert.equal(data2.provider, 'codex', 'Reviewer-role execution policy must still be resolved, not inherited from the old session');

    await releaseAdmittedExecution(SPEC_ID);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Case B: a reuse-policy transition requested through the exact predecessor session is admitted into that same session', async () => {
  const { dir: tmpRepo, predecessorSessionId } = createTempRepo('case-b-reuse');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
      roles: { reviewer: { provider: 'codex', mode: 'agent' }, fixer: { provider: 'gemini', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);
    await ai.bindingService.bindSession({
      sessionId: predecessorSessionId,
      providerSessionId: 'prov-pred',
      provider: 'gemini',
      specId: SPEC_ID,
      taskId: 'taskReuse',
      activeTaskId: 'taskReuse',
      purpose: 'execution',
      mode: 'agent',
    });

    const res = await ai.app.inject({
      method: 'POST',
      url: `/api/agent-sessions/${predecessorSessionId}/turns`,
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        taskId: 'taskReuse',
        changeSlug: SLUG,
        message: 'Execute the current workflow step for task taskReuse.',
      },
    });
    assert.equal(res.statusCode, 202, `Expected 202 but got ${res.statusCode} ${res.body}`);
    const data = JSON.parse(res.body);
    assert.equal(data.sessionId, predecessorSessionId, 'Exact predecessor session must be reused');
    assert.equal(data.isNewSession, false);
    assert.equal(data.provider, 'gemini', 'Fixer-role execution policy must be resolved');

    await releaseAdmittedExecution(SPEC_ID);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Case C: a reuse-policy transition requested through an unrelated session fails closed, never substituting that session for the exact predecessor', async () => {
  const { dir: tmpRepo, predecessorSessionId } = createTempRepo('case-c-wrong-session');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'claude',
      mode: 'agent',
      roles: { reviewer: { provider: 'codex', mode: 'agent' }, fixer: { provider: 'gemini', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);
    await ai.bindingService.bindSession({
      sessionId: predecessorSessionId,
      providerSessionId: 'prov-pred',
      provider: 'gemini',
      specId: SPEC_ID,
      taskId: 'taskReuse',
      activeTaskId: 'taskReuse',
      purpose: 'execution',
      mode: 'agent',
    });

    // An unrelated same-task session X — must never be accepted merely because it is
    // associated with the same task/spec.
    const unrelatedSessionId = '00000000-0000-4000-8000-00000000000b';
    await ai.bindingService.bindSession({
      sessionId: unrelatedSessionId,
      providerSessionId: 'prov-unrelated',
      provider: 'gemini',
      specId: SPEC_ID,
      taskId: 'taskReuse',
      activeTaskId: 'taskReuse',
      purpose: 'execution',
      mode: 'agent',
    });

    const res = await ai.app.inject({
      method: 'POST',
      url: `/api/agent-sessions/${unrelatedSessionId}/turns`,
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        taskId: 'taskReuse',
        changeSlug: SLUG,
        message: 'Execute the current workflow step for task taskReuse.',
      },
    });
    assert.equal(res.statusCode, 400, `Expected 400 fail-closed but got ${res.statusCode} ${res.body}`);
    assert.match(res.json().error.message, /does not match the server-derived session to reuse/);
    assert.equal(getWorkspaceWriterClaim(tmpRepo), null, 'No claim must be acquired');
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('Case D: entry-step execution through the existing-session route resolves identical default session policy/provider as the canonical new-session route', async () => {
  const { dir: tmpRepo } = createTempRepo('case-d-entry');
  resetAdmissionStateForTest();
  let ai = null;

  try {
    const { executionPolicyService } = await import('../dashboard/server/ai/sessions/execution-policy-service.mjs');
    executionPolicyService.saveExecutionPolicy(SLUG, { provider: 'claude', mode: 'agent' }, { repoRoot: tmpRepo });

    ai = await createApp(tmpRepo);

    // An existing session, unrelated to taskEntry, used purely as caller context.
    const resExisting = await ai.app.inject({
      method: 'POST',
      url: '/api/agent-sessions/turns',
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: { purpose: 'execution', specId: SPEC_ID, changeSlug: SLUG, taskId: 'taskFresh' },
    });
    assert.equal(resExisting.statusCode, 201);
    const existing = JSON.parse(resExisting.body);
    await waitForActiveExecutionSettled(SPEC_ID);

    const res = await ai.app.inject({
      method: 'POST',
      url: `/api/agent-sessions/${existing.sessionId}/turns`,
      headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
      payload: {
        purpose: 'execution',
        taskId: 'taskEntry',
        changeSlug: SLUG,
        message: 'Execute the current workflow step for task taskEntry.',
      },
    });
    assert.equal(res.statusCode, 202, `Expected 202 but got ${res.statusCode} ${res.body}`);
    const data = JSON.parse(res.body);
    assert.equal(data.provider, 'claude', 'Entry step with no role must resolve the default policy provider');
    assert.notEqual(data.sessionId, existing.sessionId, 'Entry step (no declared transition) defaults to fresh, same as the canonical route');
    assert.equal(data.isNewSession, true);

    await releaseAdmittedExecution(SPEC_ID);
  } finally {
    if (ai?.app) await ai.app.close();
    if (ai?.turnRuntime) await ai.turnRuntime.shutdown();
    resetAdmissionStateForTest();
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
