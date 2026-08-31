import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseYamlFile } from '../../../../lib/yaml.mjs';

export const DEFAULT_ANTIGRAVITY_RAW_DIRECTORY = '.nevo-ai-local/antigravity_raw';
export const DEFAULT_CLAUDE_RAW_DIRECTORY = '.nevo-ai-local/claude_raw';
export const DEFAULT_CODEX_RAW_DIRECTORY = '.nevo-ai-local/codex_raw';
export const DEFAULT_AI_PROVIDERS_CONFIG_PATH = '.nevo-ai-local/ai-providers.yaml';
export const SUPPORTED_AGENT_PROVIDERS = Object.freeze(['claude', 'antigravity', 'codex', 'mock']);

function configError(field, message) {
  return new Error(`Invalid AI provider configuration at '${field}': ${message}`);
}

function requireObject(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(field, 'expected a mapping.');
  }
  return value;
}

function resolveRepositoryDirectory(repoRoot, configuredDirectory, field = 'providers.antigravity.diagnostics.raw_responses.directory') {
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

function parseRawCapture(providerId, providerObj, defaultDir, repoRoot) {
  const diagnostics = requireObject(providerObj.diagnostics, `providers.${providerId}.diagnostics`);
  const rawResponses = requireObject(
    diagnostics.raw_responses,
    `providers.${providerId}.diagnostics.raw_responses`,
  );

  const rawCaptureEnabled = rawResponses.enabled ?? false;
  if (typeof rawCaptureEnabled !== 'boolean') {
    throw configError(`providers.${providerId}.diagnostics.raw_responses.enabled`, 'expected true or false.');
  }

  const directory = rawResponses.directory ?? defaultDir;
  return {
    rawCaptureEnabled,
    rawCaptureDir: resolveRepositoryDirectory(
      repoRoot,
      directory,
      `providers.${providerId}.diagnostics.raw_responses.directory`,
    ),
  };
}

export function loadAgentProvidersConfig({ repoRoot, filePath } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new TypeError('repoRoot is required to load AI provider configuration.');
  }

  const effectiveFilePath = filePath ?? resolve(repoRoot, DEFAULT_AI_PROVIDERS_CONFIG_PATH);
  const configured = existsSync(effectiveFilePath);
  const raw = configured ? parseYamlFile(effectiveFilePath) : {};
  const root = requireObject(raw, 'root');
  const version = root.version ?? 1;
  if (version !== 1) {
    throw configError('version', `expected 1, received ${JSON.stringify(version)}.`);
  }

  const providers = requireObject(root.providers, 'providers');
  for (const providerId of Object.keys(providers)) {
    if (!SUPPORTED_AGENT_PROVIDERS.includes(providerId)) {
      throw configError(`providers.${providerId}`, `unknown provider; expected one of ${SUPPORTED_AGENT_PROVIDERS.join(', ')}.`);
    }
  }

  const claudeRaw = parseRawCapture('claude', providers.claude ?? {}, DEFAULT_CLAUDE_RAW_DIRECTORY, repoRoot);
  const antigravityRaw = parseRawCapture('antigravity', providers.antigravity ?? {}, DEFAULT_ANTIGRAVITY_RAW_DIRECTORY, repoRoot);
  const codexRaw = parseRawCapture('codex', providers.codex ?? {}, DEFAULT_CODEX_RAW_DIRECTORY, repoRoot);

  const providerConfig = {};
  for (const providerId of SUPPORTED_AGENT_PROVIDERS) {
    const configuredProvider = requireObject(providers[providerId], `providers.${providerId}`);
    const enabled = configuredProvider.enabled ?? false;
    if (typeof enabled !== 'boolean') {
      throw configError(`providers.${providerId}.enabled`, 'expected true or false.');
    }
    providerConfig[providerId] = { enabled };
  }

  return {
    configPath: effectiveFilePath,
    configured,
    providerOrder: Object.keys(providers),
    providers: {
      ...providerConfig,
      claude: {
        ...providerConfig.claude,
        ...claudeRaw,
      },
      antigravity: {
        ...providerConfig.antigravity,
        ...antigravityRaw,
      },
      codex: {
        ...providerConfig.codex,
        ...codexRaw,
      },
    },
  };
}
