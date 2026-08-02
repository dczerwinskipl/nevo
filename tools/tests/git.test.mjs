// Tests for tools/lib/git.mjs against a real, disposable temp Git repository —
// never against the developer's own working tree or branch. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getWorkingTreeStatus, isWorkingTreeClean, branchExists, checkoutBranch, createAndCheckoutBranch,
} from '../lib/git.mjs';

let repo;

function git(args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'nevo-git-test-'));
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', 'a.txt']);
  git(['commit', '-m', 'initial']);
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
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
});
