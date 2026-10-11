import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { publishTask } from '../specs/workflow/publish/operation.mjs';
import { executeBatchFinish } from '../specs/workflow/batch-finish/operation.mjs';
import { executeBatchStart } from '../specs/workflow/batch-start/operation.mjs';
import { createGroupReservation } from '../specs/workflow/queue/reservation.mjs';
import { acquireWorkspaceWriter } from '../specs/workflow/workspace-writer.mjs';
import { loadChange, setTaskWorkflowState } from '../specs/store.mjs';
import * as git from '../lib/git.mjs';
import { WorkflowError } from '../specs/workflow/errors.mjs';

function gitCmd(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function setupRepoFixture(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  gitCmd(repo, ['init', '--initial-branch=main']);
  gitCmd(repo, ['config', 'user.name', 'Test User']);
  gitCmd(repo, ['config', 'user.email', 'test@example.com']);
  gitCmd(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'test-repo', private: true }));
  writeFileSync(join(repo, '.gitignore'), '.nevo-ai-local/\n');

  // Workflows
  const workflowDir = join(repo, '.nevo-ai', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  const standardWorkflowYaml = `id: standard-v1
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
        to: verified
        outcome: success
      - value: fail
        to: implementation
`;
  writeFileSync(join(workflowDir, 'standard.yaml'), standardWorkflowYaml, 'utf8');

  // Specs
  const activeDir = join(repo, 'specs', 'active');
  const archiveDir = join(repo, 'specs', 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  // Initial generated artifacts
  writeFileSync(join(repo, 'specs', 'active.generated.md'), '# Active Specs\n');
  writeFileSync(join(repo, 'specs', 'archive.generated.md'), '# Archive Specs\n');
  writeFileSync(
    join(repo, 'specs', 'index.generated.json'),
    JSON.stringify({ generated: new Date().toISOString(), changes: [] }, null, 2)
  );

  gitCmd(repo, ['add', '-A']);
  gitCmd(repo, ['commit', '-m', 'Initial baseline']);
  gitCmd(repo, ['push', '-u', 'origin', 'main']);

  return { repo, remote, activeDir, archiveDir };
}

function createSpecFixture(repo, slug, taskCount = 1) {
  const changeDir = join(repo, 'specs', 'active', slug);
  const taskDir = join(changeDir, 'tasks');
  mkdirSync(taskDir, { recursive: true });

  const tasksYaml = Array.from({ length: taskCount }, (_, i) => {
    const id = `t${i + 1}`;
    return `  - id: ${id}
    order: ${i + 1}
    title: Task ${id}
    status: draft
    file: tasks/0${i + 1}-${id}.md
    allowed_paths:
      - src/${id}.js
`;
  }).join('');

  writeFileSync(
    join(changeDir, 'change.yaml'),
    `id: ${slug}
spec_id: "11111111-2222-3333-4444-555555555555"
title: "Spec ${slug}"
type: standard
status: approved
created: 2026-10-10
workflow:
  mode: deterministic
  definition: standard.yaml
tasks:
${tasksYaml}`
  );

  for (let i = 1; i <= taskCount; i++) {
    const id = `t${i}`;
    writeFileSync(
      join(taskDir, `0${i}-${id}.md`),
      `---
id: ${id}
status: draft
allowed_paths:
  - src/${id}.js
---
# Task ${id}
`
    );
  }

  mkdirSync(join(repo, 'src'), { recursive: true });
  for (let i = 1; i <= taskCount; i++) {
    writeFileSync(join(repo, 'src', `t${i}.js`), `export const t${i} = true;\n`);
  }
}

describe('Publish and batch-finish derived-artifact sync (Task 03)', () => {
  let fx;

  beforeEach(() => {
    fx = setupRepoFixture('nevo-pub-batch-sync');
  });

  afterEach(() => {
    try { rmSync(fx.repo, { recursive: true, force: true }); } catch {}
    try { rmSync(fx.remote, { recursive: true, force: true }); } catch {}
  });

  test('Publish commits change.yaml + specs index together, index fresh, leaves unrelated dirty file unstaged', async () => {
    const slug = 'pub-change';
    createSpecFixture(fx.repo, slug, 1);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add pub-change spec']);

    // Create an unrelated dirty file in the repo
    writeFileSync(join(fx.repo, 'unrelated.txt'), 'unrelated content\n');

    const result = await publishTask(slug, 't1', {
      activeDir: fx.activeDir,
      repoRoot: fx.repo,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'approved');

    // 1. Verify HEAD commit
    const headInfo = git.getCommitInfo(fx.repo, 'HEAD');
    assert.equal(headInfo.subject, 'chore(workflow): publish t1');

    // Verify commit diff touched change.yaml and specs/index.generated.json
    const committedFiles = gitCmd(fx.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
      .trim()
      .split(/\r?\n/)
      .map(p => p.replace(/\\/g, '/'));

    assert.ok(committedFiles.includes(`specs/active/${slug}/change.yaml`), 'change.yaml must be committed');
    assert.ok(committedFiles.includes('specs/index.generated.json'), 'specs/index.generated.json must be committed');
    assert.ok(committedFiles.includes('specs/active.generated.md'), 'specs/active.generated.md must be committed');
    assert.ok(!committedFiles.includes('unrelated.txt'), 'unrelated.txt must NOT be committed');

    // 2. Verify index freshness: task t1 must be approved in specs/index.generated.json
    const indexContent = JSON.parse(readFileSync(join(fx.repo, 'specs', 'index.generated.json'), 'utf8'));
    const changeEntry = indexContent.changes.find(c => c.id === slug);
    assert.ok(changeEntry, 'change must be in index');
    const taskEntry = changeEntry.tasks.find(t => t.id === 't1');
    assert.equal(taskEntry.status, 'approved');

    // 3. Verify unrelated dirty file remains untouched and unstaged
    const dirtyPaths = git.getDirtyPaths(fx.repo);
    assert.ok(dirtyPaths.includes('unrelated.txt'), 'unrelated.txt must still be dirty');
  });

  test('Publish rejects foreign dirty input with DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION', async () => {
    const slug = 'pub-change-clean';
    createSpecFixture(fx.repo, slug, 1);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add clean spec']);

    // Create a dirty change.yaml in another spec (matches generator input)
    const otherDir = join(fx.activeDir, 'other-foreign-spec');
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, 'change.yaml'), 'id: other-foreign-spec\n');

    await assert.rejects(
      () => publishTask(slug, 't1', {
        activeDir: fx.activeDir,
        repoRoot: fx.repo,
      }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION');
        return true;
      }
    );
  });

  test('Batch finish shared commit includes regenerated outputs and does not stage unrelated dirty file', async () => {
    const slug = 'batch-spec';
    createSpecFixture(fx.repo, slug, 2);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add batch spec']);

    const batchExecutionId = 'batch-exec-01';
    const sessionId = 'session-01';
    const taskIds = ['t1', 't2'];

    // Move tasks to review active state
    const change = loadChange(slug, fx.activeDir);
    for (const id of taskIds) {
      setTaskWorkflowState(change, id, {
        status: 'in-review',
        workflowProgress: {
          current_step: 'review',
          current_attempt: 1,
          state: 'active',
          history: [],
        },
      });
    }

    await createGroupReservation({
      repoRoot: fx.repo,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const specId = '11111111-2222-3333-4444-555555555555';
    const sessionFile = join(fx.repo, '.nevo-ai-local', 'sessions', `${specId}.json`);
    mkdirSync(join(fx.repo, '.nevo-ai-local', 'sessions'), { recursive: true });
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessions: [{
          sessionId,
          specId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2)
    );

    await acquireWorkspaceWriter({
      repoRoot: fx.repo,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    // Create unrelated dirty file in the repo
    writeFileSync(join(fx.repo, 'unrelated.txt'), 'unrelated content\n');

    const result = await executeBatchFinish({
      repoRoot: fx.repo,
      activeDir: fx.activeDir,
      changeSlug: slug,
      batchExecutionId,
      skipProvenanceCheck: true,
      inputs: {
        'commit.title': 'chore(workflow): batch finish t1 and t2',
        t1: { result: 'pass' },
        t2: { result: 'pass' },
      },
      sessionId,
    });

    assert.equal(result.status, 'completed');

    // Verify shared commit included change.yaml, generated indexes, and NOT unrelated.txt
    const committedFiles = gitCmd(fx.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
      .trim()
      .split(/\r?\n/)
      .map(p => p.replace(/\\/g, '/'));

    assert.ok(committedFiles.includes(`specs/active/${slug}/change.yaml`), 'change.yaml must be in shared commit');
    assert.ok(committedFiles.includes('specs/index.generated.json'), 'specs/index.generated.json must be in shared commit');
    assert.ok(committedFiles.includes('specs/active.generated.md'), 'specs/active.generated.md must be in shared commit');
    assert.ok(!committedFiles.includes('unrelated.txt'), 'unrelated.txt must NOT be committed');

    // Unrelated file must still be dirty
    const dirtyPaths = git.getDirtyPaths(fx.repo);
    assert.ok(dirtyPaths.includes('unrelated.txt'), 'unrelated.txt must still be dirty');
  });

  test('Batch finish crash after shared commit resumes with no duplicate commit', async () => {
    const slug = 'batch-crash-spec';
    createSpecFixture(fx.repo, slug, 2);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add batch spec']);

    const batchExecutionId = 'batch-exec-02';
    const sessionId = 'session-02';
    const taskIds = ['t1', 't2'];

    const change = loadChange(slug, fx.activeDir);
    for (const id of taskIds) {
      setTaskWorkflowState(change, id, {
        status: 'in-review',
        workflowProgress: {
          current_step: 'review',
          current_attempt: 1,
          state: 'active',
          history: [],
        },
      });
    }

    await createGroupReservation({
      repoRoot: fx.repo,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const specId = '11111111-2222-3333-4444-555555555555';
    const sessionFile = join(fx.repo, '.nevo-ai-local', 'sessions', `${specId}.json`);
    mkdirSync(join(fx.repo, '.nevo-ai-local', 'sessions'), { recursive: true });
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessions: [{
          sessionId,
          specId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2)
    );

    await acquireWorkspaceWriter({
      repoRoot: fx.repo,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    // Run with _crashAfterSharedCommit: true
    await assert.rejects(
      () => executeBatchFinish({
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        changeSlug: slug,
        batchExecutionId,
        skipProvenanceCheck: true,
        inputs: {
          'commit.title': 'chore(workflow): batch finish with crash',
          t1: { result: 'pass' },
          t2: { result: 'pass' },
        },
        sessionId,
        _crashAfterSharedCommit: true,
      }),
      /Simulated crash after shared commit/
    );

    const headAfterCrash = git.getCurrentRevision(fx.repo);

    // Resume execution
    const resumeResult = await executeBatchFinish({
      repoRoot: fx.repo,
      activeDir: fx.activeDir,
      changeSlug: slug,
      batchExecutionId,
      skipProvenanceCheck: true,
      inputs: {
        'commit.title': 'chore(workflow): batch finish with crash',
        t1: { result: 'pass' },
        t2: { result: 'pass' },
      },
      sessionId,
    });

    assert.equal(resumeResult.status, 'completed');
    const headAfterResume = git.getCurrentRevision(fx.repo);
    assert.equal(headAfterResume, headAfterCrash, 'No duplicate commit must be created on resume');
  });

  test('Batch finish crash before shared commit record reconciles moved HEAD on resume', async () => {
    const slug = 'batch-crash-before-rec';
    createSpecFixture(fx.repo, slug, 2);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add batch spec']);

    const batchExecutionId = 'batch-exec-03';
    const sessionId = 'session-03';
    const taskIds = ['t1', 't2'];

    const change = loadChange(slug, fx.activeDir);
    for (const id of taskIds) {
      setTaskWorkflowState(change, id, {
        status: 'in-review',
        workflowProgress: {
          current_step: 'review',
          current_attempt: 1,
          state: 'active',
          history: [],
        },
      });
    }

    await createGroupReservation({
      repoRoot: fx.repo,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const specId = '11111111-2222-3333-4444-555555555555';
    const sessionFile = join(fx.repo, '.nevo-ai-local', 'sessions', `${specId}.json`);
    mkdirSync(join(fx.repo, '.nevo-ai-local', 'sessions'), { recursive: true });
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessions: [{
          sessionId,
          specId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2)
    );

    await acquireWorkspaceWriter({
      repoRoot: fx.repo,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    // Run with _crashBeforeSharedCommitRecord: true (git commit succeeds, crash happens before saving completed record)
    await assert.rejects(
      () => executeBatchFinish({
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        changeSlug: slug,
        batchExecutionId,
        skipProvenanceCheck: true,
        inputs: {
          'commit.title': 'chore(workflow): batch finish crash before record',
          t1: { result: 'pass' },
          t2: { result: 'pass' },
        },
        sessionId,
        _crashBeforeSharedCommitRecord: true,
      }),
      /Simulated crash before saving shared commit completion record/
    );

    const headAfterCrash = git.getCurrentRevision(fx.repo);

    // Resume execution: must detect moved HEAD via persisted intent, reconcile, and complete
    const resumeResult = await executeBatchFinish({
      repoRoot: fx.repo,
      activeDir: fx.activeDir,
      changeSlug: slug,
      batchExecutionId,
      skipProvenanceCheck: true,
      inputs: {
        'commit.title': 'chore(workflow): batch finish crash before record',
        t1: { result: 'pass' },
        t2: { result: 'pass' },
      },
      sessionId,
    });

    assert.equal(resumeResult.status, 'completed');
    assert.equal(resumeResult.record.stages.sharedCommit.status, 'completed');
    const headAfterResume = git.getCurrentRevision(fx.repo);
    assert.equal(headAfterResume, headAfterCrash, 'Reconciliation must not produce duplicate commit');
  });

  test('Batch finish preflight rejects inputs.include containing out-of-scope paths', async () => {
    const slug = 'batch-include-scope';
    createSpecFixture(fx.repo, slug, 2);
    gitCmd(fx.repo, ['add', '-A']);
    gitCmd(fx.repo, ['commit', '-m', 'Add batch spec']);

    const batchExecutionId = 'batch-exec-04';
    const sessionId = 'session-04';
    const taskIds = ['t1', 't2'];

    const change = loadChange(slug, fx.activeDir);
    for (const id of taskIds) {
      setTaskWorkflowState(change, id, {
        status: 'in-review',
        workflowProgress: {
          current_step: 'review',
          current_attempt: 1,
          state: 'active',
          history: [],
        },
      });
    }

    await createGroupReservation({
      repoRoot: fx.repo,
      changeSlug: slug,
      taskIds,
      batchExecutionId,
      executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
    });

    const specId = '11111111-2222-3333-4444-555555555555';
    const sessionFile = join(fx.repo, '.nevo-ai-local', 'sessions', `${specId}.json`);
    mkdirSync(join(fx.repo, '.nevo-ai-local', 'sessions'), { recursive: true });
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessions: [{
          sessionId,
          specId,
          batchExecutionId,
          executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
        }],
        bindings: [],
      }, null, 2)
    );

    await acquireWorkspaceWriter({
      repoRoot: fx.repo,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    await assert.rejects(
      () => executeBatchFinish({
        repoRoot: fx.repo,
        activeDir: fx.activeDir,
        changeSlug: slug,
        batchExecutionId,
        skipProvenanceCheck: true,
        inputs: {
          'commit.title': 'chore(workflow): batch finish with unauthorized include',
          include: ['unauthorized/secret.key'],
          tasks: {
            t1: { result: 'pass' },
            t2: { result: 'pass' },
          },
        },
        sessionId,
      }),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'OUT_OF_SCOPE_COMMIT_SELECTION');
        return true;
      }
    );
  });
});

