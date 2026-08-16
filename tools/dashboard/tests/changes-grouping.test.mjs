import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignGroup,
  computeVisibility,
  groupFiles,
  isGeneratedFile,
  isLockfile,
} from '../src/lib/changes-grouping.ts';
import { buildDiffFetchPlan } from '../src/hooks/use-dashboard-data.ts';

const changeView = {
  groups: [
    { name: 'Specs', paths: ['specs/**'] },
    { name: 'Tools', paths: ['tools/**'] },
    { name: 'Other', paths: [], fallback: true },
  ],
};

const generatedFiles = {
  rules: [{ paths: ['**/*.generated.*', 'dist/**'] }],
  lockfiles: ['package-lock.json', '**/package-lock.json'],
};

test('grouping is deterministic and first-match-wins (AC1)', () => {
  assert.equal(assignGroup('specs/active/x/change.yaml', changeView), 'Specs');
  assert.equal(assignGroup('tools/dashboard/server/index.mjs', changeView), 'Tools');
  assert.equal(assignGroup('README.md', changeView), 'Other');
  // Same input, computed twice, produces the same result.
  assert.equal(assignGroup('specs/active/x/change.yaml', changeView), assignGroup('specs/active/x/change.yaml', changeView));

  const groups = groupFiles(
    ['specs/a.md', 'tools/b.mjs', 'specs/c.md', 'README.md'],
    'area',
    changeView,
  );
  assert.deepEqual(groups, [
    { name: 'Specs', paths: ['specs/a.md', 'specs/c.md'] },
    { name: 'Tools', paths: ['tools/b.mjs'] },
    { name: 'Other', paths: ['README.md'] },
  ]);
});

test('a generated-matching file keeps its otherwise-matching group when shown, disappears (not from the count) when hidden (AC2)', () => {
  const paths = ['tools/index.generated.md', 'tools/index.mjs'];
  assert.equal(assignGroup('tools/index.generated.md', changeView), 'Tools');
  assert.equal(isGeneratedFile('tools/index.generated.md', generatedFiles), true);

  const shown = computeVisibility(paths, generatedFiles, false);
  assert.deepEqual(shown.visiblePaths, paths);
  assert.equal(shown.hiddenCount, 0);

  const hidden = computeVisibility(paths, generatedFiles, true);
  assert.deepEqual(hidden.visiblePaths, ['tools/index.mjs']);
  assert.deepEqual(hidden.hiddenPaths, ['tools/index.generated.md']);
  assert.equal(hidden.hiddenCount, 1);
  assert.equal(hidden.visibleCount + hidden.hiddenCount, paths.length);
});

test('toggling "hide generated" back is a pure re-filter — same input, same result, no fetch involved (AC3)', () => {
  const paths = ['dist/bundle.js', 'src/app.ts'];
  const hidden = computeVisibility(paths, generatedFiles, true);
  const shownAgain = computeVisibility(paths, generatedFiles, false);
  assert.deepEqual(shownAgain.visiblePaths, paths);
  assert.deepEqual(hidden.visiblePaths, ['src/app.ts']);
  // Toggling back matches exactly re-running with hideGenerated: false on
  // the same already-known paths — nothing lost, nothing re-derived from a
  // network call.
  assert.deepEqual(computeVisibility(paths, generatedFiles, false), shownAgain);
});

test('directory and flat modes require no changeView.groups config (AC5)', () => {
  const paths = ['tools/dashboard/a.ts', 'tools/dashboard/b.ts', 'specs/active/c.md'];
  const byDirectory = groupFiles(paths, 'directory', null);
  assert.deepEqual(byDirectory, [
    { name: 'specs/active', paths: ['specs/active/c.md'] },
    { name: 'tools/dashboard', paths: ['tools/dashboard/a.ts', 'tools/dashboard/b.ts'] },
  ]);

  const flat = groupFiles(paths, 'flat', null);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].paths, paths);
});

test('lockfiles are a distinct concept, never auto-folded into "generated"', () => {
  assert.equal(isLockfile('package-lock.json', generatedFiles), true);
  assert.equal(isGeneratedFile('package-lock.json', generatedFiles), false);
});

test('hidden generated files get zero background diff-hydration requests until explicitly opened (AC4)', () => {
  const allFiles = ['tools/index.mjs', 'tools/index.generated.md', 'dist/bundle.js'];
  const { visiblePaths, hiddenPaths } = computeVisibility(allFiles, generatedFiles, true);
  assert.deepEqual(hiddenPaths, ['tools/index.generated.md', 'dist/bundle.js']);

  // The background hydration queue only ever sees the currently-visible set.
  const plan = buildDiffFetchPlan({
    allPaths: visiblePaths,
    resolvedPaths: new Set(),
    inFlightPaths: new Set(),
    batchSize: 10,
  });
  const planned = plan.flatMap(unit => unit.paths);
  assert.deepEqual(planned, ['tools/index.mjs']);
  for (const hidden of hiddenPaths) assert.ok(!planned.includes(hidden));

  // An explicit open of a hidden file still works once it's shown — same
  // priority mechanism as any user-opened file.
  const openedPlan = buildDiffFetchPlan({
    allPaths: [...visiblePaths, 'tools/index.generated.md'],
    resolvedPaths: new Set(),
    inFlightPaths: new Set(),
    priorityPaths: ['tools/index.generated.md'],
    batchSize: 10,
  });
  assert.deepEqual(openedPlan[0], { paths: ['tools/index.generated.md'], priority: true });
});

test('an empty/missing config never throws — directory/flat/area all degrade gracefully', () => {
  assert.deepEqual(groupFiles([], 'area', undefined), []);
  assert.equal(assignGroup('anything.ts', undefined), 'Other');
  assert.equal(isGeneratedFile('anything.ts', undefined), false);
  assert.equal(isLockfile('anything.ts', undefined), false);
});
