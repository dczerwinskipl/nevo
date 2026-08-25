// Tests for the deterministic spec fingerprint (tools/specs/service.mjs).
// Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadChange } from '../specs/store.mjs';
import {
  computeSpecFingerprint, computeChangeFingerprint, computeTaskFingerprint, computeImplementationFingerprint,
  parseOwnerDecisions, parseConstraints,
} from '../specs/fingerprint.mjs';
import { validateSuspension, validateSelfCheck, validateSemanticReferences } from '../specs/validation.mjs';

let root;

function writeFixture(slug, { includeReview = false } = {}) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'areas'), { recursive: true });
  writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\n');
  writeFileSync(join(dir, 'overview.md'), '# Fixture\n\nGoal text.\n');
  writeFileSync(join(dir, 'owner-decisions.md'), '## D1\n\nSome decision.\n');
  writeFileSync(join(dir, 'areas', '01-a.md'), '# Area A\n');
  writeFileSync(join(dir, 'tasks', '01-t.md'), '---\nid: fixture.t\n---\n# Task\n');
  if (includeReview) {
    mkdirSync(join(dir, 'reviews'), { recursive: true });
    writeFileSync(join(dir, 'reviews', 'spec.md'), '---\nverdict: ready-for-approval\n---\n# Review\n');
  }
  return loadChange(slug, root);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'nevo-fingerprint-test-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('computeSpecFingerprint', () => {
  test('is deterministic — same inputs produce the same hash across calls', () => {
    const change = writeFixture('det-check');
    const a = computeSpecFingerprint(change);
    const b = computeSpecFingerprint(change);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/, 'expected a sha256 hex digest');
  });

  test('changes when a covered file (overview.md) changes', () => {
    const change = writeFixture('change-sensitive');
    const before = computeSpecFingerprint(change);
    writeFileSync(join(root, 'change-sensitive', 'overview.md'), '# Fixture\n\nGoal text CHANGED.\n');
    const after = computeSpecFingerprint(change);
    assert.notEqual(before, after);
  });

  test('changes when a task file changes', () => {
    const change = writeFixture('task-sensitive');
    const before = computeSpecFingerprint(change);
    writeFileSync(join(root, 'task-sensitive', 'tasks', '01-t.md'), '---\nid: fixture.t\n---\n# Task CHANGED\n');
    const after = computeSpecFingerprint(change);
    assert.notEqual(before, after);
  });

  test('is NOT affected by files under reviews/ — writing the review must not invalidate its own fingerprint', () => {
    const withoutReview = writeFixture('review-excluded');
    const beforeReview = computeSpecFingerprint(withoutReview);

    const withReview = writeFixture('review-excluded', { includeReview: true });
    const afterReview = computeSpecFingerprint(withReview);

    assert.equal(beforeReview, afterReview);
  });

  test('two independently-built fixtures with identical content produce the same fingerprint', () => {
    const a = writeFixture('identical-a');
    const b = writeFixture('identical-b');
    assert.equal(computeSpecFingerprint(a), computeSpecFingerprint(b));
  });
});

// ── Three-tier canonical semantic fingerprint (D7, D18, D27, D28) ──────────

const OVERVIEW = `# Fixture

## Constraints

- **C1.** First constraint text.
- **C2.** Second constraint text.
`;

const OWNER_DECISIONS = `## D1: First

Text of D1.

Refined by: D2 is authoritative on this question.

## D2: Second

Text of D2.

## D3: Third

Text of D3.
`;

function writeTierFixture(slug, { overview = OVERVIEW, ownerDecisions = OWNER_DECISIONS } = {}) {
  const dir = join(root, slug);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'change.yaml'), [
    'id: fixture',
    'title: Fixture',
    'status: draft',
    'tasks:',
    '  - id: t1',
    '    order: 1',
    '    file: tasks/01-t1.md',
    '    status: draft',
    '  - id: t2',
    '    order: 2',
    '    file: tasks/02-t2.md',
    '    status: draft',
    '    depends_on: [t1]',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'overview.md'), overview);
  writeFileSync(join(dir, 'owner-decisions.md'), ownerDecisions);
  writeFileSync(join(dir, 'tasks', '01-t1.md'), [
    '---',
    'id: fixture.t1',
    'status: draft',
    'semantic_references:',
    '  constraints: [C1]',
    '---',
    '# Task T1',
    '',
    'Goal text for t1.',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks', '02-t2.md'), [
    '---',
    'id: fixture.t2',
    'status: draft',
    'semantic_references:',
    '  dependency_contracts: [t1]',
    '  decisions: [D2]',
    '---',
    '# Task T2',
    '',
    'Goal text for t2.',
    '',
  ].join('\n'));
  return () => loadChange(slug, root);
}

describe('computeChangeFingerprint — change scope, constraints, and task graph shape', () => {
  test('is deterministic', () => {
    const load = writeTierFixture('change-det');
    assert.equal(computeChangeFingerprint(load()), computeChangeFingerprint(load()));
  });

  test("Task T's status changing does not invalidate the change-level fingerprint", () => {
    const load = writeTierFixture('change-status');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-status', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: approved',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]', '',
    ].join('\n'));
    assert.equal(computeChangeFingerprint(load()), before);
  });

  test("a task's own acceptance-criteria/body change does not invalidate the change-level fingerprint (task-scoped)", () => {
    const load = writeTierFixture('change-task-body');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-task-body', 'tasks', '01-t1.md'), [
      '---', 'id: fixture.t1', 'status: draft', '---', '# Task T1 CHANGED', '',
    ].join('\n'));
    assert.equal(computeChangeFingerprint(load()), before);
  });

  test('shared constraint text (overview.md) changing invalidates the change-level fingerprint', () => {
    const load = writeTierFixture('change-constraint');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-constraint', 'overview.md'), OVERVIEW.replace('First constraint text.', 'CHANGED constraint text.'));
    assert.notEqual(computeChangeFingerprint(load()), before);
  });

  test('an owner decision changing alone (overview.md unchanged) does not invalidate the change-level fingerprint', () => {
    const load = writeTierFixture('change-decision-only');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-decision-only', 'owner-decisions.md'), OWNER_DECISIONS.replace('Text of D2.', 'Text of D2 CHANGED.'));
    assert.equal(computeChangeFingerprint(load()), before);
  });

  test('adding a new, unrelated task always invalidates the change-level fingerprint (D27)', () => {
    const load = writeTierFixture('change-task-added');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-task-added', 'tasks', '03-t3.md'), '---\nid: fixture.t3\nstatus: draft\n---\n# Task T3\n');
    writeFileSync(join(root, 'change-task-added', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]',
      '  - id: t3', '    order: 3', '    file: tasks/03-t3.md', '    status: draft', '',
    ].join('\n'));
    assert.notEqual(computeChangeFingerprint(load()), before);
  });

  test('removing an existing, unrelated task always invalidates the change-level fingerprint (D27)', () => {
    const load = writeTierFixture('change-task-removed');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-task-removed', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft', '',
    ].join('\n'));
    assert.notEqual(computeChangeFingerprint(load()), before);
  });

  test("the dependency graph changing a task's prerequisites invalidates the change-level fingerprint (task graph shape)", () => {
    const load = writeTierFixture('change-depends-on');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-depends-on', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '',
    ].join('\n'));
    assert.notEqual(computeChangeFingerprint(load()), before);
  });

  test('reordering tasks in change.yaml (same graph shape) does not change the change-level fingerprint', () => {
    const load = writeTierFixture('change-reorder-tasks');
    const before = computeChangeFingerprint(load());
    writeFileSync(join(root, 'change-reorder-tasks', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft', '',
    ].join('\n'));
    assert.equal(computeChangeFingerprint(load()), before);
  });
});

describe('computeTaskFingerprint — task definition + resolved semantic_references (D18)', () => {
  test('is deterministic', () => {
    const load = writeTierFixture('task-det');
    assert.equal(computeTaskFingerprint(load(), 't1'), computeTaskFingerprint(load(), 't1'));
  });

  test("a task's own body change invalidates its own task-level fingerprint", () => {
    const load = writeTierFixture('task-own-body');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-own-body', 'tasks', '01-t1.md'), [
      '---', 'id: fixture.t1', 'status: draft', 'semantic_references:', '  constraints: [C1]', '---',
      '# Task T1', '', 'Goal text for t1 CHANGED.', '',
    ].join('\n'));
    assert.notEqual(computeTaskFingerprint(load(), 't1'), before);
  });

  test("a task's own status change does not invalidate its task-level fingerprint", () => {
    const load = writeTierFixture('task-own-status');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-own-status', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: approved',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test('execution.suspension is excluded from the task-level fingerprint', () => {
    const load = writeTierFixture('task-suspension');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-suspension', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: approved',
      '    execution:', '      suspension:', '        kind: confirm-required', '        code: REC-05',
      '        previous_action: start', '        created_at: "2026-08-04T00:00:00Z"',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test('self_check is excluded from the task-level fingerprint', () => {
    const load = writeTierFixture('task-self-check');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-self-check', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft',
      '    self_check:', '      status: failed', '      fingerprint: abc', '      revision: def',
      '      failed_criteria: [AC-1]', '      commands:', '        - command: "node foo.mjs"', '          exit_code: 1',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test("an unrelated task's status/body change does not invalidate a task that doesn't reference it", () => {
    const load = writeTierFixture('task-unrelated');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-unrelated', 'tasks', '02-t2.md'), [
      '---', 'id: fixture.t2', 'status: approved', 'semantic_references:',
      '  dependency_contracts: [t1]', '  decisions: [D2]', '---', '# Task T2 CHANGED', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test("T2's fingerprint changes when T1's body changes, because T2's dependency_contracts names T1", () => {
    const load = writeTierFixture('task-dep-contract');
    const before = computeTaskFingerprint(load(), 't2');
    writeFileSync(join(root, 'task-dep-contract', 'tasks', '01-t1.md'), [
      '---', 'id: fixture.t1', 'status: draft', 'semantic_references:', '  constraints: [C1]', '---',
      '# Task T1', '', 'Goal text for t1 CHANGED.', '',
    ].join('\n'));
    assert.notEqual(computeTaskFingerprint(load(), 't2'), before);
  });

  test("T2's fingerprint changes when its referenced decision D2's text changes", () => {
    const load = writeTierFixture('task-decision-change');
    const before = computeTaskFingerprint(load(), 't2');
    writeFileSync(join(root, 'task-decision-change', 'owner-decisions.md'), OWNER_DECISIONS.replace('Text of D2.', 'Text of D2 CHANGED.'));
    assert.notEqual(computeTaskFingerprint(load(), 't2'), before);
  });

  test("T2's fingerprint is unaffected when an unreferenced decision (D3) changes", () => {
    const load = writeTierFixture('task-decision-unreferenced');
    const before = computeTaskFingerprint(load(), 't2');
    writeFileSync(join(root, 'task-decision-unreferenced', 'owner-decisions.md'), OWNER_DECISIONS.replace('Text of D3.', 'Text of D3 CHANGED.'));
    assert.equal(computeTaskFingerprint(load(), 't2'), before);
  });

  test('a superseded decision resolves to the currently-active decision\'s text, not the stale one', () => {
    const decisionsMap = parseOwnerDecisions(OWNER_DECISIONS);
    assert.equal(decisionsMap.get('D1').supersededBy, 'D2');
    assert.equal(decisionsMap.get('D2').supersededBy, null);

    const load = writeTierFixture('task-superseded-decision');
    // Reference D1 (superseded by D2) instead of D2 directly.
    writeFileSync(join(root, 'task-superseded-decision', 'tasks', '02-t2.md'), [
      '---', 'id: fixture.t2', 'status: draft', 'semantic_references:',
      '  dependency_contracts: [t1]', '  decisions: [D1]', '---', '# Task T2', '', 'Goal text for t2.', '',
    ].join('\n'));
    const before = computeTaskFingerprint(load(), 't2');
    // Changing D2's (the active decision's) text must still invalidate T2's fingerprint,
    // even though T2's own reference names the now-superseded D1.
    writeFileSync(join(root, 'task-superseded-decision', 'owner-decisions.md'), OWNER_DECISIONS.replace('Text of D2.', 'Text of D2 CHANGED.'));
    assert.notEqual(computeTaskFingerprint(load(), 't2'), before);
  });

  test("T1's fingerprint changes when its referenced constraint C1's text changes", () => {
    const load = writeTierFixture('task-constraint-change');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-constraint-change', 'overview.md'), OVERVIEW.replace('First constraint text.', 'CHANGED constraint text.'));
    assert.notEqual(computeTaskFingerprint(load(), 't1'), before);
  });

  test("T1's fingerprint is unaffected when an unreferenced constraint (C2) changes", () => {
    const load = writeTierFixture('task-constraint-unreferenced');
    const before = computeTaskFingerprint(load(), 't1');
    writeFileSync(join(root, 'task-constraint-unreferenced', 'overview.md'), OVERVIEW.replace('Second constraint text.', 'CHANGED constraint text.'));
    assert.equal(computeTaskFingerprint(load(), 't1'), before);
  });

  test("adding a new task not named in T2's dependency_contracts does not invalidate T2's task-level fingerprint", () => {
    const load = writeTierFixture('task-add-unreferenced');
    const before = computeTaskFingerprint(load(), 't2');
    writeFileSync(join(root, 'task-add-unreferenced', 'tasks', '03-t3.md'), '---\nid: fixture.t3\nstatus: draft\n---\n# Task T3\n');
    writeFileSync(join(root, 'task-add-unreferenced', 'change.yaml'), [
      'id: fixture', 'title: Fixture', 'status: draft', 'tasks:',
      '  - id: t1', '    order: 1', '    file: tasks/01-t1.md', '    status: draft',
      '  - id: t2', '    order: 2', '    file: tasks/02-t2.md', '    status: draft', '    depends_on: [t1]',
      '  - id: t3', '    order: 3', '    file: tasks/03-t3.md', '    status: draft', '',
    ].join('\n'));
    assert.equal(computeTaskFingerprint(load(), 't2'), before);
  });

  test('reordering a set-like list (allowed_paths) does not change the fingerprint', () => {
    const slug = 'task-reorder-allowed-paths';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nallowed_paths:\n  - a.mjs\n  - b.mjs\n  - c.mjs\n---\n# T1\n');
    const before = computeTaskFingerprint(loadChange(slug, root), 't1');

    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nallowed_paths:\n  - c.mjs\n  - a.mjs\n  - b.mjs\n---\n# T1\n');
    assert.equal(computeTaskFingerprint(loadChange(slug, root), 't1'), before);
  });

  test('reordering semantic_references.decisions does not change the fingerprint (resolved content is what matters, not declaration order)', () => {
    const slug = 'task-reorder-sr-decisions';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'owner-decisions.md'), OWNER_DECISIONS);
    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nsemantic_references:\n  decisions: [D2, D3]\n---\n# T1\n');
    const before = computeTaskFingerprint(loadChange(slug, root), 't1');

    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nsemantic_references:\n  decisions: [D3, D2]\n---\n# T1\n');
    assert.equal(computeTaskFingerprint(loadChange(slug, root), 't1'), before);
  });

  test('reordering context.required/context.optional does not change the fingerprint', () => {
    const slug = 'task-reorder-context';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\ncontext:\n  required:\n    - a.md\n    - b.md\n  optional: []\n---\n# T1\n');
    const before = computeTaskFingerprint(loadChange(slug, root), 't1');

    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\ncontext:\n  optional: []\n  required:\n    - b.md\n    - a.md\n---\n# T1\n');
    assert.equal(computeTaskFingerprint(loadChange(slug, root), 't1'), before);
  });

  test('reordering context_exceptions entries does not change the fingerprint', () => {
    const slug = 'task-reorder-context-exceptions';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'owner-decisions.md'), OWNER_DECISIONS);
    const excA = '  - omitted: a.md\n    decision: D2\n    reason: not relevant\n';
    const excB = '  - omitted: b.md\n    decision: D3\n    reason: not relevant\n';
    writeFileSync(join(dir, 'tasks', 't1.md'), `---\nid: fixture.t1\ncontext_exceptions:\n${excA}${excB}---\n# T1\n`);
    const before = computeTaskFingerprint(loadChange(slug, root), 't1');

    writeFileSync(join(dir, 'tasks', 't1.md'), `---\nid: fixture.t1\ncontext_exceptions:\n${excB}${excA}---\n# T1\n`);
    assert.equal(computeTaskFingerprint(loadChange(slug, root), 't1'), before);
  });

  test('a real content change to a set-like list still invalidates the fingerprint (canonicalization does not mask real changes)', () => {
    const slug = 'task-real-change-allowed-paths';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nallowed_paths:\n  - a.mjs\n  - b.mjs\n---\n# T1\n');
    const before = computeTaskFingerprint(loadChange(slug, root), 't1');

    writeFileSync(join(dir, 'tasks', 't1.md'), '---\nid: fixture.t1\nallowed_paths:\n  - a.mjs\n  - c.mjs\n---\n# T1\n');
    assert.notEqual(computeTaskFingerprint(loadChange(slug, root), 't1'), before);
  });
});

describe('computeImplementationFingerprint — task fingerprint + revision/evidence contract', () => {
  test('is deterministic for identical inputs', () => {
    const load = writeTierFixture('impl-det');
    const a = computeImplementationFingerprint(load(), 't1', { revision: 'abc123', evidence: [] });
    const b = computeImplementationFingerprint(load(), 't1', { revision: 'abc123', evidence: [] });
    assert.equal(a, b);
  });

  test('changes when the revision identifier changes', () => {
    const load = writeTierFixture('impl-revision');
    const a = computeImplementationFingerprint(load(), 't1', { revision: 'abc123' });
    const b = computeImplementationFingerprint(load(), 't1', { revision: 'def456' });
    assert.notEqual(a, b);
  });

  test("changes when the underlying task-level fingerprint changes", () => {
    const load = writeTierFixture('impl-task-change');
    const before = computeImplementationFingerprint(load(), 't1', { revision: 'abc123' });
    writeFileSync(join(root, 'impl-task-change', 'tasks', '01-t1.md'), [
      '---', 'id: fixture.t1', 'status: draft', 'semantic_references:', '  constraints: [C1]', '---',
      '# Task T1', '', 'Goal text for t1 CHANGED.', '',
    ].join('\n'));
    assert.notEqual(computeImplementationFingerprint(load(), 't1', { revision: 'abc123' }), before);
  });
});

describe('execution.suspension shape validation (D8/requirement 3, hardened by PR review packet 04 Problem 3)', () => {
  const validSuspension = (overrides = {}) => ({
    kind: 'confirm-required', code: 'REC-05', previous_action: 'start', created_at: '2026-08-04T00:00:00Z', ...overrides,
  });

  test('a valid suspension produces no errors', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension() } }, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('a task with no suspension produces no errors', () => {
    const errors = [];
    validateSuspension({}, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('execution present but not an object is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: 'nope' }, errors, 'task t1');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /execution must be an object/);
  });

  test('execution.suspension present but not an object is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: 'nope' } }, errors, 'task t1');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /execution\.suspension must be an object/);
  });

  test('an invalid kind is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ kind: 'bogus' }) } }, errors, 'task t1');
    assert.ok(errors.some(e => /execution\.suspension\.kind/.test(e)));
  });

  test('a missing/empty code is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ code: '' }) } }, errors, 'task t1');
    assert.ok(errors.some(e => /execution\.suspension\.code must be a non-empty string/.test(e)));
  });

  test('a code that is not a recognized REC-xx scenario is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ code: 'REC-99' }) } }, errors, 'task t1');
    assert.ok(errors.some(e => /not a recognized recovery scenario/.test(e)));
  });

  test('every documented kind is accepted', () => {
    for (const kind of ['automatic', 'confirm-required', 'owner-decision', 'unsafe-manual']) {
      const errors = [];
      validateSuspension({ execution: { suspension: validSuspension({ kind, code: 'REC-01' }) } }, errors, 'task t1');
      assert.deepEqual(errors, []);
    }
  });

  test('previous_action must be null or a real lifecycle action', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ previous_action: 'not-a-real-action' }) } }, errors, 'task t1');
    assert.ok(errors.some(e => /execution\.suspension\.previous_action/.test(e)));
  });

  test('previous_action: null is accepted (REC-08/REC-09 have no automated retry target)', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ code: 'REC-08', previous_action: null }) } }, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('a missing/unparseable created_at is a validate error', () => {
    const errors = [];
    validateSuspension({ execution: { suspension: validSuspension({ created_at: 'not-a-date' }) } }, errors, 'task t1');
    assert.ok(errors.some(e => /created_at/.test(e)));
  });
});

describe('self_check shape validation (D28/requirement 9, hardened by PR review packet 04 Problem 4)', () => {
  const validPassed = (overrides = {}) => ({
    status: 'passed', fingerprint: 'fp1', revision: 'rev1', commands: [{ command: 'x', exit_code: 0 }], ...overrides,
  });

  test('a valid passed self_check produces no errors', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed() }, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('a valid failed self_check with failed_criteria produces no errors', () => {
    const errors = [];
    validateSelfCheck({
      self_check: validPassed({ status: 'failed', failed_criteria: ['AC-3'], commands: [{ command: 'x', exit_code: 1 }] }),
    }, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('a task with no self_check produces no errors', () => {
    const errors = [];
    validateSelfCheck({}, errors, 'task t1');
    assert.deepEqual(errors, []);
  });

  test('self_check present but not an object is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: 'nope' }, errors, 'task t1');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /self_check must be an object/);
  });

  test('a malformed status is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ status: 'bogus' }) }, errors, 'task t1');
    assert.ok(errors.some(e => /self_check\.status/.test(e)));
  });

  test('a missing fingerprint is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ fingerprint: undefined }) }, errors, 'task t1');
    assert.ok(errors.some(e => /self_check\.fingerprint/.test(e)));
  });

  test('a missing revision is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ revision: undefined }) }, errors, 'task t1');
    assert.ok(errors.some(e => /self_check\.revision/.test(e)));
  });

  test('failed_criteria present without status: failed is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ failed_criteria: ['AC-3'] }) }, errors, 'task t1');
    assert.ok(errors.some(e => /failed_criteria/.test(e)));
  });

  test('status: failed without failed_criteria is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ status: 'failed', failed_criteria: undefined }) }, errors, 'task t1');
    assert.ok(errors.some(e => /failed_criteria must be a non-empty array/.test(e)));
  });

  test('a missing/empty commands array is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ commands: [] }) }, errors, 'task t1');
    assert.ok(errors.some(e => /self_check\.commands must be a non-empty array/.test(e)));
  });

  test('a non-array commands value is a validate error, not a crash', () => {
    const errors = [];
    assert.doesNotThrow(() => validateSelfCheck({ self_check: validPassed({ commands: 'not-an-array' }) }, errors, 'task t1'));
    assert.ok(errors.some(e => /self_check\.commands must be a non-empty array/.test(e)));
  });

  test('a commands entry missing exit_code is a validate error', () => {
    const errors = [];
    validateSelfCheck({ self_check: validPassed({ commands: [{ command: 'x' }] }) }, errors, 'task t1');
    assert.ok(errors.some(e => /exit_code/.test(e)));
  });
});

describe('semantic_references integrity validation (D18/D26, requirement 7)', () => {
  const decisionsMap = parseOwnerDecisions(OWNER_DECISIONS);
  const constraintsMap = parseConstraints(OVERVIEW);

  test('a fully valid semantic_references block produces no errors', () => {
    const errors = [];
    const task = { id: 't2', depends_on: ['t1'] };
    const fm = { semantic_references: { dependency_contracts: ['t1'], decisions: ['D2'], constraints: ['C1'] } };
    validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, "task 't2'");
    assert.deepEqual(errors, []);
  });

  test('a task with no semantic_references block produces no errors', () => {
    const errors = [];
    validateSemanticReferences({ id: 't1' }, {}, decisionsMap, constraintsMap, errors, "task 't1'");
    assert.deepEqual(errors, []);
  });

  test('a dependency_contracts entry outside depends_on is a validate error', () => {
    const errors = [];
    const task = { id: 't2', depends_on: ['t1'] };
    const fm = { semantic_references: { dependency_contracts: ['t9'] } };
    validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, "task 't2'");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /dependency_contracts entry 't9' is not in this task's own depends_on/);
  });

  test('an unresolvable decisions entry is a validate error', () => {
    const errors = [];
    const task = { id: 't2', depends_on: ['t1'] };
    const fm = { semantic_references: { decisions: ['D99'] } };
    validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, "task 't2'");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /decisions entry 'D99' does not resolve/);
  });

  test('a superseded decisions entry is a validate error naming the superseding decision', () => {
    const errors = [];
    const task = { id: 't2', depends_on: ['t1'] };
    const fm = { semantic_references: { decisions: ['D1'] } };
    validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, "task 't2'");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /'D1' is superseded — reference 'D2' instead/);
  });

  test('an unresolvable constraints entry is a validate error', () => {
    const errors = [];
    const task = { id: 't1', depends_on: [] };
    const fm = { semantic_references: { constraints: ['C99'] } };
    validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, "task 't1'");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /constraints entry 'C99' does not resolve/);
  });
});
