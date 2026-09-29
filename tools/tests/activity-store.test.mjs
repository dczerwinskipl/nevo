// Tests for Activity local append-only NDJSON store (task 02, ai-spec-history).
// Run: node --test tools/tests/activity-store.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  recordActivity,
  readActivities,
  activityFilePath,
  activityDir,
  resolveSpecId,
} from '../specs/activity/store.mjs';
import { ACTIVITY_SCHEMA_VERSION } from '../specs/activity/model.mjs';

function minimalRecord(overrides = {}) {
  return {
    type: 'workflow.step.completed',
    actor: { type: 'user', id: 'dominikczerwinski@gmail.com' },
    scope: { specId: 'spec-test-uuid-1' },
    ...overrides,
  };
}

describe('Activity local NDJSON store', () => {
  let testBaseDir;

  beforeEach(() => {
    testBaseDir = mkdtempSync(join(tmpdir(), 'nevo-activity-store-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test tempdir
    }
  });

  test('appending N records and reading them back returns exactly N records in the order appended', () => {
    const specId = 'spec-order-test';
    const count = 5;
    const written = [];

    for (let i = 0; i < count; i++) {
      const rec = recordActivity(
        minimalRecord({
          scope: { specId, taskId: `task-${i}` },
          data: { index: i },
        }),
        { activityDir: testBaseDir }
      );
      written.push(rec);
    }

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, count);
    for (let i = 0; i < count; i++) {
      assert.equal(read[i].id, written[i].id);
      assert.equal(read[i].scope.taskId, `task-${i}`);
      assert.equal(read[i].data.index, i);
    }
  });

  test('a record appended for a spec is only visible when reading that spec\'s file — a second spec\'s file is untouched', () => {
    const specA = 'spec-isolation-a';
    const specB = 'spec-isolation-b';

    const recA = recordActivity(
      minimalRecord({
        scope: { specId: specA },
        data: { label: 'spec-a-data' },
      }),
      { activityDir: testBaseDir }
    );

    const readA = readActivities(specA, { activityDir: testBaseDir });
    const readB = readActivities(specB, { activityDir: testBaseDir });

    assert.equal(readA.length, 1);
    assert.equal(readA[0].id, recA.id);
    assert.deepEqual(readB, []);

    // Spec B's file should not even exist yet
    const pathB = activityFilePath(specB, { activityDir: testBaseDir });
    assert.equal(existsSync(pathB), false);
  });

  test('recordActivity called with only required fields (no id/occurredAt/schemaVersion) succeeds and read-back record has all three populated', () => {
    const specId = 'spec-defaulting-test';
    const rec = recordActivity(
      {
        type: 'workflow.step.started',
        actor: { type: 'agent-session', id: 'session-xyz' },
        scope: { specId, taskId: 'task-01' },
      },
      { activityDir: testBaseDir }
    );

    assert.ok(typeof rec.id === 'string' && rec.id.length > 0);
    assert.ok(typeof rec.occurredAt === 'string' && !Number.isNaN(Date.parse(rec.occurredAt)));
    assert.equal(rec.schemaVersion, ACTIVITY_SCHEMA_VERSION);

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.equal(read[0].id, rec.id);
    assert.equal(read[0].occurredAt, rec.occurredAt);
    assert.equal(read[0].schemaVersion, ACTIVITY_SCHEMA_VERSION);
  });

  test('caller-supplied id is preserved as-is without being re-randomized', () => {
    const specId = 'spec-deterministic-id-test';
    const customId = 'workflow.step.completed:spec-test:task-1:impl:1';

    const rec = recordActivity(
      minimalRecord({
        id: customId,
        scope: { specId },
      }),
      { activityDir: testBaseDir }
    );

    assert.equal(rec.id, customId);

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.equal(read[0].id, customId);
  });

  test('simulating a crash that leaves a dangling partial line isolates the partial line and recovers subsequent valid records', () => {
    const specId = 'spec-crash-recovery-test';

    // 1. Write first valid record
    const rec1 = recordActivity(
      minimalRecord({
        scope: { specId },
        data: { step: 1 },
      }),
      { activityDir: testBaseDir }
    );

    // 2. Simulate crash: write partial JSON fragment with NO trailing newline directly to file
    const filePath = activityFilePath(specId, { activityDir: testBaseDir });
    appendFileSync(filePath, '\n{"id": "interrupted-record", "type": "workflow.', 'utf8');

    // 3. Call recordActivity again for a new valid record
    const rec2 = recordActivity(
      minimalRecord({
        scope: { specId },
        data: { step: 2 },
      }),
      { activityDir: testBaseDir }
    );

    // 4. Verify reading returns preceding complete record AND new valid record; partial line is skipped
    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 2);
    assert.equal(read[0].id, rec1.id);
    assert.equal(read[0].data.step, 1);
    assert.equal(read[1].id, rec2.id);
    assert.equal(read[1].data.step, 2);
  });

  test('simulating a crash with dangling partial line directly at file beginning does not break subsequent record', () => {
    const specId = 'spec-crash-at-start';
    const filePath = activityFilePath(specId, { activityDir: testBaseDir });

    // File begins directly with partial line without trailing newline
    appendFileSync(filePath, '{"id": "corrupted-start", "partial": true', 'utf8');

    const rec = recordActivity(
      minimalRecord({
        scope: { specId },
        data: { ok: true },
      }),
      { activityDir: testBaseDir }
    );

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.equal(read[0].id, rec.id);
    assert.equal(read[0].data.ok, true);
  });

  test('appending two records that share the same id returns exactly one record on read (the first one appended)', () => {
    const specId = 'spec-dedup-test';
    const sharedId = 'workflow.step.started:spec-1:task-1:impl:1';

    const first = recordActivity(
      minimalRecord({
        id: sharedId,
        occurredAt: '2026-09-21T10:00:00.000Z',
        scope: { specId },
        data: { attempt: 1, note: 'first occurrence' },
      }),
      { activityDir: testBaseDir }
    );

    const second = recordActivity(
      minimalRecord({
        id: sharedId,
        occurredAt: '2026-09-21T10:05:00.000Z',
        scope: { specId },
        data: { attempt: 1, note: 'second duplicate occurrence' },
      }),
      { activityDir: testBaseDir }
    );

    // Physical file must contain two records (pure append, no rewrite/compaction)
    const filePath = activityFilePath(specId, { activityDir: testBaseDir });
    const rawContent = readFileSync(filePath, 'utf8');
    const rawLines = rawContent.split('\n').filter(line => line.trim() !== '');
    assert.equal(rawLines.length, 2);

    // Read path deduplicates by id, keeping only the first occurrence
    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.equal(read[0].id, sharedId);
    assert.equal(read[0].occurredAt, '2026-09-21T10:00:00.000Z');
    assert.equal(read[0].data.note, 'first occurrence');
  });

  test('no file-count or record-count pruning occurs after writing many records (D2 retention)', () => {
    const specId = 'spec-no-pruning-test';
    const totalRecords = 60;

    for (let i = 0; i < totalRecords; i++) {
      recordActivity(
        minimalRecord({
          scope: { specId },
          data: { seq: i },
        }),
        { activityDir: testBaseDir }
      );
    }

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, totalRecords);
    assert.equal(read[0].data.seq, 0);
    assert.equal(read[totalRecords - 1].data.seq, totalRecords - 1);
  });

  test('initiatedBy and triggeredBy fields survive an append+read round trip unchanged when present', () => {
    const specId = 'spec-causal-chain-test';
    const initiatedBy = { type: 'user', id: 'lead@nevo.dev' };
    const triggeredBy = 'prev-activity-uuid-12345';

    recordActivity(
      minimalRecord({
        scope: { specId },
        initiatedBy,
        triggeredBy,
      }),
      { activityDir: testBaseDir }
    );

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.deepEqual(read[0].initiatedBy, initiatedBy);
    assert.equal(read[0].triggeredBy, triggeredBy);
  });

  test('initiatedBy and triggeredBy are absent (not null-padded) when not supplied', () => {
    const specId = 'spec-causal-absent-test';

    const input = minimalRecord({ scope: { specId } });
    delete input.initiatedBy;
    delete input.triggeredBy;

    recordActivity(input, { activityDir: testBaseDir });

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.equal(read.length, 1);
    assert.equal('initiatedBy' in read[0], false);
    assert.equal('triggeredBy' in read[0], false);
    assert.equal(read[0].initiatedBy, undefined);
    assert.equal(read[0].triggeredBy, undefined);
  });

  test('readActivities returns an empty list if file or directory does not exist', () => {
    const nonExistentSpec = 'non-existent-spec-id-999';
    const results = readActivities(nonExistentSpec, { activityDir: testBaseDir });
    assert.deepEqual(results, []);
  });

  test('recordActivity rejects invalid envelope and does not write to file', () => {
    const specId = 'spec-invalid-envelope-test';

    assert.throws(
      () => {
        recordActivity(
          {
            // missing type, actor, scope
            scope: { specId },
          },
          { activityDir: testBaseDir }
        );
      },
      err => {
        assert.equal(err.code, 'INVALID_ACTIVITY_RECORD');
        return true;
      }
    );

    const read = readActivities(specId, { activityDir: testBaseDir });
    assert.deepEqual(read, []);
  });

  test('framing begins with a leading newline per record', () => {
    const specId = 'spec-framing-test';
    recordActivity(minimalRecord({ scope: { specId } }), { activityDir: testBaseDir });

    const filePath = activityFilePath(specId, { activityDir: testBaseDir });
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(raw.startsWith('\n'), 'File content should start with a leading newline');
  });

  test('resolveSpecId falls back cleanly when identifier is a plain test ID or slug', () => {
    assert.equal(resolveSpecId('some-test-id'), 'some-test-id');
    assert.equal(resolveSpecId({ spec_id: 'abc-123' }), 'abc-123');
    assert.equal(resolveSpecId({ specId: 'xyz-789' }), 'xyz-789');
    assert.equal(resolveSpecId({ scope: { specId: 'scope-id' } }), 'scope-id');
  });
});
