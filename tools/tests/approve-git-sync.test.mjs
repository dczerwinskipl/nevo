import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { handleApprove } from '../specs/approve/cli.mjs';
import { handleVerify } from '../specs/verify/cli.mjs';
import * as git from '../lib/git.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../specs/fingerprint.mjs';
import { parseProgressLine } from '../lib/operation-progress.mjs';

function setupTempGitRepo() {
  const baseDir = join(tmpdir(), `nevo-approve-test-${Math.random().toString(36).slice(2)}`);
  const originDir = join(baseDir, 'origin.git');
  const cloneDir = join(baseDir, 'repo');

  mkdirSync(baseDir, { recursive: true });

  // Create bare remote repository
  execFileSync('git', ['init', '--bare', originDir]);

  // Clone from bare remote
  execFileSync('git', ['clone', originDir, cloneDir]);

  // Configure user in clone
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: cloneDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: cloneDir });

  // Create initial commit on main
  writeFileSync(join(cloneDir, 'README.md'), '# Test repo\n');
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: cloneDir });
  execFileSync('git', ['add', '.'], { cwd: cloneDir });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd: cloneDir });
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

  writeFileSync(join(cloneDir, 'specs', 'active.generated.md'), '# Active Specs\n');
  writeFileSync(join(cloneDir, 'specs', 'archive.generated.md'), '# Archive Specs\n');
  writeFileSync(join(cloneDir, 'specs', 'index.generated.json'), JSON.stringify({ generated: new Date().toISOString(), changes: [] }, null, 2));

  const changeYaml = [
    'id: test-change',
    'title: Test Change',
    'status: draft',
    'tasks:',
    '  - id: task-1',
    '    order: 1',
    '    file: tasks/01-task-1.md',
    '    status: draft',
  ].join('\n');
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);
  writeFileSync(join(tasksDir, '01-task-1.md'), '# Task 1\n');

  // Compute valid review with task fingerprint
  const changeObj = {
    id: 'test-change',
    _dir: changeDir,
    tasks: [{ id: 'task-1', file: 'tasks/01-task-1.md', status: 'draft' }],
  };
  const fingerprint = computeChangeFingerprint(changeObj);
  const task1Fingerprint = computeTaskFingerprint(changeObj, 'task-1');

  const reviewMd = [
    '---',
    'verdict: ready-for-approval',
    `spec_fingerprint: ${fingerprint}`,
    'task_fingerprints:',
    `  task-1: ${task1Fingerprint}`,
    'unresolved_required_fixes: 0',
    'unresolved_owner_decisions: 0',
    'unresolved_needs_clarification: 0',
    '---',
    '',
    '# Spec Review',
  ].join('\n');
  writeFileSync(join(reviewsDir, 'spec.md'), reviewMd);

  // Commit spec baseline to repository so working tree is clean
  execFileSync('git', ['add', '.'], { cwd: cloneDir });
  execFileSync('git', ['commit', '-m', 'chore: add spec test-change'], { cwd: cloneDir });
  execFileSync('git', ['push'], { cwd: cloneDir });

  return {
    baseDir,
    originDir,
    cloneDir,
    activeDir,
    changeDir,
    cleanup() {
      try {
        rmSync(baseDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

test('Approve post-action sync and Git integration', async (t) => {
  await t.test('approve --no-git approves task and rebuilds metadata without git commit/push', async () => {
    const fixture = setupTempGitRepo();
    try {
      await handleApprove('test-change', 'task-1', {
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

  await t.test('approve with Git (default) commits ONLY operation-owned files and pushes', async () => {
    const fixture = setupTempGitRepo();
    try {
      await handleApprove('test-change', 'task-1', {
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

  await t.test('approve refuses to commit and fails safely when unrelated dirty file exists outside spec', async () => {
    const fixture = setupTempGitRepo();
    try {
      // Create unrelated dirty file outside allowed specs paths
      writeFileSync(join(fixture.cloneDir, 'unrelated.txt'), 'unrelated work');

      await assert.rejects(
        async () => {
          await handleApprove('test-change', 'task-1', {
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

  await t.test('approve refuses to commit and fails safely when unrelated dirty task file exists in same spec', async () => {
    const fixture = setupTempGitRepo();
    try {
      // Create an unrelated task file or modify existing task file in same spec
      writeFileSync(join(fixture.cloneDir, 'specs', 'active', 'test-change', 'tasks', '02-other-task.md'), '# Other task draft');

      await assert.rejects(
        async () => {
          await handleApprove('test-change', 'task-1', {
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

  for (const genFile of ['specs/index.generated.json', 'specs/active.generated.md', 'specs/archive.generated.md']) {
    await t.test(`approve fails closed if pre-existing dirty generated file ${genFile} exists`, async () => {
      const fixture = setupTempGitRepo();
      try {
        const genFilePath = join(fixture.cloneDir, genFile);
        const dirtyContent = 'dirty content from previous agent/user work\n';
        writeFileSync(genFilePath, dirtyContent);

        const commitCountBefore = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);

        await assert.rejects(
          async () => {
            await handleApprove('test-change', 'task-1', {
              gitRoot: fixture.cloneDir,
              activeDir: fixture.activeDir,
              git: true,
            });
          },
          err => err.message.includes('contains pre-existing uncommitted modifications'),
        );

        // Dirty content is untouched
        assert.equal(readFileSync(genFilePath, 'utf8'), dirtyContent);

        // No new commit created
        const commitCountAfter = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);
        assert.equal(commitCountBefore, commitCountAfter);

        // Task status not mutated in change.yaml
        const changeYaml = readFileSync(join(fixture.cloneDir, 'specs', 'active', 'test-change', 'change.yaml'), 'utf8');
        assert.ok(changeYaml.includes('status: draft'));
      } finally {
        fixture.cleanup();
      }
    });
  }

  await t.test('real push failure during approve: commit created, push fails, retry performs missing push without duplicate commit', async () => {
    const fixture = setupTempGitRepo();
    try {
      // Break the remote URL to force push to genuinely fail
      execFileSync('git', ['remote', 'set-url', 'origin', 'http://127.0.0.1:9999/nonexistent.git'], { cwd: fixture.cloneDir });

      const events = [];
      const originalWrite = process.stdout.write;
      process.stdout.write = function (chunk, ...args) {
        const line = typeof chunk === 'string' ? chunk : chunk?.toString() || '';
        for (const l of line.split('\n')) {
          const parsed = parseProgressLine(l);
          if (parsed) events.push(parsed);
        }
        return originalWrite.call(process.stdout, chunk, ...args);
      };

      // Run approve with git enabled
      try {
        await assert.rejects(
          async () => {
            await handleApprove('test-change', 'task-1', {
              gitRoot: fixture.cloneDir,
              activeDir: fixture.activeDir,
              git: true,
            });
          },
          err => err.message.includes('Push approval failed'),
        );
      } finally {
        process.stdout.write = originalWrite;
      }

      // Assert progress event structure: previous steps completed, push-approval failed, operation failed
      const completedStepIds = events.filter(e => e.type === 'operation.step.completed').map(e => e.id || e.stepId);
      assert.ok(completedStepIds.includes('validate-approval'));
      assert.ok(completedStepIds.includes('approve-task'));
      assert.ok(completedStepIds.includes('rebuild-metadata'));
      assert.ok(completedStepIds.includes('commit-approval'));

      const failedStep = events.find(e => e.type === 'operation.step.failed' && (e.id === 'push-approval' || e.stepId === 'push-approval'));
      assert.ok(failedStep, 'Expected push-approval step to fail in progress stream');

      const opFailed = events.find(e => e.type === 'operation.failed');
      assert.ok(opFailed, 'Expected operation.failed in progress stream');

      // Verify: commit was created exactly once
      const commitCount = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);
      const lastCommit = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim();
      assert.equal(lastCommit, 'chore(specs): approve task-1');

      const commitShaBefore = git.getCurrentRevision(fixture.cloneDir);

      // Now restore valid remote URL
      execFileSync('git', ['remote', 'set-url', 'origin', fixture.originDir], { cwd: fixture.cloneDir });

      // Retry approve
      await handleApprove('test-change', 'task-1', {
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

  await t.test('full idempotent approve when all postconditions are already met', async () => {
    const fixture = setupTempGitRepo();
    try {
      // First run
      await handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      // Second run (fully idempotent)
      await handleApprove('test-change', 'task-1', {
        gitRoot: fixture.cloneDir,
        activeDir: fixture.activeDir,
        git: true,
      });

      assert.ok(git.isWorkingTreeClean(fixture.cloneDir));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('verify with Git rebuilds metadata, commits ONLY operation-owned files, and pushes', async () => {
    const fixture = setupTempGitRepo();
    try {
      // First approve task
      await handleApprove('test-change', 'task-1', {
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
      await handleVerify('test-change', 'task-1', {
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

  await t.test('verify refuses to commit and fails safely when unrelated dirty file exists in same spec', async () => {
    const fixture = setupTempGitRepo();
    try {
      // First approve task
      await handleApprove('test-change', 'task-1', {
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

      await assert.rejects(
        async () => {
          await handleVerify('test-change', 'task-1', {
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

  for (const genFile of ['specs/index.generated.json', 'specs/active.generated.md', 'specs/archive.generated.md']) {
    await t.test(`verify fails closed if pre-existing dirty generated file ${genFile} exists`, async () => {
      const fixture = setupTempGitRepo();
      try {
        // First approve task
        await handleApprove('test-change', 'task-1', {
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

        const commitCountBefore = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);

        // Pre-dirty generated file
        const genFilePath = join(fixture.cloneDir, genFile);
        const dirtyContent = 'pre-existing dirty generated content before verify\n';
        writeFileSync(genFilePath, dirtyContent);

        await assert.rejects(
          async () => {
            await handleVerify('test-change', 'task-1', {
              gitRoot: fixture.cloneDir,
              activeDir: fixture.activeDir,
              git: true,
            });
          },
          err => err.message.includes('contains pre-existing uncommitted modifications'),
        );

        // Dirty content is untouched
        assert.equal(readFileSync(genFilePath, 'utf8'), dirtyContent);

        // No new commit created
        const commitCountAfter = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.cloneDir, encoding: 'utf8' }).trim(), 10);
        assert.equal(commitCountBefore, commitCountAfter);

        // Task status remains implemented (not verified)
        const updatedChange = readFileSync(changeYamlPath, 'utf8');
        assert.ok(updatedChange.includes('status: implemented'));
        assert.ok(!updatedChange.includes('status: verified'));
      } finally {
        fixture.cleanup();
      }
    });
  }
});
