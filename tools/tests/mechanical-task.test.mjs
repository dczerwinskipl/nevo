// Tests for `type: mechanical` — D14's "review-exempt deterministic approval"
// (task 07): tools/specs/validation.mjs's inspectMechanicalConditions/
// computeMechanicalExemption, and tools/specs/lifecycle.mjs's validateApproval
// mechanicalExempt bypass. Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadChange } from '../specs/store.mjs';
import { computeMechanicalExemption } from '../specs/validation.mjs';
import { validateApproval } from '../specs/lifecycle-primitives.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-mechanical-test-')); });
after(() => { rmSync(root, { recursive: true, force: true }); });

const GOOD_AC = [
  '## Acceptance criteria',
  '',
  '1. Does the thing correctly (automated: node --test tools/tests/foo.test.mjs).',
  '2. Does the other thing (automated: node tools/specs.mjs validate).',
  '',
].join('\n');

function writeFixture(slug, {
  derivedStatus = 'approved',
  mechanicalAllowed = ['tools/specs/foo.mjs'],
  mechanical = { derived_from: 'task-a', deterministic: true, no_public_behavior_change: true, no_new_design_decision: true },
  acceptanceCriteria = GOOD_AC,
  dependsOn = ['task-a'],
} = {}) {
  const dir = join(root, slug);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  const dependsOnYaml = dependsOn.length ? `    depends_on: [${dependsOn.join(', ')}]` : '';
  writeFileSync(join(dir, 'change.yaml'), [
    'id: fixture',
    'title: Fixture',
    'status: draft',
    'tasks:',
    '  - id: task-a',
    `    status: ${derivedStatus}`,
    '    file: tasks/a.md',
    '  - id: task-b',
    '    status: draft',
    '    file: tasks/b.md',
    dependsOnYaml,
    '',
  ].filter(Boolean).join('\n'));
  writeFileSync(join(dir, 'tasks', 'a.md'), [
    '---',
    'id: fixture.task-a',
    'allowed_paths:',
    '  - tools/specs/foo.mjs',
    '  - tools/specs/bar.mjs',
    '---',
    '# Task A',
    '',
  ].join('\n'));

  const mechanicalYaml = mechanical
    ? [
      'mechanical:',
      `  derived_from: ${mechanical.derived_from}`,
      `  deterministic: ${mechanical.deterministic}`,
      `  no_public_behavior_change: ${mechanical.no_public_behavior_change}`,
      `  no_new_design_decision: ${mechanical.no_new_design_decision}`,
    ].join('\n') + '\n'
    : '';
  const allowedYaml = ['allowed_paths:', ...mechanicalAllowed.map(p => `  - ${p}`), ''].join('\n');

  writeFileSync(join(dir, 'tasks', 'b.md'), [
    '---',
    'id: fixture.task-b',
    'type: mechanical',
    allowedYaml.trimEnd(),
    mechanicalYaml.trimEnd(),
    '---',
    '# Task B',
    '',
    acceptanceCriteria,
  ].join('\n'));

  return loadChange(slug, root);
}

describe('inspectMechanicalConditions / computeMechanicalExemption — all six conditions met (AC1)', () => {
  test('a task meeting all six conditions is eligible, with no failed conditions', () => {
    const change = writeFixture('all-good');
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, true);
    assert.deepEqual(failedConditions, []);
  });

  test('validateApproval grants the exemption and still performs the explicit draft->approved transition', () => {
    const r = validateApproval('draft', null, 'irrelevant-fingerprint', { mechanicalExempt: true });
    assert.equal(r.ok, true);
    assert.equal(r.idempotent, false);
  });

  test('validateApproval without mechanicalExempt still requires a review, unaffected by this task', () => {
    const r = validateApproval('draft', null, 'irrelevant-fingerprint');
    assert.equal(r.ok, false);
    assert.match(r.reason, /No review found/);
  });

  test('validateApproval\'s draft->approved transition check still applies even when exempt', () => {
    const r = validateApproval('in-implementation', null, 'x', { mechanicalExempt: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /requires status 'draft'/);
  });

  test('a non-mechanical task (no type field) is never exempt', () => {
    const change = writeFixture('non-mechanical');
    const task = { id: 'other', file: null }; // no .file — loadTaskFmAndBody returns null
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.deepEqual(failedConditions, []);
  });
});

describe('inspectMechanicalConditions — missing exactly one condition fails closed, naming it (AC2)', () => {
  test('missing derived_from (derived-from task not found) fails, naming that condition', () => {
    const change = writeFixture('bad-derived-from', {
      mechanical: { derived_from: 'does-not-exist', deterministic: true, no_public_behavior_change: true, no_new_design_decision: true },
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /derived_from \('does-not-exist'\) must name a real task/);
  });

  test('derived_from task is still draft (not yet approved) fails, naming that condition', () => {
    const change = writeFixture('derived-still-draft', { derivedStatus: 'draft' });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /has status 'draft' — must be one of approved\/in-implementation\/implemented\/verified\/archived/);
  });

  test('deterministic not explicitly true fails, naming that condition', () => {
    const change = writeFixture('not-deterministic', {
      mechanical: { derived_from: 'task-a', deterministic: false, no_public_behavior_change: true, no_new_design_decision: true },
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /mechanical\.deterministic must be explicitly 'true'/);
  });

  test('allowed_paths outside the derived-from task\'s own declared paths fails, naming the extra path', () => {
    const change = writeFixture('scope-expanded', { mechanicalAllowed: ['tools/specs/foo.mjs', 'src/Something.cs'] });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /not already declared on derived_from task 'task-a': src\/Something\.cs/);
  });

  test('an acceptance criterion missing an automated: tag fails, naming that criterion', () => {
    const change = writeFixture('missing-automated-tag', {
      acceptanceCriteria: '## Acceptance criteria\n\n1. Does the thing, no tag at all.\n',
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /acceptance criterion 1 is missing an automated: tag/);
  });

  test('derived_from task is abandoned fails, naming that condition (PR review packet 05A — abandoned previously passed the "not draft" check by omission)', () => {
    const change = writeFixture('derived-abandoned', { derivedStatus: 'abandoned' });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /has status 'abandoned' — must be one of approved\/in-implementation\/implemented\/verified\/archived/);
  });

  test('derived_from not listed in this task\'s own depends_on fails, naming that condition (PR review packet 05A)', () => {
    const change = writeFixture('derived-not-in-depends-on', { dependsOn: [] });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
    assert.match(failedConditions[0], /derived_from \('task-a'\) must also be listed in this task's own depends_on/);
  });

  test('failing two conditions at once reports both, not just the first', () => {
    const change = writeFixture('two-failures', {
      derivedStatus: 'draft',
      mechanical: { derived_from: 'task-a', deterministic: false, no_public_behavior_change: true, no_new_design_decision: true },
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 2);
  });
});

describe('inspectMechanicalConditions — acceptance-criteria tag exclusivity (AC3)', () => {
  test('an owner-decision: tagged criterion is rejected — never allowed for type: mechanical', () => {
    const change = writeFixture('owner-decision-tag', {
      acceptanceCriteria: '## Acceptance criteria\n\n1. Decided this way (owner-decision: picked option B).\n',
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.match(failedConditions[0], /carries an owner-decision: tag — not allowed for type: mechanical/);
  });

  test('an inspection: tagged criterion is rejected — never allowed for type: mechanical', () => {
    const change = writeFixture('inspection-tag', {
      acceptanceCriteria: '## Acceptance criteria\n\n1. Looks right (inspection: eyeball the output).\n',
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.match(failedConditions[0], /carries an inspection: tag — not allowed for type: mechanical/);
  });
});

describe('inspectMechanicalConditions — acceptance-criteria parser is fence-aware (PR review packet 05A)', () => {
  test('a numbered line inside a fenced code example is never mistaken for an acceptance criterion', () => {
    const change = writeFixture('fenced-example', {
      acceptanceCriteria: [
        '## Acceptance criteria',
        '',
        '1. Does the thing correctly (automated: node --test tools/tests/foo.test.mjs).',
        '',
        'Example output:',
        '```text',
        '1. first step',
        '2. second step, no tag at all',
        '```',
        '',
      ].join('\n'),
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, true, `expected no failures, got: ${failedConditions.join('; ')}`);
  });
});

describe('inspectMechanicalConditions — conjunctive, never a score/majority check', () => {
  test('five of six conditions passing is still not eligible', () => {
    const change = writeFixture('five-of-six', {
      mechanical: { derived_from: 'task-a', deterministic: true, no_public_behavior_change: false, no_new_design_decision: true },
    });
    const task = change.tasks.find(t => t.id === 'task-b');
    const { eligible, failedConditions } = computeMechanicalExemption(change, task);
    assert.equal(eligible, false);
    assert.equal(failedConditions.length, 1);
  });
});
