// Domain operations for human-owned workflow steps.
// Encapsulates executor-gated activation (startHumanStep) and result submission (submitHumanStepResult).

import { randomUUID } from 'node:crypto';
import { CliError } from '../../../lib/cli-errors.mjs';
import { WorkflowError } from '../errors.mjs';
import { resolveWorkflowMode } from '../compatibility.mjs';
import { resolveWorkflowPosition } from '../step-runner.mjs';
import { ensureStepActivated } from '../step-context.mjs';
import { finishStep } from '../finish-operation.mjs';
import { assertStepExecutor } from '../executor-guard.mjs';
import { findInFlightOperationRecord } from '../operation-record.mjs';
import { assertExecutionReadiness } from '../readiness-policy.mjs';
import { ROOT } from '../../store.mjs';
import {
  acquireWorkspaceWriter,
  releaseWorkspaceWriterIfOwned,
  markWorkspaceWriterRecoveryRequiredIfOwned,
} from '../workspace-writer.mjs';
import {
  createWorkspaceRequest,
  transitionWorkspaceRequest,
  loadWorkspaceRequest,
} from '../workspace-request.mjs';
import {
  acquireGitFinalizeLease,
  releaseGitFinalizeLease,
} from '../git-finalize-lock.mjs';
import { assessExecutionSettlement } from '../execution-settlement.mjs';
import {
  loadHumanSubmitOperation,
  createHumanSubmitOperationRecord,
  updateHumanSubmitOperationStatus,
} from './submit-request.mjs';
import { registerRequestKindReconciler } from '../workspace-claim-reconciliation.mjs';

// Register kind-specific reconciler for human-submit at module load (D88, D95)
registerRequestKindReconciler('human-submit', async ({ repoRoot, operationRef }) => {
  if (!operationRef) {
    return { settled: false, reason: 'missing-operation-ref' };
  }
  const { change, task, step, attempt } = operationRef;
  const settlement = await assessExecutionSettlement({
    repoRoot,
    changeSlug: change,
    taskId: task,
  });

  const record = loadHumanSubmitOperation({
    repoRoot,
    changeSlug: change,
    taskId: task,
    step,
    attempt,
  });

  if (settlement.settled && (record?.status === 'completed' || record?.status === 'failed')) {
    return {
      settled: true,
      terminalStatus: record.status,
    };
  }

  return {
    settled: false,
    reason: settlement.settled ? 'operation-record-not-terminal' : settlement.reason,
    reconciliationRequired: true,
  };
});

/**
 * Activates a human-owned workflow step after verifying mode and executor guards.
 * Does not bind an AI execution session.
 *
 * @param {object} change - Change manifest
 * @param {object} task - Task record
 * @param {object} definition - Normalized workflow definition
 * @param {object} [context] - Execution context (repoRoot, activeDir, etc.)
 * @returns {{ task: object, position: object }} Result of ensureStepActivated
 * @throws {CliError} if change is legacy mode
 * @throws {WorkflowStepExecutorMismatchError} if step is not human-owned
 */
export function startHumanStep(change, task, definition, context = {}) {
  const workflowMode = resolveWorkflowMode(change, { activeDir: context?.activeDir, repoRoot: context?.repoRoot });
  if (workflowMode.mode === 'legacy') {
    throw new CliError(
      `Cannot run deterministic command 'startHumanStep' against legacy specification '${change._slug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }

  assertExecutionReadiness(task, change, 'human', { definition, repoRoot: context?.repoRoot });

  return ensureStepActivated(change, task, definition, context);
}

/**
 * Submits the decision/result for an active human-owned workflow step after verifying
 * mode and executor guards, validating required feedback before any mutation,
 * and delegates to finishStep.
 *
 * @param {object} change - Change manifest
 * @param {object} task - Task record
 * @param {object} definition - Normalized workflow definition
 * @param {object} [context] - Execution context
 * @param {object} [inputs] - { result, feedback, artifacts, ...extraInputs }
 * @returns {Promise<object>} Result of finishStep
 * @throws {CliError} if change is legacy mode
 * @throws {WorkflowStepExecutorMismatchError} if step is not human-owned
 * @throws {WorkflowError} if no step is active, result is unexpected on unconditional step, or required feedback is missing
 */
export async function submitHumanStepResult(
  change,
  task,
  definition,
  context = {},
  { result, feedback, artifacts, ...extraInputs } = {}
) {
  const workflowMode = resolveWorkflowMode(change, { activeDir: context?.activeDir, repoRoot: context?.repoRoot });
  if (workflowMode.mode === 'legacy') {
    throw new CliError(
      `Cannot run deterministic command 'submitHumanStepResult' against legacy specification '${change._slug || change.id}'. ` +
      `Use legacy command surface instead: approve, start, complete, verify.`
    );
  }

  const changeSlug = change._slug || change.id;
  const inFlight = context.repoRoot ? findInFlightOperationRecord(context.repoRoot, changeSlug, task.id) : null;
  const position = inFlight ? null : resolveWorkflowPosition(definition, task);
  const activeStepName = inFlight ? inFlight.step : (position?.phase === 'active' ? position.step : null);

  if (!activeStepName) {
    if (position?.phase === 'terminal' || position?.phase === 'completed') {
      const lastStepName = task?.workflow_progress?.current_step || null;
      const lastStep = definition.steps?.[lastStepName];
      if (lastStep) {
        assertStepExecutor(lastStep, 'human', { stepId: lastStepName });
      }
      return await finishStep({
        change,
        task,
        definition,
        context,
        inputs: {
          ...(result !== undefined ? { result } : {}),
          ...(feedback !== undefined ? { feedback } : {}),
          ...(artifacts !== undefined ? { artifacts } : {}),
          ...extraInputs,
        },
        activeDir: context?.activeDir,
        gateRegistry: context?.gateRegistry,
      });
    }

    throw new WorkflowError(
      `No step is currently active for task '${task.id}' in change '${changeSlug}' (phase: '${position?.phase}')`,
      { code: 'NO_ACTIVE_STEP', step: activeStepName }
    );
  }

  const step = definition.steps?.[activeStepName];
  if (!step) {
    throw new WorkflowError(
      `Active step '${activeStepName}' not found in workflow definition '${definition?.id}'`,
      { code: 'STEP_NOT_FOUND', step: activeStepName }
    );
  }

  assertStepExecutor(step, 'human', { stepId: activeStepName });

  const transitions = step.transitions || [];
  const isConditional = transitions.length > 1 || transitions.some(t => t.value !== undefined);

  if (isConditional && !result) {
    throw new WorkflowError(
      `Step '${activeStepName}' requires a transition result (${transitions.map(t => t.value).filter(Boolean).join(', ')})`,
      { code: 'MISSING_REQUIRED_INPUT', step: activeStepName }
    );
  }

  if (!isConditional) {
    if (result !== undefined) {
      throw new WorkflowError(
        `Step '${activeStepName}' has a single unconditional transition and does not accept a result (received '${result}')`,
        { code: 'UNEXPECTED_TRANSITION_RESULT', step: activeStepName, result }
      );
    }
  }

  const selectedTransition = isConditional
    ? transitions.find(t => t.value === result)
    : transitions[0];

  if (selectedTransition?.action?.feedback?.required) {
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      throw new WorkflowError(
        `Feedback is required for transition '${selectedTransition.action?.label || selectedTransition.value || 'unconditional'}' on step '${activeStepName}'`,
        { code: 'REQUIRED_FEEDBACK_MISSING', step: activeStepName, transition: selectedTransition }
      );
    }
  }

  const finishInputs = {
    ...(result !== undefined ? { result } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
    ...(artifacts !== undefined ? { artifacts } : {}),
    ...extraInputs,
  };

  // Provide a clean default commit.title if step has commit-and-push and caller didn't pass one
  if (step.finalize?.some(f => f.id === 'commit-and-push') && !finishInputs['commit.title']) {
    const actionLabel = selectedTransition?.action?.label || result || 'confirm';
    finishInputs['commit.title'] = `verify(${task.id}): ${actionLabel}`;
  }

  return await finishStep({
    change,
    task,
    definition,
    context,
    inputs: finishInputs,
    activeDir: context?.activeDir,
    gateRegistry: context?.gateRegistry,
  });
}

/**
 * Combined human step activation and decision submission operation (Task 29, D47, D63, D73, D87, D90, D94).
 * Durable operation record first, paired workspace-request, claims workspace-writer and git-finalize lease,
 * releases only upon proven settlement.
 *
 * @param {object} change - Change manifest
 * @param {object} task - Task record
 * @param {object} definition - Normalized workflow definition
 * @param {object} [context] - Execution context
 * @param {object} [inputs] - { result, feedback, artifacts, ...extraInputs }
 * @returns {Promise<object>} Result of submission
 */
export async function activateAndSubmitHumanStep(
  change,
  task,
  definition,
  context = {},
  inputs = {}
) {
  const repoRoot = context.repoRoot || ROOT;
  const changeSlug = change._slug || change.id;
  const inFlight = repoRoot ? findInFlightOperationRecord(repoRoot, changeSlug, task.id) : null;
  const position = inFlight ? null : resolveWorkflowPosition(definition, task);
  const stepName = inFlight
    ? inFlight.step
    : (position?.phase === 'active'
        ? position.step
        : (position?.phase === 'new'
            ? definition.entryStep
            : (position?.nextStep?.id || position?.nextStep || position?.step)));

  const attempt = inFlight
    ? inFlight.attempt
    : (position?.attempt || (task.workflow_progress?.history || []).filter(h => h.step === stepName).length + 1);

  // Validate step executor guard before any lock acquisition or durable write
  const step = definition.steps?.[stepName];
  if (step) {
    assertStepExecutor(step, 'human', { stepId: stepName });
  }

  // Pre-validate conditional transition feedback if declared required
  const transitions = step?.transitions || [];
  const isConditional = transitions.length > 1 || transitions.some(t => t.value !== undefined);
  const selectedTransition = isConditional
    ? transitions.find(t => t.value === inputs.result)
    : transitions[0];

  if (selectedTransition?.action?.feedback?.required) {
    if (!inputs.feedback || typeof inputs.feedback !== 'string' || inputs.feedback.trim().length === 0) {
      throw new WorkflowError(
        `Feedback is required for transition '${selectedTransition.action?.label || selectedTransition.value || 'unconditional'}' on step '${stepName}'`,
        { code: 'REQUIRED_FEEDBACK_MISSING', step: stepName, transition: selectedTransition }
      );
    }
  }

  // 1. Classification via exact durable key (D90, D94, D96)
  const existingOp = loadHumanSubmitOperation({
    repoRoot,
    changeSlug,
    taskId: task.id,
    step: stepName,
    attempt,
  });

  if (existingOp) {
    const isSameDecision =
      existingOp.result === inputs.result &&
      (existingOp.feedback || '') === (inputs.feedback || '');

    if (existingOp.status === 'pending') {
      if (isSameDecision) {
        return {
          ok: true,
          status: 'pending',
          requestId: existingOp.requestId,
          idempotent: true,
        };
      }
      throw new WorkflowError(
        `Conflicting human decision already pending for task '${task.id}'`,
        { code: 'HUMAN_DECISION_CONFLICT', step: stepName, attempt }
      );
    }

    if (existingOp.status === 'completed' || existingOp.status === 'failed') {
      if (isSameDecision) {
        return {
          ok: existingOp.status === 'completed',
          status: existingOp.status,
          requestId: existingOp.requestId,
          idempotent: true,
          result: existingOp.result,
        };
      }
      throw new WorkflowError(
        `Cannot submit differing decision against already-terminal human-submit attempt`,
        { code: 'HUMAN_DECISION_CONFLICT', step: stepName, attempt }
      );
    }
  }

  // 2. Persist durable operation record (status: 'pending') (D73)
  const requestId = randomUUID();
  const op = createHumanSubmitOperationRecord({
    repoRoot,
    changeSlug,
    taskId: task.id,
    step: stepName,
    attempt,
    result: inputs.result,
    feedback: inputs.feedback,
    inputs,
    requestId,
  });

  // 3. Create paired workspace-request (status: 'queued') (D91)
  const operationRef = { change: changeSlug, task: task.id, step: stepName, attempt };
  const req = await createWorkspaceRequest({
    repoRoot,
    requestId,
    kind: 'human-submit',
    specId: change.id || changeSlug,
    taskId: task.id,
    operationRef,
  });

  // 4. Acquire workspace writer (D55, D82)
  let acquireRes = await acquireWorkspaceWriter({
    repoRoot,
    kind: 'human-submit',
    requestId,
    operationRef,
    specId: change.id || changeSlug,
    taskId: task.id,
  });

  if (!acquireRes.acquired) {
    if (acquireRes.blocked) {
      await transitionWorkspaceRequest({
        repoRoot,
        requestId,
        expectedStatus: ['queued', 'waiting-for-workspace'],
        to: 'blocked-by-recovery',
      });
      throw new WorkflowError('Workspace writer is blocked by recovery-required', {
        code: 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY',
        currentClaim: acquireRes.currentClaim,
      });
    }

    await transitionWorkspaceRequest({
      repoRoot,
      requestId,
      expectedStatus: ['queued', 'waiting-for-workspace'],
      to: 'waiting-for-workspace',
    });

    const deadline = Date.now() + (context.acquisitionTimeoutMs || 30000);
    while (!acquireRes.acquired && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
      acquireRes = await acquireWorkspaceWriter({
        repoRoot,
        kind: 'human-submit',
        requestId,
        operationRef,
        specId: change.id || changeSlug,
        taskId: task.id,
      });
      if (acquireRes.blocked) {
        await transitionWorkspaceRequest({
          repoRoot,
          requestId,
          expectedStatus: ['queued', 'waiting-for-workspace'],
          to: 'blocked-by-recovery',
        });
        throw new WorkflowError('Workspace writer is blocked by recovery-required', {
          code: 'WORKSPACE_WRITER_BLOCKED_BY_RECOVERY',
          currentClaim: acquireRes.currentClaim,
        });
      }
    }

    if (!acquireRes.acquired) {
      throw new WorkflowError('Timed out waiting for workspace writer slot', {
        code: 'WORKSPACE_WRITER_TIMEOUT',
      });
    }
  }

  // 5. CAS transition workspace-request to 'running' (D83)
  const casRes = await transitionWorkspaceRequest({
    repoRoot,
    requestId,
    expectedStatus: ['queued', 'waiting-for-workspace'],
    to: 'running',
    workspaceOwnerId: acquireRes.ownerId,
  });

  if (!casRes.transitioned) {
    await releaseWorkspaceWriterIfOwned({
      repoRoot,
      expectedOwnerId: acquireRes.ownerId,
      expectedKind: 'human-submit',
      expectedSpecId: change.id || changeSlug,
      expectedTaskId: task.id,
    });
    return loadWorkspaceRequest(repoRoot, requestId);
  }

  // 6. Acquire git-finalize lease (D50, D51)
  const lease = await acquireGitFinalizeLease({
    repoRoot,
    ownerId: acquireRes.ownerId,
  });

  let finishResult;
  let finishError = null;

  try {
    let effectiveTask = task;
    if (position?.phase !== 'active') {
      const act = startHumanStep(change, task, definition, context);
      effectiveTask = act.task;
    }
    finishResult = await submitHumanStepResult(
      change,
      effectiveTask,
      definition,
      { ...context, finalizeLease: lease },
      inputs
    );
  } catch (err) {
    finishError = err;
  } finally {
    if (lease) {
      try {
        await releaseGitFinalizeLease({ repoRoot, ownerId: lease.ownerId });
      } catch {}
    }
  }

  // 7. Assess execution settlement (D60, D87)
  const settlement = await assessExecutionSettlement({
    repoRoot,
    changeSlug,
    taskId: task.id,
    activeDir: context.activeDir,
  });

  if (settlement.settled) {
    const terminalStatus = finishError ? 'failed' : 'completed';
    updateHumanSubmitOperationStatus({
      repoRoot,
      changeSlug,
      taskId: task.id,
      step: stepName,
      attempt,
      status: terminalStatus,
      result: finishResult,
      error: finishError?.message,
    });
    await transitionWorkspaceRequest({
      repoRoot,
      requestId,
      expectedStatus: 'running',
      to: terminalStatus,
    });
    try {
      await releaseWorkspaceWriterIfOwned({
        repoRoot,
        expectedOwnerId: acquireRes.ownerId,
        expectedKind: 'human-submit',
        expectedSpecId: change.id || changeSlug,
        expectedTaskId: task.id,
      });
    } catch {}

    if (finishError) {
      throw finishError;
    }
    return finishResult;
  } else {
    await transitionWorkspaceRequest({
      repoRoot,
      requestId,
      expectedStatus: 'running',
      to: 'reconciliation-required',
    });
    try {
      await markWorkspaceWriterRecoveryRequiredIfOwned({
        repoRoot,
        expectedOwnerId: acquireRes.ownerId,
        expectedKind: 'human-submit',
        expectedSpecId: change.id || changeSlug,
        expectedTaskId: task.id,
      });
    } catch {}
    updateHumanSubmitOperationStatus({
      repoRoot,
      changeSlug,
      taskId: task.id,
      step: stepName,
      attempt,
      status: 'reconciliation-required',
      error: finishError?.message || settlement.reason,
    });
    if (finishError) {
      throw finishError;
    }
    throw new WorkflowError(`Human step execution did not settle: ${settlement.reason}`, {
      code: 'EXECUTION_UNSETTLED',
      settlement,
    });
  }
}
