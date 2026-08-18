// ActionContract, GateContract, parameter schema validation, and context result models.

import { PreconditionError, WorkflowError } from './errors.mjs';

export const ALLOWED_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates caller-supplied inputs against an action's parameter schemas.
 * Also validates the parameter schemas themselves, failing closed if schemas are malformed.
 * Rejects unexpected input keys not declared in the schemas.
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

  // 1. Validate the parameter schemas themselves (fail closed)
  if (!Array.isArray(schemas)) {
    errors.push({
      field: '$schema',
      message: `Action parameter schemas must be an array, got '${schemas === null ? 'null' : typeof schemas}'`,
      code: 'INVALID_SCHEMA',
    });
    const result = { valid: false, errors };
    if (options.throwOnError) {
      const actionLabel = options.actionId ? ` for action '${options.actionId}'` : '';
      throw new PreconditionError(`Precondition validation failed${actionLabel}: ${errors.map(e => e.message).join('; ')}`, errors, options.actionId);
    }
    return result;
  }

  const declaredParamNames = new Set();
  const validSchemas = [];

  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    const schemaLabel = `$schema[${i}]`;

    if (!isPlainObject(schema)) {
      errors.push({
        field: schemaLabel,
        message: `Parameter schema entry at index ${i} must be a plain object, got '${Array.isArray(schema) ? 'array' : typeof schema}'`,
        code: 'INVALID_SCHEMA_ENTRY',
      });
      continue;
    }

    if (typeof schema.name !== 'string' || !schema.name.trim()) {
      errors.push({
        field: `${schemaLabel}.name`,
        message: `Parameter schema entry at index ${i} missing non-empty 'name'`,
        code: 'INVALID_SCHEMA_NAME',
      });
      continue;
    }

    const fieldName = schema.name.trim();

    if (declaredParamNames.has(fieldName)) {
      errors.push({
        field: fieldName,
        message: `Duplicate parameter schema definition for '${fieldName}'`,
        code: 'DUPLICATE_SCHEMA_PARAMETER',
      });
      continue;
    }
    declaredParamNames.add(fieldName);

    if (typeof schema.type !== 'string' || !ALLOWED_PARAM_TYPES.has(schema.type)) {
      errors.push({
        field: fieldName,
        message: `Parameter '${fieldName}' has invalid type '${schema.type}' (expected one of: ${[...ALLOWED_PARAM_TYPES].join(', ')})`,
        code: 'INVALID_SCHEMA_TYPE',
      });
      continue;
    }

    if (schema.required !== undefined && typeof schema.required !== 'boolean') {
      errors.push({
        field: fieldName,
        message: `Parameter '${fieldName}' property 'required' must be a boolean, got '${typeof schema.required}'`,
        code: 'INVALID_SCHEMA_REQUIRED',
      });
      continue;
    }

    if (schema.constraints !== undefined) {
      if (!isPlainObject(schema.constraints)) {
        errors.push({
          field: fieldName,
          message: `Parameter '${fieldName}' property 'constraints' must be a plain object`,
          code: 'INVALID_SCHEMA_CONSTRAINTS',
        });
        continue;
      }

      const c = schema.constraints;

      if (c.minLength !== undefined && (!Number.isInteger(c.minLength) || c.minLength < 0)) {
        errors.push({
          field: fieldName,
          message: `Constraint 'minLength' for '${fieldName}' must be a non-negative integer`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.maxLength !== undefined && (!Number.isInteger(c.maxLength) || c.maxLength < 0)) {
        errors.push({
          field: fieldName,
          message: `Constraint 'maxLength' for '${fieldName}' must be a non-negative integer`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.minValue !== undefined && (typeof c.minValue !== 'number' || Number.isNaN(c.minValue))) {
        errors.push({
          field: fieldName,
          message: `Constraint 'minValue' for '${fieldName}' must be a valid number`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.maxValue !== undefined && (typeof c.maxValue !== 'number' || Number.isNaN(c.maxValue))) {
        errors.push({
          field: fieldName,
          message: `Constraint 'maxValue' for '${fieldName}' must be a valid number`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.allowedValues !== undefined && !Array.isArray(c.allowedValues)) {
        errors.push({
          field: fieldName,
          message: `Constraint 'allowedValues' for '${fieldName}' must be an array`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.itemType !== undefined && (typeof c.itemType !== 'string' || !ALLOWED_PARAM_TYPES.has(c.itemType))) {
        errors.push({
          field: fieldName,
          message: `Constraint 'itemType' for '${fieldName}' must be one of: ${[...ALLOWED_PARAM_TYPES].join(', ')}`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
      if (c.pattern !== undefined) {
        if (typeof c.pattern !== 'string' && !(c.pattern instanceof RegExp)) {
          errors.push({
            field: fieldName,
            message: `Constraint 'pattern' for '${fieldName}' must be a string or RegExp`,
            code: 'INVALID_SCHEMA_CONSTRAINT',
          });
        } else if (typeof c.pattern === 'string') {
          try {
            new RegExp(c.pattern);
          } catch (regexErr) {
            errors.push({
              field: fieldName,
              message: `Invalid regex pattern '${c.pattern}' for parameter '${fieldName}': ${regexErr.message}`,
              code: 'INVALID_SCHEMA_PATTERN',
            });
          }
        }
      }
    }

    validSchemas.push({ ...schema, name: fieldName });
  }

  // 2. Validate caller inputs object format
  if (!isPlainObject(inputs)) {
    errors.push({
      field: '$inputs',
      message: `Caller inputs must be a plain object, got '${Array.isArray(inputs) ? 'array' : (inputs === null ? 'null' : typeof inputs)}'`,
      code: 'INVALID_INPUTS_OBJECT',
    });
    const result = { valid: false, errors };
    if (options.throwOnError) {
      const actionLabel = options.actionId ? ` for action '${options.actionId}'` : '';
      throw new PreconditionError(`Precondition validation failed${actionLabel}: ${errors.map(e => e.message).join('; ')}`, errors, options.actionId);
    }
    return result;
  }

  // 3. Reject unexpected caller input keys (deterministic execution)
  for (const inputKey of Object.keys(inputs)) {
    if (!declaredParamNames.has(inputKey)) {
      errors.push({
        field: inputKey,
        message: `Unexpected input parameter '${inputKey}' not declared in action schema`,
        code: 'UNEXPECTED_INPUT_PARAMETER',
      });
    }
  }

  // 4. Validate input values against valid schemas
  for (const schema of validSchemas) {
    const fieldName = schema.name;
    const value = inputs[fieldName];
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
        typeValid = isPlainObject(value);
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
        try {
          const regex = typeof c.pattern === 'string' ? new RegExp(c.pattern) : c.pattern;
          if (!regex.test(value)) {
            errors.push({
              field: fieldName,
              message: `Input '${fieldName}' does not match required pattern '${c.pattern}'`,
              code: 'CONSTRAINT_VIOLATION',
            });
          }
        } catch {
          // Already checked in schema validation
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
            case 'array': itemValid = Array.isArray(item); break;
            case 'object': itemValid = isPlainObject(item); break;
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
 * Implements the authoritative execution boundary: validates inputs against
 * the action's declared requiredInputs schema prior to any mutating execution logic.
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
   * Authoritative execution boundary: validates inputs against check() schemas before mutation.
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

    assertActionInputs(checkResult.requiredInputs, inputs, this.id);

    const execResult = await this.executeValidated(inputs, context);
    if (!(execResult instanceof ActionExecuteResult)) {
      throw new WorkflowError(
        `Action '${this.id}' executeValidated(inputs, context) must return an ActionExecuteResult instance, got '${execResult?.constructor?.name || typeof execResult}'`
      );
    }

    return execResult;
  }

  /**
   * Subclass hook to perform domain execution operations after inputs have been strictly validated.
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
   * @param {object} context - Environmental context
   * @returns {Promise<object>}
   */
  async verify(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement verify(config, context)`);
  }
}
