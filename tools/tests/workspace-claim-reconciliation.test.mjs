// Tests for generic request-backed workspace claim reconciliation (D79, D88, D92, D95).
// Run: node --test tools/tests/workspace-claim-reconciliation.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  registerRequestKindReconciler,
  reconcileRequestBackedWorkspaceClaim,
} from '../specs/workflow/workspace-claim-reconciliation.mjs';
import {
  createWorkspaceRequest,
  loadWorkspaceRequest,
  transitionWorkspaceRequest,
} from '../specs/workflow/workspace-request.mjs';
import {
  acquireWorkspaceWriter,
  getWorkspaceWriterClaim,
  releaseWorkspaceWriterIfOwned,
} from '../specs/workflow/workspace-writer.mjs';
import { execFileSync } from 'node:child_process';
import { reconcileBootState } from '../dashboard/server/ai/orchestration/reconciliation.mjs';
import { saveStartOperation } from '../specs/workflow/start-operation.mjs';
import { saveOperationRecord, loadOperationRecord } from '../specs/workflow/operation-record.mjs';

describe('workspace-claim-reconciliation (D79, D88, D95)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-claim-recon-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('reconcileRequestBackedWorkspaceClaim resolves terminalStatus: completed (D95)', async () => {
    registerRequestKindReconciler('human-submit', async ({ repoRoot, operationRef }) => {
      assert.equal(operationRef.op, 'test-human-op');
      return { settled: true, terminalStatus: 'completed' };
    });

    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'human-submit',
      specId: 'spec-1',
      operationRef: { op: 'test-human-op' },
    });

    // Write a mock live claim
    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'owner-hs-1',
      kind: 'human-submit',
      status: 'active',
      requestId: req.requestId,
      operationRef: { op: 'test-human-op' },
      specId: 'spec-1',
      pid: 99999999,
      createdAt: new Date().toISOString(),
    }, null, 2));

    const claimSnapshot = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    const result = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tempRepoRoot,
      claimSnapshot,
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.outcome, 'completed');

    // Request is now completed
    const updatedReq = loadWorkspaceRequest(tempRepoRoot, req.requestId);
    assert.equal(updatedReq.status, 'completed');

    // Workspace writer claim is released
    assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);
  });

  test('reconcileRequestBackedWorkspaceClaim resolves terminalStatus: failed (D95)', async () => {
    registerRequestKindReconciler('publish', async ({ repoRoot, operationRef }) => {
      return { settled: true, terminalStatus: 'failed' };
    });

    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'publish',
      specId: 'spec-1',
      operationRef: { op: 'test-publish-failed' },
    });

    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'owner-pub-failed',
      kind: 'publish',
      status: 'active',
      requestId: req.requestId,
      operationRef: { op: 'test-publish-failed' },
      specId: 'spec-1',
      pid: 99999999,
      createdAt: new Date().toISOString(),
    }, null, 2));

    const claimSnapshot = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    const result = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tempRepoRoot,
      claimSnapshot,
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.outcome, 'failed');

    const updatedReq = loadWorkspaceRequest(tempRepoRoot, req.requestId);
    assert.equal(updatedReq.status, 'failed');

    // Claim is released
    assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);
  });

  test('reconcileRequestBackedWorkspaceClaim with settled: false transitions request to reconciliation-required and marks claim recovery-required (D95)', async () => {
    registerRequestKindReconciler('batch-publish', async ({ repoRoot, operationRef }) => {
      return { settled: false, reason: 'unsettled-stage-in-progress' };
    });

    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'batch-publish',
      specId: 'spec-1',
      operationRef: { op: 'test-batch-unsettled' },
    });

    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'owner-batch-unsettled',
      kind: 'batch-publish',
      status: 'active',
      requestId: req.requestId,
      operationRef: { op: 'test-batch-unsettled' },
      specId: 'spec-1',
      pid: 99999999,
      createdAt: new Date().toISOString(),
    }, null, 2));

    const claimSnapshot = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    const result = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tempRepoRoot,
      claimSnapshot,
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.outcome, 'reconciliation-required');

    const updatedReq = loadWorkspaceRequest(tempRepoRoot, req.requestId);
    assert.equal(updatedReq.status, 'reconciliation-required');

    const liveClaim = getWorkspaceWriterClaim(tempRepoRoot);
    assert.equal(liveClaim.status, 'recovery-required');
  });

  test('Unregistered kind fails closed without releasing claim (D88)', async () => {
    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'human-submit',
      specId: 'spec-1',
    });

    const claimSnapshot = {
      ownerId: 'owner-unknown',
      kind: 'unregistered-future-kind',
      status: 'active',
      requestId: req.requestId,
      specId: 'spec-1',
    };

    const result = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tempRepoRoot,
      claimSnapshot,
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'unregistered-kind');
  });

  test('Missing or unresolvable requestId fails closed (D79)', async () => {
    const claimSnapshot = {
      ownerId: 'owner-ghost',
      kind: 'publish',
      status: 'active',
      requestId: 'non-existent-request-id',
      specId: 'spec-1',
    };

    const result = await reconcileRequestBackedWorkspaceClaim({
      repoRoot: tempRepoRoot,
      claimSnapshot,
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'request-not-found');
  });

  describe('Hook 3 boot-time reconciliation (D99, D100)', () => {
    function initBootRepo(dir) {
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

      const sDir = path.join(dir, 'specs', 'active', 'spec-boot');
      const tasksDir = path.join(sDir, 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(sDir, 'change.yaml'), `schema_version: '1.0'
id: spec-boot
title: Boot Spec
spec_id: 'b0070000-0000-0000-0000-000000000001'
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

    test('Hook 3: prepared claim with clean state releases claim cleanly (D99)', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-prep',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-prep',
        turnStartState: 'prepared',
        createdAt: new Date().toISOString(),
      }, null, 2));

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);
    });

    test('Hook 3: invoking claim fails closed to recovery-required bypassing settlement (D99)', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-inv',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-inv',
        turnStartState: 'invoking',
        createdAt: new Date().toISOString(),
      }, null, 2));

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      const claim = getWorkspaceWriterClaim(tempRepoRoot);
      assert.ok(claim);
      assert.equal(claim.status, 'recovery-required');
    });

    test('Hook 3: started claim with active task produces resumable and releases claim (D99)', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-started-active',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-started-active',
        turnId: 'turn-started-1',
        turnStartState: 'started',
        createdAt: new Date().toISOString(),
      }, null, 2));

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);
    });

    test('Hook 3: started claim with in-flight start-operation marks recovery-required', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-started-sop',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-started-sop',
        turnId: 'turn-started-2',
        turnStartState: 'started',
        createdAt: new Date().toISOString(),
      }, null, 2));

      saveStartOperation(tempRepoRoot, {
        change: 'spec-boot',
        task: 't1',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        consumptionSequence: 1,
      });

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      const claim = getWorkspaceWriterClaim(tempRepoRoot);
      assert.ok(claim);
      assert.equal(claim.status, 'recovery-required');
    });

    test('Hook 3: started claim with in-flight replayable finish-operation produces resumable and releases claim', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-started-rep',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-started-rep',
        turnId: 'turn-started-3',
        turnStartState: 'started',
        createdAt: new Date().toISOString(),
      }, null, 2));

      saveOperationRecord(tempRepoRoot, {
        operationId: 'op-boot-rep',
        change: 'spec-boot',
        task: 't1',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        operations: [
          { id: 'verify-gates', status: 'pending' },
          { id: 'update-task', status: 'pending' },
        ],
      });

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      assert.equal(getWorkspaceWriterClaim(tempRepoRoot), null);

      const op = loadOperationRecord(tempRepoRoot, 'spec-boot', 't1', 'implementation', 1);
      assert.ok(op);
      assert.equal(op.operationId, 'op-boot-rep');
    });

    test('Hook 3: started claim with in-flight non-replayable finish-operation marks recovery-required', async () => {
      initBootRepo(tempRepoRoot);
      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'workspace-writer.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        ownerId: 'owner-boot-started-nonrep',
        kind: 'agent',
        status: 'active',
        specId: 'spec-boot',
        taskId: 't1',
        sessionId: 'sess-started-nonrep',
        turnId: 'turn-started-4',
        turnStartState: 'started',
        createdAt: new Date().toISOString(),
      }, null, 2));

      saveOperationRecord(tempRepoRoot, {
        operationId: 'op-boot-nonrep',
        change: 'spec-boot',
        task: 't1',
        step: 'implementation',
        attempt: 1,
        status: 'running',
        operations: [
          { id: 'verify-gates', status: 'completed' },
          { id: 'update-task', status: 'failed' },
        ],
      });

      const res = await reconcileBootState({ repoRoot: tempRepoRoot });
      assert.equal(res.reconciledClaims, 1);
      const claim = getWorkspaceWriterClaim(tempRepoRoot);
      assert.ok(claim);
      assert.equal(claim.status, 'recovery-required');
    });
  });
});
