import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { handleApprove, handleVerify } from '../specs.mjs';
import {
  computeChangeFingerprint,
  computeTaskFingerprint,
  buildSpecsIndexes,
  writeSpecsIndexes,
} from '../specs/service.mjs';
import * as git from '../lib/git.mjs';

function setupTempGitRepo() {
  const base = mkdtempSync(join(tmpdir(), 'nevo-approve-test-'));
  const originDir = join(base, 'origin.git');
  const cloneDir = join(base, 'repo');

  // Create bare origin
  mkdirSync(originDir, { recursive: true });
  execFileSync('git', ['init', '--bare'], { cwd: originDir });

  // Clone repo
  execFileSync('git', ['clone', originDir, cloneDir]);
  execFileSync('git', ['config', 'user.name', 'NEvo Test'], { cwd: cloneDir });
  execFileSync('git', ['config', 'user.email', 'test@nevo.local'], { cwd: cloneDir });
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: cloneDir });

  // Initial main commit
  writeFileSync(join(cloneDir, 'README.md'), '# NEvo Test Repo\n');
  execFileSync('git', ['add', '.'], { cwd: cloneDir });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: cloneDir });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: cloneDir });

  // Create feature branch
  execFileSync('git', ['checkout', '-b', 'feature/test-change'], { cwd: cloneDir });
  execFileSync('git', ['push', '-u', 'origin', 'feature/test-change'], { cwd: cloneDir });

  // Setup specs structure
  const activeDir = join(cloneDir, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  const tasksDir = join(changeDir, 'tasks');
  const reviewsDir = join(changeDir, 'reviews');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(reviewsDir, { recursive: true });

  const changeYaml = `id: test-change
title: Test Change
type: standard
status: draft
tasks:
  - id: task-1
    order: 1
    file: tasks/01-task-1.md
    status: draft
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const task1Md = `---
id: test-change.task-1
status: draft
change: test-change
allowed_paths:
  - tools/**
---

# Task 1
`;
  writeFileSync(join(tasksDir, '01-task-1.md'), task1Md);

  // Compute fingerprints and create valid review
  const changeObj = {
    _slug: 'test-change',
    _dir: changeDir,
    id: 'test-change',
    title: 'Test Change',
    type: 'standard',
    status: 'draft',
    tasks: [
      { id: 'task-1', order: 1, file: 'tasks/01-task-1.md', status: 'draft' },
    ],
  };

  const specFp = computeChangeFingerprint(changeObj);
  const taskFp = computeTaskFingerprint(changeObj, 'task-1');

  const reviewContent = `---
review-of: specification
change: test-change
generated: ${new Date().toISOString()}
verdict: ready-for-approval
spec_fingerprint: ${specFp}
task_fingerprints:
  task-1: ${taskFp}
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Spec Review
`;
  writeFileSync(join(reviewsDir, 'spec.md'), reviewContent);

  // Commit initial spec structure
  execFileSync('git', ['add', '.'], { cwd: cloneDir });
  execFileSync('git', ['commit', '-m', 'chore: add spec test-change'], { cwd: cloneDir });
  execFileSync('git', ['push'], { cwd: cloneDir });

  return {
    base,
    originDir,
    cloneDir,
    activeDir,
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test('Approve post-action sync and Git integration', async (t) => {
  await t.test('approve --no-git approves task and rebuilds metadata without git commit/push', () => {
    const fixture = setupTempGitRepo();
    try {
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: false,
      });

      // Verify task status in change.yaml
      const changeContent = readFileSync(join(fixture.cloneDir, 'specs', 'active', 'test-change', 'change.yaml'), 'utf8');
      assert.ok(changeContent.includes('status: approved'));

      // Verify metadata generated
      const activeGen = join(fixture.cloneDir, 'specs', 'active.generated.md');
      assert.ok(existsSync(activeGen));
      const indexJson = join(fixture.cloneDir, 'specs', 'index.generated.json');
      assert.ok(existsSync(indexJson));

      // Working tree should have uncommitted changes (since git was disabled)
      const dirty = git.getDirtyPaths(fixture.cloneDir);
      assert.ok(dirty.length > 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('approve with Git (default) commits ONLY operation-owned files and pushes', () => {
    const fixture = setupTempGitRepo();
    try {
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Working tree should be completely clean
      assert.ok(git.isWorkingTreeClean(fixture.cloneDir));

      // Branch should be fully pushed to origin (ahead: 0)
      const branch = git.getCurrentBranch(fixture.cloneDir);
      const ab = git.getAheadBehind(fixture.cloneDir, branch);
      assert.equal(ab.ahead, 0);

      // Latest commit message should match convention
      const lastCommit = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim();
      assert.equal(lastCommit, 'chore(specs): approve task-1');

      // Verify exact files in the commit — ONLY change.yaml and generated files, no unrelated paths
      const committedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' })
        .trim().split(/\r?\n/).map(p => p.replace(/\\/g, '/'));

      const expectedFiles = [
        'specs/active.generated.md',
        'specs/archive.generated.md',
        'specs/index.generated.json',
        'specs/active/test-change/change.yaml',
      ];
      for (const f of committedFiles) {
        assert.ok(expectedFiles.includes(f), `Unexpected file in commit: ${f}`);
      }
      assert.ok(committedFiles.includes('specs/active/test-change/change.yaml'));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('approve refuses to commit and fails safely when unrelated dirty file exists outside spec', () => {
    const fixture = setupTempGitRepo();
    try {
      // Create unrelated dirty file outside allowed specs paths
      writeFileSync(join(fixture.cloneDir, 'unrelated.txt'), 'unrelated work');

      assert.throws(
        () => {
          handleApprove('test-change', 'task-1', {
            gitRoot: fixture.cloneDir,
            activeDir: fixture.activeDir,
            git: true,
          });
        },
        err => err.message.includes('unrelated dirty files'),
      );

      // Unrelated file is still present and not committed
      assert.ok(existsSync(join(fixture.cloneDir, 'unrelated.txt')));
      const dirty = git.getDirtyPaths(fixture.cloneDir);
      assert.ok(dirty.includes('unrelated.txt'));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('approve refuses to commit and fails safely when unrelated dirty task file exists in same spec', () => {
    const fixture = setupTempGitRepo();
    try {
      // Create an unrelated task file or modify existing task file in same spec
      writeFileSync(join(fixture.cloneDir, 'specs', 'active', 'test-change', 'tasks', '02-other-task.md'), '# Other task draft');

      assert.throws(
        () => {
          handleApprove('test-change', 'task-1', {
            gitRoot: fixture.cloneDir,
            activeDir: fixture.activeDir,
            git: true,
          });
        },
        err => err.message.includes('unrelated dirty files'),
      );

      // Unrelated task file is untouched and NOT committed
      const dirty = git.getDirtyPaths(fixture.cloneDir);
      assert.ok(dirty.some(p => p.includes('02-other-task.md')));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('approve fails closed if change.yaml has pre-existing uncommitted modifications', () => {
    const fixture = setupTempGitRepo();
    try {
      // Dirty change.yaml before approve
      const changeYamlPath = join(fixture.cloneDir, 'specs', 'active', 'test-change', 'change.yaml');
      writeFileSync(changeYamlPath, readFileSync(changeYamlPath, 'utf8') + '# manual dirty edit\n');

      assert.throws(
        () => {
          handleApprove('test-change', 'task-1', {
            gitRoot: fixture.cloneDir,
            activeDir: fixture.activeDir,
            git: true,
          });
        },
        err => err.message.includes('contains pre-existing uncommitted modifications'),
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('real push failure during approve: commit created, push fails, retry performs missing push without duplicate commit', () => {
    const fixture = setupTempGitRepo();
    try {
      // Break the remote URL to force push to genuinely fail
      execFileSync('git', ['remote', 'set-url', 'origin', 'http://127.0.0.1:9999/nonexistent.git'], { cwd: fixture.cloneDir });

      // Run approve with git enabled
      assert.throws(
        () => {
          handleApprove('test-change', 'task-1', {
            gitRoot: fixture.cloneDir,
            activeDir: fixture.activeDir,
            git: true,
          });
        },
        err => err.message.includes('Push approval failed'),
      );

      // Verify: commit was created exactly once
      const commitCount = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);
      const lastCommit = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim();
      assert.equal(lastCommit, 'chore(specs): approve task-1');

      const commitShaBefore = git.getCurrentRevision(fixture.cloneDir);

      // Now restore valid remote URL
      execFileSync('git', ['remote', 'set-url', 'origin', fixture.originDir], { cwd: fixture.cloneDir });

      // Retry approve
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // No duplicate commit was created
      const commitShaAfter = git.getCurrentRevision(fixture.cloneDir);
      assert.equal(commitShaBefore, commitShaAfter);
      const commitCountAfter = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);
      assert.equal(commitCount, commitCountAfter);

      // Branch was pushed to origin
      const branch = git.getCurrentBranch(fixture.cloneDir);
      const ab = git.getAheadBehind(fixture.cloneDir, branch);
      assert.equal(ab.ahead, 0);
      assert.ok(git.isWorkingTreeClean(fixture.cloneDir));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('full idempotent approve when all postconditions are already met', () => {
    const fixture = setupTempGitRepo();
    try {
      // First run
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Second run (fully idempotent)
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      assert.ok(git.isWorkingTreeClean(fixture.cloneDir));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('verify with Git rebuilds metadata, commits ONLY operation-owned files, and pushes', () => {
    const fixture = setupTempGitRepo();
    try {
      // First approve task
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Mark implemented
      const changeYamlPath = join(fixture.cloneDir, 'specs', 'active', 'test-change', 'change.yaml');
      const content = readFileSync(changeYamlPath, 'utf8').replace('status: approved', 'status: implemented');
      writeFileSync(changeYamlPath, content);
      execFileSync('git', ['add', '.'], { cwd: fixture.cloneDir });
      execFileSync('git', ['commit', '-m', 'feat: complete task-1 implementation'], { cwd: fixture.cloneDir });
      execFileSync('git', ['push'], { cwd: fixture.cloneDir });

      // Owner verifies task
      handleVerify('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Task status is now verified
      const updatedChange = readFileSync(changeYamlPath, 'utf8');
      assert.ok(updatedChange.includes('status: verified'));

      // Working tree clean
      assert.ok(git.isWorkingTreeClean(fixture.cloneDir));

      // Branch pushed
      const branch = git.getCurrentBranch(fixture.cloneDir);
      const ab = git.getAheadBehind(fixture.cloneDir, branch);
      assert.equal(ab.ahead, 0);

      // Latest commit message contains changeSlug/taskId
      const lastCommit = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim();
      assert.equal(lastCommit, 'chore(specs): verify test-change/task-1');

      // Verify exact files in commit
      const committedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' })
        .trim().split(/\r?\n/).map(p => p.replace(/\\/g, '/'));

      const expectedFiles = [
        'specs/active.generated.md',
        'specs/archive.generated.md',
        'specs/index.generated.json',
        'specs/active/test-change/change.yaml',
      ];
      for (const f of committedFiles) {
        assert.ok(expectedFiles.includes(f), `Unexpected file in verification commit: ${f}`);
      }
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('verify refuses to commit and fails safely when unrelated dirty file exists in same spec', () => {
    const fixture = setupTempGitRepo();
    try {
      // First approve task
      handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Mark implemented
      const changeYamlPath = join(fixture.cloneDir, 'specs', 'active', 'test-change', 'change.yaml');
      const content = readFileSync(changeYamlPath, 'utf8').replace('status: approved', 'status: implemented');
      writeFileSync(changeYamlPath, content);
      execFileSync('git', ['add', '.'], { cwd: fixture.cloneDir });
      execFileSync('git', ['commit', '-m', 'feat: complete task-1 implementation'], { cwd: fixture.cloneDir });
      execFileSync('git', ['push'], { cwd: fixture.cloneDir });

      // Add unrelated dirty task file
      writeFileSync(join(fixture.cloneDir, 'specs', 'active', 'test-change', 'tasks', '02-other.md'), '# Another task');

      assert.throws(
        () => {
          handleVerify('test-change', 'task-1', {
            gitRoot: fixture.cloneDir,
            activeDir: fixture.activeDir,
            git: true,
          });
        },
        err => err.message.includes('unrelated dirty files'),
      );
    } finally {
      fixture.cleanup();
    }
  });
});
