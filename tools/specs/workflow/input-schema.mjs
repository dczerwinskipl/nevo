// Parameter schema definition, validation, and fail-closed input verification.

import { PreconditionError, WorkflowError } from './errors.mjs';

export const ALLOWED_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates parameter schema descriptors (fail-closed producer boundary).
 * Enforces Constraint C3: name, type, required (boolean), description (string), and applicable constraints.
 *
 * @param {Array<object>} schemas - Parameter schema descriptors
 * @param {object} [options={}]
 * @param {boolean} [options.throwOnError=false]
 * @param {string} [options.actionId]
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }>, validSchemas: Array<object> }}
 */
export function validateActionParameterSchemas(schemas, options = {}) {
  const errors = [];
  const validSchemas = [];

  if (!Array.isArray(schemas)) {
    errors.push({
      field: '$schema',
      message: `Action parameter schemas must be an array, got '${schemas === null ? 'null' : typeof schemas}'`,
      code: 'INVALID_SCHEMA',
    });
    const result = { valid: false, errors, validSchemas: [] };
    if (options.throwOnError) {
      const actionLabel = options.actionId ? ` for action '${options.actionId}'` : '';
      throw new WorkflowError(`Invalid action parameter schemas${actionLabel}: ${errors.map(e => e.message).join('; ')}`, { errors, actionId: options.actionId });
    }
    return result;
  }

  const seenNames = new Set();

  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    const schemaLabel = `$schema[${i}]`;

    if (!isPlainObject(schema)) {
      errors.push({
        field: schemaLabel,
        message: `Parameter schema entry at index ${i} must be a plain object, got '${Array.isArray(schema) ? 'array' : (schema === null ? 'null' : typeof schema)}'`,
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

    if (seenNames.has(fieldName)) {
      errors.push({
        field: fieldName,
        message: `Duplicate parameter schema definition for '${fieldName}'`,
        code: 'DUPLICATE_SCHEMA_PARAMETER',
      });
      continue;
    }
    seenNames.add(fieldName);

    if (typeof schema.type !== 'string' || !ALLOWED_PARAM_TYPES.has(schema.type)) {
      errors.push({
        field: fieldName,
        message: `Parameter '${fieldName}' has invalid or missing 'type' '${schema.type}' (expected one of: ${[...ALLOWED_PARAM_TYPES].join(', ')})`,
        code: 'INVALID_SCHEMA_TYPE',
      });
      continue;
    }

    // Constraint C3: explicit boolean required
    if (typeof schema.required !== 'boolean') {
      errors.push({
        field: fieldName,
        message: `Parameter '${fieldName}' must explicitly define boolean 'required', got '${typeof schema.required}'`,
        code: 'INVALID_SCHEMA_REQUIRED',
      });
      continue;
    }

    // Constraint C3: non-empty human-readable description
    if (typeof schema.description !== 'string' || !schema.description.trim()) {
      errors.push({
        field: fieldName,
        message: `Parameter '${fieldName}' must define a non-empty string 'description'`,
        code: 'INVALID_SCHEMA_DESCRIPTION',
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

      // Type-compatibility checks for constraints
      if (c.pattern !== undefined) {
        if (schema.type !== 'string') {
          errors.push({
            field: fieldName,
            message: `Constraint 'pattern' is only applicable to parameters of type 'string', got '${schema.type}'`,
            code: 'INCOMPATIBLE_CONSTRAINT',
          });
        } else if (typeof c.pattern !== 'string' && !(c.pattern instanceof RegExp)) {
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

      if (c.itemType !== undefined) {
        if (schema.type !== 'array') {
          errors.push({
            field: fieldName,
            message: `Constraint 'itemType' is only applicable to parameters of type 'array', got '${schema.type}'`,
            code: 'INCOMPATIBLE_CONSTRAINT',
          });
        } else if (typeof c.itemType !== 'string' || !ALLOWED_PARAM_TYPES.has(c.itemType)) {
          errors.push({
            field: fieldName,
            message: `Constraint 'itemType' for '${fieldName}' must be one of: ${[...ALLOWED_PARAM_TYPES].join(', ')}`,
            code: 'INVALID_SCHEMA_CONSTRAINT',
          });
        }
      }

      if (c.minValue !== undefined || c.maxValue !== undefined) {
        if (schema.type !== 'number') {
          errors.push({
            field: fieldName,
            message: `Constraints 'minValue' and 'maxValue' are only applicable to parameters of type 'number', got '${schema.type}'`,
            code: 'INCOMPATIBLE_CONSTRAINT',
          });
        } else {
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
          if (typeof c.minValue === 'number' && typeof c.maxValue === 'number' && c.minValue > c.maxValue) {
            errors.push({
              field: fieldName,
              message: `Constraint 'minValue' (${c.minValue}) cannot be greater than 'maxValue' (${c.maxValue}) for '${fieldName}'`,
              code: 'INVALID_SCHEMA_CONSTRAINT',
            });
          }
        }
      }

      if (c.minLength !== undefined || c.maxLength !== undefined) {
        if (schema.type !== 'string' && schema.type !== 'array') {
          errors.push({
            field: fieldName,
            message: `Constraints 'minLength' and 'maxLength' are only applicable to parameters of type 'string' or 'array', got '${schema.type}'`,
            code: 'INCOMPATIBLE_CONSTRAINT',
          });
        } else {
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
          if (Number.isInteger(c.minLength) && Number.isInteger(c.maxLength) && c.minLength > c.maxLength) {
            errors.push({
              field: fieldName,
              message: `Constraint 'minLength' (${c.minLength}) cannot be greater than 'maxLength' (${c.maxLength}) for '${fieldName}'`,
              code: 'INVALID_SCHEMA_CONSTRAINT',
            });
          }
        }
      }

      if (c.allowedValues !== undefined && !Array.isArray(c.allowedValues)) {
        errors.push({
          field: fieldName,
          message: `Constraint 'allowedValues' for '${fieldName}' must be an array`,
          code: 'INVALID_SCHEMA_CONSTRAINT',
        });
      }
    }

    validSchemas.push({ ...schema, name: fieldName });
  }

  const result = { valid: errors.length === 0, errors, validSchemas };

  if (options.throwOnError && !result.valid) {
    const actionLabel = options.actionId ? ` for action '${options.actionId}'` : '';
    throw new WorkflowError(`Invalid action parameter schemas${actionLabel}: ${errors.map(e => e.message).join('; ')}`, { errors, actionId: options.actionId });
  }

  return result;
}

/**
 * Asserts that action parameter schemas are valid, throwing WorkflowError if not.
 *
 * @param {Array<object>} schemas
 * @param {string} [actionId]
 * @throws {WorkflowError}
 */
export function assertActionParameterSchemas(schemas, actionId) {
  return validateActionParameterSchemas(schemas, { throwOnError: true, actionId });
}

/**
 * Validates caller-supplied inputs against an action's parameter schemas.
 * Validates the parameter schemas first, failing closed if schemas are malformed.
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
  // 1. Validate schemas at the producer boundary
  const schemaValidation = validateActionParameterSchemas(schemas, options);
  if (!schemaValidation.valid) {
    return { valid: false, errors: schemaValidation.errors };
  }

  const validSchemas = schemaValidation.validSchemas;
  const declaredParamNames = new Set(validSchemas.map(s => s.name));
  const errors = [];

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

    const expectedType = schema.type;
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
          // Handled during schema validation
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
