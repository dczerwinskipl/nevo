// ActionContract, GateContract, parameter schema validation, and context result models.

import { PreconditionError } from './errors.mjs';

export const ALLOWED_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

/**
 * Validates caller-supplied inputs against an action's parameter schemas.
 *
 * @param {Array<object>} schemas - Parameter schema descriptors
 * @param {Record<string, any>} [inputs={}] - Caller-supplied input object
 * @param {object} [options={}]
 * @param {boolean} [options.throwOnError=false] - If true, throws PreconditionError on invalid inputs
 * @param {string} [options.actionId] - Action ID for error context
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateActionInputs(schemas = [], inputs = {}, options = {}) {
  const errors = [];
  const safeInputs = typeof inputs === 'object' && inputs !== null ? inputs : {};

  for (const schema of schemas) {
    if (!schema || typeof schema.name !== 'string') continue;

    const fieldName = schema.name;
    const value = safeInputs[fieldName];
    const isPresent = value !== undefined && value !== null;

    if (schema.required) {
      if (!isPresent) {
        errors.push({
          field: fieldName,
          message: `Missing required input '${fieldName}': ${schema.description || 'no description provided'}`,
          code: 'REQUIRED_FIELD_MISSING',
        });
        continue;
      }

      if (schema.type === 'string' && typeof value === 'string' && value.trim() === '') {
        errors.push({
          field: fieldName,
          message: `Required input '${fieldName}' cannot be empty`,
          code: 'REQUIRED_FIELD_EMPTY',
        });
        continue;
      }
    }

    if (!isPresent) {
      continue;
    }

    const expectedType = schema.type || 'string';
    let typeValid = true;

    switch (expectedType) {
      case 'string':
        typeValid = typeof value === 'string';
        break;
      case 'number':
        typeValid = typeof value === 'number' && !Number.isNaN(value);
        break;
      case 'boolean':
        typeValid = typeof value === 'boolean';
        break;
      case 'array':
        typeValid = Array.isArray(value);
        break;
      case 'object':
        typeValid = typeof value === 'object' && value !== null && !Array.isArray(value);
        break;
      default:
        typeValid = true;
    }

    if (!typeValid) {
      const actualType = Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value);
      errors.push({
        field: fieldName,
        message: `Input '${fieldName}' must be of type '${expectedType}', got '${actualType}'`,
        code: 'INVALID_TYPE',
      });
      continue;
    }

    if (schema.constraints && typeof schema.constraints === 'object') {
      const c = schema.constraints;

      if (typeof c.minLength === 'number') {
        if ((typeof value === 'string' || Array.isArray(value)) && value.length < c.minLength) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' length (${value.length}) is less than minimum length ${c.minLength}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (typeof c.maxLength === 'number') {
        if ((typeof value === 'string' || Array.isArray(value)) && value.length > c.maxLength) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' length (${value.length}) exceeds maximum length ${c.maxLength}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (typeof c.minValue === 'number' && typeof value === 'number') {
        if (value < c.minValue) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' value (${value}) is less than minimum value ${c.minValue}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (typeof c.maxValue === 'number' && typeof value === 'number') {
        if (value > c.maxValue) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' value (${value}) exceeds maximum value ${c.maxValue}`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (c.pattern && typeof value === 'string') {
        const regex = typeof c.pattern === 'string' ? new RegExp(c.pattern) : c.pattern;
        if (!regex.test(value)) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' does not match required pattern '${c.pattern}'`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (Array.isArray(c.allowedValues)) {
        if (!c.allowedValues.includes(value)) {
          errors.push({
            field: fieldName,
            message: `Input '${fieldName}' value '${value}' is not one of allowed values: [${c.allowedValues.join(', ')}]`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      if (c.itemType && Array.isArray(value)) {
        value.forEach((item, idx) => {
          let itemValid = true;
          switch (c.itemType) {
            case 'string': itemValid = typeof item === 'string'; break;
            case 'number': itemValid = typeof item === 'number' && !Number.isNaN(item); break;
            case 'boolean': itemValid = typeof item === 'boolean'; break;
            case 'object': itemValid = typeof item === 'object' && item !== null && !Array.isArray(item); break;
          }
          if (!itemValid) {
            errors.push({
              field: `${fieldName}[${idx}]`,
              message: `Array item at index ${idx} of '${fieldName}' must be of type '${c.itemType}'`,
              code: 'INVALID_ITEM_TYPE',
            });
          }
        });
      }
    }
  }

  const result = { valid: errors.length === 0, errors };

  if (options.throwOnError && !result.valid) {
    const actionLabel = options.actionId ? ` for action '${options.actionId}'` : '';
    const summary = errors.map(e => e.message).join('; ');
    throw new PreconditionError(`Precondition validation failed${actionLabel}: ${summary}`, errors, options.actionId);
  }

  return result;
}

/**
 * Asserts that action inputs satisfy parameter schemas, throwing PreconditionError if invalid.
 *
 * @param {Array<object>} schemas
 * @param {Record<string, any>} inputs
 * @param {string} [actionId]
 * @throws {PreconditionError}
 */
export function assertActionInputs(schemas, inputs, actionId) {
  return validateActionInputs(schemas, inputs, { throwOnError: true, actionId });
}

/**
 * Structured result of a non-mutating action check introspection.
 */
export class ActionCheckResult {
  /**
   * @param {object} [params]
   * @param {string} [params.actionId=''] - Action identifier
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
    this.actionId = actionId;
    this.requiredInputs = Array.isArray(requiredInputs) ? requiredInputs : [];
    this.context = typeof context === 'object' && context !== null ? context : {};
    this.ready = Boolean(ready);
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
   * @param {object} [params]
   * @param {string} [params.actionId=''] - Action identifier
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
    this.actionId = actionId;
    this.success = Boolean(success);
    this.outputs = typeof outputs === 'object' && outputs !== null ? outputs : {};
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
 */
export class ActionContract {
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
   * Execute the action's operations using explicit input values.
   *
   * @param {Record<string, any>} inputs - Caller-supplied input parameters
   * @param {object} context - Environmental context
   * @returns {Promise<ActionExecuteResult>}
   */
  async execute(inputs, context) {
    throw new Error(`ActionContract subclass '${this.constructor.name}' must implement execute(inputs, context)`);
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
   * @param {object} context - Environmental context
   * @returns {Promise<object>}
   */
  async verify(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement verify(config, context)`);
  }
}
