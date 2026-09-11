// Tests for the commit-and-push action (Task 04, source-control-capability) and the two
// tools/lib/git.mjs reconciliation primitives it depends on — against real, disposable
// temp Git repositories, never the developer's own working tree.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ActionContract, ActionCheckResult, ActionExecuteResult } from '../specs/workflow/contracts.mjs';
import { PreconditionError } from '../specs/workflow/errors.mjs';
import { CommitAndPushAction } from '../specs/workflow/actions/commit-and-push.mjs';
import { defaultActionRegistry } from '../specs/workflow/registry.mjs';
import '../specs/workflow/actions/index.mjs';
import { validateSourceControlConfig, normalizeSourceControlConfig } from '../specs/workflow/definitions/schema.mjs';
import { isCommitOnRemoteBranch, getCommitInfo, getCurrentRevision } from '../lib/git.mjs';

function makeRepoPair(prefix) {
  const remote = mkdtempSync(join(tmpdir(), `${prefix}-remote-`));
  execFileSync('git', ['-C', remote, 'init', '--bare', '--initial-branch=main'], { encoding: 'utf8' });

  const repo = mkdtempSync(join(tmpdir(), `${prefix}-repo-`));
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'root.txt'), 'root\n');
  git(['add', 'root.txt']);
  git(['commit', '-m', 'initial']);
  git(['push', '-u', 'origin', 'main']);

  return { repo, remote, git };
}

function cleanupRepoPair({ repo, remote }) {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
}

describe('CommitAndPushAction contract shape (AC1)', () => {
  test('implements ActionContract with id "commit-and-push"', () => {
    const action = new CommitAndPushAction();
    assert.ok(action instanceof ActionContract);
    assert.equal(action.id, 'commit-and-push');
    assert.equal(typeof action.description, 'string');
    assert.ok(action.description.length > 0);
  });

  test('is auto-registered in the default action registry', () => {
    assert.ok(defaultActionRegistry.has('commit-and-push'));
    assert.ok(defaultActionRegistry.get('commit-and-push') instanceof CommitAndPushAction);
  });
});

describe('check(context) — disabled sourceControl (AC2)', () => {
  test('reports ready: false and no requiredInputs when sourceControl.enabled is false', async () => {
    const action = new CommitAndPushAction();
    const result = await action.check({ sourceControl: { enabled: false } });
    assert.ok(result instanceof ActionCheckResult);
    assert.equal(result.ready, false);
    assert.deepEqual(result.requiredInputs, []);
  });

  test('defaults to disabled when sourceControl is entirely omitted', async () => {
    const action = new CommitAndPushAction();
    const result = await action.check({});
    assert.equal(result.ready, false);
  });
});

describe('check(context) — enabled sourceControl (AC2, AC3)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-cap-check');
    writeFileSync(join(ctx.repo, 'changed.txt'), 'changed\n');
    writeFileSync(join(ctx.repo, 'untracked.txt'), 'new\n');
    ctx.git(['add', 'changed.txt']); // staged
  });

  after(() => cleanupRepoPair(ctx));

  test('requiredInputs declares commit.title and include as required', async () => {
    const action = new CommitAndPushAction();
    const result = await action.check({
      repoRoot: ctx.repo,
      sourceControl: { enabled: true, push: false },
    });
    assert.equal(result.ready, true);
    const byName = Object.fromEntries(result.requiredInputs.map(s => [s.name, s]));
    assert.equal(byName['commit.title'].required, true);
    assert.equal(byName['commit.message'].required, false);
    assert.equal(byName['include'].required, true);
    assert.equal(byName['exclude'].required, false);
  });

  test('returns factual Git context without mutating the repository or worktree (AC3)', async () => {
    const action = new CommitAndPushAction();
    const statusBefore = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const result = await action.check({
      repoRoot: ctx.repo,
      baseBranch: 'main',
      sourceControl: { enabled: true, push: false },
    });
    const statusAfter = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(statusBefore, statusAfter, 'check(context) must never mutate the worktree');

    assert.ok(result.context.changedFiles.includes('changed.txt'));
    assert.ok(result.context.changedFiles.includes('untracked.txt'));
    assert.ok(result.context.stagedFiles.includes('changed.txt'));
    assert.equal(result.context.currentBranch, 'main');
    assert.equal(result.context.baseBranch, 'main');
    assert.ok(Array.isArray(result.context.existingCommits));
    assert.equal(result.context.unpushedCommits, undefined, 'unpushedCommits must be absent when push is disabled');
  });

  test('includes unpushedCommits when push is enabled (AC3)', async () => {
    const action = new CommitAndPushAction();
    const result = await action.check({
      repoRoot: ctx.repo,
      baseBranch: 'main',
      sourceControl: { enabled: true, push: true, remote: { enabled: false } },
    });
    assert.ok(Array.isArray(result.context.unpushedCommits));
  });
});

describe('executeValidated — fail-closed input validation (AC4, AC5)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-cap-failclosed');
    writeFileSync(join(ctx.repo, 'dirty.txt'), 'dirty\n');
  });

  after(() => cleanupRepoPair(ctx));

  const baseContext = () => ({ repoRoot: ctx.repo, sourceControl: { enabled: true, push: false } });

  test('throws PreconditionError when commit.title is missing', async () => {
    const action = new CommitAndPushAction();
    await assert.rejects(
      () => action.execute({ include: ['dirty.txt'] }, baseContext()),
      PreconditionError
    );
  });

  test('throws PreconditionError when commit.title is whitespace-only', async () => {
    const action = new CommitAndPushAction();
    await assert.rejects(
      () => action.execute({ 'commit.title': '   ', include: ['dirty.txt'] }, baseContext()),
      PreconditionError
    );
  });

  test('throws PreconditionError when include is omitted — never guesses or stages dirty files implicitly', async () => {
    const action = new CommitAndPushAction();
    await assert.rejects(
      () => action.execute({ 'commit.title': 'A valid title' }, baseContext()),
      PreconditionError
    );
    // Fail-closed: the worktree must remain exactly as dirty as before the rejected call.
    const status = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.ok(status.includes('dirty.txt'));
  });

  test('throws PreconditionError when include matches no changed files', async () => {
    const action = new CommitAndPushAction();
    await assert.rejects(
      () => action.execute({ 'commit.title': 'A valid title', include: ['does-not-exist.txt'] }, baseContext()),
      PreconditionError
    );
  });
});

describe('executeValidated — successful commit and push (AC6)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-cap-execute');
  });

  after(() => cleanupRepoPair(ctx));

  test('stages the explicit selection, commits, pushes, and returns the D15 output shape', async () => {
    writeFileSync(join(ctx.repo, 'feature.txt'), 'feature\n');
    writeFileSync(join(ctx.repo, 'unrelated.txt'), 'unrelated\n');

    const action = new CommitAndPushAction();
    const result = await action.execute(
      { 'commit.title': 'Add feature file', include: ['feature.txt'] },
      { repoRoot: ctx.repo, sourceControl: { enabled: true, push: true, remote: { enabled: false } } }
    );

    assert.ok(result instanceof ActionExecuteResult);
    assert.equal(result.success, true);
    assert.equal(typeof result.outputs.commit.sha, 'string');
    assert.equal(result.outputs.commit.status, 'completed');
    assert.equal(result.outputs.push.remote, 'origin');
    assert.equal(result.outputs.push.branch, 'main');
    assert.equal(result.outputs.push.expectedSha, result.outputs.commit.sha);
    assert.equal(result.outputs.push.status, 'completed');

    // Only the explicitly included file was staged/committed — the unrelated dirty file
    // must still be present, uncommitted (C6's fail-closed file-selection invariant).
    const status = execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.ok(status.includes('unrelated.txt'));
    assert.ok(!status.includes('feature.txt'));

    // The pushed commit must actually be present on the remote.
    assert.equal(isCommitOnRemoteBranch(ctx.repo, result.outputs.commit.sha, 'main'), true);
  });

  test('does not push when sourceControl.push is false', async () => {
    writeFileSync(join(ctx.repo, 'local-only.txt'), 'local\n');
    const action = new CommitAndPushAction();
    const result = await action.execute(
      { 'commit.title': 'Local-only commit', include: ['local-only.txt'] },
      { repoRoot: ctx.repo, sourceControl: { enabled: true, push: false } }
    );
    assert.equal(result.outputs.push, undefined);
    assert.equal(isCommitOnRemoteBranch(ctx.repo, result.outputs.commit.sha, 'main'), false);
  });
});

describe('tools/lib/git.mjs — isCommitOnRemoteBranch reconciliation primitive (AC7)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-cap-reconcile');
  });

  after(() => cleanupRepoPair(ctx));

  test('reports true for a pushed commit and false for an unpushed one', () => {
    writeFileSync(join(ctx.repo, 'pushed.txt'), 'a\n');
    ctx.git(['add', 'pushed.txt']);
    ctx.git(['commit', '-m', 'pushed commit']);
    ctx.git(['push', 'origin', 'main']);
    const pushedSha = getCurrentRevision(ctx.repo);

    writeFileSync(join(ctx.repo, 'unpushed.txt'), 'b\n');
    ctx.git(['add', 'unpushed.txt']);
    ctx.git(['commit', '-m', 'unpushed commit']);
    const unpushedSha = getCurrentRevision(ctx.repo);

    assert.equal(isCommitOnRemoteBranch(ctx.repo, pushedSha, 'main'), true);
    assert.equal(isCommitOnRemoteBranch(ctx.repo, unpushedSha, 'main'), false);
  });
});

describe('tools/lib/git.mjs — getCommitInfo (AC10)', () => {
  let ctx;

  before(() => {
    ctx = makeRepoPair('nevo-cap-commitinfo');
  });

  after(() => cleanupRepoPair(ctx));

  test('returns { sha, parentSha, subject } for a normal commit', () => {
    const rootSha = getCurrentRevision(ctx.repo);
    writeFileSync(join(ctx.repo, 'second.txt'), 'x\n');
    ctx.git(['add', 'second.txt']);
    ctx.git(['commit', '-m', 'second commit']);
    const info = getCommitInfo(ctx.repo, 'HEAD');
    assert.equal(info.sha, getCurrentRevision(ctx.repo));
    assert.equal(info.parentSha, rootSha);
    assert.equal(info.subject, 'second commit');
  });

  test('reports a root commit\'s parentSha as null rather than throwing', () => {
    const other = makeRepoPair('nevo-cap-commitinfo-root');
    try {
      const info = getCommitInfo(other.repo, 'HEAD');
      assert.equal(info.parentSha, null);
      assert.equal(info.subject, 'initial');
    } finally {
      cleanupRepoPair(other);
    }
  });
});

describe('sourceControl configuration — the four defined cases and fail-closed rejection (AC8, AC9)', () => {
  test('case (a): sourceControl.enabled: false — no automation', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: false }, 'workflow', errors);
    assert.deepEqual(errors, []);
    const normalized = normalizeSourceControlConfig({ enabled: false, push: true, remote: { enabled: true, provider: 'github' } });
    assert.deepEqual(normalized, { enabled: false, push: false, remote: { enabled: false, provider: null } });
  });

  test('case (b): enabled: true, push: false — local commit only', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: true, push: false }, 'workflow', errors);
    assert.deepEqual(errors, []);
    const normalized = normalizeSourceControlConfig({ enabled: true, push: false });
    assert.deepEqual(normalized, { enabled: true, push: false, remote: { enabled: false, provider: null } });
  });

  test('case (c): enabled: true, push: true, remote.enabled: false — plain Git push, no provider', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: true, push: true, remote: { enabled: false } }, 'workflow', errors);
    assert.deepEqual(errors, []);
    const normalized = normalizeSourceControlConfig({ enabled: true, push: true, remote: { enabled: false } });
    assert.deepEqual(normalized, { enabled: true, push: true, remote: { enabled: false, provider: null } });
  });

  test('case (d): enabled: true, push: true, remote: { enabled: true, provider: github }', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: true, push: true, remote: { enabled: true, provider: 'github' } }, 'workflow', errors);
    assert.deepEqual(errors, []);
    const normalized = normalizeSourceControlConfig({ enabled: true, push: true, remote: { enabled: true, provider: 'github' } });
    assert.deepEqual(normalized, { enabled: true, push: true, remote: { enabled: true, provider: 'github' } });
  });

  test('remote.enabled: true with push: false is rejected as a validation error, never normalized (AC9)', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: true, push: false, remote: { enabled: true, provider: 'github' } }, 'workflow', errors);
    assert.ok(errors.length > 0, 'expected a validation error for remote.enabled: true with push: false');
    assert.ok(errors.some(e => e.includes('remote.enabled: true is invalid when push: false')));
  });

  test('an unknown remote provider is rejected when remote.enabled is true', () => {
    const errors = [];
    validateSourceControlConfig({ enabled: true, push: true, remote: { enabled: true, provider: 'gitlab' } }, 'workflow', errors);
    assert.ok(errors.length > 0);
  });
});
