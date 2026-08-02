// Tests for the deterministic spec fingerprint (tools/specs.mjs).
// Run: node --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadChange, computeSpecFingerprint } from '../specs.mjs';

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
