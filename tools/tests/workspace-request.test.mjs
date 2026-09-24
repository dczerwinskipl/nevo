// Tests for durable workspace-request queue and CAS transitions (D72, D74, D75, D77, D78, D81, D82, D83).
// Run: node --test tools/tests/workspace-request.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorkspaceRequest,
  loadWorkspaceRequest,
  listWorkspaceRequests,
  transitionWorkspaceRequest,
} from '../specs/workflow/workspace-request.mjs';

describe('workspace-request queue and CAS transitions', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-workspace-request-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('Workspace-request is persisted status: queued with atomically allocated requestSequence (D72, D81)', async () => {
    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'human-submit',
      specId: 'spec-1',
      taskId: 'task-1',
      operationRef: { opId: 'op-123' },
    });

    assert.ok(req.requestId);
    assert.equal(req.status, 'queued');
    assert.equal(req.requestSequence, 1);

    const loaded = loadWorkspaceRequest(tempRepoRoot, req.requestId);
    assert.deepEqual(loaded, req);
  });

  test('requestSequence allocation is atomic and non-colliding across concurrent creations (D81)', async () => {
    const creations = await Promise.all([
      createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'publish', specId: 'spec-a' }),
      createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'human-submit', specId: 'spec-b' }),
      createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'batch-publish', specId: 'spec-c' }),
      createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'publish', specId: 'spec-d' }),
    ]);

    const sequences = creations.map(c => c.requestSequence);
    assert.equal(sequences.length, 4);
    // Sequences must be 1, 2, 3, 4 without collision
    assert.deepEqual(sequences.sort((a, b) => a - b), [1, 2, 3, 4]);
  });

  test('Crash retry with same requestId reuses the allocated requestSequence verbatim (D81)', async () => {
    const req1 = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      requestId: 'fixed-req-id',
      kind: 'publish',
      specId: 'spec-1',
    });
    assert.equal(req1.requestSequence, 1);

    // Later request gets sequence 2
    const req2 = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'publish',
      specId: 'spec-2',
    });
    assert.equal(req2.requestSequence, 2);

    // Retrying with fixed-req-id reuses original sequence 1, not allocating 3
    const retried = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      requestId: 'fixed-req-id',
      kind: 'publish',
      specId: 'spec-1',
    });
    assert.equal(retried.requestSequence, 1);
  });

  test('CAS transition prevents double execution across concurrent processors (D83)', async () => {
    const req = await createWorkspaceRequest({
      repoRoot: tempRepoRoot,
      kind: 'human-submit',
      specId: 'spec-1',
    });

    // Processor 1 and Processor 2 attempt CAS to 'running' concurrently
    const [p1, p2] = await Promise.all([
      transitionWorkspaceRequest({
        repoRoot: tempRepoRoot,
        requestId: req.requestId,
        expectedStatus: ['queued', 'waiting-for-workspace'],
        to: 'running',
        workspaceOwnerId: 'owner-1',
      }),
      transitionWorkspaceRequest({
        repoRoot: tempRepoRoot,
        requestId: req.requestId,
        expectedStatus: ['queued', 'waiting-for-workspace'],
        to: 'running',
        workspaceOwnerId: 'owner-2',
      }),
    ]);

    const winner = p1.transitioned ? p1 : p2;
    const loser = p1.transitioned ? p2 : p1;

    assert.equal(winner.transitioned, true);
    assert.equal(loser.transitioned, false);
    assert.equal(loser.reason, 'state-conflict');
    assert.equal(loser.currentStatus, 'running');
  });

  test('listWorkspaceRequests returns requests for the entire physical worktree across multiple specs (D74)', async () => {
    await createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'publish', specId: 'spec-alpha' });
    await createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'human-submit', specId: 'spec-beta' });
    await createWorkspaceRequest({ repoRoot: tempRepoRoot, kind: 'batch-publish', specId: 'spec-gamma' });

    const all = listWorkspaceRequests({ repoRoot: tempRepoRoot });
    assert.equal(all.length, 3);
    const specIds = all.map(r => r.specId);
    assert.ok(specIds.includes('spec-alpha'));
    assert.ok(specIds.includes('spec-beta'));
    assert.ok(specIds.includes('spec-gamma'));
  });
});
