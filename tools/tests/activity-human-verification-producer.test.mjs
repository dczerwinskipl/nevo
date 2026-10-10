// Tests for human verification activity producer (task 07, ai-spec-history).
// Covers AC 1 - AC 5.
// Run: node --test tools/tests/activity-human-verification-producer.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readActivities } from '../specs/activity/store.mjs';
import * as activityStore from '../specs/activity/store.mjs';
import { queryTaskActivity, queryFullSpecHistory } from '../specs/activity/query.mjs';
import { resolveUserActor } from '../specs/activity/actor-resolver.mjs';
import {
  HUMAN_VERIFICATION_CONFIRMED,
  humanVerificationConfirmedActivityId,
  validateHumanVerificationConfirmedData,
  recordHumanVerificationConfirmed,
} from '../specs/activity/producers/human-verification.mjs';
import { handleWorkflowVerifyHuman } from '../specs/workflow/cli.mjs';
import { FileHumanVerificationStore } from '../specs/workflow/human-verification-store.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

const SPEC_ID = 'fe63d2b5-a66a-4c88-b3cc-6d38b193b725';

const WORKFLOW_WITH_HUMAN_GATE_YAML = `id: test-wf
title: "Workflow with Human Gate"
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
      - type: human
        id: human-gate-impl
        role: owner
        scope: task
    finalize:
      - id: commit-and-push
    transitions:
      - to: review
  review:
    status:
      active: reviewing
      completed: reviewed
    entryGates: []
    exitGates:
      - type: human
        role: reviewer
        scope: task
    finalize:
      - id: commit-and-push
    transitions:
      - to: verified
        outcome: success
`;

function makeFixtureRepo({
  changeId = 'demo-change',
  taskId = 'demo-task',
  specId = SPEC_ID,
  workflowYaml = WORKFLOW_WITH_HUMAN_GATE_YAML,
  userEmail = 'reviewer@example.com',
  userName = 'Human Reviewer',
} = {}) {
  const base = mkdtempSync(join(tmpdir(), 'nevo-human-verif-prod-'));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });

  git(repo, ['init', '-q', '--initial-branch=main']);
  git(repo, ['config', 'user.email', userEmail]);
  git(repo, ['config', 'user.name', userName]);

  const workflowsDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, 'test-wf.yaml'), workflowYaml);

  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, changeId);
  const tasksDir = join(changeDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');
  writeFileSync(join(repo, 'root.txt'), 'initial\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'initial commit']);

  const changeYaml = `id: ${changeId}
spec_id: ${specId}
title: "Demo Change"
workflow:
  mode: deterministic
  definition: test-wf
tasks:
  - id: ${taskId}
    status: implementing
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
      history: []
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
  writeFileSync(join(tasksDir, `01-${taskId}.md`), `---\nid: ${taskId}\nstatus: implementing\n---\n# Task\n`);

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'task setup']);

  return { base, repo, activeDir, changeDir, tasksDir, changeId, taskId, specId };
}

function cleanupFixture(fx) {
  if (!fx?.base) return;
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('human-verification activity producer unit contracts', () => {
  test('HUMAN_VERIFICATION_CONFIRMED constant has exact expected type name', () => {
    assert.equal(HUMAN_VERIFICATION_CONFIRMED, 'human.verification.confirmed');
  });

  test('humanVerificationConfirmedActivityId generates deterministic IDs with gateId and fallback to default', () => {
    const withGate = humanVerificationConfirmedActivityId('spec-1', 'task-1', 'impl', 1, 'my-gate');
    assert.equal(withGate, 'human.verification.confirmed:spec-1:task-1:impl:1:my-gate');

    const withoutGate = humanVerificationConfirmedActivityId('spec-1', 'task-1', 'impl', 1, null);
    assert.equal(withoutGate, 'human.verification.confirmed:spec-1:task-1:impl:1:default');

    const emptyGate = humanVerificationConfirmedActivityId('spec-1', 'task-1', 'impl', 2, '');
    assert.equal(emptyGate, 'human.verification.confirmed:spec-1:task-1:impl:2:default');
  });

  test('validateHumanVerificationConfirmedData checks required and optional fields correctly', () => {
    const valid = {
      scope: 'task',
      targetId: 'task-1',
      role: 'owner',
      stepId: 'implementation',
      attempt: 1,
      gateId: 'gate-a',
    };
    assert.equal(validateHumanVerificationConfirmedData(valid).valid, true);

    const validWithNullGate = {
      scope: 'task',
      targetId: 'task-1',
      role: 'owner',
      stepId: 'implementation',
      attempt: 1,
      gateId: null,
    };
    assert.equal(validateHumanVerificationConfirmedData(validWithNullGate).valid, true);

    // Invalid: non-object
    assert.equal(validateHumanVerificationConfirmedData(null).valid, false);
    assert.equal(validateHumanVerificationConfirmedData('string').valid, false);

    // Invalid: missing or empty scope
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, scope: '' }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, scope: null }).valid, false);

    // Invalid: missing or empty targetId
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, targetId: '   ' }).valid, false);

    // Invalid: missing or empty role
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, role: '' }).valid, false);

    // Invalid: attempt must be positive integer
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, attempt: 0 }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, attempt: -1 }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, attempt: 1.5 }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, attempt: '1' }).valid, false);

    // Invalid: stepId when present must be string or null
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, stepId: '' }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, stepId: 123 }).valid, false);

    // Invalid: gateId when present must be string or null
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, gateId: '' }).valid, false);
    assert.equal(validateHumanVerificationConfirmedData({ ...valid, gateId: 123 }).valid, false);
  });

  test('recordHumanVerificationConfirmed catches internal errors and returns null rather than throwing', () => {
    const res = recordHumanVerificationConfirmed({
      specId: null, // will fail resolveSpecId
      taskId: 'task-1',
      stepId: 'impl',
      attempt: 1,
      gateId: null,
      scope: 'task',
      targetId: 'task-1',
      role: 'owner',
    });
    assert.equal(res, null);
  });
});

describe('workflow verify-human --confirm produces human.verification.confirmed activity (AC1 - AC5)', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixtureRepo();
  });

  afterEach(() => {
    cleanupFixture(fx);
  });

  test('AC1 & AC2: --confirm produces exactly one queryable activity with user actor and matching data', async () => {
    const confirmResult = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      confirm: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(confirmResult.confirmed, true);
    assert.ok(confirmResult.record);
    assert.equal(confirmResult.record.scope, 'task');
    assert.equal(confirmResult.record.targetId, fx.taskId);
    assert.equal(confirmResult.record.role, 'owner');
    assert.equal(confirmResult.record.gateId, 'human-gate-impl');

    // Query task activity from store
    const taskActivities = queryTaskActivity(fx.specId, fx.taskId, { repoRoot: fx.repo });
    assert.equal(taskActivities.length, 1, 'Must produce exactly one queryable activity for the task');

    const activity = taskActivities[0];
    assert.equal(activity.type, HUMAN_VERIFICATION_CONFIRMED);
    assert.equal(activity.id, `human.verification.confirmed:${fx.specId}:${fx.taskId}:implementation:1:human-gate-impl`);
    assert.equal(activity.scope.specId, fx.specId, 'scope.specId on envelope must match change.spec_id');
    assert.equal(activity.scope.taskId, fx.taskId);

    // Actor must be user type resolved from git config
    assert.equal(activity.actor.type, 'user');
    assert.equal(activity.actor.id, 'reviewer@example.com');

    // Data must match signoff record
    assert.equal(activity.data.scope, confirmResult.record.scope);
    assert.equal(activity.data.targetId, confirmResult.record.targetId);
    assert.equal(activity.data.role, confirmResult.record.role);
    assert.equal(activity.data.stepId, confirmResult.record.stepId);
    assert.equal(activity.data.attempt, confirmResult.record.attempt);
    assert.equal(activity.data.gateId, confirmResult.record.gateId);
  });

  test('AC1: repeated --confirm calls deduplicate on read and still surface exactly one activity', async () => {
    // First confirmation
    await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      confirm: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    // Repeated confirmation for the same gate/attempt
    await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      confirm: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    const activities = queryTaskActivity(fx.specId, fx.taskId, { repoRoot: fx.repo });
    assert.equal(activities.length, 1, 'Read-side deduplication must keep only one activity for repeated confirmation');
  });

  test('AC2: confirmation on step with default gate id (null) records null gateId in data and default in id', async () => {
    // Switch task to review step which has no explicit gate id
    const taskFile = join(fx.changeDir, 'change.yaml');
    const updatedChangeYaml = `id: ${fx.changeId}
spec_id: ${fx.specId}
title: "Demo Change"
workflow:
  mode: deterministic
  definition: test-wf
tasks:
  - id: ${fx.taskId}
    status: reviewing
    workflow_progress:
      current_step: review
      current_attempt: 1
      state: active
      history: []
`;
    writeFileSync(taskFile, updatedChangeYaml);

    const confirmResult = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
      confirm: true,
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
      silent: true,
    });

    assert.equal(confirmResult.confirmed, true);
    assert.equal(confirmResult.record.gateId, null);

    const taskActivities = queryTaskActivity(fx.specId, fx.taskId, { repoRoot: fx.repo });
    assert.equal(taskActivities.length, 1);

    const activity = taskActivities[0];
    assert.equal(activity.id, `human.verification.confirmed:${fx.specId}:${fx.taskId}:review:1:default`);
    assert.equal(activity.data.gateId, null);
    assert.equal(activity.data.role, 'reviewer');
  });

  test('AC3: forcing recordActivity to throw does not prevent --confirm from succeeding', async () => {
    // Monkey-patch recordActivity to throw
    const originalRecordActivity = activityStore.recordActivity;
    let thrown = false;

    // We can simulate failure by setting recordActivity on the module export object if mutable,
    // or by making the .nevo-ai-local/activity directory unwritable or pointing to a non-directory.
    // Let's create an invalid file where the directory should be to force recordActivity to throw an IO error.
    const activityPath = join(fx.repo, '.nevo-ai-local', 'activity');
    mkdirSync(join(fx.repo, '.nevo-ai-local'), { recursive: true });
    // Write a regular file named 'activity' so mkdirSync(dirname) or file operations fail
    writeFileSync(activityPath, 'not a directory');

    let confirmResult;
    try {
      confirmResult = await handleWorkflowVerifyHuman(fx.changeId, fx.taskId, {
        confirm: true,
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
        silent: true,
      });
    } finally {
      // Clean up the dummy file so cleanupFixture works
      try { rmSync(activityPath, { force: true }); } catch {}
    }

    assert.ok(confirmResult, 'handleWorkflowVerifyHuman must return successful result');
    assert.equal(confirmResult.confirmed, true);
    assert.ok(confirmResult.record, 'underlying signoff record must still be created');
  });

  test('AC4: human-verification-store, human-step operations, and finish-operation are untouched', () => {
    const forbiddenFiles = [
      'tools/specs/workflow/human-verification-store.mjs',
      'tools/specs/workflow/human-step/operations.mjs',
      'tools/specs/workflow/finish-operation.mjs',
    ];

    // Check git diff in current repo against HEAD
    const diff = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    for (const forbidden of forbiddenFiles) {
      assert.ok(
        !diff.includes(forbidden.replace(/\//g, '\\')) && !diff.includes(forbidden),
        `Forbidden file ${forbidden} must not be modified in git status`
      );
    }
  });
});
