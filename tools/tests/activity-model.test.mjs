// Tests for the Activity envelope validator (pure schema check, no defaulting).
// Run: node --test tools/tests/activity-model.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVITY_SCHEMA_VERSION, validateActivityEnvelope } from '../specs/activity/model.mjs';

function minimalRecord(overrides = {}) {
  return {
    id: 'a1111111-1111-4111-8111-111111111111',
    type: 'workflow.step.completed',
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    occurredAt: '2026-09-21T10:00:00.000Z',
    actor: { type: 'user', id: 'dominikczerwinski@gmail.com' },
    scope: { specId: 'spec-1111' },
    ...overrides,
  };
}

function fieldErrors(result, field) {
  return result.errors.filter(e => e.field === field);
}

describe('validateActivityEnvelope', () => {
  test('a minimal valid record (only required fields) passes validation', () => {
    const result = validateActivityEnvelope(minimalRecord());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('ACTIVITY_SCHEMA_VERSION is currently 1', () => {
    assert.equal(ACTIVITY_SCHEMA_VERSION, 1);
  });

  test('a record missing "actor" fails with a clear error identifying the field', () => {
    const record = minimalRecord();
    delete record.actor;
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'actor').length, 1);
  });

  test('a record missing "scope.specId" fails with a clear error identifying the field', () => {
    const record = minimalRecord({ scope: {} });
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'scope.specId').length, 1);
  });

  test('a record missing "type" fails with a clear error identifying the field', () => {
    const record = minimalRecord();
    delete record.type;
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'type').length, 1);
  });

  test('a record missing "occurredAt" fails with a clear error identifying the field', () => {
    const record = minimalRecord();
    delete record.occurredAt;
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'occurredAt').length, 1);
  });

  test('a record missing "id" fails with a clear error identifying the field', () => {
    const record = minimalRecord();
    delete record.id;
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'id').length, 1);
  });

  test('a record missing "schemaVersion" fails with a clear error identifying the field', () => {
    const record = minimalRecord();
    delete record.schemaVersion;
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'schemaVersion').length, 1);
  });

  test('a record with an arbitrary/new type string passes validation unchanged', () => {
    const result = validateActivityEnvelope(minimalRecord({ type: 'some.brand.new.type' }));
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('a record with both initiatedBy and triggeredBy set passes validation', () => {
    const result = validateActivityEnvelope(minimalRecord({
      initiatedBy: { type: 'user', id: 'dominikczerwinski@gmail.com' },
      triggeredBy: 'a0000000-0000-4000-8000-000000000000',
    }));
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('a record with neither initiatedBy nor triggeredBy set passes validation', () => {
    const record = minimalRecord();
    assert.equal('initiatedBy' in record, false);
    assert.equal('triggeredBy' in record, false);
    const result = validateActivityEnvelope(record);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('an invalid initiatedBy (missing id) fails with a clear error identifying the field', () => {
    const result = validateActivityEnvelope(minimalRecord({ initiatedBy: { type: 'user' } }));
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'initiatedBy.id').length, 1);
  });

  test('a non-string triggeredBy fails with a clear error identifying the field', () => {
    const result = validateActivityEnvelope(minimalRecord({ triggeredBy: 42 }));
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'triggeredBy').length, 1);
  });

  test('scope.taskId, when present, must be a non-empty string', () => {
    const invalid = validateActivityEnvelope(minimalRecord({ scope: { specId: 'spec-1111', taskId: '' } }));
    assert.equal(invalid.valid, false);
    assert.equal(fieldErrors(invalid, 'scope.taskId').length, 1);

    const valid = validateActivityEnvelope(minimalRecord({ scope: { specId: 'spec-1111', taskId: 'task-1' } }));
    assert.equal(valid.valid, true);
  });

  test('an actor with a non-string type is rejected without a closed enum of types', () => {
    const result = validateActivityEnvelope(minimalRecord({ actor: { type: 123, id: 'x' } }));
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, 'actor.type').length, 1);
  });

  test('an actor of an arbitrary, not-hardcoded type string is accepted', () => {
    const result = validateActivityEnvelope(minimalRecord({ actor: { type: 'future-actor-kind', id: 'x' } }));
    assert.equal(result.valid, true);
  });

  test('a non-object record fails with a single clear error', () => {
    const result = validateActivityEnvelope('not a record');
    assert.equal(result.valid, false);
    assert.equal(fieldErrors(result, '$record').length, 1);
  });

  test('the "data" field is optional and unvalidated in shape', () => {
    const withoutData = validateActivityEnvelope(minimalRecord());
    assert.equal(withoutData.valid, true);

    const withData = validateActivityEnvelope(minimalRecord({ data: { anything: ['goes', 1, true] } }));
    assert.equal(withData.valid, true);
  });

  test('the validator never mutates the input record', () => {
    const record = minimalRecord();
    const snapshot = JSON.parse(JSON.stringify(record));
    validateActivityEnvelope(record);
    assert.deepEqual(record, snapshot);
  });
});
