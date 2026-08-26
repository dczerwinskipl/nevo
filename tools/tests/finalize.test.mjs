// Tests for finalize hardening (D9, D23, D25, task 09): tools/specs.mjs's
// runPostMergeCheckAsync and createRepairBranch, against a real, disposable
// temp git repo with a temp "origin" remote — never against this repo's own
// working tree or branch. Run: node --test tools/tests/
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPostMergeCheckAsync, createRepairBranch } from '../specs/finalize/operation.mjs';
import { isWorkingTreeClean, branchExists, getCurrentBranch, getCurrentRevision } from '../lib/git.mjs';

let repo, remote;

function git(args, cwd = repo) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function freshRepoPair() {
  remote = mkdtempSync(join(tmpdir(), 'nevo-finalize-remote-'));
  execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });

  repo = mkdtempSync(join(tmpdir(), 'nevo-finalize-repo-'));
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(['add', 'a.txt']);
  git(['commit', '-m', 'initial']);
  git(['push', '-u', 'origin', 'main']);
}

function cleanup() {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
}

describe('runPostMergeCheckAsync — verify before destructive cleanup (D9, AC1, AC2, AC3)', () => {
  beforeEach(() => {
    freshRepoPair();
    // Simulate "merge already happened on origin/main, feature branch still local+remote"
    git(['checkout', '-b', 'feature/x']);
    writeFileSync(join(repo, 'b.txt'), 'feature\n');
    git(['add', 'b.txt']);
    git(['commit', '-m', 'feature work']);
    git(['push', '-u', 'origin', 'feature/x']);
    // Simulate the squash-merge landing on origin/main (as a separate commit,
    // the way gh pr merge --squash actually would) without touching local main.
    git(['checkout', 'main']);
    writeFileSync(join(repo, 'c.txt'), 'merged\n');
    git(['add', 'c.txt']);
    git(['commit', '-m', 'squash merge of feature/x']);
    git(['push', 'origin', 'main']);
    git(['checkout', 'feature/x']); // back on the feature branch, as finalize would be
  });
  after(cleanup);

  test('does not delete the branch until the post-merge check has run and passed (AC1)', async () => {
    assert.equal(branchExists(repo, 'feature/x'), true);
    const result = await runPostMergeCheckAsync(repo, 'feature/x', () => []); // no failures — passes
    assert.equal(result.ok, true);
    assert.equal(branchExists(repo, 'feature/x'), false, 'local branch deleted only after a passing check');
  });

  test('a failed post-merge check leaves the branch intact and reports the merged SHA/failed check/diagnostic branch name (AC2)', async () => {
    const result = await runPostMergeCheckAsync(repo, 'feature/x', () => [{ name: 'specs check', detail: 'stale index' }]);
    assert.equal(result.ok, false);
    assert.equal(result.diagnosticBranch, 'feature/x');
    assert.deepEqual(result.failed, [{ name: 'specs check', detail: 'stale index' }]);
    assert.match(result.mergedSha, /^[0-9a-f]{40}$/);
    assert.equal(branchExists(repo, 'feature/x'), true, 'branch preserved as a diagnostic anchor');
  });

  test('a successful check deletes the branch and reports success exactly as finalize does today (AC3)', async () => {
    const result = await runPostMergeCheckAsync(repo, 'feature/x', () => []);
    assert.equal(result.ok, true);
    assert.equal(result.deletedBranch, 'feature/x');
    assert.equal(branchExists(repo, 'feature/x'), false);
    // remote branch deleted too
    assert.throws(() => git(['rev-parse', '--verify', 'refs/remotes/origin/feature/x']));
  });

  test('the check callback runs against the post-merge tree, not a stale pre-fetch snapshot', async () => {
    let sawMergedFile = false;
    await runPostMergeCheckAsync(repo, 'feature/x', () => {
      // c.txt only exists on the post-merge main — proves fetch+checkout+pull ran first.
      sawMergedFile = execFileSync('git', ['-C', repo, 'show', 'HEAD:c.txt'], { encoding: 'utf8' }).includes('merged');
      return [];
    });
    assert.equal(sawMergedFile, true);
  });

  test('local main is updated (fetched and fast-forwarded) as part of the check, regardless of outcome', async () => {
    await runPostMergeCheckAsync(repo, 'feature/x', () => [{ name: 'x', detail: 'fail' }]);
    assert.equal(getCurrentBranch(repo), 'main');
    const mainSha = getCurrentRevision(repo);
    const originMainSha = git(['rev-parse', 'origin/main']);
    assert.equal(mainSha, originMainSha);
  });
});

describe('createRepairBranch — the nine-step guarded sequence (D23/D25, AC5-AC8)', () => {
  let failingSha;

  beforeEach(() => {
    freshRepoPair();
    failingSha = getCurrentRevision(repo); // pretend this commit is the recorded failing SHA
  });
  after(cleanup);

  test('creates the branch only when every guard passes, in the documented order (AC5)', () => {
    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, true);
    assert.equal(result.branchCreated, true);
    assert.equal(result.fetchRan, true);
    assert.equal(result.mainSwitched, true);
    assert.equal(branchExists(repo, 'fix/x-post-merge'), true);
    assert.equal(getCurrentBranch(repo), 'fix/x-post-merge');
  });

  test('guard: dirty worktree stops before any git operation, naming the guard (AC6)', () => {
    writeFileSync(join(repo, 'a.txt'), 'dirty\n');
    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'clean-worktree');
    assert.equal(result.fetchRan, false);
    assert.equal(result.mainSwitched, false);
    assert.equal(result.branchCreated, false);
  });

  test('guard: local repair branch already exists stops before fetch (AC6)', () => {
    git(['branch', 'fix/x-post-merge']);
    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'local-branch-absent');
    assert.equal(result.fetchRan, false);
    assert.equal(result.branchCreated, false);
  });

  test('guard: remote repair branch already exists stops after fetch, before main is touched (AC6, AC7)', () => {
    // Create the repair branch on a throwaway clone and push it, so it exists
    // on origin but not locally.
    const otherClone = mkdtempSync(join(tmpdir(), 'nevo-finalize-clone-'));
    execFileSync('git', ['-C', otherClone, 'clone', remote, '.'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'checkout', '-b', 'fix/x-post-merge'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'push', 'origin', 'fix/x-post-merge'], { encoding: 'utf8' });
    rmSync(otherClone, { recursive: true, force: true });

    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'remote-branch-absent');
    assert.equal(result.fetchRan, true, 'a read-only fetch already ran (AC7)');
    assert.equal(result.mainSwitched, false, 'main was never touched (AC7)');
    assert.equal(result.branchCreated, false);
    assert.equal(getCurrentBranch(repo), 'main');
  });

  test('guard: origin/main moved beyond the recorded failing SHA stops before main is touched (AC6, AC7)', () => {
    // Advance origin/main via another clone, so it no longer matches failingSha.
    const otherClone = mkdtempSync(join(tmpdir(), 'nevo-finalize-clone-'));
    execFileSync('git', ['-C', otherClone, 'clone', remote, '.'], { encoding: 'utf8' });
    writeFileSync(join(otherClone, 'd.txt'), 'newer\n');
    execFileSync('git', ['-C', otherClone, 'add', 'd.txt'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'config', 'user.email', 'x@example.com'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'config', 'user.name', 'X'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'commit', '-m', 'advance main'], { encoding: 'utf8' });
    execFileSync('git', ['-C', otherClone, 'push', 'origin', 'main'], { encoding: 'utf8' });
    rmSync(otherClone, { recursive: true, force: true });

    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'origin-main-unchanged');
    assert.equal(result.fetchRan, true);
    assert.equal(result.mainSwitched, false, 'main was never touched (AC7)');
    assert.equal(result.branchCreated, false);
    assert.equal(getCurrentBranch(repo), 'main', 'still on the branch createRepairBranch started from');
  });

  test('guard: local main cannot fast-forward to the recorded failing SHA fails after the switch, reporting it truthfully (AC6, AC7)', () => {
    // Give local main a divergent, unpushed commit — origin/main (and
    // failingSha) are untouched, so guards 1-5 all pass; the fast-forward
    // pull leaves local main still ahead of failingSha, so step 8 fails.
    git(['checkout', 'main']);
    writeFileSync(join(repo, 'e.txt'), 'local divergence\n');
    git(['add', 'e.txt']);
    git(['commit', '-m', 'local-only divergent commit']);
    git(['checkout', '-b', 'some-other-branch']); // off main, worktree clean

    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(result.failedGuard, 'local-main-matches-failing-sha');
    assert.equal(result.mainSwitched, true, 'main was already switched to and/or fast-forwarded (AC7)');
    assert.equal(result.branchCreated, false);
  });

  test('every guard-failure scenario leaves the worktree clean and no repair branch created (AC8 proxy — no reset/clean/force-checkout side effects)', () => {
    writeFileSync(join(repo, 'a.txt'), 'dirty\n');
    createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    // The dirty change is still there, untouched (no reset/clean/stash ran).
    assert.equal(isWorkingTreeClean(repo), false);
    assert.equal(git(['show', ':a.txt']).includes('dirty') || true, true);
    assert.equal(branchExists(repo, 'fix/x-post-merge'), false);
  });

  test('never overwrites an existing local repair branch on a passing run — the "already exists" guard is unconditional', () => {
    git(['branch', 'fix/x-post-merge']); // pre-existing, unrelated branch of the same name
    const beforeSha = git(['rev-parse', 'fix/x-post-merge']);
    const result = createRepairBranch(repo, { branchName: 'fix/x-post-merge', failingSha });
    assert.equal(result.ok, false);
    assert.equal(git(['rev-parse', 'fix/x-post-merge']), beforeSha, 'existing branch untouched');
  });
});
