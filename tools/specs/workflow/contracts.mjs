// ActionContract, GateContract, and result models.

import { PreconditionError, WorkflowError } from './errors.mjs';
import {
  ALLOWED_PARAM_TYPES,
  KNOWN_CONSTRAINT_KEYS,
  validateActionParameterSchemas,
  assertActionParameterSchemas,
  validateActionInputs,
  assertActionInputs,
} from './input-schema.mjs';

export {
  ALLOWED_PARAM_TYPES,
  KNOWN_CONSTRAINT_KEYS,
  validateActionParameterSchemas,
  assertActionParameterSchemas,
  validateActionInputs,
  assertActionInputs,
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structured result of a non-mutating action check introspection.
 */
export class ActionCheckResult {
  /**
   * @param {object} params
   * @param {string} params.actionId - Action identifier
   * @param {Array<object>} [params.requiredInputs=[]] - Array of required/optional parameter schemas
   * @param {Record<string, any>} [params.context={}] - Factual environmental runtime facts
   * @param {boolean} [params.ready=true] - Whether prerequisites to execute are satisfied
   * @param {string} [params.summary=''] - Human-readable summary
   * @param {Record<string, any>} [params.details={}] - Additional details
   */
  constructor({
    actionId = '',
    requiredInputs = [],
    context = {},
    ready = true,
    summary = '',
    details = {},
  } = {}) {
    if (typeof actionId !== 'string' || !actionId.trim()) {
      throw new WorkflowError(`ActionCheckResult requires a non-empty string 'actionId', got '${actionId}'`);
    }
    if (!Array.isArray(requiredInputs)) {
      throw new WorkflowError(`ActionCheckResult 'requiredInputs' must be an array, got '${typeof requiredInputs}'`);
    }
    // Fail-closed validation of parameter schemas at the producer boundary (Constraint C3)
    assertActionParameterSchemas(requiredInputs, actionId);

    if (!isPlainObject(context)) {
      throw new WorkflowError(`ActionCheckResult 'context' must be a plain object, got '${Array.isArray(context) ? 'array' : (context === null ? 'null' : typeof context)}'`);
    }
    if (typeof ready !== 'boolean') {
      throw new WorkflowError(`ActionCheckResult 'ready' must be a strict boolean, got '${typeof ready}'`);
    }
    if (typeof summary !== 'string') {
      throw new WorkflowError(`ActionCheckResult 'summary' must be a string, got '${typeof summary}'`);
    }
    if (!isPlainObject(details)) {
      throw new WorkflowError(`ActionCheckResult 'details' must be a plain object, got '${Array.isArray(details) ? 'array' : (details === null ? 'null' : typeof details)}'`);
    }

    this.actionId = actionId.trim();
    this.requiredInputs = requiredInputs;
    this.context = context;
    this.ready = ready;
    this.summary = summary;
    this.details = details;
  }

  toJSON() {
    return {
      actionId: this.actionId,
      requiredInputs: this.requiredInputs,
      context: this.context,
      ready: this.ready,
      summary: this.summary,
      details: this.details,
    };
  }
}

/**
 * Structured result of an action execution.
 */
export class ActionExecuteResult {
  /**
   * @param {object} params
   * @param {string} params.actionId - Action identifier
   * @param {boolean} [params.success=true] - Execution success flag
   * @param {Record<string, any>} [params.outputs={}] - Execution output artifacts/results
   * @param {string} [params.summary=''] - Human-readable summary
   * @param {object|null} [params.error=null] - Error details if execution failed
   */
  constructor({
    actionId = '',
    success = true,
    outputs = {},
    summary = '',
    error = null,
  } = {}) {
    if (typeof actionId !== 'string' || !actionId.trim()) {
      throw new WorkflowError(`ActionExecuteResult requires a non-empty string 'actionId', got '${actionId}'`);
    }
    if (typeof success !== 'boolean') {
      throw new WorkflowError(`ActionExecuteResult 'success' must be a strict boolean, got '${typeof success}'`);
    }
    if (!isPlainObject(outputs)) {
      throw new WorkflowError(`ActionExecuteResult 'outputs' must be a plain object, got '${Array.isArray(outputs) ? 'array' : (outputs === null ? 'null' : typeof outputs)}'`);
    }
    if (typeof summary !== 'string') {
      throw new WorkflowError(`ActionExecuteResult 'summary' must be a string, got '${typeof summary}'`);
    }

    this.actionId = actionId.trim();
    this.success = success;
    this.outputs = outputs;
    this.summary = summary;
    this.error = error;
  }

  toJSON() {
    return {
      actionId: this.actionId,
      success: this.success,
      outputs: this.outputs,
      summary: this.summary,
      ...(this.error ? { error: this.error } : {}),
    };
  }
}

/**
 * Abstract base class defining the composable Action contract.
 *
 * Implements the authoritative execution boundary:
 * 1. Executes non-mutating check() to inspect state and obtain requiredInputs
 * 2. Validates action identity on the check result
 * 3. Enforces ready === true before any domain mutation
 * 4. Validates caller inputs against parameter schemas
 * 5. Delegates only validated inputs to executeValidated()
 * 6. Validates action identity on the execution result
 */
export class ActionContract {
  constructor() {
    // 1. Prototype method override check
    if (this.execute !== ActionContract.prototype.execute) {
      throw new WorkflowError(
        `ActionContract subclass '${this.constructor.name}' must not override execute(). Implement executeValidated() instead.`
      );
    }

    // 2. Lock the instance property 'execute' as non-writable and non-configurable, bound to the authoritative base implementation.
    // This prevents class-field overrides (execute = async () => ...) and direct property reassignment.
    Object.defineProperty(this, 'execute', {
      value: ActionContract.prototype.execute.bind(this),
      writable: false,
      configurable: false,
      enumerable: true,
    });
  }

  /**
   * Unique action identifier (e.g. 'commit-and-push', 'verify-task-output').
   * @returns {string}
   */
  get id() {
    throw new Error(`ActionContract subclass '${this.constructor.name}' must implement get id()`);
  }

  /**
   * Human-readable description of what this action does.
   * @returns {string}
   */
  get description() {
    throw new Error(`ActionContract subclass '${this.constructor.name}' must implement get description()`);
  }

  /**
   * Introspect current state without mutating anything.
   *
   * @param {object} context - Environmental context (change, task, repo root, git state)
   * @returns {Promise<ActionCheckResult>}
   */
  async check(context) {
    throw new Error(`ActionContract subclass '${this.constructor.name}' must implement check(context)`);
  }

  /**
   * Authoritative execution boundary: validates ready state and inputs before mutation.
   * Subclasses implement executeValidated(inputs, context) for their domain logic.
   *
   * @param {Record<string, any>} inputs - Caller-supplied input parameters
   * @param {object} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async execute(inputs, context) {
    const checkResult = await this.check(context);
    if (!(checkResult instanceof ActionCheckResult)) {
      throw new WorkflowError(
        `Action '${this.id}' check(context) must return an ActionCheckResult instance, got '${checkResult?.constructor?.name || typeof checkResult}'`
      );
    }

    // Action identity boundary check
    if (checkResult.actionId !== this.id) {
      throw new WorkflowError(
        `Action '${this.id}' check() returned ActionCheckResult with mismatched actionId '${checkResult.actionId}'`
      );
    }

    // Fail-closed readiness check: ready === false blocks domain execution
    if (!checkResult.ready) {
      const message = `Action '${this.id}' is not ready for execution: ${checkResult.summary || 'prerequisites not satisfied'}`;
      throw new PreconditionError(
        message,
        [{ field: '$action', message: checkResult.summary || 'Action is not ready for execution', code: 'ACTION_NOT_READY' }],
        this.id
      );
    }

    // Fail-closed input validation
    assertActionInputs(checkResult.requiredInputs, inputs, this.id);

    // Delegate to subclass domain implementation
    const execResult = await this.executeValidated(inputs, context);
    if (!(execResult instanceof ActionExecuteResult)) {
      throw new WorkflowError(
        `Action '${this.id}' executeValidated(inputs, context) must return an ActionExecuteResult instance, got '${execResult?.constructor?.name || typeof execResult}'`
      );
    }

    // Action identity boundary check
    if (execResult.actionId !== this.id) {
      throw new WorkflowError(
        `Action '${this.id}' executeValidated() returned ActionExecuteResult with mismatched actionId '${execResult.actionId}'`
      );
    }

    return execResult;
  }

  /**
   * Subclass hook to perform domain execution operations after inputs and readiness have been strictly validated.
   *
   * @param {Record<string, any>} inputs - Validated inputs
   * @param {object} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async executeValidated(inputs, context) {
    throw new Error(`ActionContract subclass '${this.constructor.name}' must implement executeValidated(inputs, context)`);
  }
}

/**
 * Abstract base class defining the Gate contract.
 */
export class GateContract {
  /**
   * Gate type identifier ('command' | 'markdown' | 'human').
   * @returns {string}
   */
  get type() {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement get type()`);
  }

  /**
   * Non-mutating inspection of gate status without executing heavy actions.
   *
   * @param {object} config - Gate configuration from workflow definition
   * @param {object} context - Environmental context
   * @returns {Promise<object>}
   */
  async inspect(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement inspect(config, context)`);
  }

  /**
   * Explicit gate verification execution.
   *
   * @param {object} config - Gate configuration from workflow definition
   * @returns {Promise<object>}
   */
  async verify(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement verify(config, context)`);
  }
}
