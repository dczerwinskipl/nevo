// Execution readiness policy (Task 13, D10, D13, D15, D18, D19).
// Composes TaskProjection with the executor guard and activation preconditions.

import { projectTask, resolveDefinition } from './task-projection.mjs';
import { projectSuspensions } from './suspension-projection.mjs';
import { assertStepExecutor } from './executor-guard.mjs';
import { assertCleanWorktreeForNewAttempt } from './step-context.mjs';
import { loadOperationRecord } from './operation-record.mjs';
import { WorkflowError } from './errors.mjs';

/**
 * Evaluates whether a task is ready for execution by a specific caller kind ('agent' | 'human').
 * Pure evaluation function consuming TaskProjection and activation preconditions.
 *
 * Fails closed when:
 * 1. Task is draft / unpublished (state === 'draft')
 * 2. Dependency is unsatisfied (state === 'blocked')
 * 3. Workflow is terminal (state === 'terminal')
 * 4. Step executor mismatches caller kind
 * 5. Activation preconditions reject (dirty worktree or unsettled prior finish)
 *
 * @param {object} task - Task object
 * @param {object} change - Change manifest
 * @param {'agent'|'human'} [callerKind='agent'] - Caller kind attempting activation
 * @param {object} [options]
 * @param {string} [options.repoRoot] - Repository root for dirty worktree and operation checks
 * @param {object} [options.definition] - Optional pre-loaded workflow definition
 * @returns {{ ready: boolean, code: string|null, reason: string|null, projection?: object, targetStep?: object, blockedBy?: string[], dirtyFiles?: string[], error?: Error }}
 */
export function evaluateExecutionReadiness(task, change, callerKind = 'agent', options = {}) {
  const projection = projectTask(task, change, options);

  // 1. Unpublished / Draft
  if (projection.state === 'draft') {
    return {
      ready: false,
      code: 'TASK_UNPUBLISHED',
      reason: `Task '${task?.id}' is draft and has not been published for execution`,
      projection,
    };
  }

  // 2. Unsatisfied dependencies
  if (projection.state === 'blocked') {
    const blockedList = projection.blockedBy.join(', ');
    return {
      ready: false,
      code: 'DEPENDENCY_UNSATISFIED',
      reason: `Task '${task?.id}' is blocked by unsatisfied dependencies: ${blockedList}`,
      blockedBy: projection.blockedBy,
      projection,
    };
  }

  // 3. Workflow is terminal
  if (projection.state === 'terminal') {
    return {
      ready: false,
      code: 'WORKFLOW_TERMINAL',
      reason: `Task '${task?.id}' workflow has already completed with terminal outcome '${projection.terminalOutcome}'`,
      terminalOutcome: projection.terminalOutcome,
      terminalStatus: projection.terminalStatus,
      projection,
    };
  }

  // 3b. Active non-advisory suspensions from remediation groups (D44)
  const suspensions = options.suspensions || (options.repoRoot && task && change ? projectSuspensions(task, change, options) : []);
  const activeSuspension = suspensions.find(s => !s.advisory);
  if (activeSuspension) {
    return {
      ready: false,
      code: 'TASK_SUSPENDED',
      reason: `Task '${task?.id}' is suspended: ${activeSuspension.reason} (group: ${activeSuspension.groupId})`,
      suspensions,
      projection,
    };
  }

  // 4. Resolve target step to activate/resume
  let targetStepId;
  let targetStepExecutor;
  if (projection.state === 'waiting-for-step-start' || projection.state === 'ready') {
    targetStepId = projection.nextStep?.id;
    targetStepExecutor = projection.nextStep?.executor ?? 'agent';
  } else {
    targetStepId = projection.currentStep;
    targetStepExecutor = projection.executor ?? 'agent';
  }

  const definition = resolveDefinition(change, options.definition, options);
  const stepDef = definition?.steps?.[targetStepId];
  const targetStep = stepDef
    ? { id: targetStepId, ...stepDef }
    : { id: targetStepId, executor: targetStepExecutor };

  try {
    assertStepExecutor(targetStep, callerKind, { stepId: targetStepId });
  } catch (err) {
    return {
      ready: false,
      code: err.code || 'WORKFLOW_STEP_EXECUTOR_MISMATCH',
      reason: err.message,
      error: err,
      projection,
      targetStep,
      stepId: err.stepId ?? targetStepId,
      executor: err.executor ?? targetStepExecutor,
      purpose: err.purpose,
      expectedWork: err.expectedWork,
      availableActions: err.availableActions ?? [],
    };
  }

  // 5. Activation preconditions (D13: only for new attempt / step start, not resume)
  if (projection.state === 'ready' || projection.state === 'waiting-for-step-start') {
    if (options.repoRoot) {
      if (projection.state === 'waiting-for-step-start') {
        const changeSlug = change.id || change._slug;
        const priorRecord = loadOperationRecord(
          options.repoRoot,
          changeSlug,
          task.id,
          projection.currentStep,
          projection.currentAttempt
        );
        if (priorRecord && priorRecord.status !== 'completed') {
          return {
            ready: false,
            code: 'FINISH_OPERATION_UNRESOLVED',
            reason: `Step '${projection.currentStep}' has an unresolved finish operation (status: '${priorRecord.status}') — resume it with 'workflow step finish' before starting the next step`,
            projection,
            targetStep,
          };
        }
      }

      try {
        assertCleanWorktreeForNewAttempt(options.repoRoot);
      } catch (err) {
        return {
          ready: false,
          code: err.code || 'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT',
          reason: err.message,
          error: err,
          dirtyFiles: err.dirtyFiles,
          projection,
          targetStep,
        };
      }
    }
  }

  return {
    ready: true,
    code: null,
    reason: null,
    projection,
    targetStep,
    suspensions,
  };
}

/**
 * Asserts that a task is ready for execution, throwing a WorkflowError or WorkflowStepExecutorMismatchError if not.
 *
 * @param {object} task
 * @param {object} change
 * @param {'agent'|'human'} [callerKind='agent']
 * @param {object} [options]
 * @returns {object} Readiness evaluation result
 */
export function assertExecutionReadiness(task, change, callerKind = 'agent', options = {}) {
  const result = evaluateExecutionReadiness(task, change, callerKind, options);
  if (!result.ready) {
    if (result.error) {
      throw result.error;
    }
    throw new WorkflowError(result.reason, {
      code: result.code,
      step: result.targetStep?.id || result.projection?.currentStep,
      blockedBy: result.blockedBy,
      dirtyFiles: result.dirtyFiles,
    });
  }
  return result;
}

export const ExecutionReadiness = {
  evaluate: evaluateExecutionReadiness,
  assert: assertExecutionReadiness,
};
