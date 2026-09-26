// Tests for human-step projection (Task 10, D5, D10, D16).
// Run: node --test tools/tests/human-step-projection.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  describeStep,
  projectStepDescriptor,
  describeHumanInteraction,
  projectHumanInteraction,
} from '../specs/workflow/human-step/projection.mjs';

describe('Human-step projection (Task 10)', () => {
  const agentStep = {
    executor: 'agent',
    purpose: 'Implement feature code',
    expectedWork: {
      summary: 'Produce working implementation',
    },
    transitions: [
      { to: 'review' },
    ],
  };

  const defaultedAgentStep = {
    purpose: 'Code review',
    expectedWork: {
      summary: 'Review changes',
    },
    entryGates: [
      { type: 'human', id: 'gate-1' },
    ],
    exitGates: [
      { type: 'human', id: 'gate-2' },
    ],
    transitions: [
      { value: 'pass', to: 'signoff' },
      { value: 'fail', to: 'implement' },
    ],
  };

  const conditionalHumanStep = {
    executor: 'human',
    purpose: 'Product owner signoff',
    expectedWork: {
      summary: 'Verify feature meets business requirements',
    },
    transitions: [
      {
        value: 'pass',
        to: 'verified',
        action: {
          label: 'Approve',
        },
        outcome: 'success',
      },
      {
        value: 'fail',
        to: 'implement',
        action: {
          label: 'Request changes',
          feedback: {
            required: true,
          },
        },
      },
    ],
  };

  const unconditionalHumanStep = {
    executor: 'human',
    purpose: 'Acknowledgement',
    expectedWork: {
      summary: 'Acknowledge completion',
    },
    transitions: [
      {
        to: 'verified',
        action: {
          label: 'Acknowledge',
          feedback: {
            required: false,
          },
        },
        outcome: 'success',
      },
    ],
  };

  const workflowDefinition = {
    id: 'test-wf',
    entryStep: 'implement',
    steps: {
      implement: agentStep,
      review: defaultedAgentStep,
      signoff: conditionalHumanStep,
      ack: unconditionalHumanStep,
    },
  };

  test('AC1: describeStep returns correct descriptor for both agent and human steps, active or not', () => {
    // 1. Agent step with explicit executor
    const desc1 = describeStep(agentStep, 'implement');
    assert.deepEqual(desc1, {
      id: 'implement',
      executor: 'agent',
      purpose: 'Implement feature code',
      expectedWork: {
        summary: 'Produce working implementation',
      },
    });

    // 2. Defaulted agent step (no executor declared)
    const desc2 = describeStep(defaultedAgentStep, 'review');
    assert.deepEqual(desc2, {
      id: 'review',
      executor: 'agent',
      purpose: 'Code review',
      expectedWork: {
        summary: 'Review changes',
      },
    });

    // 3. Human step
    const desc3 = describeStep(conditionalHumanStep, 'signoff');
    assert.deepEqual(desc3, {
      id: 'signoff',
      executor: 'human',
      purpose: 'Product owner signoff',
      expectedWork: {
        summary: 'Verify feature meets business requirements',
      },
    });

    // 4. Using workflowDefinition lookup
    const descDef = describeStep(workflowDefinition, 'signoff');
    assert.deepEqual(descDef, desc3);

    // 5. Alias projectStepDescriptor
    assert.equal(projectStepDescriptor, describeStep);
  });

  test('AC2: For active human step, describeHumanInteraction returns actions with label and feedbackRequired', () => {
    const activeTask = {
      id: 'task-1',
      workflow_progress: {
        current_step: 'signoff',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const desc = describeHumanInteraction(activeTask, workflowDefinition);
    assert.ok(desc);
    assert.equal(desc.actions.length, 2);

    assert.deepEqual(desc.actions[0], {
      result: 'pass',
      label: 'Approve',
      feedbackRequired: false,
    });

    assert.deepEqual(desc.actions[1], {
      result: 'fail',
      label: 'Request changes',
      feedbackRequired: true,
    });
  });

  test('AC3: For active agent step (explicit or defaulted), describeHumanInteraction returns null regardless of human gates', () => {
    // Explicit agent step
    const activeTaskAgent = {
      id: 'task-impl',
      workflow_progress: {
        current_step: 'implement',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };
    assert.equal(describeHumanInteraction(activeTaskAgent, workflowDefinition), null);

    // Defaulted agent step with human entry/exit gates
    const activeTaskReview = {
      id: 'task-review',
      workflow_progress: {
        current_step: 'review',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };
    assert.equal(describeHumanInteraction(activeTaskReview, workflowDefinition), null);

    // Calling directly with step object having human gates
    assert.equal(describeHumanInteraction(defaultedAgentStep, { isActive: true }), null);
  });

  test('AC4: For next step (not yet active) with executor: human, describeStep returns purpose/expectedWork without activation', () => {
    // Task where implementation is completed and next step is signoff (not yet active)
    const taskWaitingForStepStart = {
      id: 'task-completed-step',
      workflow_progress: {
        current_step: 'implement',
        current_attempt: 1,
        state: 'completed',
        history: [
          { step: 'implement', transitioned_to: 'signoff' },
        ],
      },
    };

    // Generic descriptor is accessible from definition for 'signoff' without activation
    const descriptor = describeStep(workflowDefinition, 'signoff');
    assert.ok(descriptor);
    assert.equal(descriptor.id, 'signoff');
    assert.equal(descriptor.executor, 'human');
    assert.equal(descriptor.purpose, 'Product owner signoff');
    assert.equal(descriptor.expectedWork.summary, 'Verify feature meets business requirements');

    // And human interaction actions is null because task is not active on signoff
    assert.equal(describeHumanInteraction(taskWaitingForStepStart, workflowDefinition), null);
  });

  test('AC5: describeHumanInteraction returns non-null for human-owned step whose id is arbitrary (not hardcoded name)', () => {
    const customIdStep = {
      executor: 'human',
      purpose: 'Custom operator decision',
      transitions: [
        {
          value: 'proceed',
          to: 'verified',
          action: { label: 'Ship it' },
        },
      ],
    };

    const customWf = {
      id: 'custom-wf',
      steps: {
        'operator-manual-decision': customIdStep,
      },
    };

    const activeTask = {
      id: 'task-custom',
      workflow_progress: {
        current_step: 'operator-manual-decision',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const desc = describeHumanInteraction(activeTask, customWf);
    assert.ok(desc);
    assert.equal(desc.actions.length, 1);
    assert.equal(desc.actions[0].result, 'proceed');
    assert.equal(desc.actions[0].label, 'Ship it');
  });

  test('AC6: For active human step with conditional transitions, both actions entries carry result matching value', () => {
    const activeTask = {
      id: 'task-signoff',
      workflow_progress: {
        current_step: 'signoff',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const desc = describeHumanInteraction(activeTask, workflowDefinition);
    assert.ok(desc);
    assert.equal(desc.actions[0].result, 'pass');
    assert.equal(desc.actions[1].result, 'fail');
    assert.ok('result' in desc.actions[0]);
    assert.ok('result' in desc.actions[1]);
  });

  test('AC7: For active human step with unconditional transition, actions entry has no result property at all', () => {
    const activeTask = {
      id: 'task-ack',
      workflow_progress: {
        current_step: 'ack',
        current_attempt: 1,
        state: 'active',
        history: [],
      },
    };

    const desc = describeHumanInteraction(activeTask, workflowDefinition);
    assert.ok(desc);
    assert.equal(desc.actions.length, 1);
    const entry = desc.actions[0];
    assert.equal('result' in entry, false, "'result' property must NOT exist in entry");
    assert.equal(entry.label, 'Acknowledge');
    assert.equal(entry.feedbackRequired, false);

    // Direct invocation on unconditional step object
    const descDirect = describeHumanInteraction(unconditionalHumanStep, { isActive: true });
    assert.ok(descDirect);
    assert.equal('result' in descDirect.actions[0], false);
  });

  test('AC8: No prohibited literal strings or gate-engine imports exist in projection module', () => {
    const projectionSource = readFileSync(
      join(process.cwd(), 'tools', 'specs', 'workflow', 'human-step', 'projection.mjs'),
      'utf8'
    );

    // Prohibited literal strings
    const prohibitedStrings = [
      'human-verification',
      'owner-review',
      'acceptance',
      'HumanVerificationGate',
      'FileHumanVerificationStore',
      'lifecycle-primitives',
    ];

    for (const prohibited of prohibitedStrings) {
      assert.equal(
        projectionSource.includes(prohibited),
        false,
        `projection.mjs must not contain '${prohibited}'`
      );
    }
  });
});
