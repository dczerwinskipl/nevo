// Main batch-start execution operation (Task 03, D28, D29, D32, D33, D34, D37, D38, D39).
// Pure workflow domain logic: zero dashboard imports.

import { requireChange, requireTask, ACTIVE_DIR } from '../../store.mjs';
import '../actions/index.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import { getGroupReservation } from '../queue/reservation.mjs';
import { resolveIncomingExecution } from '../resolve-incoming-execution.mjs';
import { ensureStepActivated, compileStepContext } from '../step-context.mjs';
import { resolveWorkflowPosition } from '../step-runner.mjs';
import { evaluateDependencySatisfaction } from '../dependency-satisfaction.mjs';
import {
  planStart,
  loadStartOperation,
  findInFlightStartOperation,
  completeActivateStage,
} from '../start-operation.mjs';
import { preflightBatchCapacity } from './preflight.mjs';
import {
  createBatchStartRecord,
  loadBatchStartRecord,
  saveBatchStartRecord,
} from './record.mjs';
import { recordWorkspaceBaseline } from './workspace-baseline.mjs';
import { buildBatchContext } from '../../context/batch-context.mjs';
import { WorkflowError } from '../errors.mjs';
import { getWorkspaceWriterClaim } from '../workspace-writer.mjs';
import { verifyBatchTrustedIdentity, updatePersistedSessionLineageSync } from '../execution-identity.mjs';
import { resolveStableSpecId } from '../../identity.mjs';

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Executes the batch-scoped step start operation (D33).
 *
 * @param {object} params
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string} [params.sessionId] - Trusted session id (resolved by caller from ambient execution context)
 * @param {object} [params.bindingService] - Optional session binding service (passed in from dashboard layer, not imported here)
 * @param {string} [params.repoRoot]
 * @param {string} [params.activeDir]
 * @param {boolean} [params.silent]
 * @returns {Promise<{ batchExecutionId: string, batchContext: object, workspaceBaseline: object }>}
 */
export async function executeBatchStart(params = {}) {
  const {
    changeSlug,
    batchExecutionId,
    sessionId: explicitSessionId,
    bindingService,
    repoRoot = process.cwd(),
    activeDir = ACTIVE_DIR,
  } = params;

  if (!changeSlug || !batchExecutionId) {
    throw new WorkflowError('executeBatchStart requires changeSlug and batchExecutionId', {
      code: 'INVALID_ARGUMENTS',
    });
  }

  const change = requireChange(changeSlug, activeDir);
  const definition = loadWorkflowDefinition(change.workflow?.definition, { repoRoot });

  // 1. Load durable group reservation
  const reservation = getGroupReservation(repoRoot, changeSlug, batchExecutionId);
  if (!reservation || reservation.status !== 'reserved') {
    throw new WorkflowError(
      `Batch reservation '${batchExecutionId}' not found or not in reserved state for change '${changeSlug}'`,
      { code: 'RESERVATION_NOT_ACTIVE', batchExecutionId, changeSlug }
    );
  }

  const taskIds = reservation.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    throw new WorkflowError(`Reservation '${batchExecutionId}' has invalid taskIds`, {
      code: 'INVALID_RESERVATION',
      taskIds,
    });
  }

  if (Array.isArray(params.taskIds)) {
    if (!arraysEqual(params.taskIds, taskIds)) {
      throw new WorkflowError(
        `Supplied taskIds do not match reserved batch execution scope: expected [${taskIds.join(', ')}], got [${params.taskIds.join(', ')}]`,
        { code: 'EXECUTION_SCOPE_MISMATCH', expected: taskIds, actual: params.taskIds }
      );
    }
  }

  // 2. Trusted identity verification (D23, D33) — fail closed before any activation
  const specId = resolveStableSpecId(change);
  const { effectiveSessionId } = verifyBatchTrustedIdentity({
    repoRoot,
    changeSlug,
    specId,
    batchExecutionId,
    sessionId: explicitSessionId,
    taskIds,
    reservation,
    getClaim: getWorkspaceWriterClaim,
  });

  // 3. Pre-activation re-verification across all members (D37)
  // The per-member single-task readiness replay (assertBaseExecutionReadiness) is
  // deliberately not repeated here — validateBatchCompatibility, run when this
  // reservation was created, is already authoritative for the in-batch-dependency
  // exception (batch-execution-generalization, task 02); re-deriving single-task rules
  // here would reject a member whose only blocker is another member of this same batch.
  const memberTasks = [];
  let targetStepName = null;

  for (const taskId of taskIds) {
    const task = requireTask(change, taskId);
    memberTasks.push(task);

    // Incoming transition resolution
    const pos = resolveWorkflowPosition(definition, task);
    const stepName = pos.phase === 'new' ? definition.entryStep : (pos.phase === 'active' ? pos.step : pos.nextStep);
    if (!targetStepName) {
      targetStepName = stepName;
    } else if (targetStepName !== stepName) {
      throw new WorkflowError(
        `Target step mismatch: task '${taskId}' targets '${stepName}', but batch targets '${targetStepName}'`,
        { code: 'TARGET_STEP_MISMATCH', taskId, stepName, targetStepName }
      );
    }

    const history = task?.workflow_progress?.history || [];
    const incoming = resolveIncomingExecution(task, definition, targetStepName);
    if (!incoming.transition) {
      // An entry-step member (no workflow history at all) has no incoming transition to
      // resolve, by construction — this is the normal case for a fresh task, not a
      // failure. It starts fresh, by construction `session: fresh`, so there is nothing
      // further to validate here (batch-execution-generalization, task 02, Gap 1).
      if (!(incoming.error === 'NO_INCOMING_TRANSITION' && history.length === 0)) {
        throw new WorkflowError(
          `No valid incoming transition found for task '${taskId}' to step '${targetStepName}'`,
          { code: 'NO_INCOMING_TRANSITION', taskId, targetStepName }
        );
      }
    } else if (incoming.session !== 'fresh') {
      throw new WorkflowError(
        `Incoming transition for task '${taskId}' requires session '${incoming.session}'; batch execution requires 'fresh'`,
        { code: 'INVALID_SESSION_SEMANTICS', taskId }
      );
    }
  }

  // 4. Non-mutating context-capacity preflight (D34, D38)
  const preflight = preflightBatchCapacity({
    change,
    tasks: memberTasks,
    reservation,
    definition,
  });

  if (!preflight.passed) {
    throw new WorkflowError(preflight.reason, {
      code: preflight.code || 'BATCH_CONTEXT_TOO_LARGE',
      estimatedContextTokensUpperBound: preflight.estimatedContextTokensUpperBound,
      maxContextTokens: preflight.maxContextTokens,
    });
  }

  // 5. Durable batch-start operation record (D28, D38)
  let record = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
  if (!record) {
    record = createBatchStartRecord({
      repoRoot,
      changeSlug,
      batchExecutionId,
      executionScope: { kind: 'task-batch', taskIds: [...taskIds] },
      sessionId: effectiveSessionId,
      executionConfigSnapshot: reservation.executionConfigSnapshot,
      preflight,
      memberStages: {},
    });
  }

  // 6. Sequential idempotent member activation (D37)
  const targetStepConfig = definition.steps?.[targetStepName];
  for (const taskId of taskIds) {
    const stage = record.memberStages?.[taskId];
    if (stage?.status === 'completed') {
      continue;
    }

    const task = requireTask(change, taskId);
    const memberAttempt = (task.workflow_progress?.history || []).filter(h => h.step === targetStepName).length + 1;

    // Dependency-consumption allocation (Gap 6, start half — batch-execution-
    // generalization, task 02): allocate and freeze this member's own
    // consumptionSequence before its own activation, reusing planStart exactly as the
    // single-task path does (cli.mjs's handleWorkflowStepStart). An external dependency
    // (outside this batch) already has a real releaseEpoch by construction — the batch
    // would not have been admitted otherwise, per validateBatchCompatibility's in-batch
    // exception — so it is snapshotted now. A dependency that is itself a member of this
    // same batch has no releaseEpoch yet (its own implementation hasn't happened) and is
    // recorded as a pending entry; task 04 materializes it at batch-finish time using
    // this exact, already-allocated consumptionSequence. recordDependencyConsumption
    // itself is intentionally not called yet for pending entries — only allocation
    // happens here.
    if (targetStepConfig?.consumesDependencies === true) {
      const existingStartOp = loadStartOperation(repoRoot, changeSlug, taskId, targetStepName, memberAttempt)
        || findInFlightStartOperation(repoRoot, changeSlug, taskId);

      if (!existingStartOp) {
        const dependencySnapshot = [];
        const dependsOn = Array.isArray(task.depends_on) ? task.depends_on : [];
        for (const depId of dependsOn) {
          if (taskIds.includes(depId)) {
            dependencySnapshot.push({ taskId: depId, releaseEpoch: null, pending: true });
            continue;
          }
          const depTask = change.tasks?.find(t => t.id === depId) || (() => { try { return requireTask(change, depId); } catch { return null; } })();
          if (depTask) {
            const evalResult = evaluateDependencySatisfaction(depTask, change, definition);
            if (evalResult.releaseEpoch) {
              dependencySnapshot.push({ taskId: depId, releaseEpoch: evalResult.releaseEpoch });
            }
          }
        }

        planStart({
          repoRoot,
          change: changeSlug,
          task: taskId,
          step: targetStepName,
          attempt: memberAttempt,
          dependencySnapshot,
        });
      }
    }

    ensureStepActivated(change, task, definition, { repoRoot, activeDir });

    if (targetStepConfig?.consumesDependencies === true) {
      const startOp = loadStartOperation(repoRoot, changeSlug, taskId, targetStepName, memberAttempt);
      if (startOp) {
        completeActivateStage(repoRoot, startOp);
      }
    }

    const reloaded = requireTask(change, taskId);
    const pos = resolveWorkflowPosition(definition, reloaded);

    record.memberStages = record.memberStages || {};
    record.memberStages[taskId] = {
      status: 'completed',
      step: pos.step,
      attempt: pos.attempt,
      activatedAt: new Date().toISOString(),
    };
    saveBatchStartRecord(repoRoot, changeSlug, record);

    if (params._crashAfterTaskId === taskId) {
      throw new Error(`SIMULATED_CRASH_AFTER_${taskId}`);
    }
  }

  // 7. Post-bootstrap workspace baseline (D29, D39)
  const workspaceBaseline = recordWorkspaceBaseline(repoRoot);
  record.workspaceBaseline = workspaceBaseline;
  saveBatchStartRecord(repoRoot, changeSlug, record);

  // 8. Compile StepContext for each member
  const memberStepContexts = {};
  for (const taskId of taskIds) {
    const task = requireTask(change, taskId);
    const sc = await compileStepContext({
      change,
      task,
      definition,
      context: { repoRoot, activeDir },
    });
    memberStepContexts[taskId] = sc;
  }

  // 9. Build full BatchContext (D32)
  const batchContext = buildBatchContext({
    change,
    specId,
    tasks: memberTasks,
    definition,
    targetStepName,
    memberStepContexts,
    reservation,
    repoRoot,
    bindingService: params.bindingService,
  });

  // 10. Persist lineage onto AgentSession if bound (D8)
  if (effectiveSessionId) {
    try {
      if (params.bindingService?.updateSessionLineageSync) {
        params.bindingService.updateSessionLineageSync(
          effectiveSessionId,
          {
            predecessorSessions: batchContext.predecessorSessions,
            parentSessionId: null,
          },
          { specId }
        );
      } else {
        updatePersistedSessionLineageSync(
          repoRoot,
          effectiveSessionId,
          {
            predecessorSessions: batchContext.predecessorSessions,
            parentSessionId: null,
          },
          { specId }
        );
      }
    } catch {}
  }


  // 11. Mark operation record completed
  record.batchContext = batchContext;
  record.status = 'completed';
  saveBatchStartRecord(repoRoot, changeSlug, record);

  return {
    batchExecutionId,
    batchContext,
    workspaceBaseline,
  };
}
