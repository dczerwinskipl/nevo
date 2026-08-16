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
