// Unit tests for declarative workflow definition schema, unconditional and result-driven transitions,
// and definition normalization (AC1 - AC6).
// Run: node --test tools/tests/workflow-definitions.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import {
  validateWorkflowDefinition,
  normalizeWorkflowDefinition,
  validateTransitionDefinition,
  KNOWN_TRANSITION_VALUES,
} from '../specs/workflow/definitions/schema.mjs';

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
          transitions: [{ to: 'verified' }],
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
          transitions: [{ to: 'verified' }],
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
            { value: 'pass', to: 'verified' },
            { value: 'pass', to: 'archived' },
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
            { value: 'pass', to: 'verified' },
            { to: 'archived' },
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
          transitions: [{ value: 'pass', to: 'verified' }],
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
              { value: invalidValue, to: 'verified' },
              { value: 'pass', to: 'archived' },
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
          transitions: [{ to: 'verified' }],
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
            transitions: [{ to: terminalStatus }],
          },
        },
      };
      const { valid, errors } = validateWorkflowDefinition(raw);
      assert.equal(valid, true, `Expected target '${terminalStatus}' to be valid, got errors: ${errors.join(', ')}`);
    }
  });

  // AC6: normalizeWorkflowDefinition outputs normalized transitions preserving value (when present) and to
  test('AC6: normalizeWorkflowDefinition preserves value (when present) and to', () => {
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
            { value: 'pass', to: 'verified' },
            { value: 'fail', to: 'impl' },
            { value: 'blocked', to: 'archived' },
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
      { value: 'pass', to: 'verified' },
      { value: 'fail', to: 'impl' },
      { value: 'blocked', to: 'archived' },
    ]);
  });

  test('AC7: Standard workflow definition defines human-verification with pass -> verified and fail -> implementation', () => {
    const content = readFileSync('tools/specs/workflow/templates/standard.yaml', 'utf8');
    const parsed = parse(content);
    const { valid, errors } = validateWorkflowDefinition(parsed);
    assert.equal(valid, true, `Expected valid standard workflow: ${errors.join(', ')}`);
    const normalized = normalizeWorkflowDefinition(parsed);
    const hv = normalized.steps['human-verification'];
    assert.ok(hv, 'Expected human-verification step in standard workflow');
    assert.deepEqual(hv.transitions, [
      { value: 'pass', to: 'verified' },
      { value: 'fail', to: 'implementation' },
    ]);
  });
});
