// Comprehensive tests for Batch Report (Task 05, AC1, AC2, AC3).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  renderBatchReport,
  writeBatchReport,
  getCanonicalBatchReportRelativePath,
} from '../specs/reviews/batch-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const mockFinalBatchContext = {
  batchExecutionId: 'batch-test-201',
  change: 'multi-task-spec',
  targetStep: 'review',
  executionScope: { kind: 'task-batch', taskIds: ['task-1', 'task-2', 'task-3'] },
  members: [
    {
      taskId: 'task-1',
      title: 'First Task',
      order: 1,
      status: 'in-implementation',
      allowedPaths: ['src/task1.js', 'src/shared.js'],
      forbiddenPaths: ['src/other.js'],
    },
    {
      taskId: 'task-2',
      title: 'Second Task',
      order: 2,
      status: 'in-implementation',
      allowedPaths: ['src/task2.js', 'src/shared.js'],
      forbiddenPaths: [],
    },
    {
      taskId: 'task-3',
      title: 'Third Task',
      order: 3,
      status: 'in-implementation',
      allowedPaths: ['src/task3.js'],
      forbiddenPaths: [],
    },
  ],
  requiredContext: [
    { path: 'docs/architecture.md', usedBy: ['task-1', 'task-2', 'task-3'] },
    { path: 'specs/active/multi-task-spec/overview.md', usedBy: ['task-1', 'task-2'] },
  ],
  relevantDocs: [
    { ref: 'docs/development/workflow.md', usedBy: ['task-1'] },
  ],
  crossTask: {
    findings: [
      {
        id: 'CT-1',
        message: 'Shared file src/shared.js overlap between task-1 and task-2',
        severity: 'warning',
        sharedPath: 'src/shared.js',
        affectedTaskIds: ['task-1', 'task-2'],
      },
    ],
    touchedPaths: {
      'src/shared.js': ['task-1', 'task-2'],
    },
  },
  predecessorSessions: [
    { taskId: 'task-1', sessionId: 'session-impl-1', priorStep: 'implementation', priorAttempt: 1 },
    { taskId: 'task-2', sessionId: 'session-impl-2', priorStep: 'implementation', priorAttempt: 1 },
    { taskId: 'task-3', sessionId: null },
  ],
};

test('1. AC1: Given final BatchContext, report renders one section per task plus cross-task findings with affectedTaskIds', () => {
  const rendered = renderBatchReport(mockFinalBatchContext, {
    results: {
      'task-1': { verdict: 'pass', feedback: 'All tests green, good coverage' },
      'task-2': { verdict: 'fail', feedback: 'Missing null check in shared handler' },
      'task-3': { verdict: 'pass', feedback: 'Clean independent implementation' },
    },
  });

  // Verify Header
  assert.ok(rendered.includes('# Batch Review Report: batch-test-201'));
  assert.ok(rendered.includes('- **Change:** multi-task-spec'));
  assert.ok(rendered.includes('- **Tasks in Scope:** task-1, task-2, task-3'));

  // Verify Cross-task findings section (D11)
  assert.ok(rendered.includes('## Cross-task findings'));
  assert.ok(rendered.includes('### CT-1'));
  assert.ok(rendered.includes('- **Affected Tasks:** task-1, task-2'));
  assert.ok(rendered.includes('Shared file src/shared.js overlap between task-1 and task-2'));
  assert.ok(rendered.includes('- **Severity:** warning'));

  // Verify Per-task sections
  assert.ok(rendered.includes('## Task: task-1 - First Task'));
  assert.ok(rendered.includes('- **Predecessor Session:** session-impl-1 (prior step: implementation, attempt: 1)'));
  assert.ok(rendered.includes('`src/task1.js`'));
  assert.ok(rendered.includes('`src/shared.js`'));
  assert.ok(rendered.includes('All tests green, good coverage'));

  assert.ok(rendered.includes('## Task: task-2 - Second Task'));
  assert.ok(rendered.includes('Missing null check in shared handler'));

  assert.ok(rendered.includes('## Task: task-3 - Third Task'));
  assert.ok(rendered.includes('- **Predecessor Session:** none'));
  assert.ok(rendered.includes('Clean independent implementation'));

  // Verify Shared Context Attribution
  assert.ok(rendered.includes('## Shared Context Attribution'));
  assert.ok(rendered.includes('docs/architecture.md'));
});

test('2. AC2: Static code check: batch-report.mjs contains zero calls to buildContextPacket, resolveIncomingExecution, and Git commits', () => {
  const sourcePath = path.join(REPO_ROOT, 'tools', 'specs', 'reviews', 'batch-report.mjs');
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.equal(
    source.includes('buildContextPacket'),
    false,
    'batch-report.mjs must contain zero calls to buildContextPacket'
  );
  assert.equal(
    source.includes('resolveIncomingExecution'),
    false,
    'batch-report.mjs must contain zero calls to resolveIncomingExecution'
  );
  assert.equal(
    source.includes('git.') || source.includes('git.mjs') || source.includes('addAndCommit') || source.includes('commitAll') || source.includes('runGit'),
    false,
    'batch-report.mjs must contain zero calls to Git commit operations'
  );
});

test('3. AC3: Determinism: rendering the same BatchContext twice produces byte-identical output', () => {
  const run1 = renderBatchReport(mockFinalBatchContext, {
    results: {
      'task-1': { verdict: 'pass', feedback: 'FB 1' },
      'task-2': { verdict: 'fail', feedback: 'FB 2' },
      'task-3': { verdict: 'pass', feedback: 'FB 3' },
    },
  });

  const run2 = renderBatchReport(mockFinalBatchContext, {
    results: {
      'task-1': { verdict: 'pass', feedback: 'FB 1' },
      'task-2': { verdict: 'fail', feedback: 'FB 2' },
      'task-3': { verdict: 'pass', feedback: 'FB 3' },
    },
  });

  assert.equal(run1, run2, 'Rendering must produce byte-identical output');
  assert.equal(Buffer.byteLength(run1), Buffer.byteLength(run2));
});

test('4. writeBatchReport writes canonical file to disk without committing', () => {
  const tmpRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-test-batch-report-write-'));

  try {
    const res = writeBatchReport(mockFinalBatchContext, {
      repoRoot: tmpRoot,
      results: {
        'task-1': 'pass',
        'task-2': 'pass',
        'task-3': 'pass',
      },
    });

    const expectedRelative = getCanonicalBatchReportRelativePath('multi-task-spec', 'batch-test-201');
    assert.equal(res.reportPath, expectedRelative);
    assert.equal(fs.existsSync(res.fullPath), true, 'Report file must exist on disk');

    const fileContent = fs.readFileSync(res.fullPath, 'utf8');
    assert.equal(fileContent, res.content);
    assert.ok(fileContent.includes('# Batch Review Report: batch-test-201'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
