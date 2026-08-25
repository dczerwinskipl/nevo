// Tests for handleStart's PR-review-driven fixes (packet 03):
// startNeedsDirtyTreeCheck (Problem 1's ordering fix) and
// setTaskSuspension/clearTaskSuspension preserving unrelated `execution`
// sibling fields (the secondary issue). handleStart itself can't be driven
// end-to-end here (it reads the real repository's ACTIVE_DIR) — see
// startNeedsDirtyTreeCheck's own doc comment in tools/specs.mjs.
// Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startNeedsDirtyTreeCheck, setTaskSuspension, clearTaskSuspension } from '../specs.mjs';
import { loadChange } from '../specs/store.mjs';

describe('startNeedsDirtyTreeCheck — dirty-tree check ordering (PR review packet 03, Problem 1)', () => {
  test('never checks for a completed postcondition, regardless of branch', () => {
    assert.equal(startNeedsDirtyTreeCheck('completed', true), false);
    assert.equal(startNeedsDirtyTreeCheck('completed', false), false);
  });

  test('never checks for a not_retryable postcondition, regardless of branch', () => {
    assert.equal(startNeedsDirtyTreeCheck('not_retryable', true), false);
    assert.equal(startNeedsDirtyTreeCheck('not_retryable', false), false);
  });

  test('does not check when already on the expected branch — only the status write is missing (partially_completed)', () => {
    assert.equal(startNeedsDirtyTreeCheck('partially_completed', true), false);
  });

  test('does not check when already on the expected branch (safe_to_retry, e.g. re-running an idempotent start)', () => {
    assert.equal(startNeedsDirtyTreeCheck('safe_to_retry', true), false);
  });

  test('checks when a branch checkout/creation is actually about to happen', () => {
    assert.equal(startNeedsDirtyTreeCheck('safe_to_retry', false), true);
    assert.equal(startNeedsDirtyTreeCheck('partially_completed', false), true);
  });
});

describe('setTaskSuspension / clearTaskSuspension — preserve unrelated execution sibling fields', () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-start-test-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  function writeFixture(slug, executionYaml = '') {
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    status: approved', '    file: tasks/t1.md',
      executionYaml,
      '',
    ].filter(Boolean).join('\n'));
    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\n---\n# T1\n');
    return loadChange(slug, root);
  }

  test('setTaskSuspension preserves a pre-existing unrelated sibling field under execution', () => {
    const slug = 'preserve-sibling';
    const change = writeFixture(slug, '    execution:\n      future_field: keep-me');
    setTaskSuspension(change, 't1', { kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: '2026-01-01T00:00:00Z' });

    const reloaded = loadChange(slug, root);
    const task = reloaded.tasks.find(t => t.id === 't1');
    assert.equal(task.execution.future_field, 'keep-me', 'unrelated sibling field must survive a suspension write');
    assert.equal(task.execution.suspension.code, 'REC-05');
  });

  test('setTaskSuspension creates execution.suspension from scratch when execution does not exist yet', () => {
    const slug = 'create-fresh';
    const change = writeFixture(slug);
    setTaskSuspension(change, 't1', { kind: 'owner-decision', code: 'REC-06', previous_action: 'start', created_at: '2026-01-01T00:00:00Z' });

    const task = loadChange(slug, root).tasks.find(t => t.id === 't1');
    assert.equal(task.execution.suspension.code, 'REC-06');
  });

  test('setTaskSuspension overwrites a pre-existing suspension without disturbing other siblings', () => {
    const slug = 'overwrite-suspension';
    const change = writeFixture(slug, [
      '    execution:',
      '      future_field: keep-me',
      '      suspension:',
      '        kind: confirm-required',
      '        code: REC-05',
      '        previous_action: start',
      '        created_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));
    setTaskSuspension(loadChange(slug, root), 't1', { kind: 'owner-decision', code: 'REC-06', previous_action: 'start', created_at: '2026-01-02T00:00:00Z' });

    const task = loadChange(slug, root).tasks.find(t => t.id === 't1');
    assert.equal(task.execution.suspension.code, 'REC-06');
    assert.equal(task.execution.future_field, 'keep-me');
  });

  test('clearTaskSuspension removes only suspension, preserving an unrelated sibling field', () => {
    const slug = 'clear-preserve-sibling';
    const change = writeFixture(slug, [
      '    execution:',
      '      future_field: keep-me',
      '      suspension:',
      '        kind: confirm-required',
      '        code: REC-05',
      '        previous_action: start',
      '        created_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));
    clearTaskSuspension(loadChange(slug, root), 't1');

    const task = loadChange(slug, root).tasks.find(t => t.id === 't1');
    assert.equal(task.execution.suspension, undefined);
    assert.equal(task.execution.future_field, 'keep-me');
  });

  test('clearTaskSuspension removes the whole execution block when suspension was its only field', () => {
    const slug = 'clear-removes-empty-execution';
    const change = writeFixture(slug, [
      '    execution:',
      '      suspension:',
      '        kind: confirm-required',
      '        code: REC-05',
      '        previous_action: start',
      '        created_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));
    clearTaskSuspension(loadChange(slug, root), 't1');

    const task = loadChange(slug, root).tasks.find(t => t.id === 't1');
    assert.equal(task.execution, undefined);
  });

  test('clearTaskSuspension on a task with no execution block at all is a no-op', () => {
    const slug = 'clear-noop';
    const change = writeFixture(slug);
    assert.doesNotThrow(() => clearTaskSuspension(change, 't1'));
    assert.equal(loadChange(slug, root).tasks.find(t => t.id === 't1').execution, undefined);
  });
});
