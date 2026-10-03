// Core Activity envelope type and validator — the stable, minimal schema every
// activity record must satisfy. Pure functions/types only: no file I/O, no defaulting,
// no persistence or producer-specific logic. Must stay importable by any future producer
// without pulling in workflow- or dashboard-specific code.

export const ACTIVITY_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateActorRefShape(value, field, errors) {
  if (!isPlainObject(value)) {
    errors.push({
      field,
      message: `'${field}' must be a plain object, got '${describeType(value)}'`,
      code: 'INVALID_ACTOR_REF',
    });
    return;
  }

  if (!isNonEmptyString(value.type)) {
    errors.push({
      field: `${field}.type`,
      message: `'${field}.type' must be a non-empty string`,
      code: 'INVALID_ACTOR_REF_TYPE',
    });
  }

  if (!isNonEmptyString(value.id)) {
    errors.push({
      field: `${field}.id`,
      message: `'${field}.id' must be a non-empty string`,
      code: 'INVALID_ACTOR_REF_ID',
    });
  }
}

/**
 * Validates a fully-normalized Activity envelope (already-defaulted `id`, `occurredAt`,
 * `schemaVersion` — this validator never defaults, generates, or mutates any field).
 *
 * Checks only the stable envelope shape: `id`, `type`, `schemaVersion`, `occurredAt`,
 * `actor`, `scope.specId` (required); `initiatedBy`, `triggeredBy`, `scope.taskId`, `data`
 * (optional). `type` is a free-form namespaced string — never checked against a closed
 * list. `data` is checked only for being present-or-absent; its internal shape is
 * producer-owned and out of scope here.
 *
 * @param {object} record
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string, code: string }> }}
 */
export function validateActivityEnvelope(record) {
  const errors = [];

  if (!isPlainObject(record)) {
    errors.push({
      field: '$record',
      message: `Activity record must be a plain object, got '${describeType(record)}'`,
      code: 'INVALID_RECORD',
    });
    return { valid: false, errors };
  }

  if (!isNonEmptyString(record.id)) {
    errors.push({
      field: 'id',
      message: `Activity record missing required non-empty string 'id'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  }

  if (!isNonEmptyString(record.type)) {
    errors.push({
      field: 'type',
      message: `Activity record missing required non-empty string 'type'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  }

  if (!Number.isInteger(record.schemaVersion) || record.schemaVersion < 1) {
    errors.push({
      field: 'schemaVersion',
      message: `Activity record missing required positive integer 'schemaVersion'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  }

  if (!isNonEmptyString(record.occurredAt) || Number.isNaN(Date.parse(record.occurredAt))) {
    errors.push({
      field: 'occurredAt',
      message: `Activity record missing required ISO-8601 string 'occurredAt'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  }

  if (record.actor === undefined) {
    errors.push({
      field: 'actor',
      message: `Activity record missing required field 'actor'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  } else {
    validateActorRefShape(record.actor, 'actor', errors);
  }

  if (!isPlainObject(record.scope)) {
    errors.push({
      field: 'scope',
      message: `Activity record missing required plain object 'scope'`,
      code: 'REQUIRED_FIELD_MISSING',
    });
  } else {
    if (!isNonEmptyString(record.scope.specId)) {
      errors.push({
        field: 'scope.specId',
        message: `Activity record missing required non-empty string 'scope.specId'`,
        code: 'REQUIRED_FIELD_MISSING',
      });
    }

    if (record.scope.taskId !== undefined && !isNonEmptyString(record.scope.taskId)) {
      errors.push({
        field: 'scope.taskId',
        message: `Activity record field 'scope.taskId', when present, must be a non-empty string`,
        code: 'INVALID_OPTIONAL_FIELD',
      });
    }
  }

  if (record.initiatedBy !== undefined) {
    validateActorRefShape(record.initiatedBy, 'initiatedBy', errors);
  }

  if (record.triggeredBy !== undefined && !isNonEmptyString(record.triggeredBy)) {
    errors.push({
      field: 'triggeredBy',
      message: `Activity record field 'triggeredBy', when present, must be a non-empty string (id of the prior Activity)`,
      code: 'INVALID_OPTIONAL_FIELD',
    });
  }

  return { valid: errors.length === 0, errors };
}
