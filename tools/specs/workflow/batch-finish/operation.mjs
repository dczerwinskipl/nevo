// Main batch-finish execution operation (Task 04, D21, D22, D23, D29, D30, D39).
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import * as git from '../../../lib/git.mjs';
import { requireChange, requireTask, ACTIVE_DIR } from '../../store.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import { normalizeSourceControlConfig } from '../definitions/schema.mjs';
import { getGroupReservation } from '../queue/reservation.mjs';
import { finishStep } from '../finish-operation.mjs';
import { defaultActionRegistry } from '../registry.mjs';
import { resolveTaskScope } from '../../context.mjs';
import { findInFlightStartOperation, saveStartOperation, completeConsumptionStage } from '../start-operation.mjs';
import { recordDependencyConsumption } from '../dependency-consumption.mjs';
import { evaluateDependencySatisfaction } from '../dependency-satisfaction.mjs';
import '../actions/index.mjs';
import { WorkflowError } from '../errors.mjs';
import {
  createBatchFinishRecord,
  loadBatchFinishRecord,
  saveBatchFinishRecord,
} from './record.mjs';
import { loadBatchStartRecord } from '../batch-start/record.mjs';
import { renderBatchReport } from '../../reviews/batch-report.mjs';
import { prevalidateBatchFinish } from './preflight.mjs';

/**
 * Orders a batch's own members by `depends_on` (filtered to ids that are members of
 * this same batch — external dependencies already resolved or the batch would not
 * have been admitted) so an upstream member's own transition is derived, and its
 * release epoch created, before any downstream member that depends on it is processed
 * (batch-execution-generalization, task 04, Gap 6 finish half). Independent members
 * keep the batch's own declared order relative to each other. Falls back to that same
 * declared order for whatever remains if the graph does not fully resolve (defensive
 * only — `validateBatchCompatibility`/admission already guarantee an acyclic,
 * in-batch-resolvable graph).
 *
 * @param {string[]} taskIds
 * @param {object} change
 * @returns {string[]}
 */
function topoSortBatchMembers(taskIds, change) {
  const idSet = new Set(taskIds);
  const remaining = new Set(taskIds);
  const result = [];

  while (remaining.size > 0) {
    let progressed = false;
    for (const id of taskIds) {
      if (!remaining.has(id)) continue;
      let task;
      try {
        task = requireTask(change, id);
      } catch {
        task = null;
      }
      const deps = (Array.isArray(task?.depends_on) ? task.depends_on : []).filter((d) => idSet.has(d));
      if (deps.every((d) => !remaining.has(d))) {
        result.push(id);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      for (const id of taskIds) {
        if (remaining.has(id)) result.push(id);
      }
      break;
    }
  }

  return result;
}

/**
 * Materializes a member's own pending intra-batch dependency-consumption entries (Gap
 * 6, finish half — batch-execution-generalization, task 04): for each pending entry
 * (`releaseEpoch: null, pending: true`, allocated at batch-start by task 02), re-reads
 * the named dependency task's *current* workflow history and fills in its real release
 * epoch once that dependency's own transition has actually landed. Once every entry in
 * the snapshot is resolved (pending or always-external), records the consumption using
 * the exact `consumptionSequence` already allocated at batch-start (never a new one —
 * this is what preserves `planStart`'s frozen-snapshot invariant) and closes the
 * start-operation's own `record-consumption` stage. A no-op, safe to call repeatedly,
 * for a task with no start-operation at all (not a `consumesDependencies` member) or
 * whose consumption stage already completed — this is what makes resuming after a
 * crash between materializing one entry and finishing the next member neither
 * re-materialize nor lose anything.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} taskId
 * @param {object} currentChange - Freshly loaded change (reflects latest transitions)
 * @param {object} definition
 */
function tryCompleteDependencyConsumption(repoRoot, changeSlug, taskId, currentChange, definition) {
  const startOp = findInFlightStartOperation(repoRoot, changeSlug, taskId);
  if (!startOp) return;

  const consumeStage = startOp.stages?.find((s) => s.id === 'record-consumption');
  if (consumeStage?.status === 'completed') return;

  let changed = false;
  const resolvedSnapshot = (startOp.dependencySnapshot || []).map((dep) => {
    if (dep.releaseEpoch || !dep.pending) return dep;
    let depTask;
    try {
      depTask = requireTask(currentChange, dep.taskId);
    } catch {
      depTask = null;
    }
    if (!depTask) return dep;
    const resolved = evaluateDependencySatisfaction(depTask, currentChange, definition);
    if (resolved.releaseEpoch) {
      changed = true;
      return { taskId: dep.taskId, releaseEpoch: resolved.releaseEpoch };
    }
    return dep;
  });

  if (changed) {
    startOp.dependencySnapshot = resolvedSnapshot;
    saveStartOperation(repoRoot, startOp);
  }

  const stillPending = resolvedSnapshot.some((dep) => !dep.releaseEpoch);
  if (stillPending) return;

  recordDependencyConsumption({
    repoRoot,
    change: changeSlug,
    consumingTaskId: taskId,
    consumingStep: startOp.step,
    consumingAttempt: startOp.attempt,
    consumptionSequence: startOp.consumptionSequence,
    dependencies: resolvedSnapshot,
  });
  completeConsumptionStage(repoRoot, startOp);
}

/**
 * Executes the batch-finish operation as a durable, idempotent saga (D21).
 *
 * @param {object} params
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {object} params.inputs - Result payload for member tasks and report
 * @param {string} [params.sessionId]
 * @param {string} [params.repoRoot]
 * @param {string} [params.activeDir]
 * @param {string|null} [params._crashAfterMemberTaskId=null] Test hook for crash simulation
 * @param {boolean} [params._crashAfterSharedCommit=false] Test hook for crash simulation
 * @returns {Promise<{ status: string, batchExecutionId: string, record: object }>}
 */
export async function executeBatchFinish(params = {}) {
  const {
    changeSlug,
    batchExecutionId,
    inputs = {},
    sessionId,
    repoRoot = process.cwd(),
    activeDir = ACTIVE_DIR,
    _crashAfterMemberTaskId = null,
    _crashAfterSharedCommit = false,
  } = params;

  if (!changeSlug || !batchExecutionId) {
    throw new WorkflowError('executeBatchFinish requires changeSlug and batchExecutionId', {
      code: 'INVALID_ARGUMENTS',
    });
  }

  const change = requireChange(changeSlug, activeDir);
  const definition = loadWorkflowDefinition(change.workflow?.definition, { repoRoot });

  const reservation = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
  if (!reservation || reservation.status !== 'reserved') {
    throw new WorkflowError(
      `Batch reservation '${batchExecutionId}' not found or not in reserved state for change '${changeSlug}'`,
      { code: 'BATCH_IDENTITY_MISMATCH', batchExecutionId, changeSlug }
    );
  }

  const taskIds = reservation.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    throw new WorkflowError(`Reservation '${batchExecutionId}' has invalid taskIds`, {
      code: 'INVALID_RESERVATION',
      taskIds,
    });
  }

  // Check existing record for resume (D30)
  let record = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (record && record.status === 'completed') {
    return {
      status: 'completed',
      batchExecutionId,
      record,
    };
  }

  // Provenance (HEAD === baseline, worktree delta === baseline delta) is a one-time gate
  // on the very first attempt, before this operation's own first durable write
  // (`createBatchFinishRecord` below) — not something to re-derive on every resume.
  // Once a record exists at all, Stage 4 may already have mutated change.yaml for some
  // members (a legitimate, expected divergence from the original baseline, not a new
  // violation) — re-running the check against that moving target would incorrectly
  // fail. A record's mere existence is the correct "already past this gate" signal,
  // independent of which stage it most recently reached.
  const isResume = record != null;

  // Stage 0 & Stage 1: In-memory prevalidation (D21, D23, D29, D30, D39).
  // Zero durable writes occur if this fails.
  const {
    effectiveSessionId,
    normalizedResults,
    canonicalReportPath,
    crossTaskFindings,
  } = prevalidateBatchFinish({
    repoRoot,
    activeDir,
    changeSlug,
    batchExecutionId,
    taskIds,
    inputs,
    sessionId,
    change,
    definition,
    reservation,
    skipProvenanceCheck: isResume,
  });

  // Phase signal (batch-execution-generalization, task 03): whether this is a
  // review-shaped batch is derived from the one signal already present in the normal
  // per-member validation Stage 1 just ran — any member supplying a `result` means its
  // own target step is conditional (review-like); homogeneous-by-contract batches
  // never mix conditional and unconditional members, so this is unambiguous. No new,
  // redundant "phase" field is introduced.
  const isReviewPhase = taskIds.some((id) => normalizedResults[id]?.result !== undefined);

  // Stage 1.5: Render and write canonical batch review report (D21, D22, Item 8) — the
  // review-phase-specific artifact, now genuinely optional (Gap 5): an implementation/
  // refinement batch produces no review report at all.
  // Strictly performed only after all read-only prevalidation has succeeded.
  const fullReportPath = path.join(repoRoot, canonicalReportPath);
  if (isReviewPhase && !fs.existsSync(fullReportPath)) {
    const startRecord = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
    const batchCtx = startRecord?.batchContext || {
      batchExecutionId,
      change: changeSlug,
      executionScope: { kind: 'task-batch', taskIds },
      crossTaskFindings,
    };
    const rendered = renderBatchReport(batchCtx, { results: normalizedResults, crossTaskFindings });
    fs.mkdirSync(path.dirname(fullReportPath), { recursive: true });
    fs.writeFileSync(fullReportPath, rendered, 'utf8');
  }

  // Stage 2: Persist as 'validated' for the first time (D21).
  if (!record) {
    record = createBatchFinishRecord({
      repoRoot,
      changeSlug,
      batchExecutionId,
      taskIds,
      results: normalizedResults,
      reportPath: isReviewPhase ? canonicalReportPath : null,
      crossTaskFindings,
      sessionId: effectiveSessionId,
    });
  }

  // Stage 4: Apply each member task's gate verification, task-state update, and
  // transition derivation sequentially & idempotently (D21), reusing `finishStep`'s own
  // non-commit/push stages exactly as the single-task path does. `sourceControl` is
  // explicitly disabled for this per-member call — its own `commit`/`push` stages must
  // not execute per member (batch-execution-generalization, task 03, Gap 2/5); Stage 5
  // below performs the one shared commit/push covering every member's changes instead.
  // Members are processed in `depends_on` topological order (task 04, Gap 6 finish
  // half) so an upstream member's own release epoch exists before any downstream
  // member's pending dependency-consumption entry is materialized below.
  if (!record.stages.memberFinishes) {
    record.stages.memberFinishes = {};
  }

  const orderedTaskIds = topoSortBatchMembers(taskIds, change);

  for (const taskId of orderedTaskIds) {
    if (record.stages.memberFinishes[taskId]?.status === 'completed') {
      continue; // Skip already completed member finishes
    }

    // Refresh change to capture recent transitions
    const currentChange = requireChange(changeSlug, activeDir);
    const task = requireTask(currentChange, taskId);
    const taskInputs = {
      ...(normalizedResults[taskId] || {}),
      ...(isReviewPhase ? { artifacts: [canonicalReportPath] } : {}),
      sessionId: effectiveSessionId,
    };
    const { allowedPaths } = resolveTaskScope(currentChange, task, { repoRoot, activeDir });

    const finishResult = await finishStep({
      change: currentChange,
      task,
      definition,
      context: {
        repoRoot,
        activeDir,
        sessionId: effectiveSessionId,
        taskAllowedPaths: allowedPaths,
        allowedPaths,
        sourceControl: { enabled: false },
      },
      inputs: taskInputs,
      activeDir,
    });

    record.stages.memberFinishes[taskId] = {
      status: 'completed',
      operationId: finishResult.operationId,
      result: finishResult,
      completedAt: new Date().toISOString(),
    };
    saveBatchFinishRecord(repoRoot, changeSlug, record);

    // Materialize dependency-consumption (Gap 6, finish half — batch-execution-
    // generalization, task 04): this member's own transition, just applied above, may
    // have created a release epoch other (not-yet-finished or already-finished)
    // members' pending entries were waiting on. Re-checked for every member on every
    // iteration — not just the one that pointed at `taskId` — so a member depending on
    // two different siblings converges correctly regardless of which one just finished,
    // and so a crash immediately after this point (before the next member starts) never
    // leaves a materializable entry un-recorded on resume (`tryCompleteDependencyConsumption`
    // is itself idempotent: a no-op for a non-consuming task or an already-completed stage).
    const changeAfterMemberFinish = requireChange(changeSlug, activeDir);
    for (const id of taskIds) {
      tryCompleteDependencyConsumption(repoRoot, changeSlug, id, changeAfterMemberFinish, definition);
    }

    if (_crashAfterMemberTaskId === taskId) {
      throw new Error(`[test-hook] Simulated crash after member task ${taskId}`);
    }
  }

  // Stage 5: ONE shared commit + push covering every member's changes — their own
  // workflow-state transitions (Stage 4), any real source edits within their declared
  // scope, and the rendered review report (still sitting on disk, uncommitted, when one
  // was rendered above) — all swept up together by the action's own default `include:
  // ['*']` staging, exactly the "one commit covering every member's changes plus the
  // review report" Gap 2 asks for, never a separate earlier report-only commit.
  // Reuses the exact same commit-then-push split `finishStep`'s own (module-private)
  // ensureCommit/ensurePush stages use — not exported there since this is a batch-wide
  // finalize, not a per-task one, so it does not belong inside that per-task saga.
  const sourceControl = normalizeSourceControlConfig(definition.sourceControl);

  if (!record.stages.sharedCommit) {
    record.stages.sharedCommit = { status: 'pending' };
  }
  if (record.stages.sharedCommit.status !== 'completed') {
    if (sourceControl.enabled) {
      const commitTitle = typeof inputs['commit.title'] === 'string' ? inputs['commit.title'].trim() : '';
      const action = defaultActionRegistry.require('commit-and-push');
      const actionContext = { repoRoot, changeSlug, activeDir, sourceControl: { enabled: true, push: false } };
      const actionInputs = { 'commit.title': commitTitle };
      const commitMessage = typeof inputs['commit.message'] === 'string' ? inputs['commit.message'].trim() : '';
      if (commitMessage) {
        actionInputs['commit.message'] = commitMessage;
      }
      const execResult = await action.execute(actionInputs, actionContext);
      record.stages.sharedCommit = { status: 'completed', result: execResult.outputs.commit };
    } else {
      record.stages.sharedCommit = { status: 'completed', skipped: true };
    }
    saveBatchFinishRecord(repoRoot, changeSlug, record);

    if (_crashAfterSharedCommit) {
      throw new Error('[test-hook] Simulated crash after shared commit');
    }
  }

  if (!record.stages.sharedPush) {
    record.stages.sharedPush = { status: 'pending' };
  }
  if (record.stages.sharedPush.status !== 'completed') {
    if (sourceControl.enabled && sourceControl.push) {
      const branch = git.getCurrentBranch(repoRoot);
      await git.pushAsync(repoRoot, branch);
      record.stages.sharedPush = { status: 'completed' };
    } else {
      record.stages.sharedPush = { status: 'completed', skipped: true };
    }
    saveBatchFinishRecord(repoRoot, changeSlug, record);
  }

  // Stage 6: Reach 'completed' (D21)
  record.status = 'completed';
  saveBatchFinishRecord(repoRoot, changeSlug, record);

  return {
    status: 'completed',
    batchExecutionId,
    record,
  };
}
