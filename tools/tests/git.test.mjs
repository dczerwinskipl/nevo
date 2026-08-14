// Tests for tools/lib/git.mjs against a real, disposable temp Git repository —
// never against the developer's own working tree or branch. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  getWorkingTreeStatus, isWorkingTreeClean, branchExists, checkoutBranch, createAndCheckoutBranch,
  getCurrentBranch, hasUpstream, getAheadBehind, commitAll, push, touchesPaths,
  checkoutTrackingBranch, getDirtyFiles, getDirtyPaths, getWorkingTreeSummary,
  getCurrentRevision, getChangedFiles,
} from '../lib/git.mjs';

let repo, remote;

function git(args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

before(() => {
  remote = mkdtempSync(join(tmpdir(), 'nevo-git-remote-'));
  execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });

  repo = mkdtempSync(join(tmpdir(), 'nevo-git-test-'));
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', 'a.txt']);
  git(['commit', '-m', 'initial']);
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

describe('lib/git.mjs against a disposable temp repo', () => {
  test('isWorkingTreeClean is true right after commit', () => {
    assert.equal(isWorkingTreeClean(repo), true);
  });

  test('isWorkingTreeClean is false with an uncommitted change', () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    assert.equal(isWorkingTreeClean(repo), false);
    assert.notEqual(getWorkingTreeStatus(repo), '');
    git(['checkout', '--', 'a.txt']);
  });

  test('branchExists is false for a name that was never created', () => {
    assert.equal(branchExists(repo, 'feature/does-not-exist'), false);
  });

  test('createAndCheckoutBranch creates and switches to a new branch', () => {
    createAndCheckoutBranch(repo, 'feature/new-thing');
    assert.equal(branchExists(repo, 'feature/new-thing'), true);
    assert.equal(git(['branch', '--show-current']).trim(), 'feature/new-thing');
  });

  test('checkoutBranch switches back to an existing branch', () => {
    checkoutBranch(repo, 'main');
    assert.equal(git(['branch', '--show-current']).trim(), 'main');
  });

  test('a branch name containing shell metacharacters is passed through as a single argument, not executed', () => {
    // Regression guard for "Git commands use argument arrays rather than shell
    // string concatenation": if lib/git.mjs ever regressed to building a shell
    // string, a name like this would either break the command or, worse, be
    // interpreted by a shell. With execFileSync + an argument array it's just
    // an invalid ref name and git rejects it cleanly.
    assert.throws(() => createAndCheckoutBranch(repo, 'feature/$(touch pwned)'));
    checkoutBranch(repo, 'main');
  });

  test('getCurrentBranch reports the active branch', () => {
    assert.equal(getCurrentBranch(repo), 'main');
  });

  test('hasUpstream is false before the branch is ever pushed', () => {
    assert.equal(hasUpstream(repo, 'main'), false);
  });

  test('getAheadBehind reports hasUpstream: false with null counts for an unpushed branch', () => {
    const state = getAheadBehind(repo, 'main');
    assert.deepEqual(state, { hasUpstream: false, ahead: null, behind: null });
  });

  test('push creates the upstream; getAheadBehind then reports 0/0', () => {
    push(repo, 'main');
    assert.equal(hasUpstream(repo, 'main'), true);
    assert.deepEqual(getAheadBehind(repo, 'main'), { hasUpstream: true, ahead: 0, behind: 0 });
  });

  test('getAheadBehind counts local commits made after the last push as "ahead"', () => {
    writeFileSync(join(repo, 'b.txt'), 'second\n');
    git(['add', 'b.txt']);
    git(['commit', '-m', 'second commit']);
    assert.deepEqual(getAheadBehind(repo, 'main'), { hasUpstream: true, ahead: 1, behind: 0 });
    push(repo, 'main');
    assert.deepEqual(getAheadBehind(repo, 'main'), { hasUpstream: true, ahead: 0, behind: 0 });
  });

  test('commitAll stages and commits every pending change, including untracked files', () => {
    writeFileSync(join(repo, 'c.txt'), 'third\n');
    commitAll(repo, 'chore: add c.txt');
    assert.equal(isWorkingTreeClean(repo), true);
    assert.match(git(['log', '-1', '--format=%s']), /chore: add c\.txt/);
    push(repo, 'main');
  });

  test('touchesPaths is true when a path filter matches changed files, false otherwise', () => {
    createAndCheckoutBranch(repo, 'feature/paths-test');
    ensureDirAndFile(join(repo, 'src', 'x.txt'), 'code\n');
    git(['add', '-A']);
    git(['commit', '-m', 'touch src/x.txt']);

    assert.equal(touchesPaths(repo, 'main', 'feature/paths-test', ['src']), true);
    assert.equal(touchesPaths(repo, 'main', 'feature/paths-test', ['tests']), false);

    checkoutBranch(repo, 'main');
  });

  test('getCurrentRevision matches git rev-parse HEAD', () => {
    assert.equal(getCurrentRevision(repo), git(['rev-parse', 'HEAD']).trim());
  });

  test('getChangedFiles lists every file changed since a base revision, committed and uncommitted (PR re-review packet 03)', () => {
    checkoutBranch(repo, 'main');
    const base = getCurrentRevision(repo);
    createAndCheckoutBranch(repo, 'feature/changed-files-test');
    ensureDirAndFile(join(repo, 'batch', 'one.txt'), 'one\n');
    git(['add', '-A']);
    git(['commit', '-m', 'batch: add one.txt']);
    ensureDirAndFile(join(repo, 'batch', 'two.txt'), 'two\n'); // uncommitted

    const changed = getChangedFiles(repo, base).sort();
    assert.deepEqual(changed, ['batch/one.txt', 'batch/two.txt']);

    execFileSync('git', ['-C', repo, 'clean', '-fd', 'batch'], { encoding: 'utf8' });
    checkoutBranch(repo, 'main');
    execFileSync('git', ['-C', repo, 'branch', '-D', 'feature/changed-files-test'], { encoding: 'utf8' });
  });

  test('getChangedFiles is empty when nothing changed since base', () => {
    const base = getCurrentRevision(repo);
    assert.deepEqual(getChangedFiles(repo, base), []);
  });

  test('getDirtyFiles is empty on a clean tree, lists changes on a dirty one', () => {
    assert.deepEqual(getDirtyFiles(repo), []);
    writeFileSync(join(repo, 'untracked.txt'), 'new\n');
    assert.deepEqual(getDirtyFiles(repo), ['untracked.txt']);
    execFileSync('git', ['-C', repo, 'clean', '-fd', 'untracked.txt'], { encoding: 'utf8' });
  });

  test('getDirtyPaths matches getDirtyFiles for an ordinary (non-rename) change', () => {
    assert.deepEqual(getDirtyPaths(repo), []);
    writeFileSync(join(repo, 'untracked2.txt'), 'new\n');
    assert.deepEqual(getDirtyPaths(repo), ['untracked2.txt']);
    execFileSync('git', ['-C', repo, 'clean', '-fd', 'untracked2.txt'], { encoding: 'utf8' });
  });

  test('getWorkingTreeSummary separates staged, unstaged, and untracked changes', () => {
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    git(['add', 'staged.txt']);
    writeFileSync(join(repo, 'a.txt'), 'unstaged\n');
    writeFileSync(join(repo, 'untracked-summary.txt'), 'untracked\n');

    const summary = getWorkingTreeSummary(repo);
    assert.equal(summary.clean, false);
    assert.deepEqual({ total: summary.total, staged: summary.staged, unstaged: summary.unstaged, untracked: summary.untracked }, {
      total: 3,
      staged: 1,
      unstaged: 1,
      untracked: 1,
    });
    assert.deepEqual(summary.files.map(file => file.path).sort(), ['a.txt', 'staged.txt', 'untracked-summary.txt']);

    git(['reset', '--hard', 'HEAD']);
    execFileSync('git', ['-C', repo, 'clean', '-fd', 'staged.txt', 'untracked-summary.txt'], { encoding: 'utf8' });
  });

  test('a rename is reported as "old -> new" by getDirtyFiles but as two separate real paths by getDirtyPaths (PR review packet 03, Problem 3)', () => {
    writeFileSync(join(repo, 'rename-src.txt'), 'x'.repeat(200)); // large enough for git to detect a rename, not add+delete
    git(['add', 'rename-src.txt']);
    git(['commit', '-m', 'add rename-src.txt']);

    execFileSync('git', ['-C', repo, 'mv', 'rename-src.txt', 'rename-dst.txt'], { encoding: 'utf8' });

    const files = getDirtyFiles(repo);
    assert.equal(files.length, 1);
    assert.match(files[0], /rename-src\.txt -> rename-dst\.txt/);

    const paths = getDirtyPaths(repo);
    assert.ok(paths.includes('rename-src.txt'), 'old path must be classifiable on its own');
    assert.ok(paths.includes('rename-dst.txt'), 'new path must be classifiable on its own');
    assert.equal(paths.length, 2);

    git(['reset', '--hard', 'HEAD~1']);
  });

  test('a file with a space in its name is reported as its real, unquoted path', () => {
    writeFileSync(join(repo, 'has space.txt'), 'x\n');
    assert.deepEqual(getDirtyPaths(repo), ['has space.txt']);
    execFileSync('git', ['-C', repo, 'clean', '-fd', 'has space.txt'], { encoding: 'utf8' });
  });

  test('checkoutTrackingBranch (REC-02) fetches and checks out a branch that exists on origin but not locally', () => {
    createAndCheckoutBranch(repo, 'feature/remote-only');
    push(repo, 'feature/remote-only');
    checkoutBranch(repo, 'main');
    git(['branch', '-D', 'feature/remote-only']);
    assert.equal(branchExists(repo, 'feature/remote-only'), false);

    checkoutTrackingBranch(repo, 'feature/remote-only');

    assert.equal(getCurrentBranch(repo), 'feature/remote-only');
    assert.equal(branchExists(repo, 'feature/remote-only'), true);
    assert.equal(hasUpstream(repo, 'feature/remote-only'), true);

    checkoutBranch(repo, 'main');
  });

  test('hasUpstream is true for a branch that exists on the remote even when the local origin/<branch> tracking ref was never fetched (PR review packet 03, Problem 2)', () => {
    // Create the branch directly against the bare remote, from a throwaway
    // clone — `repo`'s own remote-tracking refs never learn about it via an
    // ordinary fetch, simulating a clone whose cached refs are stale.
    const otherClone = mkdtempSync(join(tmpdir(), 'nevo-git-clone-'));
    execFileSync('git', ['-C', otherClone, 'clone', remote, '.'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'checkout', '-b', 'feature/stale-ref-test'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'push', 'origin', 'feature/stale-ref-test'], { encoding: 'utf8' });
    rmSync(otherClone, { recursive: true, force: true });

    // `repo` never fetched this branch — the old rev-parse-against-local-ref
    // implementation would report false here.
    assert.throws(() => execFileSync('git', ['-C', repo, 'rev-parse', '--verify', 'origin/feature/stale-ref-test'], { encoding: 'utf8' }));
    assert.equal(hasUpstream(repo, 'feature/stale-ref-test'), true);
  });
});

function ensureDirAndFile(filePath, content) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
}
