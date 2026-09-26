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
});
