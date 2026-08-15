// Tests for stable specification identity (D2, area stable-spec-identity,
// task 01): additive `spec_id` generation, format/uniqueness validation, and
// the idempotent backfill service in tools/specs/service.mjs. Run: node
// --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  generateSpecId, isValidSpecId, resolveStableSpecId, backfillSpecIds,
  loadChange, buildContextPacket, buildSpecsIndexes,
} from '../specs/service.mjs';
import { validateSpecs, validateSpecId } from '../specs/validation.mjs';
import { CliError } from '../lib/cli-errors.mjs';

function writeChange(dir, slug, { specId, id = slug } = {}) {
  const changeDir = join(dir, slug);
  mkdirSync(join(changeDir, 'tasks'), { recursive: true });
  const specIdLine = specId !== undefined ? `spec_id: ${specId}\n` : '';
  writeFileSync(join(changeDir, 'change.yaml'), [
    `id: ${id}`, specIdLine.trimEnd() ? specIdLine.trimEnd() : null, 'title: Fixture change', 'status: draft', 'tasks: []', '',
  ].filter(l => l !== null).join('\n'));
  return changeDir;
}

describe('generateSpecId / isValidSpecId', () => {
  test('generateSpecId returns a canonical UUID string accepted by isValidSpecId', () => {
    const id = generateSpecId();
    assert.equal(isValidSpecId(id), true);
    assert.notEqual(id, generateSpecId());
  });

  test('isValidSpecId rejects non-UUID shapes', () => {
    assert.equal(isValidSpecId('not-a-uuid'), false);
    assert.equal(isValidSpecId(''), false);
    assert.equal(isValidSpecId(undefined), false);
    assert.equal(isValidSpecId(123), false);
    assert.equal(isValidSpecId('4c1a7b8e-2f3d-4a5b-9c6d-1e2f3a4b5c6'), false); // one hex digit short
  });
});

describe('resolveStableSpecId — actionable migration-needed error (C2)', () => {
  test('returns the persisted spec_id when valid', () => {
    const change = { _slug: 'x', spec_id: generateSpecId() };
    assert.equal(resolveStableSpecId(change), change.spec_id);
  });

  test('throws a CliError naming the fix, never falls back to slug, when spec_id is missing', () => {
    const change = { _slug: 'legacy-change', spec_id: undefined };
    assert.throws(() => resolveStableSpecId(change), (err) => {
      assert.ok(err instanceof CliError);
      assert.match(err.message, /legacy-change/);
      assert.match(err.message, /backfill-spec-id/);
      return true;
    });
  });
});

describe('backfillSpecIds — idempotent, never rewrites a valid id (AC2/AC3)', () => {
  let root, activeDir, archiveDir;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'nevo-spec-identity-'));
    activeDir = join(root, 'active');
    archiveDir = join(root, 'archive');
    mkdirSync(activeDir, { recursive: true });
    mkdirSync(archiveDir, { recursive: true });
    writeChange(activeDir, 'missing-one');
    const existing = generateSpecId();
    writeChange(activeDir, 'already-has-one', { specId: existing });
    writeChange(archiveDir, 'archived-missing-one');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('first run assigns a unique spec_id only to manifests missing one', () => {
    const assigned = backfillSpecIds({ activeDir, archiveDir });
    const bySlug = Object.fromEntries(assigned.map(a => [a.slug, a.specId]));
    assert.ok(isValidSpecId(bySlug['missing-one']));
    assert.ok(isValidSpecId(bySlug['archived-missing-one']));
    assert.equal('already-has-one' in bySlug, false);
    assert.notEqual(bySlug['missing-one'], bySlug['archived-missing-one']);

    const reloaded = loadChange('already-has-one', activeDir);
    assert.equal(isValidSpecId(reloaded.spec_id), true);
  });

  test('second run makes no file changes (true no-op)', () => {
    const before = {
      missing: readFileSync(join(activeDir, 'missing-one', 'change.yaml'), 'utf8'),
      already: readFileSync(join(activeDir, 'already-has-one', 'change.yaml'), 'utf8'),
      archived: readFileSync(join(archiveDir, 'archived-missing-one', 'change.yaml'), 'utf8'),
    };
    const assigned = backfillSpecIds({ activeDir, archiveDir });
    assert.deepEqual(assigned, []);
    assert.equal(readFileSync(join(activeDir, 'missing-one', 'change.yaml'), 'utf8'), before.missing);
    assert.equal(readFileSync(join(activeDir, 'already-has-one', 'change.yaml'), 'utf8'), before.already);
    assert.equal(readFileSync(join(archiveDir, 'archived-missing-one', 'change.yaml'), 'utf8'), before.archived);
  });
});

describe('validateSpecId — format/uniqueness with precise paths (AC1/AC6)', () => {
  test('a manifest missing spec_id fails validation post-backfill, naming its path and the fix', () => {
    const errors = [];
    const label = 'specs/active/legacy/change.yaml';
    validateSpecId({ spec_id: undefined, _file: label }, new Map(), errors, label);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /specs\/active\/legacy\/change\.yaml/);
    assert.match(errors[0], /spec_id/);
    assert.match(errors[0], /backfill-spec-id/);
  });

  test('a malformed spec_id is rejected, naming the offending manifest\'s own path', () => {
    const errors = [];
    const label = 'specs/active/bad/change.yaml';
    validateSpecId({ spec_id: 'not-a-uuid', _file: label }, new Map(), errors, label);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /specs\/active\/bad\/change\.yaml/);
    assert.match(errors[0], /spec_id/);
  });

  test('a duplicate spec_id across two manifests names both affected files', () => {
    const specId = generateSpecId();
    const specIds = new Map();
    const errors = [];
    validateSpecId({ spec_id: specId, _file: 'specs/active/first/change.yaml' }, specIds, errors, 'specs/active/first/change.yaml');
    validateSpecId({ spec_id: specId, _file: 'specs/archive/second/change.yaml' }, specIds, errors, 'specs/archive/second/change.yaml');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /specs\/archive\/second\/change\.yaml/);
    assert.match(errors[0], /specs\/active\/first\/change\.yaml/);
    assert.match(errors[0], /duplicate spec_id/);
  });
});

// validateSpecs() has no directory-injection seam (unlike buildSpecsIndexes/
// backfillSpecIds) — it always reads the real specs/active and specs/archive.
// The format/uniqueness rule itself is exercised directly against the real
// repository state instead, which already contains the manifests this task's
// own backfill migration touches.
describe('validateSpecs — real repository state', () => {
  test('the real repository validates cleanly after backfill (spec_id format/uniqueness hold)', () => {
    const errors = validateSpecs();
    assert.deepEqual(errors.filter(e => /spec_id/.test(e)), []);
  });
});

describe('Renaming a fixture directory while retaining its manifest leaves specId unchanged (AC5)', () => {
  test('spec_id survives a directory rename, keyed by manifest content, not slug', () => {
    const root = mkdtempSync(join(tmpdir(), 'nevo-spec-identity-rename-'));
    try {
      const specId = generateSpecId();
      writeChange(root, 'old-slug', { specId });
      renameSync(join(root, 'old-slug'), join(root, 'new-slug'));

      const change = loadChange('new-slug', root);
      assert.equal(change.spec_id, specId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('specId flows through context packets and generated indexes (AC4)', () => {
  test('buildContextPacket exposes change.specId', () => {
    const root = mkdtempSync(join(tmpdir(), 'nevo-spec-identity-context-'));
    try {
      const specId = generateSpecId();
      const changeDir = join(root, 'ctx-fixture');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      writeFileSync(join(changeDir, 'change.yaml'), [
        'id: ctx-fixture', `spec_id: ${specId}`, 'title: Ctx fixture', 'status: draft',
        'tasks:', '  - id: t1', '    file: tasks/t1.md', '    status: draft', '',
      ].join('\n'));
      writeFileSync(join(changeDir, 'tasks', 't1.md'), '---\nid: ctx-fixture.t1\n---\n# T1\n');

      const change = loadChange('ctx-fixture', root);
      const packet = buildContextPacket(change, change.tasks[0]);
      assert.equal(packet.change.specId, specId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('buildSpecsIndexes projects specId alongside id for every change', () => {
    const root = mkdtempSync(join(tmpdir(), 'nevo-spec-identity-index-'));
    const activeDir = join(root, 'active');
    const archiveDir = join(root, 'archive');
    try {
      mkdirSync(activeDir, { recursive: true });
      mkdirSync(archiveDir, { recursive: true });
      const specId = generateSpecId();
      writeChange(activeDir, 'idx-fixture', { specId });
      writeChange(activeDir, 'idx-legacy');

      const built = buildSpecsIndexes({ activeDir, archiveDir });
      const withId = built.changes.find(c => c.id === 'idx-fixture');
      const legacy = built.changes.find(c => c.id === 'idx-legacy');
      assert.equal(withId.specId, specId);
      assert.equal(legacy.specId, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
