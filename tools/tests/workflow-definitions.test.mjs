// Unit tests for declarative workflow definition schema, unconditional and result-driven transitions,
// definition normalization, and Task 07 schema extensions (executor, action, outcome).
// Run: node --test tools/tests/workflow-definitions.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

import {
  validateWorkflowDefinition,
  normalizeWorkflowDefinition,
  validateTransitionDefinition,
  KNOWN_TRANSITION_VALUES,
  KNOWN_STEP_EXECUTORS,
  KNOWN_TRANSITION_OUTCOMES,
} from '../specs/workflow/definitions/schema.mjs';
import {
  parseWorkflowDefinition,
  loadWorkflowDefinition,
} from '../specs/workflow/definitions/loader.mjs';
import '../specs/workflow/actions/index.mjs';

const repoRoot = resolve(process.cwd());

describe('Workflow definition transitions and normalization (AC1 - AC6)', () => {
  // AC1: Accepts steps with a single unconditional transition ([{ to: 'review' }])
  test('AC1: accepts steps with a single unconditional transition', () => {
    const raw = {
      id: 'unconditional-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'review' }],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, `Expected valid workflow, got errors: ${errors.join(', ')}`);
  });

  // AC2: Accepts steps with multiple result-driven transitions
  test('AC2: accepts steps with multiple result-driven transitions', () => {
    const raw = {
      id: 'branching-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'review' }],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            { value: 'pass', to: 'human-verification' },
            { value: 'fail', to: 'implementation' },
          ],
        },
        'human-verification': {
          status: { active: 'awaiting-human-verification', completed: 'completed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, `Expected valid workflow, got errors: ${errors.join(', ')}`);
  });

  // AC3: Rejects steps with duplicate transition values or mixing conditional and unconditional transitions
  test('AC3: rejects steps with duplicate transition values', () => {
    const raw = {
      id: 'dup-values-workflow',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { value: 'pass', to: 'archived', outcome: 'failure' },
          ],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /duplicate transition value 'pass'/.test(e)));
  });

  test('AC3: rejects mixing conditional and unconditional transitions within the same step', () => {
    const raw = {
      id: 'mixed-transitions-workflow',
      steps: {
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { to: 'archived', outcome: 'failure' },
          ],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => /cannot mix conditional and unconditional transitions within the same step/.test(e)),
      `Expected mix error, got: ${errors.join('; ')}`
    );
  });

  test('AC3: rejects single transition with a value (unconditional steps must not require synthetic results)', () => {
    const raw = {
      id: 'single-conditional-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ value: 'pass', to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => /single transition must be unconditional and cannot specify 'value'/.test(e)),
      `Expected single conditional error, got: ${errors.join('; ')}`
    );
  });

  // AC4: Rejects transitions with values outside the v1 closed set (e.g. value: 'approved')
  test('AC4: rejects transitions with values outside the v1 closed set', () => {
    assert.deepEqual([...KNOWN_TRANSITION_VALUES], ['pass', 'fail', 'blocked']);

    for (const invalidValue of ['approved', 'changes-requested', 'rejected', 'custom-result']) {
      const raw = {
        id: 'invalid-val-workflow',
        steps: {
          review: {
            status: { active: 'reviewing', completed: 'reviewed' },
            transitions: [
              { value: invalidValue, to: 'verified', outcome: 'success' },
              { value: 'pass', to: 'archived', outcome: 'failure' },
            ],
          },
        },
      };
      const { valid, errors } = validateWorkflowDefinition(raw);
      assert.equal(valid, false, `Expected value '${invalidValue}' to be rejected`);
      assert.ok(
        errors.some(e => new RegExp(`unknown transition value '${invalidValue}'`).test(e)),
        `Expected unknown transition value error for '${invalidValue}', got: ${errors.join('; ')}`
      );
    }
  });

  // AC5: Rejects transitions targeting undeclared steps or colliding with terminal statuses
  test('AC5: rejects transitions targeting undeclared steps', () => {
    const raw = {
      id: 'undeclared-target-workflow',
      steps: {
        stepA: {
          status: { active: 'a-active', completed: 'a-completed' },
          transitions: [{ to: 'non-existent-step' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => /transition target 'non-existent-step' is neither a declared step nor a member of TERMINAL_STATUSES/.test(e))
    );
  });

  test('AC5: rejects steps whose names collide with terminal statuses', () => {
    const raw = {
      id: 'collision-workflow',
      steps: {
        implemented: {
          status: { active: 'imp-active', completed: 'imp-completed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => /step name collides with a terminal lifecycle status/.test(e))
    );
  });

  test('AC5: accepts transitions targeting valid terminal statuses', () => {
    for (const terminalStatus of ['implemented', 'verified', 'archived', 'abandoned']) {
      const raw = {
        id: `terminal-target-${terminalStatus}`,
        steps: {
          finalStep: {
            status: { active: 'fin-active', completed: 'fin-completed' },
            transitions: [{ to: terminalStatus, outcome: 'success' }],
          },
        },
      };
      const { valid, errors } = validateWorkflowDefinition(raw);
      assert.equal(valid, true, `Expected target '${terminalStatus}' to be valid, got errors: ${errors.join(', ')}`);
    }
  });

  // AC6: normalizeWorkflowDefinition outputs normalized transitions preserving value (when present) and to
  test('AC6: normalizeWorkflowDefinition preserves value (when present), to, action, and outcome', () => {
    const raw = {
      id: 'norm-workflow',
      steps: {
        impl: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'review' }],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            { value: 'pass', to: 'verified', outcome: 'success' },
            { value: 'fail', to: 'impl' },
            { value: 'blocked', to: 'archived', outcome: 'failure' },
          ],
        },
      },
    };

    const normalized = normalizeWorkflowDefinition(raw);
    assert.equal(normalized.steps.impl.transitions.length, 1);
    assert.deepEqual(normalized.steps.impl.transitions[0], { to: 'review' });
    assert.equal(normalized.steps.impl.transitions[0].value, undefined);

    assert.equal(normalized.steps.review.transitions.length, 3);
    assert.deepEqual(normalized.steps.review.transitions, [
      { value: 'pass', to: 'verified', outcome: 'success' },
      { value: 'fail', to: 'impl' },
      { value: 'blocked', to: 'archived', outcome: 'failure' },
    ]);
  });
});

describe('Workflow definition schema extensions (Task 07, D6, D9, D16)', () => {
  const workflowNames = ['standard', 'standard-v1', 'architectural', 'exploratory', 'small'];

  // AC1: All five migrated definitions validate against the extended schema.
  test('AC1: all five migrated definitions in .nevo-ai/workflows/ validate against the extended schema', () => {
    for (const name of workflowNames) {
      const def = loadWorkflowDefinition(name, { repoRoot });
      assert.ok(def, `Expected ${name} to load successfully`);
      assert.ok(def.steps, `Expected ${name} to have steps`);
    }
  });

  // AC2: Only standard.yaml/standard-v1.yaml's human-verification step carries executor: human;
  // every other step across all five files has no executor field and defaults to agent.
  test('AC2: only standard/standard-v1 human-verification step has executor: human; all other steps default to agent', () => {
    for (const name of workflowNames) {
      const filePath = resolve(repoRoot, `.nevo-ai/workflows/${name}.yaml`);
      const raw = parse(readFileSync(filePath, 'utf8'));
      const normalized = loadWorkflowDefinition(name, { repoRoot });

      for (const [stepName, rawStep] of Object.entries(raw.steps)) {
        const normStep = normalized.steps[stepName];
        if ((name === 'standard' || name === 'standard-v1') && stepName === 'human-verification') {
          assert.equal(rawStep.executor, 'human', `${name}.${stepName} raw YAML must declare executor: human`);
          assert.equal(normStep.executor, 'human', `${name}.${stepName} normalized must be executor: 'human'`);
        } else {
          assert.equal(rawStep.executor, undefined, `${name}.${stepName} raw YAML must have no executor field`);
          assert.equal(normStep.executor, 'agent', `${name}.${stepName} normalized must default to 'agent'`);
        }
      }
    }
  });

  // AC3: Every current terminal transition carries outcome: success. No internal transition carries outcome.
  test('AC3: terminal transitions carry outcome: success, internal transitions carry no outcome', () => {
    for (const name of workflowNames) {
      const def = loadWorkflowDefinition(name, { repoRoot });
      for (const [stepName, step] of Object.entries(def.steps)) {
        for (const transition of step.transitions) {
          if (['implemented', 'verified', 'archived', 'abandoned'].includes(transition.to)) {
            assert.equal(transition.outcome, 'success', `${name}.${stepName} terminal transition to ${transition.to} must carry outcome: 'success'`);
          } else {
            assert.equal(transition.outcome, undefined, `${name}.${stepName} internal transition to ${transition.to} must have no outcome`);
          }
        }
      }
    }
  });

  // AC4: architectural.yaml and exploratory.yaml {type: human, required: true} exit gates are untouched
  test('AC4: architectural.yaml and exploratory.yaml human exit gates are preserved', () => {
    const arch = loadWorkflowDefinition('architectural', { repoRoot });
    const humanGateArch = arch.steps.implementation.exitGates.find(g => g.type === 'human');
    assert.ok(humanGateArch, 'architectural implementation step must retain human exit gate');
    assert.equal(humanGateArch.required, true);

    const expl = loadWorkflowDefinition('exploratory', { repoRoot });
    const humanGateExpl = expl.steps.discovery.exitGates.find(g => g.type === 'human');
    assert.ok(humanGateExpl, 'exploratory discovery step must retain human exit gate');
    assert.equal(humanGateExpl.required, true);
  });

  // AC5: Cross-field validations
  test('AC5: executor: human step whose transition lacks action.label fails validation', () => {
    const raw = {
      id: 'missing-action-label',
      steps: {
        review: {
          executor: 'human',
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /executor: human.*action\.label/.test(e)), `Expected action.label error, got: ${errors.join('; ')}`);
  });

  test('AC5: transition targeting terminal status without outcome fails validation', () => {
    const raw = {
      id: 'missing-terminal-outcome',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'verified' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /outcome: required on a transition targeting a terminal status/.test(e)), `Expected terminal outcome error, got: ${errors.join('; ')}`);
  });

  test('AC5: outcome declared on an internal (step-targeting) transition fails validation', () => {
    const raw = {
      id: 'invalid-internal-outcome',
      steps: {
        stepA: {
          status: { active: 'a-active', completed: 'a-completed' },
          transitions: [{ to: 'stepB', outcome: 'success' }],
        },
        stepB: {
          status: { active: 'b-active', completed: 'b-completed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /outcome: cannot be declared on an internal transition/.test(e)), `Expected internal outcome error, got: ${errors.join('; ')}`);
  });

  test('AC5: invalid executor value fails validation', () => {
    const raw = {
      id: 'invalid-executor',
      steps: {
        implementation: {
          executor: 'robot',
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /executor: must be one of: agent, human/.test(e)), `Expected executor error, got: ${errors.join('; ')}`);
  });

  test('AC5: action.feedback without boolean required fails validation', () => {
    const raw = {
      id: 'invalid-feedback-req',
      steps: {
        review: {
          executor: 'human',
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            {
              to: 'verified',
              outcome: 'success',
              action: {
                label: 'Approve',
                feedback: { required: 'yes' },
              },
            },
          ],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(errors.some(e => /action\.feedback\.required: must be a boolean/.test(e)), `Expected feedback.required error, got: ${errors.join('; ')}`);
  });

  // AC7 & AC8: parseWorkflowDefinition() and loadWorkflowDefinition() return object with materialized executor, action, outcome
  test('AC7 & AC8: parseWorkflowDefinition and loadWorkflowDefinition return materialized executor, action, and outcome', () => {
    const standardDef = loadWorkflowDefinition('standard', { repoRoot });
    const hvStep = standardDef.steps['human-verification'];
    assert.equal(hvStep.executor, 'human');
    assert.equal(standardDef.steps.implementation.executor, 'agent');
    assert.equal(standardDef.steps.review.executor, 'agent');

    assert.deepEqual(hvStep.transitions, [
      {
        value: 'pass',
        to: 'verified',
        action: { label: 'Approve' },
        outcome: 'success',
      },
      {
        value: 'fail',
        to: 'implementation',
        action: { label: 'Request changes', feedback: { required: true } },
      },
    ]);

    const parsed = parseWorkflowDefinition(readFileSync(resolve(repoRoot, '.nevo-ai/workflows/standard.yaml'), 'utf8'));
    assert.equal(parsed.steps['human-verification'].executor, 'human');
    assert.equal(parsed.steps.implementation.executor, 'agent');
    assert.deepEqual(parsed.steps['human-verification'].transitions[0], {
      value: 'pass',
      to: 'verified',
      action: { label: 'Approve' },
      outcome: 'success',
    });
  });

  // AC9: Hypothetical human step with single unconditional transition validates without requiring value
  test('AC9: hypothetical human step with single unconditional transition validates without requiring value', () => {
    const raw = {
      id: 'unconditional-human-step',
      steps: {
        signoff: {
          executor: 'human',
          status: { active: 'signing-off', completed: 'signed-off' },
          transitions: [
            {
              to: 'verified',
              action: { label: 'Sign off' },
              outcome: 'success',
            },
          ],
        },
      },
    };
    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, `Expected valid unconditional human step: ${errors.join(', ')}`);

    const normalized = normalizeWorkflowDefinition(raw);
    const signoff = normalized.steps.signoff;
    assert.equal(signoff.executor, 'human');
    assert.equal(signoff.transitions.length, 1);
    assert.equal(signoff.transitions[0].value, undefined, 'Must not fabricate a value field');
    assert.equal(signoff.transitions[0].to, 'verified');
    assert.deepEqual(signoff.transitions[0].action, { label: 'Sign off' });
    assert.equal(signoff.transitions[0].outcome, 'success');
  });
});
