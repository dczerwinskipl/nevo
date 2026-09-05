import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_AI_PROVIDERS_CONFIG_PATH,
  DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS,
  DEFAULT_ANTIGRAVITY_RAW_DIRECTORY,
  DEFAULT_CLAUDE_RAW_DIRECTORY,
  DEFAULT_CODEX_RAW_DIRECTORY,
  loadAgentProvidersConfig,
} from '../server/ai/providers/config.mjs';

test('AI provider config disables every provider and raw capture when the local YAML file is absent', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-providers-default-'));
  try {
    const config = loadAgentProvidersConfig({ repoRoot });
    assert.deepEqual(config, {
      configPath: resolve(repoRoot, DEFAULT_AI_PROVIDERS_CONFIG_PATH),
      configured: false,
      providerOrder: [],
      providers: {
        claude: {
          enabled: false,
          rawCaptureEnabled: false,
          rawCaptureDir: resolve(repoRoot, DEFAULT_CLAUDE_RAW_DIRECTORY),
        },
        antigravity: {
          enabled: false,
          rawCaptureEnabled: false,
          rawCaptureDir: resolve(repoRoot, DEFAULT_ANTIGRAVITY_RAW_DIRECTORY),
          printTimeoutSeconds: DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS,
        },
        codex: {
          enabled: false,
          rawCaptureEnabled: false,
          rawCaptureDir: resolve(repoRoot, DEFAULT_CODEX_RAW_DIRECTORY),
        },
        mock: { enabled: false },
      },
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('AI provider config reads the enabled provider list and Antigravity diagnostics', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-providers-custom-'));
  try {
    const filePath = join(repoRoot, 'ai-providers.yaml');
    await writeFile(
      filePath,
      `version: 1
providers:
  claude:
    enabled: true
    diagnostics:
      raw_responses:
        enabled: true
        directory: .nevo-ai-local/provider-raw/claude
  antigravity:
    enabled: true
    transport:
      print_timeout_seconds: 43200
    diagnostics:
      raw_responses:
        enabled: true
        directory: .nevo-ai-local/provider-raw/antigravity
  codex:
    enabled: false
    diagnostics:
      raw_responses:
        enabled: true
        directory: .nevo-ai-local/provider-raw/codex
  mock:
    enabled: true
`,
      'utf8',
    );

    const config = loadAgentProvidersConfig({ repoRoot, filePath });
    assert.equal(config.configured, true);
    assert.deepEqual(config.providerOrder, ['claude', 'antigravity', 'codex', 'mock']);
    assert.deepEqual(Object.fromEntries(Object.entries(config.providers).map(([id, value]) => [id, value.enabled])), {
      claude: true,
      antigravity: true,
      codex: false,
      mock: true,
    });
    assert.equal(config.providers.claude.rawCaptureEnabled, true);
    assert.equal(config.providers.claude.rawCaptureDir, resolve(repoRoot, '.nevo-ai-local/provider-raw/claude'));
    assert.equal(config.providers.antigravity.rawCaptureEnabled, true);
    assert.equal(config.providers.antigravity.printTimeoutSeconds, 43200);
    assert.equal(
      config.providers.antigravity.rawCaptureDir,
      resolve(repoRoot, '.nevo-ai-local/provider-raw/antigravity'),
    );
    assert.equal(config.providers.codex.rawCaptureEnabled, true);
    assert.equal(config.providers.codex.rawCaptureDir, resolve(repoRoot, '.nevo-ai-local/provider-raw/codex'));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('AI provider config reports field-specific errors for invalid values and unsafe directories', async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-providers-invalid-'));
  const filePath = join(repoRoot, 'ai-providers.yaml');
  try {
    await t.test('enabled must be boolean', async () => {
      await writeFile(
        filePath,
        `providers:
  antigravity:
    diagnostics:
      raw_responses:
        enabled: "yes"
`,
        'utf8',
      );
      assert.throws(
        () => loadAgentProvidersConfig({ repoRoot, filePath }),
        /providers\.antigravity\.diagnostics\.raw_responses\.enabled.*expected true or false/,
      );
    });

    await t.test('provider enabled must be boolean', async () => {
      await writeFile(
        filePath,
        `providers:
  codex:
    enabled: "yes"
`,
        'utf8',
      );
      assert.throws(
        () => loadAgentProvidersConfig({ repoRoot, filePath }),
        /providers\.codex\.enabled.*expected true or false/,
      );
    });

    await t.test('Antigravity print timeout must be a positive integer', async () => {
      await writeFile(
        filePath,
        `providers:
  antigravity:
    transport:
      print_timeout_seconds: 0
`,
        'utf8',
      );
      assert.throws(
        () => loadAgentProvidersConfig({ repoRoot, filePath }),
        /providers\.antigravity\.transport\.print_timeout_seconds.*positive integer/,
      );
    });

    await t.test('unknown provider is rejected', async () => {
      await writeFile(
        filePath,
        `providers:
  imaginary:
    enabled: true
`,
        'utf8',
      );
      assert.throws(() => loadAgentProvidersConfig({ repoRoot, filePath }), /providers\.imaginary.*unknown provider/);
    });

    await t.test('absolute directory is rejected', async () => {
      const absolute = resolve(repoRoot, 'raw').replaceAll('\\', '/');
      await writeFile(
        filePath,
        `providers:
  antigravity:
    diagnostics:
      raw_responses:
        directory: '${absolute}'
`,
        'utf8',
      );
      assert.throws(
        () => loadAgentProvidersConfig({ repoRoot, filePath }),
        /raw_responses\.directory.*absolute paths are not allowed/,
      );
    });

    await t.test('directory traversal is rejected', async () => {
      await writeFile(
        filePath,
        `providers:
  antigravity:
    diagnostics:
      raw_responses:
        directory: ../outside
`,
        'utf8',
      );
      assert.throws(
        () => loadAgentProvidersConfig({ repoRoot, filePath }),
        /raw_responses\.directory.*path must stay inside the repository root/,
      );
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
