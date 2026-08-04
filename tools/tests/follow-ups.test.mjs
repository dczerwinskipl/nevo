// Tests for the mutable follow-up ledger (D15, D22, task 06):
// tools/specs/service.mjs's loadFollowUps/addFollowUp/resolveFollowUp and
// tools/specs/validation.mjs's validateFollowUps, plus the finalize gate
// (tools/specs/lifecycle.mjs's validateFinalize) it feeds. Run: node --test
// tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadChange, loadFollowUps, addFollowUp, resolveFollowUp, parseOwnerDecisions } from '../specs/service.mjs';
import { validateFollowUps } from '../specs/validation.mjs';
import { validateFinalize } from '../specs/lifecycle.mjs';

let root;

function writeFixture(slug, { followUpsYaml } = {}) {
  const dir = join(root, slug);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'change.yaml'), [
    'id: fixture',
    'title: Fixture',
    'status: draft',
    'tasks:',
    '  - id: task-a',
    '    status: verified',
    '    file: tasks/a.md',
    '  - id: task-b',
    '    status: verified',
    '    file: tasks/b.md',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks', 'a.md'), '---\nid: fixture.task-a\n---\n# Task A\n');
  writeFileSync(join(dir, 'tasks', 'b.md'), '---\nid: fixture.task-b\n---\n# Task B\n');
  writeFileSync(join(dir, 'owner-decisions.md'), '## D1: First\n\nText of D1.\n');
  if (followUpsYaml !== undefined) writeFileSync(join(dir, 'follow-ups.yaml'), followUpsYaml);
  return loadChange(slug, root);
}

before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-follow-ups-test-')); });
after(() => { rmSync(root, { recursive: true, force: true }); });

describe('loadFollowUps', () => {
  test('returns an empty ledger when follow-ups.yaml does not exist', () => {
    const change = writeFixture('no-ledger');
    assert.deepEqual(loadFollowUps(change), { follow_ups: [] });
  });

  test('parses an existing ledger', () => {
    const change = writeFixture('existing-ledger', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: open\n    resolution: null\n',
    });
    const ledger = loadFollowUps(change);
    assert.equal(ledger.follow_ups.length, 1);
    assert.equal(ledger.follow_ups[0].id, 'FU-001');
  });
});

describe('addFollowUp / resolveFollowUp — mutable in place, never append-only (AC4)', () => {
  test('addFollowUp creates the ledger file on the first entry', () => {
    const change = writeFixture('add-first');
    addFollowUp(change, {
      id: 'FU-001', source_task: 'task-a', kind: 'risk', severity: 'non-blocking',
      reason: 'r', resolver_task: null, status: 'open', resolution: null,
    });
    const ledger = loadFollowUps(change);
    assert.equal(ledger.follow_ups.length, 1);
    assert.equal(ledger.follow_ups[0].status, 'open');
  });

  test('resolveFollowUp mutates the existing entry\'s status/resolution in place — no new entry is appended', () => {
    const change = writeFixture('resolve-in-place');
    addFollowUp(change, {
      id: 'FU-001', source_task: 'task-a', kind: 'risk', severity: 'non-blocking',
      reason: 'r', resolver_task: null, status: 'open', resolution: null,
    });
    resolveFollowUp(change, 'FU-001', { status: 'resolved', resolution: 'fixed' });

    const ledger = loadFollowUps(change);
    assert.equal(ledger.follow_ups.length, 1, 'still exactly one entry — mutated, not appended');
    assert.equal(ledger.follow_ups[0].status, 'resolved');
    assert.equal(ledger.follow_ups[0].resolution, 'fixed');
  });

  test('resolveFollowUp on an unknown id throws rather than silently creating one', () => {
    const change = writeFixture('resolve-unknown', { followUpsYaml: 'follow_ups: []\n' });
    assert.throws(() => resolveFollowUp(change, 'FU-999', { status: 'resolved', resolution: 'x' }));
  });
});

describe('validateFollowUps — malformed content (AC9)', () => {
  test('rejects invalid YAML with a specific reason', () => {
    const change = writeFixture('invalid-yaml', { followUpsYaml: 'follow_ups: [this is not valid yaml\n' });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Invalid YAML/);
  });

  test('rejects a follow_ups value that is not a list', () => {
    const change = writeFixture('not-a-list', { followUpsYaml: 'follow_ups: "oops"\n' });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must be a list/);
  });

  test('rejects an entry missing a required field', () => {
    const change = writeFixture('missing-field', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    status: open\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.ok(errors.some(e => /missing 'source_task'/.test(e)));
  });

  test('rejects an unrecognized severity value', () => {
    const change = writeFixture('bad-severity', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: super-blocking\n' +
        '    reason: r\n    status: open\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.ok(errors.some(e => /severity must be one of/.test(e)));
  });

  test('rejects an unrecognized status value', () => {
    const change = writeFixture('bad-status', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: blocking\n' +
        '    reason: r\n    status: closed\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.ok(errors.some(e => /status must be one of/.test(e)));
  });

  test('accepts a well-formed, fully-open entry', () => {
    const change = writeFixture('well-formed', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: open\n    resolution: null\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.deepEqual(errors, []);
  });

  test('a missing follow-ups.yaml is not an error', () => {
    const change = writeFixture('no-file-at-all');
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.deepEqual(errors, []);
  });
});

describe('validateFollowUps — stale resolver_task (AC6)', () => {
  test('rejects a resolver_task that does not resolve to a real task id in this change', () => {
    const change = writeFixture('stale-resolver', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: does-not-exist\n    status: open\n    resolution: null\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.ok(errors.some(e => /resolver_task 'does-not-exist' does not resolve/.test(e)));
  });

  test('accepts a resolver_task that resolves to a real task in this change', () => {
    const change = writeFixture('valid-resolver', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: task-b\n    status: open\n    resolution: null\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.deepEqual(errors, []);
  });

  test('accepts a null resolver_task (nullable field)', () => {
    const change = writeFixture('null-resolver', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: open\n    resolution: null\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.deepEqual(errors, []);
  });

  test('accepts an explicitly-named-change resolver_task (change-id/task-id) when it resolves', () => {
    const change = writeFixture('cross-change-resolver', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: fixture/task-b\n    status: open\n    resolution: null\n',
    });
    const errors = [];
    validateFollowUps(change, new Map(), [change], errors);
    assert.deepEqual(errors, []);
  });
});

describe('validateFollowUps — dismissing a blocking entry requires a recorded owner decision (AC5)', () => {
  const decisionsMap = () => parseOwnerDecisions('## D1: First\n\nText of D1.\n');

  test('rejects a dismissed blocking entry whose resolution does not cite a recorded decision', () => {
    const change = writeFixture('dismiss-blocking-no-decision', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: dismissed\n    resolution: "not important"\n',
    });
    const errors = [];
    validateFollowUps(change, decisionsMap(), [change], errors);
    assert.ok(errors.some(e => /requires 'resolution' to reference a recorded owner decision/.test(e)));
  });

  test('rejects citing a decision id that itself does not resolve in owner-decisions.md', () => {
    const change = writeFixture('dismiss-blocking-bad-decision-ref', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: dismissed\n    resolution: "per D99"\n',
    });
    const errors = [];
    validateFollowUps(change, decisionsMap(), [change], errors);
    assert.ok(errors.some(e => /requires 'resolution' to reference a recorded owner decision/.test(e)));
  });

  test('accepts a dismissed blocking entry whose resolution cites a real recorded decision', () => {
    const change = writeFixture('dismiss-blocking-ok', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: dismissed\n    resolution: "per D1: owner accepted the risk"\n',
    });
    const errors = [];
    validateFollowUps(change, decisionsMap(), [change], errors);
    assert.deepEqual(errors, []);
  });

  test('a dismissed non-blocking entry needs no decision reference at all', () => {
    const change = writeFixture('dismiss-non-blocking', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: non-blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: dismissed\n    resolution: "not important"\n',
    });
    const errors = [];
    validateFollowUps(change, decisionsMap(), [change], errors);
    assert.deepEqual(errors, []);
  });

  test('a resolved (not dismissed) blocking entry needs no decision reference', () => {
    const change = writeFixture('resolved-blocking', {
      followUpsYaml: 'follow_ups:\n  - id: FU-001\n    source_task: task-a\n    kind: risk\n    severity: blocking\n' +
        '    reason: r\n    resolver_task: null\n    status: resolved\n    resolution: "fixed in task-b"\n',
    });
    const errors = [];
    validateFollowUps(change, decisionsMap(), [change], errors);
    assert.deepEqual(errors, []);
  });
});

describe('validateFinalize — blocks on an open, blocking-severity follow-up (AC7)', () => {
  const doneChange = () => ({ tasks: [{ id: 't1', status: 'verified' }] });
  const cleanFacts = () => ({
    gitClean: true,
    branch: { hasUpstream: true, ahead: 0, behind: 0 },
    ghAvailable: true,
    pr: { number: 42, state: 'OPEN', isDraft: false, unresolvedThreads: 0 },
    verification: [{ name: 'specs validate', passed: true }],
    openBlockingFollowUps: [],
  });

  test('blocks finalize when an open, blocking-severity follow-up exists, naming it', () => {
    const facts = { ...cleanFacts(), openBlockingFollowUps: [{ id: 'FU-001', reason: 'risk' }] };
    const r = validateFinalize(doneChange(), facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Open blocking follow-up\(s\): FU-001/);
  });

  test('does not block finalize when no blocking follow-up is open', () => {
    const r = validateFinalize(doneChange(), cleanFacts());
    assert.equal(r.ok, true);
  });

  test('the follow-up gate is evaluated before the git-clean check, alongside the terminal-task check', () => {
    const facts = { ...cleanFacts(), gitClean: false, openBlockingFollowUps: [{ id: 'FU-001', reason: 'risk' }] };
    const r = validateFinalize(doneChange(), facts);
    assert.match(r.reason, /Open blocking follow-up/, 'follow-up gate reason must win over the later gitClean check');
  });
});
