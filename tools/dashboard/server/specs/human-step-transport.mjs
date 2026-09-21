// Generic HTTP transport handler for human-owned workflow steps (Task 16, D14, D16, D17).
// Calls startHumanStep and submitHumanStepResult directly — never through the legacy CLI handler.

import { ACTIVE_DIR, loadChange } from '../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';
import { resolveWorkflowMode } from '../../../specs/workflow/compatibility.mjs';
import { loadWorkflowDefinition } from '../../../specs/workflow/definitions/loader.mjs';
import { startHumanStep, submitHumanStepResult } from '../../../specs/workflow/human-step/operations.mjs';
import { WorkflowError } from '../../../specs/workflow/errors.mjs';
import { WorkflowStepExecutorMismatchError } from '../../../specs/workflow/executor-guard.mjs';
import { CliError } from '../../../lib/cli-errors.mjs';

export class HumanStepTransportError extends Error {
  constructor(message, { status = 400, code, stepId, executor, allowedResults, blockedBy, details = {} } = {}) {
    super(message);
    this.name = 'HumanStepTransportError';
    this.status = status;
    this.code = code;
    if (stepId !== undefined) this.stepId = stepId;
    if (executor !== undefined) this.executor = executor;
    if (allowedResults !== undefined) this.allowedResults = allowedResults;
    if (blockedBy !== undefined) this.blockedBy = blockedBy;
    this.details = details;
  }
}

/**
 * Executes a human-step action ('start' | 'submit') directly against domain operations.
 *
 * @param {object} options
 * @param {string} options.slug - Specification slug
 * @param {string} options.taskId - Task identifier
 * @param {'start'|'submit'} options.action - Action to perform
 * @param {string} [options.result] - Transition result value (for conditional submit)
 * @param {string} [options.feedback] - Human feedback text
 * @param {unknown} [options.artifacts] - Artifacts payload
 * @param {string} [options.activeDir] - Active specs directory
 * @param {string} [options.root] - Repository root
 * @returns {Promise<{ ok: boolean, action: string, taskId: string, result: unknown }>}
 */
export async function executeHumanStepAction({
  slug,
  taskId,
  action,
  result,
  feedback,
  artifacts,
  activeDir = ACTIVE_DIR,
  root = REPOSITORY_ROOT,
} = {}) {
  if (action !== 'start' && action !== 'submit') {
    throw new HumanStepTransportError("Action must be 'start' or 'submit'.", {
      status: 400,
      code: 'INVALID_ACTION',
    });
  }

  const change = loadChange(slug, activeDir);
  if (!change) {
    throw new HumanStepTransportError(`Specification '${slug}' not found`, {
      status: 404,
      code: 'SPEC_NOT_FOUND',
    });
  }

  const task = change.tasks?.find((t) => t.id === taskId);
  if (!task) {
    throw new HumanStepTransportError(`Task '${taskId}' not found in specification '${slug}'`, {
      status: 404,
      code: 'TASK_NOT_FOUND',
    });
  }

  const resolvedWorkflow = resolveWorkflowMode(change, { activeDir, repoRoot: root });
  if (resolvedWorkflow.mode === 'legacy') {
    throw new HumanStepTransportError(
      `Cannot run human-step action against legacy specification '${slug}'. Use legacy actions instead.`,
      {
        status: 400,
        code: 'LEGACY_WORKFLOW_MODE',
      },
    );
  }

  let definition;
  try {
    definition = loadWorkflowDefinition(resolvedWorkflow.definition, { repoRoot: root });
  } catch (err) {
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: 'DEFINITION_LOAD_ERROR',
    });
  }

  const context = { activeDir, repoRoot: root };

  if (action === 'start') {
    try {
      const activation = startHumanStep(change, task, definition, context);
      return {
        ok: true,
        action: 'start',
        taskId,
        result: activation,
      };
    } catch (err) {
      handleDomainError(err, definition, task);
    }
  }

  if (action === 'submit') {
    try {
      const finishResult = await submitHumanStepResult(
        change,
        task,
        definition,
        context,
        { result, feedback, artifacts },
      );
      return {
        ok: true,
        action: 'submit',
        taskId,
        result: finishResult,
      };
    } catch (err) {
      handleDomainError(err, definition, task, result);
    }
  }
}

function handleDomainError(err, definition, task, attemptedResult) {
  if (err instanceof HumanStepTransportError) {
    throw err;
  }

  if (err instanceof WorkflowStepExecutorMismatchError || err.code === 'WORKFLOW_STEP_EXECUTOR_MISMATCH') {
    const stepId = err.details?.stepId || err.stepId;
    const executor = err.details?.executor || err.executor;
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: 'WORKFLOW_STEP_EXECUTOR_MISMATCH',
      stepId,
      executor,
      details: {
        ...(err.details || {}),
        stepId,
        executor,
      },
    });
  }

  if (err.code === 'REQUIRED_FEEDBACK_MISSING') {
    const stepId = err.details?.step || err.stepId;
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: 'REQUIRED_FEEDBACK_MISSING',
      stepId,
      details: {
        ...(err.details || {}),
        stepId,
      },
    });
  }

  if (err.code === 'UNEXPECTED_TRANSITION_RESULT') {
    const stepId = err.details?.step || err.stepId;
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: 'UNEXPECTED_TRANSITION_RESULT',
      stepId,
      allowedResults: [],
      details: {
        ...(err.details || {}),
        stepId,
        allowedResults: [],
      },
    });
  }

  // Invalid transition result from planFinish (PreconditionError) or finishStep (ensureUpdateTask)
  if (
    err.code === 'INVALID_TRANSITION_RESULT' ||
    (typeof err.message === 'string' && (err.message.includes('Invalid transition result') || err.message.includes('No transition found for step')))
  ) {
    const match = err.message.match(/for step '([^']+)'/) || err.message.match(/No transition found for step '([^']+)'/);
    const stepId = match ? match[1] : (task?.workflow_progress?.current_step || err.details?.step);
    const step = definition?.steps?.[stepId];
    const transitions = step?.transitions || [];
    const allowedResults = transitions.map((t) => t.value).filter((v) => v !== undefined);

    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: 'INVALID_TRANSITION_RESULT',
      stepId,
      executor: step?.executor,
      allowedResults,
      details: {
        code: 'INVALID_TRANSITION_RESULT',
        stepId,
        executor: step?.executor,
        allowedResults,
        attemptedResult,
      },
    });
  }

  // Execution readiness failures
  const readinessCodes = new Set([
    'TASK_UNPUBLISHED',
    'DEPENDENCY_UNSATISFIED',
    'WORKFLOW_TERMINAL',
    'DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT',
    'FINISH_OPERATION_UNRESOLVED',
    'EXECUTION_READINESS_FAILED',
  ]);

  if (err.code && readinessCodes.has(err.code)) {
    const stepId = err.details?.step || err.stepId || err.details?.stepId;
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code: err.code,
      stepId,
      blockedBy: err.details?.blockedBy,
      details: {
        ...(err.details || {}),
        code: err.code,
        stepId,
      },
    });
  }

  // General WorkflowError or CliError
  if (err instanceof WorkflowError || err instanceof CliError) {
    const code = err.code || err.details?.code || 'WORKFLOW_ERROR';
    const stepId = err.details?.stepId || err.details?.step || err.stepId;
    throw new HumanStepTransportError(err.message, {
      status: 400,
      code,
      stepId,
      details: {
        ...(err.details || {}),
        code,
        stepId,
      },
    });
  }

  throw new HumanStepTransportError(err.message || 'Internal error during human-step execution', {
    status: 500,
    code: 'INTERNAL_ERROR',
  });
}
