// Main batch-start execution operation (Task 03, D28, D29, D32, D33, D34, D37, D38, D39).
// Pure workflow domain logic: zero dashboard imports.

import { requireChange, requireTask, ACTIVE_DIR } from '../../store.mjs';
import '../actions/index.mjs';
import { loadWorkflowDefinition } from '../definitions/loader.mjs';
import { getGroupReservation } from '../queue/reservation.mjs';
import { assertBaseExecutionReadiness } from '../readiness-policy.mjs';
import { resolveIncomingExecution } from '../resolve-incoming-execution.mjs';
import { ensureStepActivated, compileStepContext } from '../step-context.mjs';
import { resolveWorkflowPosition } from '../step-runner.mjs';
import { preflightBatchCapacity } from './preflight.mjs';
import {
  createBatchStartRecord,
  loadBatchStartRecord,
  saveBatchStartRecord,
} from './record.mjs';
import { recordWorkspaceBaseline } from './workspace-baseline.mjs';
import { buildBatchContext } from '../../context/batch-context.mjs';
import { WorkflowError } from '../errors.mjs';

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

  // 2. Trusted identity verification (D33, Issue #5 fix, Issue #6 fix).
  // The session id must come from the caller — resolved from the trusted execution environment
  // (env vars set by the provider, Codex bridge, etc.) — never from CLI arguments.
  // The --batch value is a durable correlation key only; it is never authority by itself.
  const effectiveSessionId = explicitSessionId !== undefined ? explicitSessionId : null;

  // Resolve binding service once: prefer caller-injected; fall back via dynamic import.
  // Dynamic import avoids a static module-level dependency from workflow/core onto dashboard/server.
  let effectiveBindingService = bindingService || null;
  if (!effectiveBindingService) {
    try {
      const { createAgentSessionBindingService } = await import('../../../dashboard/server/ai/sessions/binding-service.mjs');
      effectiveBindingService = createAgentSessionBindingService(repoRoot);
    } catch {}
  }

  // Fail-closed identity check: when a sessionId is present, verify it matches the reservation.
  if (effectiveSessionId && effectiveBindingService) {
    let session = null;
    try {
      session = effectiveBindingService.getSessionSync(effectiveSessionId);
    } catch {}
    if (session) {
      // Verify batchExecutionId matches if already persisted on the session
      if (session.batchExecutionId && session.batchExecutionId !== batchExecutionId) {
        throw new WorkflowError(
          `Session '${effectiveSessionId}' batchExecutionId '${session.batchExecutionId}' does not match reservation '${batchExecutionId}'`,
          { code: 'BATCH_IDENTITY_MISMATCH', sessionId: effectiveSessionId }
        );
      }
      // Verify scope if present
      if (session.executionScope) {
        if (session.executionScope.kind !== 'task-batch') {
          throw new WorkflowError(
            `Session '${effectiveSessionId}' executionScope kind is '${session.executionScope.kind}', expected 'task-batch'`,
            { code: 'BATCH_IDENTITY_MISMATCH', sessionId: effectiveSessionId }
          );
        }
        if (!arraysEqual(session.executionScope.taskIds, taskIds)) {
          throw new WorkflowError(
            `Session '${effectiveSessionId}' taskIds do not match reservation '${batchExecutionId}'`,
            { code: 'BATCH_IDENTITY_MISMATCH', sessionId: effectiveSessionId }
          );
        }
      }
    }
  }

  // 3. Pre-activation re-verification across all members (D37)
  const memberTasks = [];
  let targetStepName = null;

  for (const taskId of taskIds) {
    const task = requireTask(change, taskId);
    memberTasks.push(task);

    // Underlying workflow eligibility check (dependencies, suspensions, executor, prior finish)
    assertBaseExecutionReadiness(task, change, 'agent', { definition, repoRoot });

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

    const incoming = resolveIncomingExecution(task, definition, targetStepName);
    if (!incoming.transition) {
      throw new WorkflowError(
        `No valid incoming transition found for task '${taskId}' to step '${targetStepName}'`,
        { code: 'NO_INCOMING_TRANSITION', taskId, targetStepName }
      );
    }

    if (incoming.session !== 'fresh') {
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
  for (const taskId of taskIds) {
    const stage = record.memberStages?.[taskId];
    if (stage?.status === 'completed') {
      continue;
    }

    const task = requireTask(change, taskId);
    ensureStepActivated(change, task, definition, { repoRoot, activeDir });

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
    tasks: memberTasks,
    definition,
    targetStepName,
    memberStepContexts,
    reservation,
    repoRoot,
    bindingService: effectiveBindingService,
  });

  // 10. Persist lineage onto AgentSession if bound (D8)
  if (effectiveSessionId && effectiveBindingService) {
    try {
      effectiveBindingService.updateSessionLineageSync(
        effectiveSessionId,
        {
          predecessorSessions: batchContext.predecessorSessions,
          parentSessionId: null,
        },
        { specId: change.id || change._slug }
      );
    } catch {}
  }


  // 11. Mark operation record completed
  record.status = 'completed';
  saveBatchStartRecord(repoRoot, changeSlug, record);

  return {
    batchExecutionId,
    batchContext,
    workspaceBaseline,
  };
}
