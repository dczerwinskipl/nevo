import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  operationFilePath,
  loadOperationRecord,
  saveOperationRecord,
  findInFlightOperationRecord,
} from '../specs/workflow/operation-record.mjs';
import {
  PreconditionError,
  WorkflowError,
} from '../specs/workflow/errors.mjs';

function makeFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { base, repo: base };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('operationFilePath and storage layout (AC4)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-op-record-layout'); });
  after(() => cleanupFixture(fx));

  test('constructs exact attempt-scoped path', () => {
    const p = operationFilePath(fx.repo, 'demo-change', 'demo-task', 'implementation', 1);
    const expected = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task', 'implementation', 'attempt-1.json');
    assert.equal(p, expected);

    const p2 = operationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 3);
    const expected2 = join(fx.repo, '.nevo-ai-local', 'workflow-operations', 'demo-change', 'demo-task', 'review', 'attempt-3.json');
    assert.equal(p2, expected2);
  });

  test('enforces step and attempt arguments on path construction and storage APIs', () => {
    assert.throws(
      () => operationFilePath(fx.repo, 'c', 't', null, 1),
      WorkflowError
    );
    assert.throws(
      () => operationFilePath(fx.repo, 'c', 't', 's', null),
      WorkflowError
    );
    assert.throws(
      () => loadOperationRecord(fx.repo, 'c', 't', null, 1),
      WorkflowError
    );
    assert.throws(
      () => loadOperationRecord(fx.repo, 'c', 't', 's', undefined),
      WorkflowError
    );
    assert.throws(
      () => saveOperationRecord(fx.repo, { change: 'c', task: 't', step: 's' }),
      WorkflowError
    );
  });

  test('saves and loads operation record accurately with attempt scoping', () => {
    const record = {
      operationId: 'op-1',
      change: 'change-a',
      task: 'task-a',
      step: 'implementation',
      attempt: 1,
      status: 'running',
      resolvedInputs: { key: 'value' },
      operations: [
        { id: 'verify-gates', status: 'pending' },
      ],
    };

    saveOperationRecord(fx.repo, record);

    const filePath = operationFilePath(fx.repo, 'change-a', 'task-a', 'implementation', 1);
    assert.ok(existsSync(filePath), 'record file must exist at scoped path');

    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(raw.operationId, 'op-1');
    assert.equal(raw.attempt, 1);

    const loaded = loadOperationRecord(fx.repo, 'change-a', 'task-a', 'implementation', 1);
    assert.deepEqual(loaded, record);

    // Another attempt for the same step returns null when not written
    const nonExistent = loadOperationRecord(fx.repo, 'change-a', 'task-a', 'implementation', 2);
    assert.equal(nonExistent, null);
  });
});

describe('findInFlightOperationRecord (AC5)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-op-record-flight'); });
  after(() => cleanupFixture(fx));

  test('returns null when storage directory does not exist or has no records', () => {
    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.equal(result, null);
  });

  test('returns null when all operation records are completed', () => {
    saveOperationRecord(fx.repo, {
      operationId: 'op-c1',
      change: 'demo-change',
      task: 'demo-task',
      step: 'implementation',
      attempt: 1,
      status: 'completed',
      operations: [],
    });
    saveOperationRecord(fx.repo, {
      operationId: 'op-c2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 1,
      status: 'completed',
      operations: [],
    });

    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.equal(result, null);
  });

  test('returns single record when exactly one uncompleted record exists', () => {
    saveOperationRecord(fx.repo, {
      operationId: 'op-in-flight',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 2,
      status: 'running',
      operations: [],
    });

    const result = findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task');
    assert.ok(result);
    assert.equal(result.operationId, 'op-in-flight');
    assert.equal(result.step, 'review');
    assert.equal(result.attempt, 2);
  });

  test('throws MULTIPLE_IN_FLIGHT_OPERATIONS when two or more uncompleted records exist', () => {
    // Add a second uncompleted record for attempt 3
    saveOperationRecord(fx.repo, {
      operationId: 'op-in-flight-2',
      change: 'demo-change',
      task: 'demo-task',
      step: 'review',
      attempt: 3,
      status: 'reconciliation-required',
      operations: [],
    });

    assert.throws(
      () => findInFlightOperationRecord(fx.repo, 'demo-change', 'demo-task'),
      (err) => {
        assert.ok(err instanceof WorkflowError);
        assert.equal(err.code, 'MULTIPLE_IN_FLIGHT_OPERATIONS');
        return true;
      }
    );
  });
});
