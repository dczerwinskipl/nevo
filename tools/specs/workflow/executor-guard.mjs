// Invariant guard enforcing workflow step executor ownership.
// Reused by CLI step start/finish and human step operations.

import { WorkflowError } from './errors.mjs';

/**
 * Derives available actions descriptor from a step's transitions.
 *
 * @param {object} step - Workflow step configuration
 * @returns {Array<object>} List of available actions with labels, results, and feedback requirements
 */
export function deriveAvailableActions(step) {
  if (!Array.isArray(step?.transitions)) return [];
  const isConditional = step.transitions.length > 1 || step.transitions.some(t => t.value !== undefined);
  return step.transitions.map(t => {
    const action = {};
    if (isConditional && t.value !== undefined) {
      action.result = t.value;
      action.value = t.value;
    }
    if (t.action?.label) {
      action.label = t.action.label;
    }
    action.feedbackRequired = Boolean(t.action?.feedback?.required);
    if (t.action?.feedback !== undefined) {
      action.feedback = t.action.feedback;
    }
    if (t.to) {
      action.to = t.to;
    }
    return action;
  });
}

/**
 * Error thrown when a caller attempts to execute a workflow step owned by a different executor.
 */
export class WorkflowStepExecutorMismatchError extends WorkflowError {
  constructor({
    stepId,
    executor,
    callerKind,
    purpose,
    expectedWork,
    availableActions = [],
    message,
  }) {
    const defaultMsg = callerKind === 'agent'
      ? `Step '${stepId}' is owned by a human and cannot be started by an agent. Human action is required. Do not execute, simulate, or complete this step.`
      : `Step '${stepId}' is owned by an agent and cannot be started or executed by a human.`;
    const finalMessage = message || defaultMsg;
    super(finalMessage, {
      code: 'WORKFLOW_STEP_EXECUTOR_MISMATCH',
      stepId,
      executor,
      callerKind,
      purpose,
      expectedWork,
      availableActions,
    });
    this.name = 'WorkflowStepExecutorMismatchError';
    this.code = 'WORKFLOW_STEP_EXECUTOR_MISMATCH';
    this.stepId = stepId;
    this.executor = executor;
    this.callerKind = callerKind;
    this.purpose = purpose;
    this.expectedWork = expectedWork;
    this.availableActions = availableActions;
  }
}

/**
 * Asserts that a workflow step's executor matches the expected caller kind.
 * Throws a structured WorkflowStepExecutorMismatchError if they differ.
 *
 * @param {object} step - Normalized step definition
 * @param {'agent' | 'human'} callerKind - Identity of the caller attempting the operation
 * @param {object} [options]
 * @param {string} [options.stepId] - Identifier of the step
 * @throws {WorkflowStepExecutorMismatchError}
 */
export function assertStepExecutor(step, callerKind, options = {}) {
  const stepId = options.stepId ?? step?.id ?? 'unknown';
  const executor = step?.executor ?? 'agent';
  if (executor !== callerKind) {
    throw new WorkflowStepExecutorMismatchError({
      stepId,
      executor,
      callerKind,
      purpose: step?.purpose,
      expectedWork: step?.expectedWork,
      availableActions: deriveAvailableActions(step),
    });
  }
}
