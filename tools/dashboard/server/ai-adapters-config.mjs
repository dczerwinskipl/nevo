import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseYamlFile } from '../../lib/yaml.mjs';

export const DEFAULT_ANTIGRAVITY_RAW_DIRECTORY = '.nevo-ai-local/antigravity_raw';

function configError(field, message) {
  return new Error(`Invalid AI adapter configuration at '${field}': ${message}`);
}

function requireObject(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(field, 'expected a mapping.');
  }
  return value;
}

function resolveRepositoryDirectory(repoRoot, configuredDirectory) {
  const field = 'adapters.antigravity.diagnostics.raw_responses.directory';
  if (typeof configuredDirectory !== 'string' || !configuredDirectory.trim()) {
    throw configError(field, 'expected a non-empty repository-relative path.');
  }
  if (isAbsolute(configuredDirectory)) {
    throw configError(field, 'absolute paths are not allowed.');
  }

  const resolvedDirectory = resolve(repoRoot, configuredDirectory);
  const relativeDirectory = relative(repoRoot, resolvedDirectory);
  if (relativeDirectory === '..' || relativeDirectory.startsWith(`..${sep}`) || isAbsolute(relativeDirectory)) {
    throw configError(field, 'path must stay inside the repository root.');
  }
  return resolvedDirectory;
}

export function loadAiAdaptersConfig({ repoRoot, filePath } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new TypeError('repoRoot is required to load AI adapter configuration.');
  }

  const effectiveFilePath = filePath ?? resolve(repoRoot, 'ai-adapters.yaml');
  const raw = existsSync(effectiveFilePath) ? parseYamlFile(effectiveFilePath) : {};
  const root = requireObject(raw, 'root');
  const version = root.version ?? 1;
  if (version !== 1) {
    throw configError('version', `expected 1, received ${JSON.stringify(version)}.`);
  }

  const adapters = requireObject(root.adapters, 'adapters');
  const antigravity = requireObject(adapters.antigravity, 'adapters.antigravity');
  const diagnostics = requireObject(antigravity.diagnostics, 'adapters.antigravity.diagnostics');
  const rawResponses = requireObject(
    diagnostics.raw_responses,
    'adapters.antigravity.diagnostics.raw_responses',
  );

  const enabled = rawResponses.enabled ?? true;
  if (typeof enabled !== 'boolean') {
    throw configError('adapters.antigravity.diagnostics.raw_responses.enabled', 'expected true or false.');
  }

  const directory = rawResponses.directory ?? DEFAULT_ANTIGRAVITY_RAW_DIRECTORY;
  return {
    antigravity: {
      rawCaptureEnabled: enabled,
      rawCaptureDir: resolveRepositoryDirectory(repoRoot, directory),
    },
  };
}
