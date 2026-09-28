import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIncomingExecution,
  matchIncomingTransition,
} from '../specs/workflow/resolve-incoming-execution.mjs';

describe('resolveIncomingExecution', () => {
  const definition = {
    steps: {
      draft: {
        name: 'draft',
        transitions: [
          {
            to: 'plan',
            role: 'planner',
            execution: { role: 'planner', session: 'fresh' },
          },
        ],
      },
      plan: {
        name: 'plan',
        transitions: [
          {
            to: 'implement',
            role: 'coder',
            execution: { role: 'coder', session: 'fresh' },
          },
        ],
      },
      implement: {
        name: 'implement',
        transitions: [
          {
            to: 'review',
            role: 'reviewer',
            execution: { role: 'reviewer', session: 'fresh' },
          },
        ],
      },
      review: {
        name: 'review',
        transitions: [
          {
            to: 'implement',
            role: 'coder',
            execution: { role: 'coder', session: 'reuse' },
          },
        ],
      },
      ambiguous: {
        name: 'ambiguous',
        transitions: [
          {
            to: 'implement',
            role: 'coder-a',
            execution: { role: 'coder-a', session: 'fresh' },
          },
          {
            to: 'implement',
            role: 'coder-b',
            execution: { role: 'coder-b', session: 'reuse' },
          },
        ],
      },
    },
  };

  it('resolves unambiguous incoming transition from history', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'draft', transitioned_to: 'plan', at: '2026-09-28T10:00:00Z' },
          { step: 'plan', transitioned_to: 'implement', at: '2026-09-28T10:30:00Z' },
        ],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'implement');
    assert.ok(res.transition);
    assert.equal(res.transition.to, 'implement');
    assert.equal(res.role, 'coder');
    assert.equal(res.session, 'fresh');
    assert.equal(res.ambiguous, false);
    assert.equal(res.error, null);
  });

  it('resolves reuse transition when incoming transition comes from review', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'draft', transitioned_to: 'plan', at: '2026-09-28T10:00:00Z' },
          { step: 'plan', transitioned_to: 'implement', at: '2026-09-28T10:30:00Z' },
          { step: 'implement', transitioned_to: 'review', at: '2026-09-28T11:00:00Z' },
          { step: 'review', transitioned_to: 'implement', at: '2026-09-28T11:30:00Z' },
        ],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'implement');
    assert.ok(res.transition);
    assert.equal(res.transition.to, 'implement');
    assert.equal(res.role, 'coder');
    assert.equal(res.session, 'reuse');
    assert.equal(res.ambiguous, false);
    assert.equal(res.error, null);
  });

  it('returns NO_INCOMING_TRANSITION for entry step with no incoming transitions', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'draft');
    assert.equal(res.transition, null);
    assert.equal(res.role, null);
    assert.equal(res.session, null);
    assert.equal(res.ambiguous, false);
    assert.equal(res.error, 'NO_INCOMING_TRANSITION');
  });

  it('returns AMBIGUOUS_TRANSITION_MATCH when history leads from step with multiple unkeyed transitions', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'ambiguous', transitioned_to: 'implement', at: '2026-09-28T10:00:00Z' },
        ],
      },
    };

    const res = resolveIncomingExecution(task, definition, 'implement');
    assert.equal(res.transition, null);
    assert.equal(res.role, null);
    assert.equal(res.ambiguous, true);
    assert.equal(res.error, 'AMBIGUOUS_TRANSITION_MATCH');
    assert.equal(res.candidates.length, 2);
  });

  it('legacy adapter matchIncomingTransition returns match or null', () => {
    const task = {
      id: 'task-1',
      workflow_progress: {
        history: [
          { step: 'plan', transitioned_to: 'implement', at: '2026-09-28T10:30:00Z' },
          { step: 'implement', transitioned_to: 'review', at: '2026-09-28T11:00:00Z' },
        ],
      },
    };

    const match = matchIncomingTransition(task, definition, 'review');
    assert.ok(match);
    assert.equal(match.ambiguous, false);
    assert.equal(match.role, 'reviewer');
    assert.equal(match.session, 'fresh');

    // Ambiguous returns ambiguous: true, transition: null
    const ambigTask = {
      id: 'task-2',
      workflow_progress: {
        history: [{ step: 'ambiguous', transitioned_to: 'implement' }],
      },
    };
    const ambigMatch = matchIncomingTransition(ambigTask, definition, 'implement');
    assert.equal(ambigMatch.transition, null);
    assert.equal(ambigMatch.ambiguous, true);

    // Entry step returns ambiguous: false, transition: null
    const entryTask = { id: 'task-3', workflow_progress: { history: [] } };
    const entryMatch = matchIncomingTransition(entryTask, definition, 'draft');
    assert.equal(entryMatch.transition, null);
    assert.equal(entryMatch.ambiguous, false);
  });
});
