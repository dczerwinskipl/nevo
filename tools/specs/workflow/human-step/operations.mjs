// Domain operations for human-owned workflow steps.
// Encapsulates executor-gated activation (startHumanStep) and result submission (submitHumanStepResult).

import { CliError } from '../../../lib/cli-errors.mjs';
import { WorkflowError } from '../errors.mjs';
import { resolveWorkflowMode } from '../compatibility.mjs';
import { resolveWorkflowPosition } from '../step-runner.mjs';
import { ensureStepActivated } from '../step-context.mjs';
import { finishStep } from '../finish-operation.mjs';
import { assertStepExecutor } from '../executor-guard.mjs';
import { findInFlightOperationRecord } from '../operation-record.mjs';
import { assertExecutionReadiness } from '../readiness-policy.mjs';

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
