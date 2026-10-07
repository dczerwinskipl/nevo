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
  validateBatchCompatibility,
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
 * Admission failure reasons that reflect transient contention (another execution still
 * holds the one-active-execution-per-spec slot, a workspace-writer race, a pending
 * workspace request, an unresolved reuse-session predecessor) rather than a genuine,
 * permanent inability to dispatch. A dispatch unit blocked by one of these must stay
 * durably `'pending'`, never recorded as a terminal `'failed'`/`'completed'` outcome
 * (batch-execution-generalization, task 13, second-round review finding 2).
 */
export const TRANSIENT_ADMISSION_REASONS = new Set([
  'ACTIVE_EXECUTION_EXISTS',
  'DEFERRED_TO_PENDING_WORKSPACE_REQUEST',
  'WORKSPACE_WRITER_CONTENDED',
  'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY',
  'REUSE_SESSION_NOT_RESOLVED',
]);

function isTransientAdmissionReason(reason) {
  return TRANSIENT_ADMISSION_REASONS.has(reason);
}

/**
 * Durable grouped-handover retry (batch-execution-generalization, task 11, gap 1):
 * finds another settlement for this same `changeSlug` whose own Stage 4 still has
 * durable pending dispatch units (the one-active-execution-per-spec invariant blocked
 * admitting them in some earlier pass) — never a new cross-batch scheduler, only a scan
 * over this module's own already-persisted, already-determined saga state, the exact
 * same kind of durable-state scan Hook 3 boot reconciliation already performs over
 * workspace-writer claims. Called whenever the one-active-execution-per-spec slot frees
 * — a batch settlement's own Stage 2, or (task 13) a singleton's own turn settling in
 * `admission.mjs`'s `reconcileHook1` — the only moments a sibling's pending unit could
 * newly become admittable.
 *
 * @param {object} params
 * @returns {Promise<void>} Never throws — a failed resume attempt is retried by the
 *   next natural trigger (another settlement's own Stage 2, a singleton settling, or
 *   Hook 3).
 */
export async function resumePendingHandoverForSpec({ repoRoot, changeSlug, excludeBatchExecutionId, activeDir, options }) {
  try {
    const dir = getBatchCompletionSettlementDir(repoRoot, changeSlug);
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.tmp'));
    for (const file of files) {
      const candidateBatchExecutionId = file.replace(/\.json$/, '');
      if (candidateBatchExecutionId === excludeBatchExecutionId) continue;

      const candidate = loadBatchCompletionSettlement(repoRoot, changeSlug, candidateBatchExecutionId);
      const pendingUnits = candidate?.stages?.continuationDispatch?.pendingUnits;
      const hasPendingUnit = Array.isArray(pendingUnits) && pendingUnits.some((u) => u.status === 'pending');
      if (!candidate || candidate.status === 'completed' || !hasPendingUnit) continue;

      // Found durable pending handover work for this spec — resume it. Recurses
      // naturally (this resumed call's own Stage 2 is already-cleared/no-op, so it
      // goes straight to Stage 4 and may itself free the slot again for a third
      // sibling, etc.) and bottoms out once no settlement has pending units left.
      await executeBatchCompletionSettlement({
        repoRoot,
        changeSlug,
        batchExecutionId: candidateBatchExecutionId,
        sessionId: candidate.sessionId,
        activeDir,
        options: options || {},
      });
      return; // One resume per call; a still-pending remainder is picked up by the
      // resumed settlement's own next Stage 2 (if it dispatches something) or by
      // the next natural trigger otherwise.
    }
  } catch {
    // Best-effort: never let a resume attempt fail the settlement that triggered it.
  }
}

/**
 * Worktree-wide durable grouped-handover retry (batch-execution-generalization, task
 * 16, third-round review finding 1): `resumePendingHandoverForSpec` only ever scans ONE
 * already-known `changeSlug` — correct for the slot-freeing triggers (a sibling of the
 * SAME spec), but insufficient for the worktree-wide transient admission reasons
 * (`DEFERRED_TO_PENDING_WORKSPACE_REQUEST`, `WORKSPACE_WRITER_CONTENDED`,
 * `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY`) that block a *different* spec's pending unit
 * entirely — nothing about the spec that originally triggered the trigger identifies
 * which other spec, if any, is sitting durably pending behind a now-cleared worktree-
 * wide contention. This sweeps every changeSlug that has ever had a settlement
 * directory (still only a scan over already-persisted, already-determined saga state —
 * never a new cross-spec scheduler, never a re-ranking of unrelated work) and resumes
 * the first one it finds with durable pending work.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} [params.activeDir]
 * @param {object} [params.options]
 * @returns {Promise<void>} Never throws.
 */
export async function sweepAllPendingHandovers({ repoRoot, activeDir, options }) {
  try {
    if (!repoRoot) return;
    const baseDir = path.join(repoRoot, '.nevo-ai-local', 'batch-completion');
    if (!fs.existsSync(baseDir)) return;

    const changeSlugs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const changeSlug of changeSlugs) {
      await resumePendingHandoverForSpec({ repoRoot, changeSlug, excludeBatchExecutionId: null, activeDir, options });
    }
  } catch {
    // Best-effort: never let a sweep attempt fail the caller that triggered it.
  }
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

        // The one-active-execution-per-spec slot just freed — a sibling settlement's
        // own durable pending handover group (task 11, gap 1) may now be admittable.
        await resumePendingHandoverForSpec({
          repoRoot,
          changeSlug,
          excludeBatchExecutionId: batchExecutionId,
          activeDir,
          options,
        });
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
  // D40; batch-execution-generalization, task 05 Gap 6, corrected by task 11). Members
  // sharing the identical resulting {continuation policy, target step/executor, role,
  // session policy, resolved execution policy} tuple are dispatched together as ONE new
  // agent session — never one independent session per member. Every member's own
  // transition is already applied and persisted (task 03/04); this stage only changes
  // how many/which sessions get admitted from that already-resolved data.
  //
  // Task 11 correction: the one-active-execution-per-spec invariant (D33, admission.mjs)
  // means at most ONE dispatch unit (a single member or a fresh multi-member group) can
  // actually be admitted per settlement pass — attempting a second immediately after the
  // first succeeds always hits ACTIVE_EXECUTION_EXISTS. Dispatch units are resolved once
  // and persisted as `pendingUnits`; each pass admits at most one eligible unit and
  // leaves the rest durably `pending` (never silently 'noop'/completed) for a later pass
  // — triggered by `resumePendingHandoverForSpec` once the slot frees again, or by any
  // other natural re-invocation (Hook 3, a retry). A destination whose sessionPolicy is
  // not 'fresh' is never grouped — multi-member batch admission is a 'fresh'-only v1
  // concept (task 02); such a member always dispatches via the single-task path, which
  // already supports `session: reuse` via its own exact predecessor-session resolution,
  // so no cross-member reuse-identity ambiguity can arise.
  // -------------------------------------------------------------------------
  if (settlement.stages.continuationDispatch.status !== 'completed') {
    if (!settlement.stages.continuationDispatch.members) {
      settlement.stages.continuationDispatch.members = {};
    }

    const pendingTaskIds = taskIds.filter(
      (taskId) => settlement.stages.continuationDispatch.members[taskId]?.status !== 'completed'
    );

    if (pendingTaskIds.length > 0) {
      // Resolve dispatch units once per settlement (idempotent: only computed the first
      // time pendingUnits is absent; a resumed pass reuses the already-persisted list).
      if (!Array.isArray(settlement.stages.continuationDispatch.pendingUnits)) {
        const currentChangeForGrouping = requireChange(changeSlug, activeDir);
        const resolvedMode = resolveWorkflowMode(currentChangeForGrouping, { repoRoot });
        const definition = resolvedMode.definition
          ? loadWorkflowDefinition(resolvedMode.definition, { repoRoot })
          : null;
        const { executionPolicyService } = await import('../sessions/execution-policy-service.mjs');

        // Partition pending members by their full resulting execution-contract tuple —
        // continuation policy, target step/executor, role, session policy, and resolved
        // execution policy (provider/model/mode, including any taskOverrides) — not
        // destination transition alone. Non-'fresh' destinations are never grouped.
        const freshGroups = new Map(); // tupleKey -> { taskIds: [], destination, resolvedPolicy }
        const singleUnits = []; // [{ taskIds: [id], destination, resolvedPolicy }]
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
            // Human-owned destination, or no automatic continuation: this member simply
            // produces its human interaction(s), already handled by the per-task
            // transition itself — no session to admit, no contention risk.
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

          if (destination.sessionPolicy !== 'fresh') {
            // Gap 3: never grouped — dispatched individually via the reuse-capable
            // single-task path, which resolves its own exact predecessor session.
            singleUnits.push({ taskIds: [taskId], destination, resolvedPolicy });
            continue;
          }

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

          if (!freshGroups.has(tupleKey)) {
            freshGroups.set(tupleKey, { taskIds: [], destination, resolvedPolicy });
          }
          freshGroups.get(tupleKey).taskIds.push(taskId);
        }

        // Human-only / no-agent-executor members: nothing to dispatch, no contention
        // risk — processed immediately, one at a time (save, then crash-hook check).
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

        // A fresh group of exactly one member still gets exactly one session via the
        // single-task path — no batch machinery for a group of one.
        const units = [...singleUnits];
        for (const { taskIds: groupTaskIds, destination, resolvedPolicy } of freshGroups.values()) {
          units.push({
            taskIds: groupTaskIds,
            destination,
            resolvedPolicy,
            isGroup: groupTaskIds.length > 1,
          });
        }

        settlement.stages.continuationDispatch.pendingUnits = units.map((u) => ({
          taskIds: u.taskIds,
          destination: u.destination,
          resolvedPolicy: u.resolvedPolicy,
          isGroup: !!u.isGroup,
          status: 'pending',
        }));
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
      }

      // Admit at most ONE eligible pending unit this pass, respecting the one-active-
      // execution-per-spec invariant — never attempt a second admission in the same pass.
      const pendingUnits = settlement.stages.continuationDispatch.pendingUnits.filter((u) => u.status === 'pending');

      if (pendingUnits.length > 0) {
        const alreadyActive = getActiveAgentExecution(canonicalSpecId);
        if (!alreadyActive) {
          const unit = pendingUnits[0];

          if (!unit.isGroup) {
            const taskId = unit.taskIds[0];
            const currentChange = requireChange(changeSlug, activeDir);
            const task = requireTask(currentChange, taskId);

            const dispatchResult = await reconcileContinuation(currentChange, task, {
              ...options,
              repoRoot,
              activeDir,
              parentSessionId: effectiveSessionId,
            });

            // Give the singleton path the same transient/terminal classification the
            // grouped branch already has (task 13, second-round review finding 2):
            // `reconcileContinuation`'s own 'agent-admitted' action unconditionally
            // wraps whatever `admitAgentExecution` returned, including a failed,
            // merely-transient admission — that must stay pending, not be recorded as
            // a completed unit.
            const singletonAdmission = dispatchResult?.admission || null;
            const isTransientSingletonFailure = dispatchResult?.action === 'agent-admitted'
              && singletonAdmission
              && singletonAdmission.admitted === false
              && isTransientAdmissionReason(singletonAdmission.reason);

            if (isTransientSingletonFailure) {
              // Transient contention — leave this unit durably pending; a later pass
              // (triggered once the slot actually frees) retries it.
            } else {
              settlement.stages.continuationDispatch.members[taskId] = {
                status: 'completed',
                action: dispatchResult?.action || 'noop',
                admission: singletonAdmission,
                nextStep: dispatchResult?.nextStep || null,
                completedAt: new Date().toISOString(),
              };
              unit.status = (singletonAdmission && singletonAdmission.admitted === false) ? 'failed' : 'completed';
              saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

              if (_crashAfterMemberDispatchTaskId === taskId) {
                throw new Error(`[test-hook] Simulated crash after member dispatch for task ${taskId}`);
              }
            }
          } else {
            const { taskIds: groupTaskIds, destination, resolvedPolicy } = unit;

            // Gap 2: run the same canonical compatibility/readiness validation every
            // other reservation-creation call site runs, before creating a reservation
            // for this handover group — never skip it just because the members already
            // passed it once, at a prior, independent admission.
            const currentChangeForCompat = requireChange(changeSlug, activeDir);
            const resolvedModeForCompat = resolveWorkflowMode(currentChangeForCompat, { repoRoot });
            const definitionForCompat = resolvedModeForCompat.definition
              ? loadWorkflowDefinition(resolvedModeForCompat.definition, { repoRoot })
              : null;
            const compat = validateBatchCompatibility({
              change: currentChangeForCompat,
              taskIds: groupTaskIds,
              definition: definitionForCompat,
              repoRoot,
            });

            if (!compat.compatible) {
              // Genuinely incompatible/blocked (e.g. an external unsatisfied
              // dependency) — a real failure, never silently 'noop' as if nothing
              // needed to happen.
              for (const taskId of groupTaskIds) {
                settlement.stages.continuationDispatch.members[taskId] = {
                  status: 'completed',
                  action: 'failed',
                  reason: compat.reason,
                  admission: null,
                  nextStep: destination.targetStepId,
                  groupTaskIds,
                  completedAt: new Date().toISOString(),
                };
              }
              unit.status = 'failed';
              saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
            } else {
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
                sessionPolicy: destination.sessionPolicy,
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
                // An exception during admission (e.g. a transient failure creating the
                // session) is treated as transient, not a terminal loss of this unit
                // (task 13, second-round review finding 2) — the reservation was already
                // rolled back above, so a later pass can create a fresh one and retry.
                admissionRes = { admitted: false, reason: err?.message || String(err), transient: true };
              }

              if (!admissionRes.admitted) {
                await rollbackReservationSynchronously({
                  repoRoot,
                  changeSlug,
                  batchExecutionId: newBatchExecutionId,
                  error: new Error(admissionRes.reason || 'ADMISSION_BLOCKED'),
                }).catch(() => {});
              }

              if (!admissionRes.admitted && (admissionRes.transient || isTransientAdmissionReason(admissionRes.reason))) {
                // Transient contention (slot still held, a workspace-writer race, a
                // pending workspace request, an unresolved reuse predecessor, or a
                // thrown admission exception) — leave this unit durably pending, do not
                // mark it done; a later pass retries it once the contention clears.
              } else {
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
                unit.status = admissionRes.admitted ? 'completed' : 'failed';
                saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);

                if (admissionRes.admitted) {
                  for (const taskId of groupTaskIds) {
                    if (_crashAfterMemberDispatchTaskId === taskId) {
                      throw new Error(`[test-hook] Simulated crash after member dispatch for task ${taskId}`);
                    }
                  }
                }
              }
            }
          }
        }
      }

      const stillPending = settlement.stages.continuationDispatch.pendingUnits.some((u) => u.status === 'pending');
      if (stillPending) {
        saveBatchCompletionSettlement(repoRoot, changeSlug, settlement);
        return {
          settled: false,
          status: 'pending',
          reason: 'CONTINUATION_DISPATCH_PENDING',
          settlement,
        };
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
