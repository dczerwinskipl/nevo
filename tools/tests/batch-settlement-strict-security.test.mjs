// Strict fail-closed settlement security integration tests (Item 13).
// Verifies executeBatchCompletionSettlement fails closed (status: 'recovery-required')
// and does NOT release claim or dispatch continuations when the live workspace claim
// has malformed or ambiguous identity.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { createGroupReservation, getGroupReservation } from '../specs/workflow/queue/reservation.mjs';
import {
  acquireWorkspaceWriter,
  getWorkspaceWriterClaim,
} from '../specs/workflow/workspace-writer.mjs';
import {
  createBatchFinishRecord,
  saveBatchFinishRecord,
} from '../specs/workflow/batch-finish/record.mjs';
import {
  executeBatchCompletionSettlement,
  loadBatchCompletionSettlement,
  matchesBatchClaimExact,
  isAmbiguousBatchClaim,
} from '../dashboard/server/ai/orchestration/batch-completion-settlement.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function setupTestRepo(slug, taskIds = ['t1', 't2']) {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), `nevo-settlement-sec-${slug}-`));
  execFileSync('git', ['init', '-q'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRoot });

  const activeDir = path.join(tmpRoot, 'specs', 'active');
  const changeDir = path.join(activeDir, slug);
  const taskDir = path.join(changeDir, 'tasks');
  const workflowDir = path.join(tmpRoot, '.nevo-ai', 'workflows');

  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard.yaml')
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, '.nevo-ai', 'workflows', 'standard.yaml'),
    path.join(workflowDir, 'standard-v1.yaml')
  );

  const specId = randomUUID();
  const taskYamlLines = taskIds.map(id => `  - id: ${id}\n    title: Task ${id}\n    type: core`).join('\n');
  const changeYaml = `id: ${slug}
spec_id: "${specId}"
title: Test change for strict settlement
workflow:
  mode: deterministic
  version: 1
  definition: standard-v1
tasks:
${taskYamlLines}
`;
  fs.writeFileSync(path.join(changeDir, 'change.yaml'), changeYaml, 'utf8');

  for (const tid of taskIds) {
    fs.writeFileSync(
      path.join(taskDir, `${tid}.md`),
      `---\nid: ${tid}\nstatus: in-review\nstep: review\n---\n# Task ${tid}\n`,
      'utf8'
    );
  }

  execFileSync('git', ['add', '.'], { cwd: tmpRoot });
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: tmpRoot });

  return { tmpRoot, activeDir, specId };
}

async function prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds }) {
  // 1. Group reservation
  await createGroupReservation({
    repoRoot: tmpRoot,
    changeSlug: slug,
    batchExecutionId,
    taskIds,
    step: 'review',
    executionConfigSnapshot: { provider: 'mock', model: 'mock-model' },
  });

  // 2. Persisted session
  const sessionsDir = path.join(tmpRoot, '.nevo-ai-local', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `${specId}.json`),
    JSON.stringify({
      sessions: [{
        sessionId,
        batchExecutionId,
        executionScope: { kind: 'task-batch', changeSlug: slug, taskIds },
      }],
      bindings: [],
    }, null, 2),
    'utf8'
  );

  // 3. Persisted completed batch-finish record
  const finishRecord = createBatchFinishRecord({
    repoRoot: tmpRoot,
    batchExecutionId,
    changeSlug: slug,
    taskIds,
    sessionId,
    results: {
      t1: { result: 'pass' },
      t2: { result: 'pass' },
    },
    canonicalReportPath: `specs/active/${slug}/reviews/review-batch-${batchExecutionId}.md`,
  });
  finishRecord.status = 'completed';
  finishRecord.stages.reportCommit = { status: 'completed', commitSha: 'abc1234' };
  finishRecord.stages.memberFinishes = {
    t1: { status: 'completed', outcome: 'pass' },
    t2: { status: 'completed', outcome: 'pass' },
  };
  saveBatchFinishRecord(tmpRoot, slug, finishRecord);
}

test('Strict Settlement Security: Unit predicates for batch claim matching', () => {
  const expected = {
    batchExecutionId: 'batch-1',
    sessionId: 'sess-1',
    specId: 'spec-uuid',
    changeSlug: 'my-change',
    taskIds: ['t1', 't2'],
  };

  const perfectClaim = {
    kind: 'agent',
    scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
    batchExecutionId: 'batch-1',
    sessionId: 'sess-1',
    specId: 'spec-uuid',
    changeSlug: 'my-change',
  };

  assert.equal(matchesBatchClaimExact(perfectClaim, expected), true);
  assert.equal(isAmbiguousBatchClaim(perfectClaim, expected), false);

  // Missing batchExecutionId
  const missingBatchId = { ...perfectClaim, batchExecutionId: undefined };
  assert.equal(matchesBatchClaimExact(missingBatchId, expected), false);
  assert.equal(isAmbiguousBatchClaim(missingBatchId, expected), true);

  // Wrong batchExecutionId
  const wrongBatchId = { ...perfectClaim, batchExecutionId: 'batch-OTHER' };
  assert.equal(matchesBatchClaimExact(wrongBatchId, expected), false);
  assert.equal(isAmbiguousBatchClaim(wrongBatchId, expected), true);

  // Missing sessionId
  const missingSession = { ...perfectClaim, sessionId: undefined };
  assert.equal(matchesBatchClaimExact(missingSession, expected), false);
  assert.equal(isAmbiguousBatchClaim(missingSession, expected), true);

  // Wrong sessionId
  const wrongSession = { ...perfectClaim, sessionId: 'sess-OTHER' };
  assert.equal(matchesBatchClaimExact(wrongSession, expected), false);
  assert.equal(isAmbiguousBatchClaim(wrongSession, expected), true);

  // Partial task overlap: subset
  const subsetClaim = { ...perfectClaim, scope: { kind: 'task-batch', taskIds: ['t1'] } };
  assert.equal(matchesBatchClaimExact(subsetClaim, expected), false);
  assert.equal(isAmbiguousBatchClaim(subsetClaim, expected), true);

  // Partial task overlap: superset
  const supersetClaim = { ...perfectClaim, scope: { kind: 'task-batch', taskIds: ['t1', 't2', 't3'] } };
  assert.equal(matchesBatchClaimExact(supersetClaim, expected), false);
  assert.equal(isAmbiguousBatchClaim(supersetClaim, expected), true);

  // Wrong specId
  const wrongSpecId = { ...perfectClaim, specId: 'different-uuid' };
  assert.equal(matchesBatchClaimExact(wrongSpecId, expected), false);
  assert.equal(isAmbiguousBatchClaim(wrongSpecId, expected), true);
});

test('Strict Settlement Security: Missing batchExecutionId on live claim fails closed to recovery-required', async () => {
  const slug = 'sec-missing-batch-id';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-sec-01';
    const sessionId = 'sess-sec-01';
    const taskIds = ['t1', 't2'];

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire claim missing batchExecutionId
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      // batchExecutionId omitted intentionally
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'recovery-required', 'Settlement must fail closed to recovery-required');
    assert.equal(result.settlement.stages.claimRelease.status, 'recovery-required');

    // Claim must NOT be released
    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim, 'Live claim must NOT be released when identity is ambiguous');
    assert.equal(liveClaim.sessionId, sessionId);

    // Reservation must NOT be released
    const reservation = getGroupReservation(tmpRoot, slug, batchExecutionId);
    assert.equal(reservation.status, 'reserved', 'Reservation must remain intact');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Strict Settlement Security: Wrong batchExecutionId on live claim fails closed to recovery-required', async () => {
  const slug = 'sec-wrong-batch-id';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-sec-02';
    const sessionId = 'sess-sec-02';
    const taskIds = ['t1', 't2'];

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire claim with wrong batchExecutionId
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId: 'batch-exec-WRONG',
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'recovery-required');
    assert.equal(result.settlement.stages.claimRelease.status, 'recovery-required');

    // Claim must NOT be released
    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim);
    assert.equal(liveClaim.batchExecutionId, 'batch-exec-WRONG');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Strict Settlement Security: Missing or wrong sessionId on live claim fails closed', async () => {
  const slug = 'sec-wrong-session-id';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-sec-03';
    const sessionId = 'sess-sec-03';
    const taskIds = ['t1', 't2'];

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire claim with wrong sessionId
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId: 'sess-WRONG',
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'recovery-required');
    assert.equal(result.settlement.stages.claimRelease.status, 'recovery-required');

    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim);
    assert.equal(liveClaim.sessionId, 'sess-WRONG');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Strict Settlement Security: Partial task overlap on live claim fails closed', async () => {
  const slug = 'sec-task-overlap';
  const taskIds = ['t1', 't2', 't3'];
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug, taskIds);
  try {
    const batchExecutionId = 'batch-sec-04';
    const sessionId = 'sess-sec-04';

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire claim with partial subset ['t1', 't2'] instead of all 3 tasks
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds: ['t1', 't2'] },
      batchExecutionId,
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'recovery-required');
    assert.equal(result.settlement.stages.claimRelease.status, 'recovery-required');

    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim);
    assert.deepEqual(liveClaim.scope.taskIds, ['t1', 't2']);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Strict Settlement Security: Wrong specId on live claim fails closed', async () => {
  const slug = 'sec-wrong-spec-id';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-sec-05';
    const sessionId = 'sess-sec-05';
    const taskIds = ['t1', 't2'];

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire claim with different specId
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId: randomUUID(),
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'recovery-required');
    assert.equal(result.settlement.stages.claimRelease.status, 'recovery-required');

    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    assert.ok(liveClaim);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Strict Settlement Security: Exact match succeeds cleanly and releases claim', async () => {
  const slug = 'sec-exact-match-success';
  const { tmpRoot, activeDir, specId } = setupTestRepo(slug);
  try {
    const batchExecutionId = 'batch-sec-06';
    const sessionId = 'sess-sec-06';
    const taskIds = ['t1', 't2'];

    await prepareCompletedBatchFinish({ tmpRoot, slug, specId, batchExecutionId, sessionId, taskIds });

    // Acquire exact matching claim
    await acquireWorkspaceWriter({
      repoRoot: tmpRoot,
      kind: 'agent',
      specId,
      sessionId,
      turnId: 'turn-1',
      scope: { kind: 'task-batch', taskIds },
      batchExecutionId,
      changeSlug: slug,
    });

    const result = await executeBatchCompletionSettlement({
      repoRoot: tmpRoot,
      activeDir,
      changeSlug: slug,
      batchExecutionId,
    });

    assert.equal(result.status, 'completed', 'Settlement must complete successfully on exact match');
    assert.equal(result.settlement.stages.claimRelease.status, 'completed');
    assert.equal(result.settlement.stages.activeExecutionClear.status, 'completed');
    assert.equal(result.settlement.stages.reservationRelease.status, 'completed');
    assert.equal(result.settlement.stages.continuationDispatch.status, 'completed');

    // Batch claim must be released
    const liveClaim = getWorkspaceWriterClaim(tmpRoot);
    if (liveClaim) {
      assert.notEqual(liveClaim.batchExecutionId, batchExecutionId);
      assert.notEqual(liveClaim.scope?.kind, 'task-batch');
    }

    // Reservation must be released
    const reservation = getGroupReservation(tmpRoot, slug, batchExecutionId);
    assert.equal(reservation.status, 'released');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
