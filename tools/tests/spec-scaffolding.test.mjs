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
  SpecValidationError,
  SpecConflictError,
  SpecRollbackError,
} from '../specs/identity.mjs';
import {
  refreshSpecsIndexes,
  buildSpecsIndexes,
  checkSpecsIndexes,
} from '../specs/indexes.mjs';
import { loadChange } from '../specs/store.mjs';

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

test('creation failure + successful rollback: rethrows original error and restores consistent state', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    // Seed initial spec
    await createSpecification({
      slug: 'pre-existing',
      title: 'Pre-existing Spec',
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });

    let attempts = 0;
    const failingRefreshIndexes = (options) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Initial index write failed');
      }
      // Recovery call succeeds
      return refreshSpecsIndexes(options);
    };

    await assert.rejects(
      () => createSpecification({
        slug: 'failing-spec',
        title: 'Failing Spec',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
        refreshIndexes: failingRefreshIndexes,
      }),
      err => {
        assert.equal(err.message, 'Initial index write failed');
        return true;
      }
    );

    // Spec directory removed
    assert.equal(existsSync(join(env.activeDir, 'failing-spec')), false);

    // Verify index is untouched and consistent with disk
    const problems = checkSpecsIndexes({
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });
    assert.deepEqual(problems, []);
  } finally {
    await env.cleanup();
  }
});

test('partial index write + successful recovery: directory removed and indexes remain consistent', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    await createSpecification({
      slug: 'initial-spec',
      title: 'Initial Spec',
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });

    let callCount = 0;
    const partiallyFailingRefresh = (options) => {
      callCount += 1;
      if (callCount === 1) {
        // Write active.generated.md, then fail before index.generated.json
        writeFileSync(options.activeIndexMd, 'corrupted partial active content');
        throw new Error('Disk full writing indexJson');
      }
      // Rollback recovery call: full proper rebuild/write
      return refreshSpecsIndexes(options);
    };

    await assert.rejects(
      () => createSpecification({
        slug: 'failing-spec',
        title: 'Failing Spec',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
        refreshIndexes: partiallyFailingRefresh,
      }),
      err => {
        assert.equal(err.message, 'Disk full writing indexJson');
        return true;
      }
    );

    // Spec directory was removed during rollback
    assert.equal(existsSync(join(env.activeDir, 'failing-spec')), false);

    // Rollback restored the generated index files to match disk exactly
    const problems = checkSpecsIndexes({
      activeDir: env.activeDir,
      archiveDir: env.archiveDir,
      activeIndexMd: env.activeIndexMd,
      archiveIndexMd: env.archiveIndexMd,
      indexJson: env.indexJson,
    });
    assert.deepEqual(problems, []);
  } finally {
    await env.cleanup();
  }
});

test('directory removal failure during rollback throws SpecRollbackError with failed step and cause', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    let callCount = 0;
    const failingRefresh = (options) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Index failure triggering rollback');
      }
      return refreshSpecsIndexes(options);
    };

    const failingFsRm = () => {
      throw new Error('EACCES: permission denied, unlink directory');
    };

    await assert.rejects(
      () => createSpecification({
        slug: 'rollback-dir-fail',
        title: 'Rollback Directory Fail',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
        fsRm: failingFsRm,
        refreshIndexes: failingRefresh,
      }),
      err => {
        assert.ok(err instanceof SpecRollbackError);
        assert.equal(err.code, 'SPEC_ROLLBACK_FAILED');
        assert.equal(err.slug, 'rollback-dir-fail');
        assert.deepEqual(err.failedSteps, ['cleanup_directory']);
        assert.equal(err.cause?.message, 'Index failure triggering rollback');
        assert.equal(err.recoveryErrors.length, 1);
        assert.equal(err.recoveryErrors[0].message, 'EACCES: permission denied, unlink directory');
        return true;
      }
    );
  } finally {
    await env.cleanup();
  }
});

test('index rebuild failure during rollback throws SpecRollbackError with failed step and cause', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    let callCount = 0;
    const failingRefresh = () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Initial index write failed');
      }
      throw new Error('Rollback index rebuild failed');
    };

    await assert.rejects(
      () => createSpecification({
        slug: 'rollback-index-fail',
        title: 'Rollback Index Fail',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
        refreshIndexes: failingRefresh,
      }),
      err => {
        assert.ok(err instanceof SpecRollbackError);
        assert.equal(err.code, 'SPEC_ROLLBACK_FAILED');
        assert.equal(err.slug, 'rollback-index-fail');
        assert.deepEqual(err.failedSteps, ['rebuild_indexes']);
        assert.equal(err.cause?.message, 'Initial index write failed');
        assert.equal(err.recoveryErrors.length, 1);
        assert.equal(err.recoveryErrors[0].message, 'Rollback index rebuild failed');
        return true;
      }
    );
  } finally {
    await env.cleanup();
  }
});

test('both rollback steps failing throws SpecRollbackError with all failed steps and explicit recovery context', async () => {
  const env = await createTempSpecsEnvironment();
  try {
    const failingFsRm = () => {
      throw new Error('Rollback directory deletion failed');
    };
    let callCount = 0;
    const failingRefresh = () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Initial index write failed');
      }
      throw new Error('Rollback index rebuild failed');
    };

    await assert.rejects(
      () => createSpecification({
        slug: 'both-rollback-fail',
        title: 'Both Rollback Fail',
        activeDir: env.activeDir,
        archiveDir: env.archiveDir,
        activeIndexMd: env.activeIndexMd,
        archiveIndexMd: env.archiveIndexMd,
        indexJson: env.indexJson,
        fsRm: failingFsRm,
        refreshIndexes: failingRefresh,
      }),
      err => {
        assert.ok(err instanceof SpecRollbackError);
        assert.equal(err.name, 'SpecRollbackError');
        assert.equal(err.code, 'SPEC_ROLLBACK_FAILED');
        assert.equal(err.slug, 'both-rollback-fail');
        assert.deepEqual(err.failedSteps, ['cleanup_directory', 'rebuild_indexes']);
        assert.equal(err.cause?.message, 'Initial index write failed');
        assert.equal(err.recoveryErrors.length, 2);
        assert.equal(err.recoveryErrors[0].message, 'Rollback directory deletion failed');
        assert.equal(err.recoveryErrors[1].message, 'Rollback index rebuild failed');
        assert.ok(err.message.includes('cleanup_directory, rebuild_indexes'));
        return true;
      }
    );
  } finally {
    await env.cleanup();
  }
});
