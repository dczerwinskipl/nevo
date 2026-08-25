import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { handleBatchReview } from '../specs.mjs';
import { computeChangeFingerprint, computeTaskFingerprint } from '../specs/fingerprint.mjs';
import { actionDefinitions } from '../specs/gates.mjs';

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const lines = [];
  process.stdout.write = chunk => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return lines.flatMap(l => l.split('\n')).filter(Boolean);
}

function parseProgressLine(line) {
  const prefix = '@@nevo:progress@@ ';
  if (line.startsWith(prefix)) {
    try {
      return JSON.parse(line.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function setupBatchFixture({ staleEvidence = false, currentNonTerminal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nevo-batch-test-'));
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'test-change');
  const tasksDir = join(changeDir, 'tasks');
  const reviewsDir = join(changeDir, 'reviews');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(reviewsDir, { recursive: true });

  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });

  // Initial base commit
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root });
  const startSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  // Create files touched by tasks
  writeFileSync(join(root, 'feature-1.txt'), 'feature 1 content\n');
  writeFileSync(join(root, 'feature-2.txt'), 'feature 2 content\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'implement features'], { cwd: root });

  const task1Status = currentNonTerminal ? 'in-implementation' : 'implemented';

  const task1Md = `---
id: test-change.task-1
status: ${task1Status}
change: test-change
allowed_paths:
  - feature-1.txt
---
# Task 1
`;
  const task2Md = `---
id: test-change.task-2
status: implemented
change: test-change
allowed_paths:
  - feature-2.txt
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
      { id: 'task-1', order: 1, file: 'tasks/01-task-1.md', status: task1Status },
      { id: 'task-2', order: 2, file: 'tasks/02-task-2.md', status: 'implemented' },
    ],
  };

  const fp1 = computeTaskFingerprint(changeObj, 'task-1');
  const fp2 = computeTaskFingerprint(changeObj, 'task-2');

  const changeYaml = `id: test-change
title: Test Change
type: standard
status: in-implementation
tasks:
  - id: task-1
    order: 1
    file: tasks/01-task-1.md
    status: ${task1Status}
    self_check:
      status: passed
      fingerprint: ${staleEvidence ? 'stale-fingerprint-123' : fp1}
  - id: task-2
    order: 2
    file: tasks/02-task-2.md
    status: implemented
    self_check:
      status: passed
      fingerprint: ${fp2}
`;
  writeFileSync(join(changeDir, 'change.yaml'), changeYaml);

  const batchIntent = {
    change: 'test-change',
    mode: 'all-approved-reachable',
    startRevision: startSha,
    orderedTasks: ['task-1', 'task-2'],
  };
  writeFileSync(join(changeDir, 'batch.json'), JSON.stringify(batchIntent, null, 2));

  return {
    root,
    activeDir,
    changeDir,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Batch Review CLI Step Progress Instrumentation (Task 06)', async (t) => {
  await t.test('actionDefinitions exposes batch-review step template', () => {
    assert.ok(actionDefinitions);
  });

  await t.test('batch-review emits real per-task progress events for batched tasks and writes report', () => {
    const fixture = setupBatchFixture();
    try {
      const output = captureStdout(() => {
        handleBatchReview('test-change', {
          activeDir: fixture.activeDir,
          gitRoot: fixture.root,
        });
      });

      const events = output.map(parseProgressLine).filter(Boolean);
      assert.ok(events.length >= 8, `Expected at least 8 events, got ${events.length}`);

      // 1. Operation started with all steps (readiness + per-task + report)
      const opStarted = events.find(e => e.type === 'operation.started');
      assert.ok(opStarted);
      assert.equal(opStarted.operationType, 'batch-review');
      assert.deepEqual(opStarted.steps.map(s => s.id), [
        'validate-batch-readiness',
        'review-task-task-1',
        'review-task-task-2',
        'generate-batch-report',
      ]);

      // 2. Validate readiness step completed
      const readinessStarted = events.find(e => e.type === 'operation.step.started' && e.stepId === 'validate-batch-readiness');
      const readinessCompleted = events.find(e => e.type === 'operation.step.completed' && e.stepId === 'validate-batch-readiness');
      assert.ok(readinessStarted);
      assert.ok(readinessCompleted);

      // 3. Per-task review steps executed
      const task1Started = events.find(e => e.type === 'operation.step.started' && e.stepId === 'review-task-task-1');
      const task1Completed = events.find(e => e.type === 'operation.step.completed' && e.stepId === 'review-task-task-1');
      assert.ok(task1Started);
      assert.ok(task1Completed);

      const task2Started = events.find(e => e.type === 'operation.step.started' && e.stepId === 'review-task-task-2');
      const task2Completed = events.find(e => e.type === 'operation.step.completed' && e.stepId === 'review-task-task-2');
      assert.ok(task2Started);
      assert.ok(task2Completed);

      // 4. Report generation completed
      const reportCompleted = events.find(e => e.type === 'operation.step.completed' && e.stepId === 'generate-batch-report');
      assert.ok(reportCompleted);

      // 5. Operation completed successfully
      const opCompleted = events.find(e => e.type === 'operation.completed');
      assert.ok(opCompleted);
      assert.ok(opCompleted.summary.includes('Batch review written'));
    } finally {
      fixture.cleanup();
    }
  });

  await t.test('batch-review fails operation when readiness validation fails (stale evidence)', () => {
    const fixture = setupBatchFixture({ staleEvidence: true });
    try {
      let threw = false;
      const output = captureStdout(() => {
        try {
          handleBatchReview('test-change', {
            activeDir: fixture.activeDir,
            gitRoot: fixture.root,
          });
        } catch {
          threw = true;
        }
      });

      assert.ok(threw);
      const events = output.map(parseProgressLine).filter(Boolean);

      // Readiness step failed
      const readinessFailed = events.find(e => e.type === 'operation.step.failed' && e.stepId === 'validate-batch-readiness');
      assert.ok(readinessFailed);

      // Subsequent steps were never started
      const task1Started = events.find(e => e.type === 'operation.step.started' && e.stepId === 'review-task-task-1');
      assert.equal(task1Started, undefined);

      // Operation overall failed
      const opFailed = events.find(e => e.type === 'operation.failed');
      assert.ok(opFailed);
    } finally {
      fixture.cleanup();
    }
  });
});
