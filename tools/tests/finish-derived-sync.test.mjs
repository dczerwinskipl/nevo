import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { finishStep, planFinish } from '../specs/workflow/finish-operation.mjs';
import { normalizeWorkflowDefinition } from '../specs/workflow/definitions/schema.mjs';
import { createDefaultGateRegistry, MemoryCommandVerificationStore, MemoryHumanVerificationReader } from '../specs/workflow/index.mjs';
import { requireChange, requireTask } from '../specs/store.mjs';
import { loadOperationRecord, saveOperationRecord } from '../specs/workflow/operation-record.mjs';
import { assessExecutionSettlement } from '../specs/workflow/execution-settlement.mjs';
import { DERIVED_GENERATORS } from '../specs/derived/registry.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function makeGateRegistry() {
  const cmdStore = new MemoryCommandVerificationStore();
  cmdStore.recordCommandResult({ command: 'npm test', action: 'test', passed: true });
  const humanReader = new MemoryHumanVerificationReader([]);
  return createDefaultGateRegistry({
    commandRunner: async () => ({ passed: true, exitCode: 0 }),
    commandVerificationStore: cmdStore,
    humanVerificationReader: humanReader,
  });
}

const RAW_DEFINITION = {
  id: 'standard-v1',
  title: 'Standard Workflow',
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
      exitGates: [],
      finalize: [{ id: 'commit-and-push' }],
      transitions: [{ to: 'verified' }],
    },
  },
};
const DEFINITION = normalizeWorkflowDefinition(RAW_DEFINITION);

function setupRepoFixture(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['remote', 'add', 'origin', remote]);

  // package.json so it's recognized as a repo with toolchain
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'test-repo', private: true }));
  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');

  // Specs structure
  const activeDir = join(repo, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  mkdirSync(join(repo, 'specs', 'archive'), { recursive: true });

  writeFileSync(
    join(changeDir, 'change.yaml'),
    `id: test-change
spec_id: 11111111-2222-3333-4444-555555555555
title: "Test Change"
type: standard
status: approved
priority: 1
created: 2026-10-10
workflow:
  mode: deterministic
  definition: standard-v1
tasks:
  - id: task-01
    order: 1
    file: tasks/01-task.md
    status: in-implementation
`
  );

  writeFileSync(
    join(changeDir, 'tasks', '01-task.md'),
    `---
id: task-01
status: in-implementation
allowed_paths:
  - src/**
---
# Task 01
`
  );

  // Docs structure
  mkdirSync(join(repo, 'docs', 'architecture'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'ai'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'architecture', 'overview.md'),
    `---
id: architecture.overview
type: architecture
title: Architecture Overview
status: stable
scope: core
read_when:
  - when onboarding
summary: Overview of the architecture.
---
# Architecture
`
  );
  writeFileSync(
    join(repo, 'docs', 'ai', 'task-routing.md'),
    `# Task routing

## Routing table

| rule_id | path_glob | doc_ref |
|---|---|---|
| RT-01 | src/** | docs/architecture/overview.md |
`
  );
  writeFileSync(
    join(repo, 'docs', 'ai', 'change-impact-map.md'),
    `# Change impact map

## Routing table

| rule_id | path_glob | doc_ref |
|---|---|---|
| CI-01 | docs/** | docs/architecture/overview.md |
`
  );

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'Initial baseline']);
  git(repo, ['push', '-u', 'origin', 'main']);

  return { repo, remote, activeDir };
}

describe('Derived-artifact sync inside finish transaction (Task 02)', () => {
  let fx;

  beforeEach(() => {
    fx = setupRepoFixture('nevo-finish-sync-');
  });

  afterEach(() => {
    try { rmSync(fx.repo, { recursive: true, force: true }); } catch {}
    try { rmSync(fx.remote, { recursive: true, force: true }); } catch {}
  });

  test('Finish commits change.yaml + triggered indexes together', async () => {
    const change = requireChange('test-change', fx.activeDir);
    const task = requireTask(change, 'task-01');
    task.workflow_progress = {
      current_step: 'implementation',
      current_attempt: 1,
      state: 'active',
      history: [],
    };

    const gateRegistry = makeGateRegistry();
    const result = await finishStep({
      change,
      task,
      definition: DEFINITION,
      context: {
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        taskId: 'task-01',
        taskAllowedPaths: ['src/**'],
        sourceControl: { enabled: true, push: false },
      },
      inputs: {
        'commit.title': 'feat: complete task-01',
      },
      activeDir: fx.activeDir,
      gateRegistry,
    });

    assert.equal(result.status, 'completed');

    // Verify commit contents
    const commitFiles = git(fx.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').filter(Boolean);
    assert.ok(commitFiles.includes('specs/active/test-change/change.yaml'), 'change.yaml must be committed');
    assert.ok(commitFiles.includes('specs/index.generated.json'), 'specs/index.generated.json must be committed');
    assert.ok(commitFiles.includes('specs/active.generated.md'), 'specs/active.generated.md must be committed');

    // Working tree must be clean
    const status = git(fx.repo, ['status', '--porcelain']);
    assert.equal(status, '', 'Working tree must be clean after finish');
  });

  test('Repeated finish returns already-completed with no new commit and no diff', async () => {
    const change = requireChange('test-change', fx.activeDir);
    const task = requireTask(change, 'task-01');
    task.workflow_progress = {
      current_step: 'implementation',
      current_attempt: 1,
      state: 'active',
      history: [],
    };

    const gateRegistry = makeGateRegistry();
    const params = {
      change,
      task,
      definition: DEFINITION,
      context: {
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        taskId: 'task-01',
        taskAllowedPaths: ['src/**'],
        sourceControl: { enabled: true, push: false },
      },
      inputs: { 'commit.title': 'feat: complete task-01' },
      activeDir: fx.activeDir,
      gateRegistry,
    };

    const first = await finishStep(params);
    assert.equal(first.status, 'completed');
    const head1 = git(fx.repo, ['rev-parse', 'HEAD']);

    // Re-run finish with updated task
    const updatedTask = requireTask(requireChange('test-change', fx.activeDir), 'task-01');
    const second = await finishStep({ ...params, task: updatedTask });
    assert.equal(second.status, 'already-completed');

    const head2 = git(fx.repo, ['rev-parse', 'HEAD']);
    assert.equal(head2, head1, 'No new commit should be created');
    assert.equal(git(fx.repo, ['status', '--porcelain']), '', 'Worktree remains clean');
  });

  test('Generator failure raises DERIVED_ARTIFACT_SYNC_FAILED, commit stage pending, rerun succeeds', async () => {
    const change = requireChange('test-change', fx.activeDir);
    const task = requireTask(change, 'task-01');
    task.workflow_progress = {
      current_step: 'implementation',
      current_attempt: 1,
      state: 'active',
      history: [],
    };

    // Temporarily sabotage generator
    const origSync = DERIVED_GENERATORS[0].sync;
    DERIVED_GENERATORS[0].sync = () => { throw new Error('Forced sync failure'); };

    const gateRegistry = makeGateRegistry();
    const params = {
      change,
      task,
      definition: DEFINITION,
      context: {
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        taskId: 'task-01',
        taskAllowedPaths: ['src/**'],
        sourceControl: { enabled: true, push: false },
      },
      inputs: { 'commit.title': 'feat: complete task-01' },
      activeDir: fx.activeDir,
      gateRegistry,
    };

    let caughtErr;
    try {
      await finishStep(params);
    } catch (err) {
      caughtErr = err;
    } finally {
      DERIVED_GENERATORS[0].sync = origSync;
    }

    assert.ok(caughtErr instanceof WorkflowError);
    assert.equal(caughtErr.code, 'DERIVED_ARTIFACT_SYNC_FAILED');

    // Operation record must show commit stage is still pending
    const record = loadOperationRecord(fx.repo, 'test-change', 'task-01', 'implementation', 1);
    assert.ok(record);
    const commitStage = record.operations.find(o => o.id === 'commit');
    assert.equal(commitStage.status, 'pending');

    // Rerun succeeds
    const rerun = await finishStep(params);
    assert.equal(rerun.status, 'completed');
  });

  test('Out-of-scope dirty file rejected; foreign dirty input raises DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION', async () => {
    const change = requireChange('test-change', fx.activeDir);
    const task = requireTask(change, 'task-01');
    task.workflow_progress = {
      current_step: 'implementation',
      current_attempt: 1,
      state: 'active',
      history: [],
    };

    const gateRegistry = makeGateRegistry();

    // 1. Foreign dirty input (e.g. another change's change.yaml)
    const otherChangeDir = join(fx.activeDir, 'other-change');
    mkdirSync(otherChangeDir, { recursive: true });
    writeFileSync(join(otherChangeDir, 'change.yaml'), 'id: other-change\n');

    await assert.rejects(
      async () => {
        await finishStep({
          change,
          task,
          definition: DEFINITION,
          context: {
            repoRoot: fx.repo,
            activeDir: fx.activeDir,
            taskId: 'task-01',
            taskAllowedPaths: ['src/**'],
            sourceControl: { enabled: true, push: false },
          },
          inputs: { 'commit.title': 'feat: complete task-01' },
          activeDir: fx.activeDir,
          gateRegistry,
        });
      },
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION');
        return true;
      }
    );

    // Remove foreign change and reset worktree
    rmSync(otherChangeDir, { recursive: true, force: true });
    rmSync(join(fx.repo, '.nevo-ai-local'), { recursive: true, force: true });
    git(fx.repo, ['checkout', '--', '.']);

    // 2. Non-triggered generated file dirty (e.g. docs/index.generated.json when only specs generator is triggered)
    writeFileSync(join(fx.repo, 'docs', 'index.generated.json'), '{"dirty": true}');

    await assert.rejects(
      async () => {
        await finishStep({
          change,
          task,
          definition: DEFINITION,
          context: {
            repoRoot: fx.repo,
            activeDir: fx.activeDir,
            taskId: 'task-01',
            taskAllowedPaths: ['src/**'],
            sourceControl: { enabled: true, push: false },
          },
          inputs: { 'commit.title': 'feat: complete task-01' },
          activeDir: fx.activeDir,
          gateRegistry,
        });
      },
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'OUT_OF_SCOPE_WORKTREE_CHANGES');
        return true;
      }
    );
  });

  test('DERIVED_INTEGRITY_FAILED and REPO_INTEGRITY_FAILED are raised on integrity errors', async () => {
    const change = requireChange('test-change', fx.activeDir);
    const task = requireTask(change, 'task-01');
    task.workflow_progress = {
      current_step: 'implementation',
      current_attempt: 1,
      state: 'active',
      history: [],
    };

    const gateRegistry = makeGateRegistry();
    const params = {
      change,
      task,
      definition: DEFINITION,
      context: {
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        taskId: 'task-01',
        taskAllowedPaths: ['src/**'],
        sourceControl: { enabled: true, push: false },
      },
      inputs: { 'commit.title': 'feat: complete task-01' },
      activeDir: fx.activeDir,
      gateRegistry,
    };

    // 1. Generator check failure
    const origCheck = DERIVED_GENERATORS[0].check;
    DERIVED_GENERATORS[0].check = () => ['stale: specs/index.generated.json'];

    try {
      await assert.rejects(
        () => finishStep(params),
        (err) => {
          assert.ok(err instanceof WorkflowError);
          assert.equal(err.code, 'DERIVED_INTEGRITY_FAILED');
          return true;
        }
      );
    } finally {
      DERIVED_GENERATORS[0].check = origCheck;
    }

    rmSync(join(fx.repo, '.nevo-ai-local'), { recursive: true, force: true });

    // 2. Repo-wide validation failure (e.g. invalid change in archive)
    const brokenDir = join(fx.repo, 'specs', 'archive', 'broken-change');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'change.yaml'), 'id: broken-change\n');
    git(fx.repo, ['add', 'specs/archive/broken-change']);
    git(fx.repo, ['commit', '-m', 'Add broken change']);

    await assert.rejects(
      () => finishStep(params),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'REPO_INTEGRITY_FAILED');
        return true;
      }
    );
  });

  test('Settlement treats registered generator outputs as owned', async () => {
    // Modify a registered generator output
    writeFileSync(join(fx.repo, 'specs', 'index.generated.json'), '{"custom": 1}');

    const assessment = await assessExecutionSettlement({
      repoRoot: fx.repo,
      changeSlug: 'test-change',
      taskId: 'task-01',
      activeDir: fx.activeDir,
    });

    // The index file must NOT be in outOfScopeDirty
    assert.deepEqual(assessment.outOfScopeDirty, []);
  });
});
