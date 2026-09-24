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
});
