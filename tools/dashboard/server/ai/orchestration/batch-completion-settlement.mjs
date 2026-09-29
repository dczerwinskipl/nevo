// Durable staged batch completion settlement saga (Task 06, D16, D17, D19, D31, D35, D40).
// Owns the dashboard-orchestration terminal sequence:
// 1. claim-release (strictly before dispatch)
// 2. active-execution-clear
// 3. reservation/barrier release
// 4. per-member continuation dispatch (refiners get parentSessionId = batch session id)
// 5. completed

import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from '../../../../specs/workflow/errors.mjs';
import {
  getWorkspaceWriterClaim,
  releaseWorkspaceWriterIfOwned,
} from '../../../../specs/workflow/workspace-writer.mjs';
import {
  getGroupReservation,
  releaseGroupReservation,
} from '../../../../specs/workflow/queue/reservation.mjs';
import { loadBatchFinishRecord } from '../../../../specs/workflow/batch-finish/record.mjs';
import { getActiveAgentExecution, clearActiveAgentExecution } from './admission.mjs';
import { reconcileContinuation } from './reconciliation.mjs';
import { requireChange, requireTask, ACTIVE_DIR } from '../../../../specs/store.mjs';

export function getBatchCompletionSettlementDir(repoRoot, changeSlug) {
  return path.join(repoRoot, '.nevo-ai-local', 'batch-completion', changeSlug);
}

export function getBatchCompletionSettlementPath(repoRoot, changeSlug, batchExecutionId) {
  return path.join(getBatchCompletionSettlementDir(repoRoot, changeSlug), `${batchExecutionId}.json`);
}

/**
 * Loads a batch completion settlement record from disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @returns {object|null}
 */
export function loadBatchCompletionSettlement(repoRoot, changeSlug, batchExecutionId) {
  if (!repoRoot || !changeSlug || !batchExecutionId) return null;
  const filePath = getBatchCompletionSettlementPath(repoRoot, changeSlug, batchExecutionId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new WorkflowError(`Failed to load batch completion settlement at ${filePath}: ${err.message}`, {
      code: 'BATCH_COMPLETION_SETTLEMENT_LOAD_FAILED',
      cause: err,
    });
  }
}

/**
 * Atomically saves a batch completion settlement record to disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {object} record
 * @returns {object}
 */
export function saveBatchCompletionSettlement(repoRoot, changeSlug, record) {
  if (!repoRoot || !changeSlug || !record?.batchExecutionId) {
    throw new WorkflowError('saveBatchCompletionSettlement requires repoRoot, changeSlug, and record.batchExecutionId');
  }

  const dir = getBatchCompletionSettlementDir(repoRoot, changeSlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const targetPath = getBatchCompletionSettlementPath(repoRoot, changeSlug, record.batchExecutionId);
  const tempPath = path.join(dir, `${record.batchExecutionId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

  const updatedRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(tempPath, JSON.stringify(updatedRecord, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EBUSY') {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.renameSync(tempPath, targetPath);
      } catch (retryErr) {
        try { fs.unlinkSync(tempPath); } catch {}
        throw retryErr;
      }
    } else {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  return updatedRecord;
}

/**
 * Creates and persists an initial batch completion settlement record.
 *
 * @param {object} params
 * @returns {object}
 */
export function createBatchCompletionSettlement(params = {}) {
  const {
    repoRoot,
    changeSlug,
    batchExecutionId,
    sessionId = null,
    taskIds = [],
  } = params;

  if (!repoRoot || !changeSlug || !batchExecutionId) {
    throw new WorkflowError('createBatchCompletionSettlement requires repoRoot, changeSlug, and batchExecutionId');
  }

  const existing = loadBatchCompletionSettlement(repoRoot, changeSlug, batchExecutionId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const record = {
    batchExecutionId,
    changeSlug,
    sessionId,
    taskIds: [...taskIds],
    status: 'pending',
    stages: {
      claimRelease: { status: 'pending' },
      activeExecutionClear: { status: 'pending' },
      reservationRelease: { status: 'pending' },
      continuationDispatch: { status: 'pending', members: {} },
    },
    createdAt: now,
    updatedAt: now,
  };

  return saveBatchCompletionSettlement(repoRoot, changeSlug, record);
}

/**
 * Determines whether a batch execution has reached a settleable terminal state,
 * by inspecting the authoritative durable batch-finish record (D35).
 *
 * This is the single source of truth for Hook 1 (terminal subscription) and
 * Hook 3 (boot reconciliation). Neither hook should trust a caller-supplied boolean.
 *
 * Settlement is true when and only when the durable batch-finish record has status 'completed'.
 * Failed/cancelled provider turns that never completed batch-finish remain unsettled.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @returns {{ settled: boolean, reason?: string, finishRecord?: object }}
 */
export function assessBatchExecutionSettlement({ repoRoot, changeSlug, batchExecutionId }) {
  if (!repoRoot || !changeSlug || !batchExecutionId) {
    return { settled: false, reason: 'missing-parameters' };
  }

  const finishRecord = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (!finishRecord) {
    return { settled: false, reason: 'batch-finish-not-found' };
  }

  if (finishRecord.status !== 'completed') {
    return {
      settled: false,
      reason: 'batch-finish-not-completed',
      finishRecord,
    };
  }

  // Check if settlement saga has already fully completed (idempotent re-entry)
  const existingSettlement = loadBatchCompletionSettlement(repoRoot, changeSlug, batchExecutionId);
  if (existingSettlement?.status === 'completed') {
    return { settled: true, reason: 'already-settled', finishRecord, existingSettlement };
  }

  return { settled: true, finishRecord };
}

/**
 * Executes the D35/D40 terminal settlement saga for a completed batch execution.
 *
 * Ordered stages:
 * 1. claim-release (strictly before dispatch)
 * 2. active-execution-clear
 * 3. reservation-release
 * 4. continuation-dispatch (per member)
 * 5. completed
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string} [params.sessionId]
 * @param {string} [params.ownerId]
 * @param {string} [params.activeDir]
 * @param {object} [params.options]
 * @param {boolean} [params._crashAfterClaimRelease=false] Test hook
 * @param {boolean} [params._crashAfterActiveExecutionClear=false] Test hook
 * @param {boolean} [params._crashAfterReservationRelease=false] Test hook
 * @param {string|null} [params._crashAfterMemberDispatchTaskId=null] Test hook
 * @returns {Promise<{ settled: boolean, status: string, settlement: object }>}
 */
export async function executeBatchCompletionSettlement(params = {}) {
  const {
    repoRoot,
    changeSlug,
    batchExecutionId,
    sessionId: explicitSessionId,
    ownerId,
    activeDir = ACTIVE_DIR,
    options = {},
    _crashAfterClaimRelease = false,
    _crashAfterActiveExecutionClear = false,
    _crashAfterReservationRelease = false,
    _crashAfterMemberDispatchTaskId = null,
  } = params;

  if (!repoRoot || !changeSlug || !batchExecutionId) {
    throw new WorkflowError('executeBatchCompletionSettlement requires repoRoot, changeSlug, and batchExecutionId');
  }

  // 1. Verify batch-finish operation has durably reached 'completed' (D35)
  const finishRecord = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (!finishRecord || finishRecord.status !== 'completed') {
    return {
      settled: false,
      status: 'pending',
      reason: 'BATCH_FINISH_NOT_COMPLETED',
    };
  }

  const effectiveSessionId = explicitSessionId || finishRecord.sessionId || null;
  const taskIds = finishRecord.taskIds || [];

  // 2. Load or create durable settlement record
  let settlement = loadBatchCompletionSettlement(repoRoot, changeSlug, batchExecutionId);
  if (!settlement) {
    settlement = createBatchCompletionSettlement({
      repoRoot,
      changeSlug,
      batchExecutionId,
      sessionId: effectiveSessionId,
      taskIds,
    });
  }

  if (settlement.status === 'completed') {
    return {
      settled: true,
      status: 'completed',
      settlement,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 1: Workspace-writer claim release (D35 Step 1, D40)
  // -------------------------------------------------------------------------
  if (settlement.stages.claimRelease.status !== 'completed') {
    const liveClaim = getWorkspaceWriterClaim(repoRoot);

    if (!liveClaim) {
      // Authoritatively satisfied: claim is already gone
      settlement.stages.claimRelease = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    } else {
      // Check if claim belongs to this batch
      const isBatchClaim = liveClaim.scope?.kind === 'task-batch' &&
        (!liveClaim.batchExecutionId || liveClaim.batchExecutionId === batchExecutionId) &&
        (!effectiveSessionId || !liveClaim.sessionId || liveClaim.sessionId === effectiveSessionId) &&
        Array.isArray(liveClaim.scope?.taskIds) &&
        liveClaim.scope.taskIds.some(t => taskIds.includes(t));

      if (isBatchClaim) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId || liveClaim.ownerId,
          expectedKind: 'agent',
          expectedScope: liveClaim.scope,
          ...(liveClaim.sessionId ? { expectedSessionId: liveClaim.sessionId } : {}),
          ...(liveClaim.turnId ? { expectedTurnId: liveClaim.turnId } : {}),
        });

        const afterClaim = getWorkspaceWriterClaim(repoRoot);
        const stillHeld = afterClaim &&
          afterClaim.scope?.kind === 'task-batch' &&
          (!effectiveSessionId || !afterClaim.sessionId || afterClaim.sessionId === effectiveSessionId) &&
          Array.isArray(afterClaim.scope?.taskIds) &&
          afterClaim.scope.taskIds.some(t => taskIds.includes(t));

        if (!stillHeld) {
          settlement.stages.claimRelease = {
            status: 'completed',
            completedAt: new Date().toISOString(),
          };
          saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
        }
      } else {
        // If a different claim occupies the workspace (e.g. from an independent operation),
        // we never clear it as if it belonged to this batch (D40)
        settlement.stages.claimRelease = {
          status: 'completed',
          completedAt: new Date().toISOString(),
          note: 'different-claim-observed',
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      }
    }

    if (_crashAfterClaimRelease) {
      throw new Error('[test-hook] Simulated crash after claim release');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 2: Clear active execution (D35 Step 2, D40)
  // -------------------------------------------------------------------------
  if (settlement.stages.activeExecutionClear.status !== 'completed') {
    const active = getActiveAgentExecution(changeSlug);

    if (!active) {
      // Authoritatively satisfied: already absent
      settlement.stages.activeExecutionClear = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    } else {
      const isThisBatchActive = (active.ownerId && active.ownerId === ownerId) ||
        (active.sessionId && active.sessionId === effectiveSessionId) ||
        (active.candidate?.batchExecutionId && active.candidate.batchExecutionId === batchExecutionId);

      if (isThisBatchActive) {
        clearActiveAgentExecution(changeSlug);
      }
      settlement.stages.activeExecutionClear = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    }

    if (_crashAfterActiveExecutionClear) {
      throw new Error('[test-hook] Simulated crash after active execution clear');
    }
  }

  // -------------------------------------------------------------------------
  // Stage 3: Atomic reservation / barrier release (D35 Step 3, D40)
  // -------------------------------------------------------------------------
  if (settlement.stages.reservationRelease.status !== 'completed') {
    const reservation = getGroupReservation(repoRoot, changeSlug, batchExecutionId);

    if (!reservation || reservation.status === 'released') {
      // Authoritatively satisfied: already released
      settlement.stages.reservationRelease = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    } else {
      await releaseGroupReservation({
        repoRoot,
        changeSlug,
        batchExecutionId,
      });

      const updatedRes = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
      if (!updatedRes || updatedRes.status === 'released') {
        settlement.stages.reservationRelease = {
          status: 'completed',
          completedAt: new Date().toISOString(),
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      }
    }

    if (_crashAfterReservationRelease) {
      throw new Error('[test-hook] Simulated crash after reservation release');
    }
  }

  // -------------------------------------------------------------------------
  // Structural Dispatch Safety Guard (D35, D40)
  // Dispatch is illegal until stages 1–3 are authoritatively satisfied.
  // -------------------------------------------------------------------------
  const liveClaimBeforeDispatch = getWorkspaceWriterClaim(repoRoot);
  if (
    liveClaimBeforeDispatch &&
    liveClaimBeforeDispatch.scope?.kind === 'task-batch' &&
    (!liveClaimBeforeDispatch.batchExecutionId || liveClaimBeforeDispatch.batchExecutionId === batchExecutionId) &&
    (!effectiveSessionId || !liveClaimBeforeDispatch.sessionId || liveClaimBeforeDispatch.sessionId === effectiveSessionId) &&
    Array.isArray(liveClaimBeforeDispatch.scope?.taskIds) &&
    liveClaimBeforeDispatch.scope.taskIds.some(t => taskIds.includes(t))
  ) {
    throw new WorkflowError(
      'Dispatch illegal: batch workspace-writer claim is still held',
      { code: 'DISPATCH_BEFORE_CLAIM_RELEASE', batchExecutionId }
    );
  }

  const liveReservationBeforeDispatch = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
  if (liveReservationBeforeDispatch && liveReservationBeforeDispatch.status === 'reserved') {
    throw new WorkflowError(
      'Dispatch illegal: batch action barrier/reservation is still active',
      { code: 'DISPATCH_BEFORE_RESERVATION_RELEASE', batchExecutionId }
    );
  }

  // -------------------------------------------------------------------------
  // Stage 4: Per-member continuation dispatch (D35 Step 4, D40)
  // -------------------------------------------------------------------------
  if (settlement.stages.continuationDispatch.status !== 'completed') {
    if (!settlement.stages.continuationDispatch.members) {
      settlement.stages.continuationDispatch.members = {};
    }

    for (const taskId of taskIds) {
      if (settlement.stages.continuationDispatch.members[taskId]?.status === 'completed') {
        continue; // Skip already dispatched member
      }

      const currentChange = requireChange(changeSlug, activeDir);
      let task = null;
      try {
        task = requireTask(currentChange, taskId);
      } catch {}

      if (task) {
        // Dispatch via single-task continuation mechanism.
        // A fresh refiner gets parentSessionId equal to the batch reviewer session id (D8, D35).
        const dispatchResult = await reconcileContinuation(currentChange, task, {
          ...options,
          repoRoot,
          activeDir,
          parentSessionId: effectiveSessionId,
        });

        settlement.stages.continuationDispatch.members[taskId] = {
          status: 'completed',
          action: dispatchResult?.action || 'noop',
          admission: dispatchResult?.admission || null,
          nextStep: dispatchResult?.nextStep || null,
          completedAt: new Date().toISOString(),
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

        if (_crashAfterMemberDispatchTaskId === taskId) {
          throw new Error(`[test-hook] Simulated crash after member dispatch for task ${taskId}`);
        }
      }
    }

    settlement.stages.continuationDispatch.status = 'completed';
    settlement.stages.continuationDispatch.completedAt = new Date().toISOString();
    saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
  }

  // -------------------------------------------------------------------------
  // Stage 5: Reach 'completed' (D35 Step 5, D40)
  // -------------------------------------------------------------------------
  settlement.status = 'completed';
  saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

  return {
    settled: true,
    status: 'completed',
    settlement,
  };
}
