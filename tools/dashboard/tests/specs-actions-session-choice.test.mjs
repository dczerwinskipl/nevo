// Automated tests for actions session-choice projection (task 03 of session-continuity-choice)
// Verifies projection of sessionChoice in actions DTO: default, allowed, candidate derivation,
// unavailableReason (missing candidate, provider mismatch), and absence on single-policy transitions.
// Run: node --test tools/dashboard/tests/specs-actions-session-choice.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { loadSpecificationActions, resolveTaskSessionChoice } from '../server/specs/actions.mjs';
import { createAgentSessionBindingService } from '../server/ai/sessions/binding-service.mjs';
import { executionPolicyService } from '../server/ai/sessions/execution-policy-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const SPEC_ID = '77777777-7777-4777-8777-777777777777';
const SLUG = 'spec-session-choice-actions';

function createTempRepo(prefix) {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Session Choice Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'session-choice@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Session Choice Actions Test\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.nevo-ai-local\n.nevo-ai-local/\n', 'utf8');

  const wfDir = path.join(dir, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, 'choice-wf.yaml'),
    JSON.stringify({
      id: 'choice-wf',
      version: 1,
      entryStep: 'implementation',
      steps: {
        implementation: {
          executor: 'agent',
          status: { active: 'in-progress', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                allow: ['fresh', 'reuse'],
                reuseFrom: 'implementation',
                role: 'reviewer',
              },
            },
          ],
        },
        review: {
          executor: 'agent',
          status: { active: 'in-review', completed: 'reviewed' },
          transitions: [
            {
              value: 'pass',
              to: 'human-verification',
            },
            {
              value: 'fail',
              to: 'implementation',
              execution: {
                session: 'reuse',
                allow: ['reuse', 'fresh'],
                reuseFrom: 'implementation',
                role: 'implementer',
              },
            },
          ],
        },
        'human-verification': {
          executor: 'human',
          status: { active: 'in-verification', completed: 'completed' },
          transitions: [
            {
              value: 'pass',
              to: 'verified',
              outcome: 'success',
              action: { label: 'Approve' },
            },
            {
              value: 'fail',
              to: 'implementation',
              action: { label: 'Request changes', feedback: { required: true } },
              execution: {
                session: 'reuse',
                allow: ['reuse', 'fresh'],
                reuseFrom: 'implementation',
                role: 'implementer',
              },
            },
          ],
        },
      },
    }, null, 2),
    'utf8',
  );

  const implSessionId = '11111111-2222-4333-8444-555555555555';
  const reviewSessionId = '66666666-7777-4888-8999-000000000000';

  const specDir = path.join(dir, 'specs', 'active', SLUG);
  const tasksDir = path.join(specDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'change.yaml'),
    `id: ${SLUG}
spec_id: ${SPEC_ID}
title: "Session Choice Actions Spec"
status: in-progress
workflow:
  mode: deterministic
  definition: choice-wf
tasks:
  - id: taskRequestedChanges
    title: "Task after Request Changes"
    status: in-implementation
    file: tasks/taskRequestedChanges.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          sessionId: "${implSessionId}"
          completed_at: "2026-10-10T10:00:00Z"
        - step: review
          attempt: 1
          result: pass
          transitioned_to: human-verification
          sessionId: "${reviewSessionId}"
          completed_at: "2026-10-10T11:00:00Z"
        - step: human-verification
          attempt: 1
          result: fail
          feedback: "Fix the bug"
          transitioned_to: implementation
          completed_at: "2026-10-10T12:00:00Z"
  - id: taskNoCandidate
    title: "Task with missing candidate"
    status: in-implementation
    file: tasks/taskNoCandidate.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: completed
      history:
        - step: human-verification
          attempt: 1
          result: fail
          feedback: "No implementation session in history"
          transitioned_to: implementation
          completed_at: "2026-10-10T12:00:00Z"
  - id: taskProviderMismatch
    title: "Task with candidate provider mismatch"
    status: in-implementation
    file: tasks/taskProviderMismatch.md
    workflow_progress:
      current_step: human-verification
      current_attempt: 1
      state: completed
      history:
        - step: implementation
          attempt: 1
          transitioned_to: review
          sessionId: "${implSessionId}"
          completed_at: "2026-10-10T10:00:00Z"
        - step: human-verification
          attempt: 1
          result: fail
          feedback: "Provider mismatch test"
          transitioned_to: implementation
          completed_at: "2026-10-10T12:00:00Z"
  - id: taskSinglePolicy
    title: "Task with entry step (single policy fresh)"
    status: in-implementation
    file: tasks/taskSinglePolicy.md
`,
  );
  fs.writeFileSync(path.join(specDir, 'overview.md'), '# Overview\n');
  fs.writeFileSync(path.join(tasksDir, 'taskRequestedChanges.md'), '---\nid: taskRequestedChanges\nstatus: in-implementation\n---\n# Task\n');
  fs.writeFileSync(path.join(tasksDir, 'taskNoCandidate.md'), '---\nid: taskNoCandidate\nstatus: in-implementation\n---\n# Task\n');
  fs.writeFileSync(path.join(tasksDir, 'taskProviderMismatch.md'), '---\nid: taskProviderMismatch\nstatus: in-implementation\n---\n# Task\n');
  fs.writeFileSync(path.join(tasksDir, 'taskSinglePolicy.md'), '---\nid: taskSinglePolicy\nstatus: in-implementation\n---\n# Task\n');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' });

  return { dir, implSessionId, reviewSessionId };
}

test('AC 1: A task after "Request changes" has default: reuse, allowed: [reuse, fresh], and implementation session as candidate', async () => {
  const { dir: tmpRepo, implSessionId } = createTempRepo('request-changes-candidate');
  try {
    const bindingService = createAgentSessionBindingService({
      storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions'),
    });
    await bindingService.bindSession({
      sessionId: implSessionId,
      providerSessionId: 'prov-impl-1',
      provider: 'claude',
      specId: SPEC_ID,
      taskId: 'taskRequestedChanges',
      activeTaskId: 'taskRequestedChanges',
      purpose: 'execution',
      mode: 'agent',
    });

    const actions = await loadSpecificationActions({ slug: SLUG, root: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') });
    const taskGate = actions.tasks.taskRequestedChanges;
    assert.ok(taskGate, 'taskRequestedChanges must be present in actions.tasks');
    assert.ok(taskGate.sessionChoice, 'sessionChoice must be present on taskRequestedChanges');

    const sc = taskGate.sessionChoice;
    assert.equal(sc.default, 'reuse');
    assert.deepEqual(sc.allowed, ['reuse', 'fresh']);
    assert.ok(sc.candidate, 'candidate must be present');
    assert.equal(sc.candidate.sessionId, implSessionId);
    assert.equal(sc.candidate.step, 'implementation');
    assert.equal(sc.candidate.attempt, 1);
    assert.equal(sc.candidate.provider, 'claude');
    assert.match(sc.candidate.label, /Implementation, attempt 1/);
    assert.equal(sc.unavailableReason, null);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 2: A task with no matching candidate reports unavailableReason and null candidate', async () => {
  const { dir: tmpRepo } = createTempRepo('no-candidate');
  try {
    const actions = await loadSpecificationActions({ slug: SLUG, root: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') });
    const taskGate = actions.tasks.taskNoCandidate;
    assert.ok(taskGate, 'taskNoCandidate must be present in actions.tasks');
    assert.ok(taskGate.sessionChoice, 'sessionChoice must be present on taskNoCandidate');

    const sc = taskGate.sessionChoice;
    assert.equal(sc.default, 'reuse');
    assert.deepEqual(sc.allowed, ['reuse', 'fresh']);
    assert.equal(sc.candidate, null, 'candidate must be null when not found');
    assert.ok(sc.unavailableReason, 'unavailableReason must be set');
    assert.equal(sc.unavailableReason.code, 'REUSE_CANDIDATE_NOT_FOUND');
    assert.match(sc.unavailableReason.message, /No candidate session could be resolved from step 'implementation'/);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 3: A task with provider mismatch reports unavailableReason and null candidate', async () => {
  const { dir: tmpRepo, implSessionId } = createTempRepo('provider-mismatch');
  try {
    const bindingService = createAgentSessionBindingService({
      storageDir: path.join(tmpRepo, '.nevo-ai-local', 'sessions'),
    });
    // Candidate session uses provider 'claude'
    await bindingService.bindSession({
      sessionId: implSessionId,
      providerSessionId: 'prov-impl-1',
      provider: 'claude',
      specId: SPEC_ID,
      taskId: 'taskProviderMismatch',
      activeTaskId: 'taskProviderMismatch',
      purpose: 'execution',
      mode: 'agent',
    });

    // Execution policy for role 'implementer' configured with 'codex'
    executionPolicyService.saveExecutionPolicy(SLUG, {
      provider: 'codex',
      mode: 'agent',
      roles: { implementer: { provider: 'codex', mode: 'agent' } },
    }, { repoRoot: tmpRepo });

    const actions = await loadSpecificationActions({ slug: SLUG, root: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') });
    const taskGate = actions.tasks.taskProviderMismatch;
    assert.ok(taskGate, 'taskProviderMismatch must be present in actions.tasks');
    assert.ok(taskGate.sessionChoice, 'sessionChoice must be present');

    const sc = taskGate.sessionChoice;
    assert.equal(sc.default, 'reuse');
    assert.deepEqual(sc.allowed, ['reuse', 'fresh']);
    assert.equal(sc.candidate, null, 'candidate must be null on provider mismatch');
    assert.ok(sc.unavailableReason, 'unavailableReason must be set on provider mismatch');
    assert.equal(sc.unavailableReason.code, 'PROVIDER_MISMATCH');
    assert.match(sc.unavailableReason.message, /Candidate session uses provider 'claude', which differs from target role provider 'codex'/);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('AC 4: A single-policy transition has no sessionChoice', async () => {
  const { dir: tmpRepo } = createTempRepo('single-policy');
  try {
    const actions = await loadSpecificationActions({ slug: SLUG, root: tmpRepo, activeDir: path.join(tmpRepo, 'specs', 'active') });
    const taskGate = actions.tasks.taskSinglePolicy;
    assert.ok(taskGate, 'taskSinglePolicy must be present in actions.tasks');
    assert.equal(taskGate.sessionChoice, undefined, 'sessionChoice must be absent on single-policy transition');
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
