// Comprehensive tests for deterministic dependency satisfaction (Task 11, D9).
// Run: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateDependencySatisfaction,
  isDependencySatisfied,
  resolveTaskTerminalOutcome,
  checkTaskDependencies,
} from '../specs/workflow/dependency-satisfaction.mjs';

describe('Deterministic dependency satisfaction (Task 11, D9)', () => {
  const workflowDefinition = {
    id: 'test-wf',
    entryStep: 'implement',
    steps: {
      implement: {
        executor: 'agent',
        transitions: [
          { to: 'review' },
        ],
      },
      review: {
        executor: 'agent',
        transitions: [
          { value: 'pass', to: 'signoff' },
          { value: 'fail', to: 'implement' },
        ],
      },
      signoff: {
        executor: 'human',
        transitions: [
          {
            value: 'approve',
            to: 'verified',
            outcome: 'success',
            action: { label: 'Approve' },
          },
          {
            value: 'reject',
            to: 'abandoned',
            outcome: 'failure',
            action: { label: 'Abandon' },
          },
        ],
      },
      direct: {
        executor: 'agent',
        transitions: [
          {
            to: 'verified',
            outcome: 'success',
          },
        ],
      },
    },
  };

  const change = {
    id: 'change-1',
    workflow: {
      mode: 'deterministic',
      definition: 'test-wf',
    },
    workflowDefinition,
  };

  test('AC1: Dependency task whose matched terminal transition has outcome: success is reported satisfied', () => {
    // 1. Conditional transition matching 'approve' -> verified (outcome: success)
    const successDepTask = {
      id: 'dep-success',
      workflow_progress: {
        current_step: 'signoff',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implement', attempt: 1, transitioned_to: 'review' },
          { step: 'review', attempt: 1, result: 'pass', transitioned_to: 'signoff' },
          { step: 'signoff', attempt: 1, result: 'approve', transitioned_to: 'verified' },
        ],
      },
    };

    const evalResult = evaluateDependencySatisfaction(successDepTask, change, workflowDefinition);
    assert.equal(evalResult.satisfied, true);
    assert.equal(evalResult.outcome, 'success');
    assert.equal(evalResult.terminalStatus, 'verified');
    assert.equal(evalResult.reason, null);

    assert.equal(isDependencySatisfied(successDepTask, change, workflowDefinition), true);

    // 2. Downstream task depending on this satisfied dependency
    const downstreamTask = {
      id: 'task-downstream',
      depends_on: ['dep-success'],
    };

    const check = checkTaskDependencies(downstreamTask, change, [successDepTask], workflowDefinition);
    assert.equal(check.satisfied, true);
    assert.deepEqual(check.blockingDependencies, []);
  });

  test('AC2: Dependency task whose matched terminal transition has outcome: failure is reported unsatisfied', () => {
    // Conditional transition matching 'reject' -> abandoned (outcome: failure)
    const failedDepTask = {
      id: 'dep-failure',
      workflow_progress: {
        current_step: 'signoff',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implement', attempt: 1, transitioned_to: 'review' },
          { step: 'review', attempt: 1, result: 'pass', transitioned_to: 'signoff' },
          { step: 'signoff', attempt: 1, result: 'reject', transitioned_to: 'abandoned' },
        ],
      },
    };

    const evalResult = evaluateDependencySatisfaction(failedDepTask, change, workflowDefinition);
    assert.equal(evalResult.satisfied, false);
    assert.equal(evalResult.outcome, 'failure');
    assert.equal(evalResult.terminalStatus, 'abandoned');
    assert.ok(evalResult.reason.includes('failure outcome'));

    assert.equal(isDependencySatisfied(failedDepTask, change, workflowDefinition), false);

    // Downstream task depending on failed dependency
    const downstreamTask = {
      id: 'task-downstream',
      depends_on: ['dep-failure'],
    };

    const check = checkTaskDependencies(downstreamTask, change, [failedDepTask], workflowDefinition);
    assert.equal(check.satisfied, false);
    assert.equal(check.blockingDependencies.length, 1);
    assert.equal(check.blockingDependencies[0].id, 'dep-failure');
    assert.equal(check.blockingDependencies[0].outcome, 'failure');
  });

  test('AC3: Dependency task implemented but awaiting review or human decision is unsatisfied (brief regression #11)', () => {
    // 1. Implementation step finished, but currently waiting for review or in-review
    const inReviewDepTask = {
      id: 'dep-in-review',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'implement', attempt: 1, transitioned_to: 'review' },
        ],
      },
    };

    const evalInReview = evaluateDependencySatisfaction(inReviewDepTask, change, workflowDefinition);
    assert.equal(evalInReview.satisfied, false);
    assert.ok(evalInReview.reason.includes('active'));

    // 2. Review finished (pass), currently waiting for signoff start (state: completed, next: signoff)
    const awaitingSignoffDepTask = {
      id: 'dep-awaiting-signoff',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implement', attempt: 1, transitioned_to: 'review' },
          { step: 'review', attempt: 1, result: 'pass', transitioned_to: 'signoff' },
        ],
      },
    };

    const evalAwaitingSignoff = evaluateDependencySatisfaction(awaitingSignoffDepTask, change, workflowDefinition);
    assert.equal(evalAwaitingSignoff.satisfied, false);
    assert.ok(evalAwaitingSignoff.reason.includes('internal step'));

    // 3. Downstream check blocked by awaiting task
    const downstream = {
      id: 'downstream-task',
      depends_on: ['dep-awaiting-signoff'],
    };
    const check = checkTaskDependencies(downstream, change, [awaitingSignoffDepTask], workflowDefinition);
    assert.equal(check.satisfied, false);
    assert.equal(check.blockingDependencies[0].id, 'dep-awaiting-signoff');
  });

  test('AC4: Dependency task whose last history entry names an internal transition is unsatisfied', () => {
    const internalTransitionTask = {
      id: 'dep-internal',
      workflow_progress: {
        current_step: 'implement',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implement', attempt: 1, transitioned_to: 'review' },
        ],
      },
    };

    const evalResult = evaluateDependencySatisfaction(internalTransitionTask, change, workflowDefinition);
    assert.equal(evalResult.satisfied, false);
    assert.ok(evalResult.reason.includes('internal step'));

    // Unconditional single transition to verified
    const directTerminalTask = {
      id: 'dep-direct',
      workflow_progress: {
        current_step: 'direct',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'direct', attempt: 1, transitioned_to: 'verified' },
        ],
      },
    };

    const evalDirect = evaluateDependencySatisfaction(directTerminalTask, change, workflowDefinition);
    assert.equal(evalDirect.satisfied, true);
    assert.equal(evalDirect.outcome, 'success');
  });

  test('Terminal outcome helper resolves terminal status and outcome', () => {
    const directTerminalTask = {
      id: 'dep-direct',
      workflow_progress: {
        current_step: 'direct',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'direct', attempt: 1, transitioned_to: 'verified' },
        ],
      },
    };

    const outcome = resolveTaskTerminalOutcome(directTerminalTask, workflowDefinition);
    assert.equal(outcome.isTerminal, true);
    assert.equal(outcome.outcome, 'success');
    assert.equal(outcome.status, 'verified');

    const inProgressTask = {
      id: 'dep-in-progress',
      workflow_progress: {
        current_step: 'implement',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const nonTerminal = resolveTaskTerminalOutcome(inProgressTask, workflowDefinition);
    assert.equal(nonTerminal.isTerminal, false);
    assert.equal(nonTerminal.outcome, null);
    assert.equal(nonTerminal.status, null);
  });
});
