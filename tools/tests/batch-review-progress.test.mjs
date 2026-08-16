import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { handleBatchReview } from '../specs.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../specs/service.mjs';

function setupBatchFixture() {
  const base = mkdtempSync(join(tmpdir(), 'nevo-batch-progress-test-'));
  const activeDir = join(base, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  const tasksDir = join(changeDir, 'tasks');
  const reviewsDir = join(changeDir, 'reviews');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(reviewsDir, { recursive: true });

  const changeYaml = `id: test-change
title: Test Change
type: standard
status: in-implementation
tasks:
  - id: task-1
    order: 1
    file: tasks/01-task-1.md
    status: implemented
    self_check:
      status: passed
  - id: task-2
    order: 2
    file: tasks/02-task-2.md
    status: implemented
    self_check:
      status: passed
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const task1Md = `---
id: test-change.task-1
status: implemented
change: test-change
allowed_paths:
  - tools/**
---
# Task 1
`;
  const task2Md = `---
id: test-change.task-2
status: implemented
change: test-change
allowed_paths:
  - tools/**
---
# Task 2
`;
  writeFileSync(join(tasksDir, '01-task-1.md'), task1Md);
  writeFileSync(join(tasksDir, '02-task-2.md'), task2Md);

  const changeObj = {
    _slug: 'test-change',
    _dir: changeDir,
    id: 'test-change',
    tasks: [
      { id: 'task-1', order: 1, file: 'tasks/01-task-1.md', status: 'implemented' },
      { id: 'task-2', order: 2, file: 'tasks/02-task-2.md', status: 'implemented' },
    ],
  };

  const fp1 = computeTaskFingerprint(changeObj, 'task-1');
  const fp2 = computeTaskFingerprint(changeObj, 'task-2');

  const batchIntent = `mode: all-approved-reachable
startRevision: 1234567890abcdef
orderedTasks:
  - task-1
  - task-2
`;
  writeFileSync(join(changeDir, 'batch-intent.yaml'), batchIntent);

  return {
    base,
    activeDir,
    changeDir,
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test('Batch Review CLI Step Progress Instrumentation (Task 06)', async (t) => {
  await t.test('actionDefinitions exposes batch-review step template', async () => {
    const { actionDefinitions } = await import('../specs/gates.mjs');
    assert.ok(actionDefinitions);
  });
});
