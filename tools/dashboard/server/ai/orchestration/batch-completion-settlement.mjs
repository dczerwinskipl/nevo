// Durable staged batch completion settlement saga (Task 06, D16, D17, D19, D31, D35, D40).
// Owns the dashboard-orchestration terminal sequence:
// 1. claim-release (strictly before dispatch)
// 2. active-execution-clear
// 3. reservation/barrier release
// 4. per-member continuation dispatch (refiners get parentSessionId = batch session id)
// 5. completed

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from '../../../../specs/workflow/errors.mjs';
import '../../../../specs/workflow/actions/index.mjs';
import {
  getWorkspaceWriterClaim,
  releaseWorkspaceWriterIfOwned,
} from '../../../../specs/workflow/workspace-writer.mjs';
import {
  getGroupReservation,
  releaseGroupReservation,
  createGroupReservation,
  rollbackReservationSynchronously,
} from '../../../../specs/workflow/queue/reservation.mjs';
import { loadBatchFinishRecord } from '../../../../specs/workflow/batch-finish/record.mjs';
import { getActiveAgentExecution, clearActiveAgentExecution, admitAgentExecution } from './admission.mjs';
import { reconcileContinuation, matchIncomingTransition } from './reconciliation.mjs';
import { resolveWorkflowPosition } from '../../../../specs/workflow/step-runner.mjs';
import { loadWorkflowDefinition } from '../../../../specs/workflow/definitions/loader.mjs';
import { resolveWorkflowMode } from '../../../../specs/workflow/compatibility.mjs';
import { requireChange, requireTask, ACTIVE_DIR } from '../../../../specs/store.mjs';
import { arraysEqual } from '../../../../specs/workflow/execution-identity.mjs';
import { resolveStableSpecId } from '../../../../specs/identity.mjs';

/**
 * Resolves a just-finished member's own actual resulting destination (batch-execution-
 * generalization, task 05, Gap 6 handover correction): the same canonical, read-only
 * data `reconcileWorkflowPosition`'s single-task path already reads — never a second,
 * independently-derived readiness/transition concept. Every member's own transition
 * was already applied and persisted by `BatchFinish` (task 03/04); this only reads the
 * result.
 *
 * @param {object} task - Freshly reloaded task (reflects its own just-applied transition)
 * @param {object} definition
 * @returns {{ hasAgentExecutor: boolean, continuationPolicy?: string|null, targetStepId?: string, executor?: string, role?: string|null, sessionPolicy?: string }}
 */
function resolveMemberDestination(task, definition) {
  const position = resolveWorkflowPosition(definition, task);

  // Mirrors reconcileWorkflowPosition's own phase handling (reconciliation.mjs) —
  // 'new' and 'completed' resolve to the step about to start, 'active' resolves to
  // the step the member is already sitting on (the normal case right after a batch
  // member's own finish just transitioned it into its next step, which is persisted
  // as that step, attempt 1, state 'active', no history yet). Only 'terminal' has
  // nothing further to dispatch.
  let nextStepId = null;
  if (position.phase === 'new') {
    nextStepId = definition.entryStep;
  } else if (position.phase === 'completed') {
    nextStepId = position.nextStep;
  } else if (position.phase === 'active') {
    nextStepId = position.step;
  } else {
    return { hasAgentExecutor: false };
  }

  const stepDef = definition.steps?.[nextStepId];
  if (!stepDef) {
    // `nextStepId` names a terminal status (e.g. 'verified'), not a declared step —
    // nothing further to execute, human-owned by construction.
    return { hasAgentExecutor: false, terminal: true };
  }

  const matchResult = matchIncomingTransition(task, definition, nextStepId);
  if (matchResult.ambiguous) {
    return { hasAgentExecutor: false, ambiguous: true, reason: matchResult.reason };
  }

  const transition = matchResult.transition;
  const continuationPolicy = transition?.continuation || null;
  if (continuationPolicy !== 'auto') {
    // Human-owned destination, or a destination requiring explicit owner action —
    // never produces a session regardless of executor (Gap 6: "Human destinations
    // never produce a session regardless").
    return { hasAgentExecutor: false, continuationPolicy, targetStepId: nextStepId };
  }

  const executor = stepDef.executor || 'agent';
  if (executor !== 'agent') {
    return { hasAgentExecutor: false, continuationPolicy, targetStepId: nextStepId, executor };
  }

  const role = matchResult.role ?? transition?.execution?.role ?? null;
  const sessionPolicy = matchResult.session ?? transition?.execution?.session ?? 'fresh';

  return {
    hasAgentExecutor: true,
    continuationPolicy,
    targetStepId: nextStepId,
    executor,
    role,
    sessionPolicy,
  };
}

/**
 * Exact matcher for live batch workspace-writer claim (D35, Item 3, 4).
 * Requires exact kind === 'agent', scope.kind === 'task-batch', batchExecutionId, sessionId,
 * canonical specId, changeSlug (if present), and exact taskIds set equality.
 */
export function matchesBatchClaimExact(liveClaim, {
  batchExecutionId,
  sessionId,
  specId,
  changeSlug,
  taskIds,
}) {
  if (!liveClaim) return false;
  if (liveClaim.kind !== 'agent') return false;
  if (liveClaim.scope?.kind !== 'task-batch') return false;
  if (!liveClaim.batchExecutionId || liveClaim.batchExecutionId !== batchExecutionId) return false;
  if (!liveClaim.sessionId || liveClaim.sessionId !== sessionId) return false;
  if (!liveClaim.specId || liveClaim.specId !== specId) return false;
  if (liveClaim.changeSlug && changeSlug && liveClaim.changeSlug !== changeSlug) return false;
  if (!Array.isArray(liveClaim.scope?.taskIds) || !arraysEqual(liveClaim.scope.taskIds, taskIds)) return false;
  return true;
}

/**
 * Checks whether a live workspace claim is ambiguous or corrupt with respect to this batch.
 * If true, settlement CANNOT authoritatively prove this batch's claim is gone, and must fail closed.
 */
export function isAmbiguousBatchClaim(liveClaim, {
  batchExecutionId,
  sessionId,
  specId,
  changeSlug,
  taskIds,
}) {
  if (!liveClaim) return false;
  // 1. Same batchExecutionId, but any required identity field is missing or mismatch
  if (liveClaim.batchExecutionId === batchExecutionId) {
    if (liveClaim.kind !== 'agent') return true;
    if (liveClaim.scope?.kind !== 'task-batch') return true;
    if (!liveClaim.sessionId || liveClaim.sessionId !== sessionId) return true;
    if (!liveClaim.specId || liveClaim.specId !== specId) return true;
    if (liveClaim.changeSlug && changeSlug && liveClaim.changeSlug !== changeSlug) return true;
    if (!Array.isArray(liveClaim.scope?.taskIds) || !arraysEqual(liveClaim.scope.taskIds, taskIds)) return true;
  }
  // 2. Same sessionId, but missing or mismatched batchExecutionId
  if (liveClaim.sessionId && liveClaim.sessionId === sessionId) {
    if (liveClaim.batchExecutionId !== batchExecutionId) return true;
  }
  // 3. Contradictory changeSlug when specId, batchExecutionId, or sessionId match (Section 5)
  if (liveClaim.changeSlug && changeSlug && liveClaim.changeSlug !== changeSlug) {
    if (
      liveClaim.specId === specId ||
      liveClaim.sessionId === sessionId ||
      liveClaim.batchExecutionId === batchExecutionId
    ) {
      return true;
    }
  }
  // 4. Task batch claim with partial task overlap (not exact equal)
  if (liveClaim.scope?.kind === 'task-batch' && Array.isArray(liveClaim.scope?.taskIds)) {
    const hasOverlap = liveClaim.scope.taskIds.some(t => taskIds.includes(t));
    if (hasOverlap && !arraysEqual(liveClaim.scope.taskIds, taskIds)) {
      return true;
    }
  }
  // 5. Single-task claim that matches one of our member tasks
  if (liveClaim.scope?.kind === 'task' && liveClaim.scope?.taskId && taskIds.includes(liveClaim.scope.taskId)) {
    return true;
  }
  return false;
}

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
    activeDir = params.activeDir || (repoRoot ? path.join(repoRoot, 'specs', 'active') : ACTIVE_DIR),
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

  // Resolve canonical specId (Section 2: never fall back to changeSlug)
  let canonicalSpecId = params.specId;
  try {
    const change = requireChange(changeSlug, activeDir);
    const resolvedSpecId = resolveStableSpecId(change);
    if (!canonicalSpecId) {
      canonicalSpecId = resolvedSpecId;
    } else if (canonicalSpecId !== resolvedSpecId) {
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
      settlement.status = 'recovery-required';
      settlement.recoveryReason = 'CANONICAL_SPEC_ID_MISMATCH';
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      return {
        settled: false,
        status: 'recovery-required',
        reason: 'CANONICAL_SPEC_ID_MISMATCH',
        settlement,
      };
    }
  } catch (err) {
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
    settlement.status = 'recovery-required';
    settlement.recoveryReason = 'CANONICAL_SPEC_ID_UNAVAILABLE';
    saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    return {
      settled: false,
      status: 'recovery-required',
      reason: 'CANONICAL_SPEC_ID_UNAVAILABLE',
      settlement,
    };
  }

  if (!canonicalSpecId) {
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
    settlement.status = 'recovery-required';
    settlement.recoveryReason = 'CANONICAL_SPEC_ID_UNAVAILABLE';
    saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    return {
      settled: false,
      status: 'recovery-required',
      reason: 'CANONICAL_SPEC_ID_UNAVAILABLE',
      settlement,
    };
  }

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
  // Stage 1: Workspace-writer claim release (D35 Step 1, D40, Item 3, 5)
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
      const isExactMatch = matchesBatchClaimExact(liveClaim, {
        batchExecutionId,
        sessionId: effectiveSessionId,
        specId: canonicalSpecId,
        changeSlug,
        taskIds,
      });

      if (isExactMatch) {
        await releaseWorkspaceWriterIfOwned({
          repoRoot,
          expectedOwnerId: ownerId || liveClaim.ownerId,
          expectedKind: 'agent',
          expectedScope: liveClaim.scope,
          expectedSessionId: liveClaim.sessionId,
          ...(liveClaim.turnId ? { expectedTurnId: liveClaim.turnId } : {}),
        });

        const afterClaim = getWorkspaceWriterClaim(repoRoot);
        const stillHeld = matchesBatchClaimExact(afterClaim, {
          batchExecutionId,
          sessionId: effectiveSessionId,
          specId: canonicalSpecId,
          changeSlug,
          taskIds,
        });

        if (!stillHeld) {
          settlement.stages.claimRelease = {
            status: 'completed',
            completedAt: new Date().toISOString(),
          };
          saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
        }
      } else {
        // Live claim exists but does not match this batch.
        // Check if the claim is ambiguous or corrupt with respect to this batch (Item 5)
        if (isAmbiguousBatchClaim(liveClaim, {
          batchExecutionId,
          sessionId: effectiveSessionId,
          specId: canonicalSpecId,
          changeSlug,
          taskIds,
        })) {
          // Malformed / ambiguous identity: fail closed!
          settlement.stages.claimRelease = {
            status: 'recovery-required',
            reason: 'AMBIGUOUS_WORKSPACE_CLAIM',
          };
          settlement.status = 'recovery-required';
          settlement.recoveryReason = 'AMBIGUOUS_WORKSPACE_CLAIM';
          saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
          return {
            settled: false,
            status: 'recovery-required',
            reason: 'AMBIGUOUS_WORKSPACE_CLAIM',
            settlement,
          };
        }

        // It is an authoritatively separate, valid, non-overlapping operation.
        // We do NOT delete it, and mark this batch's claim release as satisfied.
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
  // Stage 2: Clear active execution (D35 Step 2, D40, Item 6)
  // -------------------------------------------------------------------------
  if (settlement.stages.activeExecutionClear.status !== 'completed') {
    const targetSpecKey = canonicalSpecId || changeSlug;
    let active = getActiveAgentExecution(targetSpecKey);
    let keyUsed = targetSpecKey;
    if (!active && targetSpecKey !== changeSlug) {
      active = getActiveAgentExecution(changeSlug);
      keyUsed = changeSlug;
    }

    if (!active) {
      // Authoritatively satisfied: already absent
      settlement.stages.activeExecutionClear = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
    } else {
      // Exact active execution correlation (Item 6)
      // Missing specId is ambiguous identity — never a valid match for a canonical admitted batch.
      const activeBatchId = active.batchExecutionId || active.candidate?.batchExecutionId;
      const isExactBatchActive =
        active.scope?.kind === 'task-batch' &&
        activeBatchId === batchExecutionId &&
        active.sessionId === effectiveSessionId &&
        !!active.specId && active.specId === canonicalSpecId &&
        Array.isArray(active.scope?.taskIds) &&
        arraysEqual(active.scope.taskIds, taskIds);

      if (isExactBatchActive) {
        clearActiveAgentExecution(keyUsed);
        // Only clear the slug-keyed entry if it is unambiguously the same batch.
        // Require full identity (specId, sessionId, scope.taskIds) — batchExecutionId alone is not sufficient.
        if (targetSpecKey !== changeSlug) {
          const other = getActiveAgentExecution(changeSlug);
          const otherBatchId = other?.batchExecutionId || other?.candidate?.batchExecutionId;
          const isExactSlugEntry =
            other &&
            otherBatchId === batchExecutionId &&
            other.sessionId === effectiveSessionId &&
            !!other.specId && other.specId === canonicalSpecId &&
            Array.isArray(other.scope?.taskIds) &&
            arraysEqual(other.scope.taskIds, taskIds);
          if (isExactSlugEntry) {
            clearActiveAgentExecution(changeSlug);
          }
        }
        settlement.stages.activeExecutionClear = {
          status: 'completed',
          completedAt: new Date().toISOString(),
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      } else {
        // If the active execution does NOT match this batch, do not clear it!
        // But if it is an ambiguous match (e.g. same batchId but wrong session/scope):
        if (activeBatchId === batchExecutionId) {
          settlement.status = 'recovery-required';
          settlement.recoveryReason = 'AMBIGUOUS_ACTIVE_EXECUTION';
          saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
          return {
            settled: false,
            status: 'recovery-required',
            reason: 'AMBIGUOUS_ACTIVE_EXECUTION',
            settlement,
          };
        }

        // Active execution belongs to another operation; this batch is not active.
        settlement.stages.activeExecutionClear = {
          status: 'completed',
          completedAt: new Date().toISOString(),
          note: 'different-execution-active',
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      }
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
  // Structural Dispatch Safety Guard (D35, D40, Item 4)
  // Dispatch is illegal until stages 1–3 are authoritatively satisfied.
  // -------------------------------------------------------------------------
  const liveClaimBeforeDispatch = getWorkspaceWriterClaim(repoRoot);
  if (
    liveClaimBeforeDispatch &&
    matchesBatchClaimExact(liveClaimBeforeDispatch, {
      batchExecutionId,
      sessionId: effectiveSessionId,
      specId: canonicalSpecId,
      changeSlug,
      taskIds,
    })
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
  // Stage 4: Continuation dispatch partitioned by full execution contract (D35 Step 4,
  // D40; batch-execution-generalization, task 05, Gap 6 handover correction). Members
  // sharing the identical resulting {continuation policy, target step/executor, role,
  // session policy, resolved execution policy} tuple are dispatched together as ONE new
  // agent session — never one independent session per member. Every member's own
  // transition is already applied and persisted (task 03/04); this stage only changes
  // how many/which sessions get admitted from that already-resolved data.
  // -------------------------------------------------------------------------
  if (settlement.stages.continuationDispatch.status !== 'completed') {
    if (!settlement.stages.continuationDispatch.members) {
      settlement.stages.continuationDispatch.members = {};
    }

    const pendingTaskIds = taskIds.filter(
      (taskId) => settlement.stages.continuationDispatch.members[taskId]?.status !== 'completed'
    );

    if (pendingTaskIds.length > 0) {
      const currentChangeForGrouping = requireChange(changeSlug, activeDir);
      const resolvedMode = resolveWorkflowMode(currentChangeForGrouping, { repoRoot });
      const definition = resolvedMode.definition
        ? loadWorkflowDefinition(resolvedMode.definition, { repoRoot })
        : null;
      const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');

      // Partition pending members by their full resulting execution-contract tuple —
      // continuation policy, target step/executor, role, session policy, and resolved
      // execution policy (provider/model/mode, including any taskOverrides) — not
      // destination transition alone.
      const groups = new Map(); // tupleKey -> { taskIds: [], destination, resolvedPolicy }
      const noDispatchTaskIds = [];

      for (const taskId of pendingTaskIds) {
        let task = null;
        try {
          task = requireTask(currentChangeForGrouping, taskId);
        } catch {}

        if (!task || !definition) {
          noDispatchTaskIds.push(taskId);
          continue;
        }

        const destination = resolveMemberDestination(task, definition);
        if (!destination.hasAgentExecutor) {
          // Human-owned destination, or no automatic continuation: this group simply
          // produces its human interaction(s), already handled by the per-task
          // transition itself — no session to admit.
          noDispatchTaskIds.push(taskId);
          continue;
        }

        let resolvedPolicy = null;
        try {
          resolvedPolicy = executionPolicyService.resolveExecutionPolicy(changeSlug, taskId, {
            ...(destination.role ? { role: destination.role } : {}),
            repoRoot,
          });
        } catch {}

        const tupleKey = JSON.stringify({
          continuationPolicy: destination.continuationPolicy,
          targetStepId: destination.targetStepId,
          executor: destination.executor,
          role: destination.role,
          sessionPolicy: destination.sessionPolicy,
          provider: resolvedPolicy?.provider || null,
          model: resolvedPolicy?.model || null,
          mode: resolvedPolicy?.mode || null,
        });

        if (!groups.has(tupleKey)) {
          groups.set(tupleKey, { taskIds: [], destination, resolvedPolicy });
        }
        groups.get(tupleKey).taskIds.push(taskId);
      }

      // Human-only / no-agent-executor members: nothing to dispatch. Processed one at a
      // time (save, then crash-hook check) — same sequencing granularity as the
      // per-group dispatch below — so a crash hook on any one member reflects state as
      // of exactly that member, never a sibling processed in the same batched write.
      for (const taskId of noDispatchTaskIds) {
        settlement.stages.continuationDispatch.members[taskId] = {
          status: 'completed',
          action: 'noop',
          admission: null,
          nextStep: null,
          completedAt: new Date().toISOString(),
        };
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

        if (_crashAfterMemberDispatchTaskId === taskId) {
          throw new Error(`[test-hook] Simulated crash after member dispatch for task ${taskId}`);
        }
      }

      for (const { taskIds: groupTaskIds, destination, resolvedPolicy } of groups.values()) {
        if (groupTaskIds.length === 1) {
          // A single member needing continuation still gets exactly one session, via
          // the existing single-task path — no batch machinery for a group of one.
          const taskId = groupTaskIds[0];
          const currentChange = requireChange(changeSlug, activeDir);
          const task = requireTask(currentChange, taskId);

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
          continue;
        }

        // Two or more members share the identical resulting contract: admit ONE new
        // batch covering all of them, rather than one independent session per member.
        const newBatchExecutionId = randomUUID();
        const genericTrigger = options.message || options.prompt
          || `Execute batched ${destination.targetStepId} for tasks: ${groupTaskIds.join(', ')}.`;

        await createGroupReservation({
          repoRoot,
          changeSlug,
          taskIds: groupTaskIds,
          batchExecutionId: newBatchExecutionId,
          executionConfigSnapshot: {
            provider: resolvedPolicy?.provider,
            model: resolvedPolicy?.model,
            mode: resolvedPolicy?.mode || 'agent',
            contextCapacity: { status: 'unknown', reason: 'batch-completion-handover' },
          },
        });

        const candidate = {
          scope: { kind: 'task-batch', taskIds: groupTaskIds },
          taskIds: groupTaskIds,
          batchExecutionId: newBatchExecutionId,
          stepId: destination.targetStepId,
          role: destination.role,
          provider: resolvedPolicy?.provider,
          mode: resolvedPolicy?.mode || 'agent',
          model: resolvedPolicy?.model,
          changeSlug,
          specId: canonicalSpecId,
          sessionPolicy: 'fresh',
          parentSessionId: effectiveSessionId,
          message: genericTrigger,
          userMessage: genericTrigger,
          prompt: genericTrigger,
        };

        let admissionRes;
        try {
          admissionRes = await admitAgentExecution(canonicalSpecId, candidate, {
            ...options,
            repoRoot,
            activeDir,
          });
        } catch (err) {
          await rollbackReservationSynchronously({
            repoRoot,
            changeSlug,
            batchExecutionId: newBatchExecutionId,
            error: err,
          });
          admissionRes = { admitted: false, reason: err?.message || String(err) };
        }

        if (!admissionRes.admitted) {
          await rollbackReservationSynchronously({
            repoRoot,
            changeSlug,
            batchExecutionId: newBatchExecutionId,
            error: new Error(admissionRes.reason || 'ADMISSION_BLOCKED'),
          }).catch(() => {});
        }

        for (const taskId of groupTaskIds) {
          settlement.stages.continuationDispatch.members[taskId] = {
            status: 'completed',
            action: admissionRes.admitted ? 'agent-admitted' : 'noop',
            admission: admissionRes,
            nextStep: destination.targetStepId,
            batchExecutionId: newBatchExecutionId,
            groupTaskIds,
            completedAt: new Date().toISOString(),
          };
        }
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

        for (const taskId of groupTaskIds) {
          if (_crashAfterMemberDispatchTaskId === taskId) {
            throw new Error(`[test-hook] Simulated crash after member dispatch for task ${taskId}`);
          }
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
