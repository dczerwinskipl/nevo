// Tests for the D13/task-06 additions to tools/specs/validation.mjs:
// context_exceptions (decision-referenced), consequential_paths/forbidden_paths
// overlap, and their effect on computeTaskFingerprint. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadChange, computeTaskFingerprint, parseOwnerDecisions } from '../specs/service.mjs';
import { validateContextExceptions, validateConsequentialPaths } from '../specs/validation.mjs';

describe('validateContextExceptions (D13, AC1)', () => {
  const decisionsMap = parseOwnerDecisions('## D1: First\n\nText.\n\n## D2: Second\n\nText.\n');

  test('accepts an entry whose decision resolves in owner-decisions.md', () => {
    const errors = [];
    const fm = { context_exceptions: [{ omitted: 'docs/x.md', decision: 'D1', reason: 'not relevant' }] };
    validateContextExceptions(fm, decisionsMap, errors, 'label');
    assert.deepEqual(errors, []);
  });

  test('rejects an entry whose decision does not resolve', () => {
    const errors = [];
    const fm = { context_exceptions: [{ omitted: 'docs/x.md', decision: 'D99', reason: 'not relevant' }] };
    validateContextExceptions(fm, decisionsMap, errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unresolvable decision 'D99'/);
    assert.match(errors[0], /docs\/x\.md/);
  });

  test('rejects an entry missing a decision entirely', () => {
    const errors = [];
    const fm = { context_exceptions: [{ omitted: 'docs/x.md', reason: 'not relevant' }] };
    validateContextExceptions(fm, decisionsMap, errors, 'label');
    assert.equal(errors.length, 1);
  });

  test('a task with no context_exceptions at all is a no-op', () => {
    const errors = [];
    validateContextExceptions({}, decisionsMap, errors, 'label');
    assert.deepEqual(errors, []);
  });
});

describe('validateConsequentialPaths (AC3)', () => {
  test('rejects an overlap, naming both globs', () => {
    const errors = [];
    const fm = { consequential_paths: ['src/Foo/**'], forbidden_paths: ['src/**'] };
    validateConsequentialPaths(fm, errors, 'label');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /'src\/Foo\/\*\*' overlaps forbidden_paths 'src\/\*\*'/);
  });

  test('rejects the overlap in the other direction too (forbidden glob nested under consequential)', () => {
    const errors = [];
    const fm = { consequential_paths: ['docs/**'], forbidden_paths: ['docs/usage/**'] };
    validateConsequentialPaths(fm, errors, 'label');
    assert.equal(errors.length, 1);
  });

  test('accepts disjoint consequential_paths/forbidden_paths', () => {
    const errors = [];
    const fm = { consequential_paths: ['docs/routing.generated.json'], forbidden_paths: ['src/**', 'tests/**'] };
    validateConsequentialPaths(fm, errors, 'label');
    assert.deepEqual(errors, []);
  });

  test('a task with neither list at all is a no-op', () => {
    const errors = [];
    validateConsequentialPaths({}, errors, 'label');
    assert.deepEqual(errors, []);
  });
});

describe('computeTaskFingerprint — context_exceptions is part of the projection (AC2)', () => {
  let root;

  before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-validation-test-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  function writeFixture(slug, { taskAExceptions = '', taskBExceptions = '' } = {}) {
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), [
      'id: fixture',
      'title: Fixture',
      'status: draft',
      'tasks:',
      '  - id: task-a',
      '    file: tasks/a.md',
      '  - id: task-b',
      '    file: tasks/b.md',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks', 'a.md'), `---\nid: fixture.task-a\n${taskAExceptions}---\n# Task A\n`);
    writeFileSync(join(dir, 'tasks', 'b.md'), `---\nid: fixture.task-b\n${taskBExceptions}---\n# Task B\n`);
    return loadChange(slug, root);
  }

  test('a context_exceptions entry changes that task\'s fingerprint and no other task\'s', () => {
    const before = writeFixture('ctx-exc');
    const fpABefore = computeTaskFingerprint(before, 'task-a');
    const fpBBefore = computeTaskFingerprint(before, 'task-b');

    const after = writeFixture('ctx-exc', {
      taskAExceptions: "context_exceptions:\n  - omitted: docs/x.md\n    decision: D1\n    reason: n/a\n",
    });
    const fpAAfter = computeTaskFingerprint(after, 'task-a');
    const fpBAfter = computeTaskFingerprint(after, 'task-b');

    assert.notEqual(fpABefore, fpAAfter, 'task-a\'s own fingerprint must change');
    assert.equal(fpBBefore, fpBAfter, 'task-b\'s fingerprint must be unaffected');
  });
});
