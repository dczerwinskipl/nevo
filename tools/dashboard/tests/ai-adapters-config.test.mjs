import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_ANTIGRAVITY_RAW_DIRECTORY,
  loadAiAdaptersConfig,
} from '../server/ai-adapters-config.mjs';

test('AI adapter config preserves Antigravity diagnostic defaults when the YAML file is absent', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-adapters-default-'));
  try {
    const config = loadAiAdaptersConfig({ repoRoot });
    assert.deepEqual(config, {
      antigravity: {
        rawCaptureEnabled: true,
        rawCaptureDir: resolve(repoRoot, DEFAULT_ANTIGRAVITY_RAW_DIRECTORY),
      },
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('AI adapter config reads the raw response toggle and custom repository-relative directory', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-adapters-custom-'));
  try {
    const filePath = join(repoRoot, 'ai-adapters.yaml');
    await writeFile(filePath, `version: 1
adapters:
  antigravity:
    diagnostics:
      raw_responses:
        enabled: false
        directory: .nevo-ai-local/provider-raw/antigravity
`, 'utf8');

    const config = loadAiAdaptersConfig({ repoRoot, filePath });
    assert.equal(config.antigravity.rawCaptureEnabled, false);
    assert.equal(
      config.antigravity.rawCaptureDir,
      resolve(repoRoot, '.nevo-ai-local/provider-raw/antigravity'),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('AI adapter config reports field-specific errors for invalid values and unsafe directories', async t => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-adapters-invalid-'));
  const filePath = join(repoRoot, 'ai-adapters.yaml');
  try {
    await t.test('enabled must be boolean', async () => {
      await writeFile(filePath, `adapters:
  antigravity:
    diagnostics:
      raw_responses:
        enabled: "yes"
`, 'utf8');
      assert.throws(
        () => loadAiAdaptersConfig({ repoRoot, filePath }),
        /adapters\.antigravity\.diagnostics\.raw_responses\.enabled.*expected true or false/,
      );
    });

    await t.test('absolute directory is rejected', async () => {
      const absolute = resolve(repoRoot, 'raw').replaceAll('\\', '/');
      await writeFile(filePath, `adapters:
  antigravity:
    diagnostics:
      raw_responses:
        directory: '${absolute}'
`, 'utf8');
      assert.throws(
        () => loadAiAdaptersConfig({ repoRoot, filePath }),
        /raw_responses\.directory.*absolute paths are not allowed/,
      );
    });

    await t.test('directory traversal is rejected', async () => {
      await writeFile(filePath, `adapters:
  antigravity:
    diagnostics:
      raw_responses:
        directory: ../outside
`, 'utf8');
      assert.throws(
        () => loadAiAdaptersConfig({ repoRoot, filePath }),
        /raw_responses\.directory.*path must stay inside the repository root/,
      );
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
