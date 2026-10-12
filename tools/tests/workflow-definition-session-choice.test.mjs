// Unit tests for session choice definition schema, validation, normalization, and resolveIncomingExecution.
// Run: node --test tools/tests/workflow-definition-session-choice.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  validateWorkflowDefinition,
  normalizeWorkflowDefinition,
} from '../specs/workflow/definitions/schema.mjs';
import {
  loadWorkflowDefinition,
} from '../specs/workflow/definitions/loader.mjs';
import {
  resolveIncomingExecution,
  matchIncomingTransition,
} from '../specs/workflow/resolve-incoming-execution.mjs';
import '../specs/workflow/actions/index.mjs';

const repoRoot = resolve(process.cwd());

describe('Workflow definition session-choice schema and validation (Task 01)', () => {
  test('A definition without allow/reuseFrom validates and normalizes identically to before', () => {
    const raw = {
      id: 'baseline-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            {
              to: 'verified',
              outcome: 'success',
            },
          ],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, `Expected valid workflow, got errors: ${errors.join(', ')}`);

    const normalized = normalizeWorkflowDefinition(raw);
    const trans = normalized.steps.implementation.transitions[0];
    assert.deepEqual(trans.execution, {
      session: 'fresh',
      role: 'reviewer',
    });
    assert.equal(trans.execution.allow, undefined);
    assert.equal(trans.execution.reuseFrom, undefined);
  });

  test('Valid definition with allow and reuseFrom validates and normalizes successfully', () => {
    const raw = {
      id: 'session-choice-workflow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: ['fresh', 'reuse'],
                reuseFrom: 'implementation',
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [
            {
              to: 'verified',
              outcome: 'success',
            },
          ],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, true, `Expected valid workflow, got errors: ${errors.join(', ')}`);

    const normalized = normalizeWorkflowDefinition(raw);
    const trans = normalized.steps.implementation.transitions[0];
    assert.deepEqual(trans.execution, {
      session: 'fresh',
      role: 'reviewer',
      allow: ['fresh', 'reuse'],
      reuseFrom: 'implementation',
    });
  });

  test('Rejects unknown policy in allow', () => {
    const raw = {
      id: 'invalid-allow-policy',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: ['fresh', 'invalid-policy'],
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => e.includes('execution.allow[1]') && e.includes("must be one of: reuse, fresh")),
      `Expected error about unknown policy in allow, got: ${errors.join(' | ')}`
    );
  });

  test('Rejects empty allow array', () => {
    const raw = {
      id: 'empty-allow',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: [],
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => e.includes('execution.allow: must be a non-empty array')),
      `Expected error about empty allow array, got: ${errors.join(' | ')}`
    );
  });

  test('Rejects allow that does not include declared session', () => {
    const raw = {
      id: 'allow-missing-declared',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: ['reuse'],
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => e.includes("execution.allow: must include declared session 'fresh'")),
      `Expected error about missing declared session, got: ${errors.join(' | ')}`
    );
  });

  test('Rejects reuseFrom naming nonexistent step', () => {
    const raw = {
      id: 'nonexistent-reusefrom',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: ['fresh', 'reuse'],
                reuseFrom: 'nonexistent-step',
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => e.includes("execution.reuseFrom: step 'nonexistent-step' does not exist in workflow definition")),
      `Expected error about nonexistent step in reuseFrom, got: ${errors.join(' | ')}`
    );
  });

  test('Rejects reuseFrom when reuse is neither declared nor in allow', () => {
    const raw = {
      id: 'reusefrom-not-allowed',
      steps: {
        implementation: {
          status: { active: 'implementing', completed: 'implemented' },
          transitions: [
            {
              to: 'review',
              execution: {
                session: 'fresh',
                role: 'reviewer',
                allow: ['fresh'],
                reuseFrom: 'implementation',
              },
            },
          ],
        },
        review: {
          status: { active: 'reviewing', completed: 'reviewed' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const { valid, errors } = validateWorkflowDefinition(raw);
    assert.equal(valid, false);
    assert.ok(
      errors.some(e => e.includes("execution.reuseFrom: only valid when 'reuse' is declared or allowed")),
      `Expected error about reuseFrom when reuse not allowed, got: ${errors.join(' | ')}`
    );
  });
});

describe('resolveIncomingExecution session choice fields (Task 01)', () => {
  const definition = {
    id: 'test-wf',
    steps: {
      implementation: {
        transitions: [
          {
            to: 'review',
            execution: {
              session: 'fresh',
              role: 'reviewer',
              allow: ['fresh', 'reuse'],
              reuseFrom: 'implementation',
            },
          },
        ],
      },
      review: {
        transitions: [
          {
            value: 'pass',
            to: 'human-verification',
            execution: {
              session: 'fresh',
              role: 'reviewer',
            },
          },
        ],
      },
      'human-verification': {
        transitions: [],
      },
    },
  };

  test('Returns allow and reuseFrom for annotated transition', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'implementation', transitioned_to: 'review' },
        ],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'review');
    assert.equal(res.error, null);
    assert.equal(res.session, 'fresh');
    assert.equal(res.role, 'reviewer');
    assert.deepEqual(res.allow, ['fresh', 'reuse']);
    assert.equal(res.reuseFrom, 'implementation');

    const matched = matchIncomingTransition(task, definition, 'review');
    assert.deepEqual(matched.allow, ['fresh', 'reuse']);
    assert.equal(matched.reuseFrom, 'implementation');
  });

  test('Returns default [session] and null reuseFrom for unannotated transition', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'review', result: 'pass', transitioned_to: 'human-verification' },
        ],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'human-verification');
    assert.equal(res.error, null);
    assert.equal(res.session, 'fresh');
    assert.equal(res.role, 'reviewer');
    assert.deepEqual(res.allow, ['fresh']);
    assert.equal(res.reuseFrom, null);

    const matched = matchIncomingTransition(task, definition, 'human-verification');
    assert.deepEqual(matched.allow, ['fresh']);
    assert.equal(matched.reuseFrom, null);
  });
});

describe('Shipped standard-v1.yaml loads and validates with annotations (Task 01)', () => {
  test('standard-v1 loads and contains annotated session choices', () => {
    const def = loadWorkflowDefinition('standard-v1', { repoRoot });
    assert.ok(def, 'standard-v1 loaded successfully');

    // implementation -> review
    const implToReview = def.steps.implementation.transitions.find(t => t.to === 'review');
    assert.ok(implToReview, 'implementation -> review transition exists');
    assert.equal(implToReview.execution.session, 'fresh');
    assert.deepEqual(implToReview.execution.allow, ['fresh', 'reuse']);
    assert.equal(implToReview.execution.reuseFrom, 'implementation');

    // human-verification -> implementation (fail / Request changes)
    const hvToImpl = def.steps['human-verification'].transitions.find(
      t => t.to === 'implementation' && t.value === 'fail'
    );
    assert.ok(hvToImpl, 'human-verification -> implementation (fail) transition exists');
    assert.equal(hvToImpl.execution.session, 'reuse');
    assert.deepEqual(hvToImpl.execution.allow, ['reuse', 'fresh']);
    assert.equal(hvToImpl.execution.reuseFrom, 'implementation');

    // review -> implementation (fail) is unchanged (fresh, no allow/reuseFrom)
    const reviewToImpl = def.steps.review.transitions.find(
      t => t.to === 'implementation' && t.value === 'fail'
    );
    assert.ok(reviewToImpl, 'review -> implementation (fail) transition exists');
    assert.equal(reviewToImpl.execution.session, 'fresh');
    assert.equal(reviewToImpl.execution.allow, undefined);
    assert.equal(reviewToImpl.execution.reuseFrom, undefined);
  });
});
