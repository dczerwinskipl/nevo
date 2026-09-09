// Tests for the atomic, store-owned task-state mutation helper (D32, task 08
// multi-step-workflow-progression). Covers AC18: setTaskWorkflowState applies whichever
// of status/workflowProgress is supplied in one structural change.yaml read-modify-write,
// preserving comments/formatting the same way setTaskStatus already does, and requires at
// least one of the two fields.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireChange, requireTask, setTaskWorkflowState } from '../specs/store.mjs';

const CHANGE_YAML = `id: demo-change
title: "Demo change" # a trailing comment that must survive every mutation
status: draft
tasks:
  - id: demo-task
    order: 1
    file: tasks/01-demo.md
    status: in-implementation
`;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'nevo-store-workflow-state-'));
  const activeDir = join(root, 'specs', 'active');
  const changeDir = join(activeDir, 'demo-change');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), CHANGE_YAML);
  return { root, activeDir };
}

function freshChange(activeDir) {
  return requireChange('demo-change', activeDir);
}

describe('setTaskWorkflowState (D32, AC18)', () => {
  let fx;
  before(() => { fx = makeFixture(); });
  after(() => rmSync(fx.root, { recursive: true, force: true }));

  test('supplying both status and workflowProgress applies both in one structural mutation', () => {
    const change = freshChange(fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', {
      status: 'verified',
      workflowProgress: { current_step: 'implementation', history: [{ step: 'implementation', completed_at: '2026-09-09T00:00:00.000Z', transitioned_to: 'verified' }] },
    });

    const task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.status, 'verified');
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.history.length, 1);

    // Preserves comments/formatting the same way setTaskStatus already does (D32's own
    // stated requirement — the exact same updateYamlFile pattern, not a competing one).
    const raw = readFileSync(join(fx.activeDir, 'demo-change', 'change.yaml'), 'utf8');
    assert.match(raw, /# a trailing comment that must survive every mutation/);
  });

  test('status-only leaves an already-present workflow_progress completely untouched', () => {
    const change = freshChange(fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', { status: 'implemented' });

    const task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.status, 'implemented');
    // Untouched from the previous test's write, not reset/cleared (D28's own rule that
    // workflow_progress is never nulled — this helper must not contradict that itself).
    assert.equal(task.workflow_progress.current_step, 'implementation');
    assert.equal(task.workflow_progress.history.length, 1);
  });

  test('workflowProgress-only leaves the already-present status completely untouched', () => {
    const change = freshChange(fx.activeDir);
    setTaskWorkflowState(change, 'demo-task', {
      workflowProgress: { current_step: 'review', history: [] },
    });

    const task = requireTask(freshChange(fx.activeDir), 'demo-task');
    assert.equal(task.status, 'implemented', 'status must be unchanged from the prior test');
    assert.equal(task.workflow_progress.current_step, 'review');
    assert.deepEqual(task.workflow_progress.history, []);
  });

  test('supplying neither field is an explicit error, never a silent no-op', () => {
    const change = freshChange(fx.activeDir);
    assert.throws(
      () => setTaskWorkflowState(change, 'demo-task', {}),
      /requires at least one of status\/workflowProgress/
    );
    assert.throws(
      () => setTaskWorkflowState(change, 'demo-task'),
      /requires at least one of status\/workflowProgress/
    );
  });

  test('an unknown task id fails closed, naming the change file', () => {
    const change = freshChange(fx.activeDir);
    assert.throws(
      () => setTaskWorkflowState(change, 'no-such-task', { status: 'verified' }),
      /Task 'no-such-task' not found/
    );
  });
});
