// Aggregated workflow check and execution engine.

import { WorkflowError, PreconditionError } from './errors.mjs';
import { ActionCheckResult, ActionExecuteResult } from './contracts.mjs';
import { defaultActionRegistry, defaultGateRegistry } from './registry.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts normalized action identifiers from a step definition or action list.
 * Enforces action ID uniqueness within the step action list.
 *
 * @param {object|Array<string|object>} stepDefinition
 * @returns {{ stepName: string, actionIds: string[] }}
 * @throws {WorkflowError} If step definition is invalid or contains duplicate action IDs
 */
function normalizeStepActions(stepDefinition) {
  if (!stepDefinition) {
    throw new WorkflowError('WorkflowEngine step definition must not be null or undefined');
  }

  let stepName = 'step';
  let rawActions = [];

  if (Array.isArray(stepDefinition)) {
    rawActions = stepDefinition;
  } else if (isPlainObject(stepDefinition)) {
    stepName = stepDefinition.name || stepDefinition.id || 'step';
    if (Array.isArray(stepDefinition.actions)) {
      rawActions = stepDefinition.actions;
    } else if (Array.isArray(stepDefinition.finalize)) {
      rawActions = stepDefinition.finalize;
    } else {
      rawActions = [];
    }
  } else {
    throw new WorkflowError(
      `Invalid step definition type: expected object or array, got '${typeof stepDefinition}'`
    );
  }

  const actionIds = [];
  const seenActionIds = new Set();

  for (let i = 0; i < rawActions.length; i++) {
    const entry = rawActions[i];
    let actionId = '';
    if (typeof entry === 'string' && entry.trim()) {
      actionId = entry.trim();
    } else if (isPlainObject(entry) && typeof entry.id === 'string' && entry.id.trim()) {
      actionId = entry.id.trim();
    } else {
      throw new WorkflowError(
        `Step '${stepName}' action entry at index ${i} is missing a valid string 'id'`
      );
    }

    if (seenActionIds.has(actionId)) {
      throw new WorkflowError(
        `Duplicate action reference '${actionId}' in step '${stepName}' at index ${i}`,
        { code: 'DUPLICATE_ACTION_REFERENCE', step: stepName, actionId, index: i }
      );
    }

    seenActionIds.add(actionId);
    actionIds.push(actionId);
  }

  return { stepName, actionIds };
}

/**
 * Orchestrates multi-action steps and aggregated checks.
 */
export class WorkflowEngine {
  /**
   * @param {object} [options={}]
   * @param {import('./registry.mjs').ActionRegistry} [options.actionRegistry]
   * @param {import('./registry.mjs').GateRegistry} [options.gateRegistry]
   */
  constructor({ actionRegistry = defaultActionRegistry, gateRegistry = defaultGateRegistry } = {}) {
    this.actionRegistry = actionRegistry;
    this.gateRegistry = gateRegistry;
  }

  /**
   * Evaluates non-mutating checks across all actions declared in a step.
   * Aggregates results strictly keyed by action ID without merging or flattening schemas/facts.
   *
   * @param {object|Array<string|object>} stepDefinition - Step definition containing action declarations
   * @param {Record<string, any>} [context={}] - Runtime environmental context
   * @returns {Promise<{ step: string, ready: boolean, actions: Record<string, object> }>}
   */
  async checkStep(stepDefinition, context = {}) {
    if (!isPlainObject(context)) {
      throw new WorkflowError(`checkStep() context must be a plain object, got '${typeof context}'`);
    }

    const { stepName, actionIds } = normalizeStepActions(stepDefinition);
    const aggregatedActions = {};
    let overallReady = true;

    for (const actionId of actionIds) {
      const action = this.actionRegistry.require(actionId);

      let checkResult;
      try {
        checkResult = await action.check(context);
      } catch (err) {
        throw new WorkflowError(
          `Action '${actionId}' failed during non-mutating check in step '${stepName}': ${err.message}`,
          { cause: err, actionId, step: stepName }
        );
      }

      if (!(checkResult instanceof ActionCheckResult)) {
        throw new WorkflowError(
          `Action '${actionId}' check() in step '${stepName}' must return ActionCheckResult, got '${checkResult?.constructor?.name || typeof checkResult}'`,
          { actionId, step: stepName }
        );
      }

      if (checkResult.actionId !== actionId) {
        throw new WorkflowError(
          `Action '${actionId}' check() returned ActionCheckResult with mismatched actionId '${checkResult.actionId}'`,
          { actionId, step: stepName }
        );
      }

      aggregatedActions[actionId] = checkResult.toJSON();
      if (!checkResult.ready) {
        overallReady = false;
      }
    }

    return {
      step: stepName,
      ready: overallReady,
      actions: aggregatedActions,
    };
  }

  /**
   * Executes all actions declared in a step sequentially with action-scoped inputs.
   * Aborts execution immediately upon first failure.
   *
   * @param {object|Array<string|object>} stepDefinition - Step definition containing action declarations
   * @param {Record<string, Record<string, any>>} [stepInputs={}] - Inputs scoped per action: { [actionId]: inputs }
   * @param {Record<string, any>} [context={}] - Runtime environmental context
   * @returns {Promise<{ step: string, success: boolean, actions: Record<string, object>, failedAction?: string, error?: any }>}
   */
  async executeStep(stepDefinition, stepInputs = {}, context = {}) {
    if (!isPlainObject(stepInputs)) {
      throw new WorkflowError(`executeStep() stepInputs must be a plain object keyed by action ID, got '${typeof stepInputs}'`);
    }
    if (!isPlainObject(context)) {
      throw new WorkflowError(`executeStep() context must be a plain object, got '${typeof context}'`);
    }

    const { stepName, actionIds } = normalizeStepActions(stepDefinition);
    const executedActions = {};

    for (const actionId of actionIds) {
      const action = this.actionRegistry.require(actionId);
      const actionInputs = stepInputs[actionId] || {};

      if (!isPlainObject(actionInputs)) {
        throw new PreconditionError(
          `Step inputs for action '${actionId}' must be a plain object, got '${typeof actionInputs}'`,
          [{ field: actionId, message: `Inputs for action '${actionId}' must be a plain object`, code: 'INVALID_INPUTS_OBJECT' }],
          actionId
        );
      }

      let execResult;
      try {
        execResult = await action.execute(actionInputs, context);
      } catch (err) {
        return {
          step: stepName,
          success: false,
          failedAction: actionId,
          actions: executedActions,
          error: err.message,
        };
      }

      if (!(execResult instanceof ActionExecuteResult)) {
        throw new WorkflowError(
          `Action '${actionId}' execute() in step '${stepName}' must return ActionExecuteResult, got '${execResult?.constructor?.name || typeof execResult}'`,
          { actionId, step: stepName }
        );
      }

      executedActions[actionId] = execResult.toJSON();

      if (!execResult.success) {
        return {
          step: stepName,
          success: false,
          failedAction: actionId,
          actions: executedActions,
          error: execResult.error || execResult.summary || `Action '${actionId}' execution failed`,
        };
      }
    }

    return {
      step: stepName,
      success: true,
      actions: executedActions,
    };
  }
}

/** Global default WorkflowEngine instance */
export const defaultWorkflowEngine = new WorkflowEngine();
