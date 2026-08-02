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
});

function ensureDirAndFile(filePath, content) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
}
