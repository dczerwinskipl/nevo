import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import {
  createSpecification,
  validateSpecSlug,
  validateSpecType,
  refreshSpecsIndexes,
  buildSpecsIndexes,
  loadChange,
  SpecValidationError,
  SpecConflictError,
} from '../specs/service.mjs';

async function createTempSpecsEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'nevo-spec-test-'));
  const activeDir = join(root, 'specs', 'active');
  const archiveDir = join(root, 'specs', 'archive');
  const activeIndexMd = join(root, 'specs', 'active.generated.md');
  const archiveIndexMd = join(root, 'specs', 'archive.generated.md');
  const indexJson = join(root, 'specs', 'index.generated.json');

  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  refreshSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson });

  return {
    root,
    activeDir,
    archiveDir,
    activeIndexMd,
    archiveIndexMd,
    indexJson,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

test('validateSpecSlug validates canonical slug format', () => {
  assert.equal(validateSpecSlug('simple-feature'), 'simple-feature');
  assert.equal(validateSpecSlug('feature_123.test'), 'feature_123.test');
  assert.equal(validateSpecSlug('a1'), 'a1');

  assert.throws(() => validateSpecSlug(''), SpecValidationError);
  assert.throws(() => validateSpecSlug('   '), SpecValidationError);
  assert.throws(() => validateSpecSlug('INVALID-UPPERCASE'), SpecValidationError);
  assert.throws(() => validateSpecSlug('invalid space'), SpecValidationError);
  assert.throws(() => validateSpecSlug('-leading-dash'), SpecValidationError);
  assert.throws(() => validateSpecSlug('../traversal'), SpecValidationError);
  assert.throws(() => validateSpecSlug('/root/path'), SpecValidationError);
});

test('validateSpecType normalizes and validates spec type', () => {
  assert.equal(validateSpecType('standard'), 'standard');
  assert.equal(validateSpecType('ARCHITECTURAL'), 'architectural');
  assert.equal(validateSpecType('small'), 'small');
  assert.equal(validateSpecType('exploratory'), 'exploratory');
  assert.equal(validateSpecType(undefined), 'standard');

  assert.throws(() => validateSpecType('invalid_type'), SpecValidationError);
});

test('createSpecification creates complete specification skeleton and updates indexes', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    const result = await createSpecification({
      slug: 'my-new-feature',
      title: 'My New Feature',
      type: 'standard',
      goal: 'Implement a new feature.',
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });

    assert.equal(result.ok, true);
    assert.equal(result.slug, 'my-new-feature');
    assert.ok(result.specId);
    assert.equal(result.change.id, 'my-new-feature');
    assert.equal(result.change.title, 'My New Feature');
    assert.equal(result.change.type, 'standard');
    assert.equal(result.change.status, 'draft');
    assert.equal(result.change.spec_id, result.specId);

    // Verify files on disk
    const changeYamlPath = join(env.activeDir, 'my-new-feature', 'change.yaml');
    const overviewMdPath = join(env.activeDir, 'my-new-feature', 'overview.md');
    assert.ok(existsSync(changeYamlPath));
    assert.ok(existsSync(overviewMdPath));

    const overviewContent = readFileSync(overviewMdPath, 'utf-8');
    assert.ok(overviewContent.includes('# My New Feature'));
    assert.ok(overviewContent.includes('Implement a new feature.'));

    // Verify index files were updated
    const indexData = JSON.parse(readFileSync(env.indexJson, 'utf-8'));
    const changeInIndex = indexData.changes.find(c => c.id === 'my-new-feature');
    assert.ok(changeInIndex);
    assert.equal(changeInIndex.specId, result.specId);
    assert.equal(changeInIndex.title, 'My New Feature');
  } finally {
    await env.cleanup();
  }
});

test('createSpecification rejects duplicate slug in active or archive specs', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    await createSpecification({
      slug: 'existing-active',
      title: 'Active Spec',
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });

    // Duplicate in active
    await assert.rejects(
      () => createSpecification({
        slug: 'existing-active',
        title: 'Duplicate Spec',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
      err => err instanceof SpecConflictError && err.code === 'SPEC_CONFLICT'
    );

    // Create an archived spec manually
    const archivedDir = join(env.archiveDir, 'existing-archived');
    mkdirSync(archivedDir, { recursive: true });
    writeFileSync(join(archivedDir, 'change.yaml'), 'id: existing-archived\ntitle: Archived\nstatus: completed\n');

    // Duplicate in archive
    await assert.rejects(
      () => createSpecification({
        slug: 'existing-archived',
        title: 'Archived Duplicate',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
      err => err instanceof SpecConflictError && err.code === 'SPEC_CONFLICT'
    );
  } finally {
    await env.cleanup();
  }
});

test('createSpecification handles concurrent same-slug creation safely', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    const promises = [
      createSpecification({
        slug: 'concurrent-spec',
        title: 'First Caller',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
      createSpecification({
        slug: 'concurrent-spec',
        title: 'Second Caller',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
    ];

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, 'SPEC_CONFLICT');
  } finally {
    await env.cleanup();
  }
});

test('createSpecification handles concurrent different-slug creation safely', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    const promises = [
      createSpecification({
        slug: 'concurrent-spec-a',
        title: 'Spec A',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
      createSpecification({
        slug: 'concurrent-spec-b',
        title: 'Spec B',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
      }),
    ];

    const results = await Promise.allSettled(promises);
    assert.equal(results.every(r => r.status === 'fulfilled'), true);

    const indexData = JSON.parse(readFileSync(env.indexJson, 'utf-8'));
    assert.ok(indexData.changes.some(c => c.id === 'concurrent-spec-a'));
    assert.ok(indexData.changes.some(c => c.id === 'concurrent-spec-b'));
  } finally {
    await env.cleanup();
  }
});

test('createSpecification rolls back directory and index on partial failure', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    // Seed one valid initial spec
    await createSpecification({
      slug: 'initial-spec',
      title: 'Initial Spec',
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });

    // Attempt creation with invalid indexJson path that triggers index-writing failure
    const invalidIndexJsonPath = join(env.root, 'nonexistent-dir', 'unwritable.json');

    await assert.rejects(
      () => createSpecification({
        slug: 'failing-spec',
        title: 'Failing Spec',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: invalidIndexJsonPath,
      })
    );

    // Spec directory must have been cleaned up
    assert.equal(existsSync(join(env.activeDir, 'failing-spec')), false);

    // Valid spec still exists and indexes remain consistent
    assert.ok(existsSync(join(env.activeDir, 'initial-spec')));
    const indexData = JSON.parse(readFileSync(env.indexJson, 'utf-8'));
    assert.equal(indexData.changes.length, 1);
    assert.equal(indexData.changes[0].id, 'initial-spec');
  } finally {
    await env.cleanup();
  }
});
