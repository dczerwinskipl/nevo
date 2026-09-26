// Comprehensive tests for canonical deterministic TaskProjection (Task 12, D8, D9, D10, D15).
// Run: node --test tools/tests/deterministic-task-projection.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectTask,
  projectTaskState,
  getTaskProjection,
  TaskProjection,
} from '../specs/workflow/task-projection.mjs';

describe('Deterministic TaskProjection (Task 12, D10)', () => {
  const standardWorkflowDefinition = {
    id: 'standard-wf',
    entryStep: 'dev',
    steps: {
      dev: {
        executor: 'agent',
        purpose: 'Develop feature',
        expectedWork: { summary: 'Implement feature code' },
        transitions: [
          { to: 'qa' },
        ],
      },
      qa: {
        executor: 'agent',
        purpose: 'Quality assurance',
        expectedWork: { summary: 'Automated and manual tests' },
        transitions: [
          { value: 'pass', to: 'approval' },
          { value: 'fail', to: 'dev' },
        ],
      },
      approval: {
        executor: 'human',
        purpose: 'Stakeholder signoff',
        expectedWork: { summary: 'Review and approve' },
        transitions: [
          {
            value: 'approve',
            to: 'verified',
            action: { label: 'Approve' },
            outcome: 'success',
          },
          {
            value: 'reject',
            to: 'abandoned',
            action: { label: 'Reject' },
            outcome: 'failure',
          },
        ],
      },
    },
  };

  const change = {
    id: 'test-change',
    workflow: { mode: 'deterministic', definition: 'standard-wf' },
    workflowDefinition: standardWorkflowDefinition,
    tasks: [],
  };

  test('AC1: Task that finished agent step awaiting next step projects waiting-for-step-start with nextStep descriptor', () => {
    // dev finished -> nextStep is qa (agent step)
    const taskWaitingQa = {
      id: 'task-1',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'dev',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
        ],
      },
    };

    const proj1 = projectTask(taskWaitingQa, change, { definition: standardWorkflowDefinition });
    assert.equal(proj1.state, 'waiting-for-step-start');
    assert.equal(proj1.currentStep, 'dev');
    assert.equal(proj1.currentAttempt, 1);
    assert.equal(proj1.executor, 'agent');
    assert.deepEqual(proj1.nextStep, {
      id: 'qa',
      executor: 'agent',
      purpose: 'Quality assurance',
      expectedWork: { summary: 'Automated and manual tests' },
    });
    assert.equal(proj1.humanInteraction, null, 'humanInteraction must be null before activation');

    // qa finished -> nextStep is approval (human step)
    const taskWaitingApproval = {
      id: 'task-2',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'qa',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'pass', transitioned_to: 'approval' },
        ],
      },
    };

    const proj2 = projectTask(taskWaitingApproval, change, { definition: standardWorkflowDefinition });
    assert.equal(proj2.state, 'waiting-for-step-start');
    assert.equal(proj2.currentStep, 'qa');
    assert.equal(proj2.currentAttempt, 1);
    assert.equal(proj2.executor, 'human');
    assert.deepEqual(proj2.nextStep, {
      id: 'approval',
      executor: 'human',
      purpose: 'Stakeholder signoff',
      expectedWork: { summary: 'Review and approve' },
    });
    assert.equal(proj2.humanInteraction, null, 'humanInteraction must be null even for next human step before activation');
  });

  test('AC2: Review-fail loop back to agent step projects waiting-for-step-start and never auto-activates', () => {
    // qa step finished with 'fail', transitioning back to 'dev'
    const taskQAFailed = {
      id: 'task-qa-failed',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'qa',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'fail', transitioned_to: 'dev' },
        ],
      },
    };

    const proj = projectTask(taskQAFailed, change, { definition: standardWorkflowDefinition });
    assert.equal(proj.state, 'waiting-for-step-start');
    assert.equal(proj.currentStep, 'qa');
    assert.equal(proj.currentAttempt, 1);
    assert.equal(proj.executor, 'agent');
    assert.equal(proj.nextStep.id, 'dev');
    assert.equal(proj.humanInteraction, null);
  });

  test('AC3: Draft, unpublished task projects draft', () => {
    const draftTask = {
      id: 'task-draft',
      status: 'draft',
    };

    const proj = projectTask(draftTask, change, { definition: standardWorkflowDefinition });
    assert.equal(proj.state, 'draft');
    assert.equal(proj.currentStep, null);
    assert.equal(proj.currentAttempt, null);
    assert.equal(proj.executor, 'agent');
    assert.equal(proj.nextStep.id, 'dev');
    assert.deepEqual(proj.blockedBy, []);
  });

  test('AC4: Published task with unsatisfied dependency projects blocked and names blocking dependency', () => {
    const depTaskUnfinished = {
      id: 'dep-task-1',
      status: 'in-implementation',
      workflow_progress: {
        current_step: 'dev',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const blockedTask = {
      id: 'task-blocked',
      status: 'approved', // published
      depends_on: ['dep-task-1'],
    };

    const changeWithTasks = {
      ...change,
      tasks: [depTaskUnfinished, blockedTask],
    };

    const proj = projectTask(blockedTask, changeWithTasks, { definition: standardWorkflowDefinition });
    assert.equal(proj.state, 'blocked');
    assert.equal(proj.currentStep, null);
    assert.deepEqual(proj.blockedBy, ['dep-task-1']);
    assert.equal(proj.blockingDependencies.length, 1);
    assert.equal(proj.blockingDependencies[0].id, 'dep-task-1');

    // When dependency is satisfied (outcome: success) -> projects ready
    const depTaskFinished = {
      id: 'dep-task-1',
      status: 'verified',
      workflow_progress: {
        current_step: 'approval',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'pass', transitioned_to: 'approval' },
          { step: 'approval', attempt: 1, result: 'approve', transitioned_to: 'verified' },
        ],
      },
    };

    const changeWithSatisfiedTasks = {
      ...change,
      tasks: [depTaskFinished, blockedTask],
    };

    const readyProj = projectTask(blockedTask, changeWithSatisfiedTasks, { definition: standardWorkflowDefinition });
    assert.equal(readyProj.state, 'ready');
    assert.deepEqual(readyProj.blockedBy, []);
  });

  test('AC5: Task with active human step projects human-interaction with executor human and actions descriptor', () => {
    const activeApprovalTask = {
      id: 'task-approval-active',
      status: 'awaiting-approval',
      workflow_progress: {
        current_step: 'approval',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'pass', transitioned_to: 'approval' },
        ],
      },
    };

    const proj = projectTask(activeApprovalTask, change, { definition: standardWorkflowDefinition });
    assert.equal(proj.state, 'human-interaction');
    assert.equal(proj.currentStep, 'approval');
    assert.equal(proj.executor, 'human');
    assert.equal(proj.currentAttempt, 1);
    assert.ok(proj.humanInteraction);
    assert.equal(proj.humanInteraction.actions.length, 2);
    assert.equal(proj.humanInteraction.actions[0].result, 'approve');
    assert.equal(proj.humanInteraction.actions[0].label, 'Approve');
    assert.equal(proj.humanInteraction.actions[1].result, 'reject');
    assert.equal(proj.humanInteraction.actions[1].label, 'Reject');
  });

  test('AC6: Task whose matched terminal transition has outcome success/failure projects terminal with matching outcome', () => {
    // 1. Success outcome
    const successTask = {
      id: 'task-success',
      status: 'verified',
      workflow_progress: {
        current_step: 'approval',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'pass', transitioned_to: 'approval' },
          { step: 'approval', attempt: 1, result: 'approve', transitioned_to: 'verified' },
        ],
      },
    };

    const successProj = projectTask(successTask, change, { definition: standardWorkflowDefinition });
    assert.equal(successProj.state, 'terminal');
    assert.equal(successProj.terminalOutcome, 'success');
    assert.equal(successProj.terminalStatus, 'verified');

    // 2. Failure outcome
    const failureTask = {
      id: 'task-failure',
      status: 'abandoned',
      workflow_progress: {
        current_step: 'approval',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'dev', attempt: 1, transitioned_to: 'qa' },
          { step: 'qa', attempt: 1, result: 'pass', transitioned_to: 'approval' },
          { step: 'approval', attempt: 1, result: 'reject', transitioned_to: 'abandoned' },
        ],
      },
    };

    const failProj = projectTask(failureTask, change, { definition: standardWorkflowDefinition });
    assert.equal(failProj.state, 'terminal');
    assert.equal(failProj.terminalOutcome, 'failure');
    assert.equal(failProj.terminalStatus, 'abandoned');
  });

  test('AC7: Arbitrary non-standard workflow produces structurally identical output without step-name branching (D15)', () => {
    const customDefinition = {
      id: 'custom-wf',
      entryStep: 'discovery',
      steps: {
        discovery: {
          executor: 'agent',
          purpose: 'Discover requirements',
          expectedWork: { summary: 'Research domain' },
          transitions: [
            { to: 'hardening' },
          ],
        },
        hardening: {
          executor: 'agent',
          purpose: 'Harden implementation',
          expectedWork: { summary: 'Build and verify' },
          transitions: [
            { to: 'verified', outcome: 'success' },
          ],
        },
      },
    };

    const customChange = {
      id: 'custom-change',
      workflow: { mode: 'deterministic', definition: 'custom-wf' },
      workflowDefinition: customDefinition,
    };

    const taskDiscoveryActive = {
      id: 'task-custom',
      workflow_progress: {
        current_step: 'discovery',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const projDiscovery = projectTask(taskDiscoveryActive, customChange, { definition: customDefinition });
    assert.equal(projDiscovery.state, 'active');
    assert.equal(projDiscovery.currentStep, 'discovery');
    assert.equal(projDiscovery.executor, 'agent');

    const taskHardeningActive = {
      id: 'task-custom-2',
      workflow_progress: {
        current_step: 'hardening',
        current_attempt: 1,
        state: 'active',
        history: [
          { step: 'discovery', attempt: 1, transitioned_to: 'hardening' },
        ],
      },
    };

    const projHardening = projectTask(taskHardeningActive, customChange, { definition: customDefinition });
    assert.equal(projHardening.state, 'active');
    assert.equal(projHardening.currentStep, 'hardening');
    assert.equal(projHardening.executor, 'agent');

    // Structure shapes match 1:1
    assert.deepEqual(Object.keys(projDiscovery).sort(), Object.keys(projHardening).sort());
  });

  test('AC8: Return shape has no availableActions or git/session state fields', () => {
    const task = {
      id: 'task-check-keys',
      status: 'draft',
    };

    const proj = projectTask(task, change, { definition: standardWorkflowDefinition });
    assert.equal('availableActions' in proj, false, 'availableActions must NOT exist in TaskProjection');
    assert.equal('git' in proj, false, 'git state must NOT exist in TaskProjection');
    assert.equal('session' in proj, false, 'session state must NOT exist in TaskProjection');
    assert.equal('readiness' in proj, false, 'readiness must NOT exist in TaskProjection');
  });

  test('TaskProjection class and aliases export correctly', () => {
    const draftTask = { id: 'task-aliases', status: 'draft' };
    const p1 = projectTask(draftTask, change, { definition: standardWorkflowDefinition });
    const p2 = projectTaskState(draftTask, change, { definition: standardWorkflowDefinition });
    const p3 = getTaskProjection(draftTask, change, { definition: standardWorkflowDefinition });
    const p4 = TaskProjection.from(draftTask, change, { definition: standardWorkflowDefinition });
    const p5 = TaskProjection.project(draftTask, change, { definition: standardWorkflowDefinition });

    assert.deepEqual(p1, p2);
    assert.deepEqual(p1, p3);
    assert.deepEqual(p1, p4);
    assert.deepEqual(p1, p5);
  });
});
