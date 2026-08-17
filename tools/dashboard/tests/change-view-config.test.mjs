import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_CHANGE_VIEW, DEFAULT_GENERATED_FILES, loadChangeViewConfig } from '../server/change-view-config.mjs';

test('falls back to this repo\'s own reasonable default when no project config file exists', () => {
  const root = join(tmpdir(), `nevo-dashboard-changeview-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const result = loadChangeViewConfig({ repoRoot: root });
    assert.deepEqual(result.changeView, DEFAULT_CHANGE_VIEW);
    assert.deepEqual(result.generatedFiles, DEFAULT_GENERATED_FILES);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reads a per-project config file, so a consumer repo other than NEvo can customize it', () => {
  const root = join(tmpdir(), `nevo-dashboard-changeview-custom-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, '.nevo'), { recursive: true });
  const customChangeView = { groups: [{ name: 'App', paths: ['app/**'], fallback: false }] };
  const customGeneratedFiles = { rules: [{ paths: ['build/**'] }], lockfiles: ['composer.lock'] };
  writeFileSync(
    join(root, '.nevo', 'dashboard-view.json'),
    JSON.stringify({ changeView: customChangeView, generatedFiles: customGeneratedFiles }),
  );
  try {
    const result = loadChangeViewConfig({ repoRoot: root });
    assert.deepEqual(result.changeView, customChangeView);
    assert.deepEqual(result.generatedFiles, customGeneratedFiles);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a malformed config file falls back to defaults rather than throwing', () => {
  const root = join(tmpdir(), `nevo-dashboard-changeview-malformed-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, '.nevo'), { recursive: true });
  writeFileSync(join(root, '.nevo', 'dashboard-view.json'), '{ not valid json');
  try {
    const result = loadChangeViewConfig({ repoRoot: root });
    assert.deepEqual(result.changeView, DEFAULT_CHANGE_VIEW);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('DEFAULT_CHANGE_VIEW separates tooling per tool (Dashboard, AI, Specs, Docs, Tests, Other)', async () => {
  const { assignGroup } = await import('../src/lib/changes-grouping.ts');
  assert.equal(assignGroup('tools/dashboard/src/App.tsx', DEFAULT_CHANGE_VIEW), 'Tooling: Dashboard');
  assert.equal(assignGroup('tools/dashboard/server/index.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Dashboard');
  assert.equal(assignGroup('tools/ai/service.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: AI');
  assert.equal(assignGroup('.claude/skills/demo.md', DEFAULT_CHANGE_VIEW), 'Tooling: AI');
  assert.equal(assignGroup('.cursor/rules/main.md', DEFAULT_CHANGE_VIEW), 'Tooling: AI');
  assert.equal(assignGroup('tools/specs.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Specs');
  assert.equal(assignGroup('tools/specs/service.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Specs');
  assert.equal(assignGroup('tools/docs.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Docs');
  assert.equal(assignGroup('tools/docs/indexer.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Docs');
  assert.equal(assignGroup('tools/tests/specs.test.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Tests');
  assert.equal(assignGroup('tools/lib/common.mjs', DEFAULT_CHANGE_VIEW), 'Tooling: Other');
  assert.equal(assignGroup('specs/active/my-change/change.yaml', DEFAULT_CHANGE_VIEW), 'Specs');
  assert.equal(assignGroup('src/NEvo.Core/Engine.cs', DEFAULT_CHANGE_VIEW), 'Source');
  assert.equal(assignGroup('tests/NEvo.Tests/EngineTests.cs', DEFAULT_CHANGE_VIEW), 'Tests');
  assert.equal(assignGroup('docs/development/local-setup.md', DEFAULT_CHANGE_VIEW), 'Docs');
  assert.equal(assignGroup('README.md', DEFAULT_CHANGE_VIEW), 'Other');
});

