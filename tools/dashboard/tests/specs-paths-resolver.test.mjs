import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import { resolveSpecsPaths } from '../server/specs/paths.mjs';
import { REPOSITORY_ROOT } from '../server/infrastructure/paths.mjs';

test('resolveSpecsPaths: no overrides resolve to the current repository layout', () => {
  const paths = resolveSpecsPaths();
  assert.equal(paths.root, REPOSITORY_ROOT);
  assert.equal(paths.specsDir, resolve(REPOSITORY_ROOT, 'specs'));
  assert.equal(paths.activeDir, resolve(REPOSITORY_ROOT, 'specs', 'active'));
  assert.equal(paths.archiveDir, resolve(REPOSITORY_ROOT, 'specs', 'archive'));
  assert.equal(paths.activeIndexMd, resolve(REPOSITORY_ROOT, 'specs', 'active.generated.md'));
  assert.equal(paths.archiveIndexMd, resolve(REPOSITORY_ROOT, 'specs', 'archive.generated.md'));
  assert.equal(paths.indexJson, resolve(REPOSITORY_ROOT, 'specs', 'index.generated.json'));
});

// The regression this file exists to catch: a bare `resolveSpecsPaths({
// root: customRoot })` — with everything else left to default — must
// relocate *every* Specs path under that custom root, not just `root`
// itself. Against the version introduced in 796440d, activeDir/archiveDir/
// the indexes still fell back to the real repository's own ACTIVE_DIR/
// ARCHIVE_DIR/index constants regardless of `root`, so this test fails on
// that commit.
test('resolveSpecsPaths: a custom root alone relocates every Specs path under <root>/specs', () => {
  const customRoot = '/worktrees/my-spec';
  const paths = resolveSpecsPaths({ root: customRoot });

  assert.equal(paths.root, customRoot);
  assert.equal(paths.specsDir, resolve(customRoot, 'specs'));
  assert.equal(paths.activeDir, resolve(customRoot, 'specs', 'active'));
  assert.equal(paths.archiveDir, resolve(customRoot, 'specs', 'archive'));
  assert.equal(paths.activeIndexMd, resolve(customRoot, 'specs', 'active.generated.md'));
  assert.equal(paths.archiveIndexMd, resolve(customRoot, 'specs', 'archive.generated.md'));
  assert.equal(paths.indexJson, resolve(customRoot, 'specs', 'index.generated.json'));

  // None of the resolved paths accidentally point back at the real
  // repository.
  for (const [key, value] of Object.entries(paths)) {
    if (key === 'root' || key === 'specsDir') continue;
    assert.ok(
      !value.startsWith(REPOSITORY_ROOT),
      `${key} still points inside the real repository (${value}) instead of the custom root`,
    );
  }
});

test('resolveSpecsPaths: a custom specsDir (without overriding root) relocates active/archive/indexes but not root', () => {
  const customSpecsDir = '/worktrees/my-spec/custom-specs';
  const paths = resolveSpecsPaths({ specsDir: customSpecsDir });

  assert.equal(paths.root, REPOSITORY_ROOT, 'root should stay at its own default when only specsDir is overridden');
  assert.equal(paths.specsDir, customSpecsDir);
  assert.equal(paths.activeDir, resolve(customSpecsDir, 'active'));
  assert.equal(paths.archiveDir, resolve(customSpecsDir, 'archive'));
  assert.equal(paths.activeIndexMd, resolve(customSpecsDir, 'active.generated.md'));
  assert.equal(paths.archiveIndexMd, resolve(customSpecsDir, 'archive.generated.md'));
  assert.equal(paths.indexJson, resolve(customSpecsDir, 'index.generated.json'));
});

test('resolveSpecsPaths: an explicit leaf override changes only that leaf', () => {
  const customActiveDir = '/worktrees/my-spec/only-active';
  const paths = resolveSpecsPaths({ activeDir: customActiveDir });

  assert.equal(paths.activeDir, customActiveDir);
  // Everything else still derives from the default specsDir.
  assert.equal(paths.root, REPOSITORY_ROOT);
  assert.equal(paths.specsDir, resolve(REPOSITORY_ROOT, 'specs'));
  assert.equal(paths.archiveDir, resolve(REPOSITORY_ROOT, 'specs', 'archive'));
  assert.equal(paths.activeIndexMd, resolve(REPOSITORY_ROOT, 'specs', 'active.generated.md'));
  assert.equal(paths.archiveIndexMd, resolve(REPOSITORY_ROOT, 'specs', 'archive.generated.md'));
  assert.equal(paths.indexJson, resolve(REPOSITORY_ROOT, 'specs', 'index.generated.json'));
});

test('resolveSpecsPaths: the returned object is frozen', () => {
  const paths = resolveSpecsPaths();
  assert.throws(() => { paths.activeDir = '/tmp/should-not-work'; }, /Cannot assign|read.only/i);
});
