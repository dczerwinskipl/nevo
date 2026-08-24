import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_AI_ADAPTERS_CONFIG_PATH,
  DEFAULT_ANTIGRAVITY_RAW_DIRECTORY,
  loadAiAdaptersConfig,
} from '../server/ai-adapters-config.mjs';

test('AI adapter config disables every adapter and raw capture when the local YAML file is absent', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-adapters-default-'));
  try {
    const config = loadAiAdaptersConfig({ repoRoot });
    assert.deepEqual(config, {
      configPath: resolve(repoRoot, DEFAULT_AI_ADAPTERS_CONFIG_PATH),
      configured: false,
      adapterOrder: [],
      adapters: {
        claude: { enabled: false },
        antigravity: {
          enabled: false,
          rawCaptureEnabled: false,
          rawCaptureDir: resolve(repoRoot, DEFAULT_ANTIGRAVITY_RAW_DIRECTORY),
        },
        codex: { enabled: false },
        mock: { enabled: false },
      },
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('AI adapter config reads the enabled adapter list and Antigravity diagnostics', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-adapters-custom-'));
  try {
    const filePath = join(repoRoot, 'ai-adapters.yaml');
    await writeFile(filePath, `version: 1
adapters:
  claude:
    enabled: true
  antigravity:
    enabled: true
    diagnostics:
      raw_responses:
        enabled: true
        directory: .nevo-ai-local/provider-raw/antigravity
  codex:
    enabled: false
  mock:
    enabled: true
`, 'utf8');

    const config = loadAiAdaptersConfig({ repoRoot, filePath });
    assert.equal(config.configured, true);
    assert.deepEqual(config.adapterOrder, ['claude', 'antigravity', 'codex', 'mock']);
    assert.deepEqual(
      Object.fromEntries(Object.entries(config.adapters).map(([id, value]) => [id, value.enabled])),
      { claude: true, antigravity: true, codex: false, mock: true },
    );
    assert.equal(config.adapters.antigravity.rawCaptureEnabled, true);
    assert.equal(
      config.adapters.antigravity.rawCaptureDir,
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

    await t.test('adapter enabled must be boolean', async () => {
      await writeFile(filePath, `adapters:
  codex:
    enabled: "yes"
`, 'utf8');
      assert.throws(
        () => loadAiAdaptersConfig({ repoRoot, filePath }),
        /adapters\.codex\.enabled.*expected true or false/,
      );
    });

    await t.test('unknown adapter is rejected', async () => {
      await writeFile(filePath, `adapters:
  imaginary:
    enabled: true
`, 'utf8');
      assert.throws(
        () => loadAiAdaptersConfig({ repoRoot, filePath }),
        /adapters\.imaginary.*unknown adapter/,
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
