// Tests for workspace-writer slot and workspace-control lock (D55, D56, D65, D70, D80, D82, D84, D89, D92, D99).
// Run: node --test tools/tests/workspace-writer.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
  updateWorkspaceWriterIfOwned,
  forceReleaseWorkspaceWriterUnsafe,
  listPendingWorkspaceWriters,
  getWorkspaceWriterClaim,
  withWorkspaceControlLock,
} from '../specs/workflow/workspace-writer.mjs';
import { execFileSync } from 'node:child_process';
import { handleWorkflowStepStart } from '../specs/workflow/cli.mjs';
import { saveStartOperation } from '../specs/workflow/start-operation.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
} from '../specs/workflow/workspace-request.mjs';
import { registerRequestKindReconciler } from '../specs/workflow/workspace-claim-reconciliation.mjs';

describe('workspace-writer slot and workspace-control lock', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-workspace-writer-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('At most one holder per physical worktree at a time across different specIds (D65)', async () => {
    const resA = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-alpha',
      taskId: 'task-1',
    });
    assert.equal(resA.acquired, true);
    assert.ok(resA.ownerId);

    // Contention from completely different specId
    const resB = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-beta',
      taskId: 'task-2',
      timeoutMs: 100,
      retryIntervalMs: 20,
    });
    assert.equal(resB.acquired, false);
    assert.equal(resB.contended, true);

    await releaseWorkspaceWriter({ repoRoot: tempRepoRoot, ownerId: resA.ownerId });

    // Now spec-beta can acquire
    const resBAfter = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-beta',
      taskId: 'task-2',
      timeoutMs: 500,
    });
    assert.equal(resBAfter.acquired, true);
    await releaseWorkspaceWriter({ repoRoot: tempRepoRoot, ownerId: resBAfter.ownerId });
  });

  test('agent/cli-manual claim is never auto-reclaimed by this module itself', async () => {
    // Simulate dead pid on agent claim
    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'dead-agent-owner',
      kind: 'agent',
      status: 'active',
      specId: 'spec-1',
      taskId: 'task-1',
      pid: 99999999, // dead pid
      createdAt: new Date().toISOString(),
    }, null, 2));

    // Another caller attempts acquisition: must NOT delete or steal the agent claim
    const attempt = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'cli-manual',
      specId: 'spec-1',
      taskId: 'task-2',
      timeoutMs: 100,
      retryIntervalMs: 20,
    });

    assert.equal(attempt.acquired, false);
    assert.equal(attempt.contended, true);

    const claim = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(claim.ownerId, 'dead-agent-owner', 'Agent claim must remain held until caller reconciles it');
  });

  test('releaseWorkspaceWriterIfOwned releases only on exact ownerId match; mismatch is a silent no-op (D70)', async () => {
    const claim = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'cli-manual',
      specId: 'spec-1',
      taskId: 'task-1',
    });

    // Mismatched expectedOwnerId
    const mismatchRes = await releaseWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: 'wrong-owner',
    });
    assert.equal(mismatchRes.released, false);
    assert.equal(mismatchRes.reason, 'not-current-owner');

    const liveClaim = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(liveClaim.ownerId, claim.ownerId, 'Claim must survive byte-for-byte on mismatch');

    // Matching ownerId releases
    const matchRes = await releaseWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claim.ownerId,
    });
    assert.equal(matchRes.released, true);
    assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);
  });

  test('markWorkspaceWriterRecoveryRequiredIfOwned is ownership-conditional', async () => {
    const claim = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-1',
      taskId: 'task-1',
    });

    // Mismatched expectedOwnerId
    const mismatchRes = await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: 'wrong-owner',
    });
    assert.equal(mismatchRes.marked, false);
    assert.equal(mismatchRes.reason, 'not-current-owner');

    let current = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(current.status, 'active');

    // Matching marks recovery-required
    const matchRes = await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claim.ownerId,
    });
    assert.equal(matchRes.marked, true);

    current = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(current.status, 'recovery-required');

    // Any new acquisition must be unconditionally blocked
    const newAcquire = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-1',
      taskId: 'task-2',
    });
    assert.equal(newAcquire.acquired, false);
    assert.equal(newAcquire.blocked, true);
    assert.equal(newAcquire.reason, 'recovery-required');
  });

  test('Stale-reconciliation race: delayed reconciliation call from previous holder cannot affect new holder (D70)', async () => {
    // 1. Holder A acquires and releases
    const claimA = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-1',
      taskId: 'task-1',
    });
    await releaseWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claimA.ownerId,
    });

    // 2. Holder B acquires
    const claimB = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'cli-manual',
      specId: 'spec-2',
      taskId: 'task-2',
    });

    // 3. Delayed stale reconciliation from A runs
    const delayedRelease = await releaseWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claimA.ownerId,
    });
    assert.equal(delayedRelease.released, false);
    assert.equal(delayedRelease.reason, 'not-current-owner');

    const delayedMark = await markWorkspaceWriterRecoveryRequiredIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claimA.ownerId,
    });
    assert.equal(delayedMark.marked, false);
    assert.equal(delayedMark.reason, 'not-current-owner');

    const liveClaim = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(liveClaim.ownerId, claimB.ownerId);
    assert.equal(liveClaim.status, 'active');

    await releaseWorkspaceWriter({ repoRoot: tempRepoRoot, ownerId: claimB.ownerId });
  });

  test('updateWorkspaceWriterIfOwned enriches claim progressively (D89, D93, D99)', async () => {
    const claim = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-1',
      taskId: 'task-1',
    });

    // 1. Prepared stage with sessionId
    const prep = await updateWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claim.ownerId,
      sessionId: 'sess-123',
      turnStartState: 'prepared',
    });
    assert.equal(prep.updated, true);
    let cur = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(cur.sessionId, 'sess-123');
    assert.equal(cur.turnStartState, 'prepared');
    assert.equal(cur.turnId, undefined);

    // 2. Invoking stage
    const inv = await updateWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claim.ownerId,
      turnStartState: 'invoking',
    });
    assert.equal(inv.updated, true);
    cur = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(cur.turnStartState, 'invoking');

    // 3. Started stage together with turnId atomically
    const start = await updateWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: claim.ownerId,
      turnId: 'turn-456',
      turnStartState: 'started',
    });
    assert.equal(start.updated, true);
    cur = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(cur.turnId, 'turn-456');
    assert.equal(cur.turnStartState, 'started');

    // Mismatched expectedOwnerId does nothing
    const mismatch = await updateWorkspaceWriterIfOwned({
      repoRoot: tempRepoRoot,
      expectedOwnerId: 'wrong-owner',
      turnId: 'turn-invalid',
    });
    assert.equal(mismatch.updated, false);
    assert.equal(mismatch.reason, 'not-current-owner');

    await releaseWorkspaceWriter({ repoRoot: tempRepoRoot, ownerId: claim.ownerId });
  });

  test('turnStartState is legal only for kind: agent (D99)', async () => {
    await assert.rejects(async () => {
      await acquireWorkspaceWriter({
        repoRoot: tempRepoRoot,
        kind: 'cli-manual',
        specId: 'spec-1',
        turnStartState: 'prepared',
      });
    }, /turnStartState is legal only for kind: 'agent'/);
  });

  test('Dead PID on request-backed claim triggers reconciliation and retries acquisition (D79, D92)', async () => {
    // Register a checker for 'publish' that reports settled completed
    registerRequestKindReconciler('publish', async ({ repoRoot, operationRef }) => {
      return { settled: true, terminalStatus: 'completed' };
    });

    // Create a workspace request
    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'publish',
      specId: 'spec-1',
      operationRef: 'op-1',
    });

    // Simulate an abandoned publish claim with dead PID
    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'dead-publish-owner',
      kind: 'publish',
      status: 'active',
      requestId: req.requestId,
      operationRef: 'op-1',
      specId: 'spec-1',
      pid: 99999999,
      createdAt: new Date().toISOString(),
    }, null, 2));

    // Agent attempts to acquire: should trigger Phase B reconciliation, release dead publish claim, and acquire slot!
    const acquireRes = await acquireWorkspaceWriter({
      repoRoot: tempRepoRoot,
      kind: 'agent',
      specId: 'spec-1',
      taskId: 'task-agent',
    });

    assert.equal(acquireRes.acquired, true);
    assert.notEqual(acquireRes.ownerId, 'dead-publish-owner');

    // Verify request transitioned to completed
    const updatedReq = loadWorkspaceRequest(tempRepoRoot, req.requestId);
    assert.equal(updatedReq.status, 'completed');

    await releaseWorkspaceWriter({ repoRoot: tempRepoRoot, ownerId: acquireRes.ownerId });
  });

  test('forceReleaseWorkspaceWriterUnsafe is not used in production orchestration code (D70)', () => {
    // Assert that forceReleaseWorkspaceWriterUnsafe is only called in this test file
    const toolsDir = path.resolve('tools/specs/workflow');
    const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.mjs'));
    for (const f of files) {
      if (f === 'workspace-writer.mjs') continue;
      const content = fs.readFileSync(path.join(toolsDir, f), 'utf8');
      assert.ok(
        !content.includes('forceReleaseWorkspaceWriterUnsafe'),
        `File ${f} must not import or call forceReleaseWorkspaceWriterUnsafe`
      );
    }
  });

  describe('cli-manual dead-pid takeover adopts three-outcome classification', () => {
    function initTestRepo(dir) {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n', 'utf8');

      const wfDir = path.join(dir, '.nevo-ai', 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      const realWfDir = path.resolve('.nevo-ai', 'workflows');
      if (fs.existsSync(realWfDir)) {
        for (const f of fs.readdirSync(realWfDir)) {
          if (f.endsWith('.yaml') || f.endsWith('.yml')) {
            fs.copyFileSync(path.join(realWfDir, f), path.join(wfDir, f));
          }
        }
      }

      const sDir = path.join(dir, 'specs', 'active', 'spec-cli');
      const tasksDir = path.join(sDir, 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-cli
title: CLI Spec
spec_id: 'c1100000-0000-0000-0000-000000000001'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: t1
    file: tasks/t1.md
    status: in-progress
    workflow_progress:
      current_step: implementation
      current_attempt: 1
      state: active
`, 'utf8');
      fs.writeFileSync(path.join(tasksDir, 't1.md'), `---
id: t1
status: in-progress
allowed_paths:
  - README.md
---
# Task 1
`, 'utf8');

      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
    }

    test('cli-manual dead-pid takeover releases cleanly when resumable (active attempt) and acquires claim', async () => {
      initTestRepo(tempRepoRoot);

      // Simulate an abandoned cli-manual claim with dead PID on active task t1
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'dead-cli-owner',
        kind: 'cli-manual',
        status: 'active',
        specId: 'c1100000-0000-0000-0000-000000000001',
        changeSlug: 'spec-cli',
        taskId: 't1',
        scope: { kind: 'task', taskId: 't1' },
        pid: 99999999, // dead PID
        createdAt: new Date().toISOString(),
      }, null, 2));

      // Call handleWorkflowStepStart
      const ctx = await handleWorkflowStepStart('spec-cli', 't1', {
        repoRoot: tempRepoRoot,
        activeDir: path.join(tempRepoRoot, 'specs', 'active'),
        silent: true,
      });
      assert.equal(ctx.currentStep, 'implementation');
      assert.equal(ctx.attempt, 1);

      // Verify claim was taken over by new live cli-manual owner
      const claim = getWorkspaceWriterClaim(tempRepoRoot);
      assert.ok(claim);
      assert.equal(claim.kind, 'cli-manual');
      assert.notEqual(claim.ownerId, 'dead-cli-owner');
      assert.equal(claim.pid, process.pid);
    });

    test('cli-manual dead-pid takeover marks recovery-required when ambiguous (in-flight start-operation)', async () => {
      initTestRepo(tempRepoRoot);

      // Simulate an abandoned cli-manual claim with dead PID
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'dead-cli-owner-ambiguous',
        kind: 'cli-manual',
        status: 'active',
        specId: 'c1100000-0000-0000-0000-000000000001',
        changeSlug: 'spec-cli',
        taskId: 't1',
        scope: { kind: 'task', taskId: 't1' },
        pid: 99999999, // dead PID
        createdAt: new Date().toISOString(),
      }, null, 2));

      // Persist an in-flight start-operation record (ambiguous / recovery-required)
      saveStartOperation(tempRepoRoot, {
        change: 'spec-cli',
        task: 't1',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        consumptionSequence: 1,
      });

      // Call handleWorkflowStepStart: should fail because claim is marked recovery-required
      await assert.rejects(async () => {
        await handleWorkflowStepStart('spec-cli', 't1', {
          repoRoot: tempRepoRoot,
          activeDir: path.join(tempRepoRoot, 'specs', 'active'),
          silent: true,
        });
      }, /Workspace writer is blocked by recovery/);

      // Verify claim status is recovery-required
      const claim = getWorkspaceWriterClaim(tempRepoRoot);
      assert.ok(claim);
      assert.equal(claim.status, 'recovery-required');
      assert.equal(claim.ownerId, 'dead-cli-owner-ambiguous');
    });
  });
});
