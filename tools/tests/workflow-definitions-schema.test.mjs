import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  validateWorkflowDefinition,
  normalizeWorkflowDefinition,
  validateTransitionDefinition,
  KNOWN_CONTINUATION_MODES,
  KNOWN_EXECUTION_SESSIONS,
} from '../specs/workflow/definitions/schema.mjs';
import {
  loadWorkflowDefinition,
} from '../specs/workflow/definitions/loader.mjs';
import '../specs/workflow/actions/index.mjs';

const repoRoot = resolve(process.cwd());

describe('Task 25: Workflow continuation schema validation', () => {
  const baseSteps = {
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
      executor: 'human',
      status: { active: 'awaiting', completed: 'done' },
      transitions: [
        { value: 'pass', to: 'verified', outcome: 'success', action: { label: 'Approve' } },
        { value: 'fail', to: 'implementation', action: { label: 'Reject' } },
      ],
    },
  };

  test('continuation, releasesDependencies, and invalidatesDependencyRelease on terminal transition fail validation', () => {
    const rawCont = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success', continuation: 'auto' }],
        },
      },
    };
    const res1 = validateWorkflowDefinition(rawCont);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('continuation: cannot be declared on a terminal transition')));

    const rawRel = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success', releasesDependencies: true }],
        },
      },
    };
    const res2 = validateWorkflowDefinition(rawRel);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('releasesDependencies: cannot be declared on a terminal transition')));

    const rawInval = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success', invalidatesDependencyRelease: true }],
        },
      },
    };
    const res3 = validateWorkflowDefinition(rawInval);
    assert.equal(res3.valid, false);
    assert.ok(res3.errors.some(e => e.includes('invalidatesDependencyRelease: cannot be declared on a terminal transition')));
  });

  test('execution declared on a terminal transition fails validation', () => {
    const raw = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{
            to: 'verified',
            outcome: 'success',
            execution: { session: 'fresh', role: 'reviewer' },
          }],
        },
      },
    };
    const res = validateWorkflowDefinition(raw);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('execution: cannot be declared on a terminal transition')));
  });

  test('declaring both releasesDependencies: true and invalidatesDependencyRelease: true fails with clear error naming both', () => {
    const raw = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{
            to: 'step2',
            releasesDependencies: true,
            invalidatesDependencyRelease: true,
          }],
        },
        step2: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res = validateWorkflowDefinition(raw);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('releasesDependencies') && e.includes('invalidatesDependencyRelease')));
  });

  test('execution declared on a transition targeting a human-owned step fails validation', () => {
    const raw = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{
            to: 'step2',
            execution: { session: 'fresh', role: 'reviewer' },
          }],
        },
        step2: {
          executor: 'human',
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success', action: { label: 'Approve' } }],
        },
      },
    };
    const res = validateWorkflowDefinition(raw);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('execution: can only target an \'executor: agent\' step')));
  });

  test('validates schedulingPriority must be an integer and consumesDependencies must be a boolean', () => {
    const rawPrio = {
      id: 'test-wf',
      steps: {
        step1: {
          schedulingPriority: 3.14,
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res1 = validateWorkflowDefinition(rawPrio);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('schedulingPriority: must be an integer')));

    const rawCons = {
      id: 'test-wf',
      steps: {
        step1: {
          consumesDependencies: 'yes',
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res2 = validateWorkflowDefinition(rawCons);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('consumesDependencies: must be a boolean')));
  });

  test('validates execution.session and execution.role', () => {
    const raw = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{
            to: 'step2',
            execution: { session: 'invalid', role: 'worker' },
          }],
        },
        step2: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res1 = validateWorkflowDefinition(raw);
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some(e => e.includes('execution.session: must be one of: reuse, fresh')));

    raw.steps.step1.transitions[0].execution = { session: 'fresh', role: '   ' };
    const res2 = validateWorkflowDefinition(raw);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some(e => e.includes('execution.role: must be a non-empty string')));
  });

  test('validates continuation values', () => {
    const raw = {
      id: 'test-wf',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{
            to: 'step2',
            continuation: 'manual',
          }],
        },
        step2: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };
    const res = validateWorkflowDefinition(raw);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('continuation: must be one of: auto, owner-action')));
  });
});

describe('Task 25: Workflow continuation normalization', () => {
  test('normalizeWorkflowDefinition preserves all six fields and supplies defaults', () => {
    const raw = {
      id: 'sample-continuation',
      steps: {
        step1: {
          schedulingPriority: 5,
          consumesDependencies: true,
          status: { active: 's1-act', completed: 's1-done' },
          transitions: [{
            to: 'step2',
            continuation: 'auto',
            releasesDependencies: true,
            execution: { session: 'fresh', role: 'reviewer' },
          }],
        },
        step2: {
          status: { active: 's2-act', completed: 's2-done' },
          transitions: [
            {
              value: 'pass',
              to: 'verified',
              outcome: 'success',
            },
            {
              value: 'fail',
              to: 'step1',
              continuation: 'auto',
              invalidatesDependencyRelease: true,
              execution: { session: 'reuse', role: 'fixer' },
            },
          ],
        },
      },
    };

    const norm = normalizeWorkflowDefinition(raw);

    // Step 1
    assert.equal(norm.steps.step1.schedulingPriority, 5);
    assert.equal(norm.steps.step1.consumesDependencies, true);
    assert.deepEqual(norm.steps.step1.transitions[0], {
      to: 'step2',
      continuation: 'auto',
      releasesDependencies: true,
      execution: { session: 'fresh', role: 'reviewer' },
    });

    // Step 2
    assert.equal(norm.steps.step2.schedulingPriority, 0); // default
    assert.equal(norm.steps.step2.consumesDependencies, false); // default
    // Terminal transition (pass)
    assert.deepEqual(norm.steps.step2.transitions[0], {
      value: 'pass',
      to: 'verified',
      outcome: 'success',
    });
    // Internal transition (fail)
    assert.deepEqual(norm.steps.step2.transitions[1], {
      value: 'fail',
      to: 'step1',
      continuation: 'auto',
      invalidatesDependencyRelease: true,
      execution: { session: 'reuse', role: 'fixer' },
    });
  });

  test('internal transition without continuation preserves absent continuation verbatim', () => {
    const raw = {
      id: 'default-continuation',
      steps: {
        step1: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'step2' }],
        },
        step2: {
          status: { active: 'a', completed: 'c' },
          transitions: [{ to: 'verified', outcome: 'success' }],
        },
      },
    };

    const norm = normalizeWorkflowDefinition(raw);
    assert.equal(norm.steps.step1.transitions[0].continuation, undefined);
    assert.equal(norm.steps.step1.transitions[0].releasesDependencies, undefined);
    assert.equal(norm.steps.step1.transitions[0].invalidatesDependencyRelease, undefined);
    assert.equal(norm.steps.step1.transitions[0].execution, undefined);
  });
});

describe('Task 25: standard.yaml and standard-v1.yaml migrated definition conformance', () => {
  for (const defId of ['standard', 'standard-v1']) {
    test(`loads and validates .nevo-ai/workflows/${defId}.yaml with migrated fields`, () => {
      const def = loadWorkflowDefinition(defId, { repoRoot });
      assert.ok(def);
      assert.equal(def.id, 'standard-v1');

      // 1. implementation step
      const impl = def.steps.implementation;
      assert.equal(impl.consumesDependencies, true, 'implementation must declare consumesDependencies: true');
      assert.equal(impl.schedulingPriority, 0, 'implementation schedulingPriority must default to 0');
      assert.equal(impl.transitions.length, 1);
      assert.deepEqual(impl.transitions[0], {
        to: 'review',
        continuation: 'auto',
        releasesDependencies: true,
        execution: {
          session: 'fresh',
          role: 'reviewer',
        },
      });

      // 2. review step
      const review = def.steps.review;
      assert.equal(review.schedulingPriority, 10, 'review schedulingPriority must be 10');
      assert.equal(review.consumesDependencies, false, 'review consumesDependencies must default to false');
      assert.equal(review.transitions.length, 2);

      // pass -> human-verification
      const passTrans = review.transitions.find(t => t.value === 'pass');
      assert.deepEqual(passTrans, {
        value: 'pass',
        to: 'human-verification',
        continuation: 'auto',
      });

      // fail -> implementation
      const failTrans = review.transitions.find(t => t.value === 'fail');
      assert.deepEqual(failTrans, {
        value: 'fail',
        to: 'implementation',
        continuation: 'auto',
        invalidatesDependencyRelease: true,
        execution: {
          session: 'fresh',
          role: 'refiner',
        },
      });

      // 3. human-verification step
      const hv = def.steps['human-verification'];
      assert.equal(hv.schedulingPriority, 0, 'human-verification schedulingPriority must default to 0');
      assert.equal(hv.consumesDependencies, false, 'human-verification consumesDependencies must default to false');
      assert.equal(hv.transitions.length, 2);

      // pass -> verified (terminal)
      const hvPass = hv.transitions.find(t => t.value === 'pass');
      assert.deepEqual(hvPass, {
        value: 'pass',
        to: 'verified',
        action: { label: 'Approve' },
        outcome: 'success',
      });

      // fail -> implementation
      const hvFail = hv.transitions.find(t => t.value === 'fail');
      assert.deepEqual(hvFail, {
        value: 'fail',
        to: 'implementation',
        action: {
          label: 'Request changes',
          feedback: { required: true },
        },
        continuation: 'auto',
        invalidatesDependencyRelease: true,
        execution: {
          session: 'fresh',
          role: 'refiner',
        },
      });
    });
  }

  test('all five workflow definitions still load and validate cleanly', () => {
    const allDefs = ['architectural', 'exploratory', 'small', 'standard', 'standard-v1'];
    for (const defId of allDefs) {
      const def = loadWorkflowDefinition(defId, { repoRoot });
      assert.ok(def, `Failed to load workflow definition: ${defId}`);
    }
  });
});
