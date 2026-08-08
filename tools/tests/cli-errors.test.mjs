// Tests for tools/lib/cli-errors.mjs — the CliError base type and the
// canonical REC-01..REC-09 recovery scenario catalog (area recovery-and-resume).
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CliError, RecoveryError, RECOVERY_SCENARIOS } from '../lib/cli-errors.mjs';

describe('CliError', () => {
  test('is an Error with name CliError and the given message', () => {
    const err = new CliError('something went wrong');
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'CliError');
    assert.equal(err.message, 'something went wrong');
  });
});

const VALID_CLASSES = new Set(['automatic', 'confirm-required', 'owner-decision', 'unsafe-manual']);

describe('RECOVERY_SCENARIOS — the canonical nine-scenario set (D8)', () => {
  test('has exactly nine scenarios, REC-01 through REC-09', () => {
    const keys = Object.keys(RECOVERY_SCENARIOS).sort();
    assert.deepEqual(keys, [
      'REC-01', 'REC-02', 'REC-03', 'REC-04', 'REC-05', 'REC-06', 'REC-07', 'REC-08', 'REC-09',
    ]);
  });

  for (const [key, scenario] of Object.entries({
    'REC-01': { name: 'WRONG_BRANCH', class: 'automatic' },
    'REC-02': { name: 'REMOTE_BRANCH_ONLY', class: 'automatic' },
    'REC-03': { name: 'STALE_GENERATED_FILE', class: 'automatic' },
    'REC-04': { name: 'MECHANICAL_VALIDATION_FAILURE', class: 'confirm-required' },
    'REC-05': { name: 'DIRTY_WORKTREE_TASK_FILES', class: 'confirm-required' },
    'REC-06': { name: 'DIRTY_WORKTREE_UNRELATED_FILES', class: 'owner-decision' },
    'REC-07': { name: 'STALE_REVIEW_AFTER_SEMANTIC_CHANGE', class: 'confirm-required' },
    'REC-08': { name: 'SCOPE_EXPANSION', class: 'owner-decision' },
    'REC-09': { name: 'ADR_CONFLICT', class: 'unsafe-manual' },
  })) {
    test(`${key} ${scenario.name} is classified '${scenario.class}'`, () => {
      assert.equal(RECOVERY_SCENARIOS[key].code, key);
      assert.equal(RECOVERY_SCENARIOS[key].name, scenario.name);
      assert.equal(RECOVERY_SCENARIOS[key].class, scenario.class);
    });
  }

  test('every scenario has a real class, a description, and a proposed recovery', () => {
    for (const scenario of Object.values(RECOVERY_SCENARIOS)) {
      assert.ok(VALID_CLASSES.has(scenario.class), `${scenario.code} has an unrecognized class '${scenario.class}'`);
      assert.equal(typeof scenario.description, 'string');
      assert.ok(scenario.description.length > 0);
      assert.equal(typeof scenario.proposedRecovery, 'string');
      assert.ok(scenario.proposedRecovery.length > 0);
    }
  });

  test('confirmationRequired is false only for automatic and unsafe-manual scenarios', () => {
    for (const scenario of Object.values(RECOVERY_SCENARIOS)) {
      if (scenario.class === 'automatic' || scenario.class === 'unsafe-manual') {
        assert.equal(scenario.confirmationRequired, false, `${scenario.code}`);
      } else {
        assert.equal(scenario.confirmationRequired, true, `${scenario.code}`);
      }
    }
  });
});

describe('RecoveryError — machine-readable, not just a human sentence', () => {
  test('carries code, class, and previousAction from the catalog', () => {
    const err = new RecoveryError('REC-05', { detail: 'Dirty file(s): tools/foo.mjs' });
    assert.ok(err instanceof CliError);
    assert.equal(err.name, 'RecoveryError');
    assert.equal(err.code, 'REC-05');
    assert.equal(err.class, 'confirm-required');
    assert.equal(err.previousAction, 'start');
    assert.match(err.message, /REC-05/);
    assert.match(err.message, /Dirty file\(s\): tools\/foo\.mjs/);
  });

  test('exposes a machine-readable recovery: {class, suggestedFix, retryCommand} shape', () => {
    const err = new RecoveryError('REC-07');
    assert.deepEqual(err.recovery, {
      class: 'confirm-required',
      suggestedFix: RECOVERY_SCENARIOS['REC-07'].proposedRecovery,
      retryCommand: 'approve',
    });
  });

  test('previousAction can be overridden per-call', () => {
    const err = new RecoveryError('REC-08', { previousAction: 'complete' });
    assert.equal(err.previousAction, 'complete');
  });

  test('suspension defaults to null and can be attached', () => {
    const bare = new RecoveryError('REC-09');
    assert.equal(bare.suspension, null);
    const withSuspension = new RecoveryError('REC-06', { suspension: { kind: 'owner-decision', code: 'REC-06' } });
    assert.deepEqual(withSuspension.suspension, { kind: 'owner-decision', code: 'REC-06' });
  });

  test('an unknown scenario code throws', () => {
    assert.throws(() => new RecoveryError('REC-99'), /Unknown recovery scenario/);
  });
});
