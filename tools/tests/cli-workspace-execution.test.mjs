// Tests for cli-workspace-execution (D85).
// Run: node --test tools/tests/cli-workspace-execution.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordCliWorkspaceExecution,
  loadCliWorkspaceExecution,
  updateCliWorkspaceExecutionStatus,
  findInFlightCliWorkspaceExecution,
} from '../specs/workflow/cli-workspace-execution.mjs';

describe('cli-workspace-execution (D85)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-cli-exec-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('Records and loads cli-manual workspace execution record independently of dependency-consumption (D85)', () => {
    const record = recordCliWorkspaceExecution({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      taskId: 'test-task',
      step: 'review', // A step with no consumesDependencies
      attempt: 1,
      workspaceOwnerId: 'owner-cli-123',
    });

    assert.equal(record.change, 'test-change');
    assert.equal(record.taskId, 'test-task');
    assert.equal(record.step, 'review');
    assert.equal(record.attempt, 1);
    assert.equal(record.workspaceOwnerId, 'owner-cli-123');
    assert.equal(record.status, 'active');

    const loaded = loadCliWorkspaceExecution(tempRepoRoot, 'test-change', 'test-task', 'review', 1);
    assert.deepEqual(loaded, record);

    // Verify zero records created under workflow-start-operations or dependency-consumption
    const startOpDir = path.join(tempRepoRoot, '.nevo-ai-local', 'workflow-start-operations');
    const depConsumeDir = path.join(tempRepoRoot, '.nevo-ai-local', 'dependency-consumption');
    assert.equal(fs.existsSync(startOpDir), false);
    assert.equal(fs.existsSync(depConsumeDir), false);
  });

  test('Finds in-flight execution and updates status to completed or failed', () => {
    recordCliWorkspaceExecution({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      taskId: 'test-task',
      step: 'implement',
      attempt: 2,
      workspaceOwnerId: 'owner-cli-456',
    });

    const inFlight = findInFlightCliWorkspaceExecution(tempRepoRoot, 'test-change', 'test-task');
    assert.ok(inFlight);
    assert.equal(inFlight.attempt, 2);
    assert.equal(inFlight.status, 'active');

    // Update to completed
    const updated = updateCliWorkspaceExecutionStatus(tempRepoRoot, 'test-change', 'test-task', 'implement', 2, 'completed');
    assert.equal(updated.status, 'completed');

    const inFlightAfter = findInFlightCliWorkspaceExecution(tempRepoRoot, 'test-change', 'test-task');
    assert.equal(inFlightAfter, null);
  });
});
