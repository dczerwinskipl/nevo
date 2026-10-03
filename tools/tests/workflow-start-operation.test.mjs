// Tests for workflow start-operation and crash recovery (D52, D58).
// Run: node --test tools/tests/workflow-start-operation.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  planStart,
  completeActivateStage,
  completeConsumptionStage,
  findInFlightStartOperation,
  loadStartOperation,
} from '../specs/workflow/start-operation.mjs';
import {
  recordDependencyConsumption,
  loadDependencyConsumption,
} from '../specs/workflow/dependency-consumption.mjs';

describe('workflow-start-operation (D52, D58)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-start-op-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('planStart freezes dependencySnapshot and allocates monotonic consumptionSequence (D52, D58)', () => {
    const op1 = planStart({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      task: 'task-1',
      step: 'implement',
      attempt: 1,
      dependencySnapshot: [{ taskId: 'dep-a', releaseEpoch: { step: 'implement', attempt: 1 } }],
    });

    assert.equal(op1.consumptionSequence, 1);
    assert.equal(op1.status, 'running');
    assert.deepEqual(op1.dependencySnapshot, [{ taskId: 'dep-a', releaseEpoch: { step: 'implement', attempt: 1 } }]);

    completeActivateStage(tempRepoRoot, op1);
    completeConsumptionStage(tempRepoRoot, op1);

    // Attempt 2 gets sequence 2
    const op2 = planStart({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      task: 'task-1',
      step: 'implement',
      attempt: 2,
      dependencySnapshot: [{ taskId: 'dep-a', releaseEpoch: { step: 'implement', attempt: 2 } }],
    });

    assert.equal(op2.consumptionSequence, 2);
    completeActivateStage(tempRepoRoot, op2);
    completeConsumptionStage(tempRepoRoot, op2);
  });

  test('Crash recovery: crash between activate and consumption write resumes from original frozen snapshot and sequence (D52, D58)', () => {
    const frozenSnapshot = [
      { taskId: 'dep-1', releaseEpoch: { step: 'implement', attempt: 1 } },
      { taskId: 'dep-2', releaseEpoch: { step: 'implement', attempt: 3 } },
    ];

    // 1. Initial execution crashes after activate
    const op = planStart({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      task: 'task-crash',
      step: 'implement',
      attempt: 1,
      dependencySnapshot: frozenSnapshot,
    });
    assert.equal(op.consumptionSequence, 1);

    completeActivateStage(tempRepoRoot, op);
    // Simulating process crash before completeConsumptionStage or recordDependencyConsumption!

    // 2. Next start sees in-flight operation
    const inFlight = findInFlightStartOperation(tempRepoRoot, 'test-change', 'task-crash');
    assert.ok(inFlight);
    assert.equal(inFlight.status, 'running');
    assert.equal(inFlight.consumptionSequence, 1);
    assert.deepEqual(inFlight.dependencySnapshot, frozenSnapshot);

    const activateStage = inFlight.stages.find(s => s.id === 'activate');
    assert.equal(activateStage.status, 'completed');

    const consumeStage = inFlight.stages.find(s => s.id === 'record-consumption');
    assert.equal(consumeStage.status, 'pending');

    // 3. Complete consumption from original frozen snapshot and sequence
    recordDependencyConsumption({
      repoRoot: tempRepoRoot,
      change: 'test-change',
      consumingTaskId: inFlight.task,
      consumingStep: inFlight.step,
      consumingAttempt: inFlight.attempt,
      consumptionSequence: inFlight.consumptionSequence,
      dependencies: inFlight.dependencySnapshot,
    });
    completeConsumptionStage(tempRepoRoot, inFlight);

    // Verify persisted consumption matches frozen values
    const consumption = loadDependencyConsumption(tempRepoRoot, 'test-change', 'task-crash', 'implement', 1);
    assert.equal(consumption.consumptionSequence, 1);
    assert.deepEqual(consumption.dependencies, frozenSnapshot);

    // No longer in-flight
    assert.equal(findInFlightStartOperation(tempRepoRoot, 'test-change', 'task-crash'), null);
  });
});
