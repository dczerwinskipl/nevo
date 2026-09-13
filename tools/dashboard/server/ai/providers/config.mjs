import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseYamlFile } from '../../../../lib/yaml.mjs';
import { validateAgentModelTraits } from '../model/model-catalog.mjs';
import { AiValidationError } from '../contracts.mjs';

export const DEFAULT_ANTIGRAVITY_RAW_DIRECTORY = '.nevo-ai-local/antigravity_raw';
export const DEFAULT_CLAUDE_RAW_DIRECTORY = '.nevo-ai-local/claude_raw';
export const DEFAULT_CODEX_RAW_DIRECTORY = '.nevo-ai-local/codex_raw';
// agy 1.1.23 requires a finite --print-timeout and documents no supported
// disable value. Keep its provider-owned transport ceiling well beyond the
// neutral protocol-silence policy while allowing operators to configure it.
export const DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS = 24 * 60 * 60;
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

function resolveRepositoryDirectory(
  repoRoot,
  configuredDirectory,
  field = 'providers.antigravity.diagnostics.raw_responses.directory',
) {
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
  const rawResponses = requireObject(diagnostics.raw_responses, `providers.${providerId}.diagnostics.raw_responses`);

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

function parseClaudeModels(providerObj) {
  const raw = providerObj.models ?? providerObj.configured_models;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw configError('providers.claude.models', 'expected an array of model configurations.');
  }
  return raw.map((item, index) => {
    // `source` is never read from operator config: every entry here is, by construction,
    // operator-supplied, so its provenance is always truthfully `configured` — an operator
    // cannot claim `known`/`discovered` for their own entry (source spoofing).
    if (typeof item === 'string' && item.trim()) {
      return {
        id: item.trim(),
        label: item.trim(),
        source: 'configured',
      };
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (typeof item.id !== 'string' || !item.id.trim()) {
        throw configError(`providers.claude.models[${index}].id`, 'expected a non-empty string.');
      }
      if (item.isDefault !== undefined && typeof item.isDefault !== 'boolean') {
        throw configError(`providers.claude.models[${index}].isDefault`, 'expected true or false.');
      }
      let traits;
      if (item.traits !== undefined) {
        try {
          traits = validateAgentModelTraits(item.traits, `providers.claude.models[${index}].traits`);
        } catch (err) {
          if (err instanceof AiValidationError) {
            throw configError(`providers.claude.models[${index}].traits`, err.message);
          }
          throw err;
        }
      }
      return {
        id: item.id.trim(),
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.id.trim(),
        ...(traits !== undefined ? { traits } : {}),
        ...(typeof item.isDefault === 'boolean' ? { isDefault: item.isDefault } : {}),
        source: 'configured',
      };
    }
    throw configError(`providers.claude.models[${index}]`, 'expected a model object or string.');
  });
}

function parseAntigravityTransport(providerObj) {
  const transport = requireObject(providerObj.transport, 'providers.antigravity.transport');
  const printTimeoutSeconds = transport.print_timeout_seconds ?? DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(printTimeoutSeconds) || printTimeoutSeconds <= 0) {
    throw configError(
      'providers.antigravity.transport.print_timeout_seconds',
      'expected a positive integer number of seconds.',
    );
  }
  return { printTimeoutSeconds };
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
      throw configError(
        `providers.${providerId}`,
        `unknown provider; expected one of ${SUPPORTED_AGENT_PROVIDERS.join(', ')}.`,
      );
    }
  }

  const claudeRaw = parseRawCapture('claude', providers.claude ?? {}, DEFAULT_CLAUDE_RAW_DIRECTORY, repoRoot);
  const claudeModels = parseClaudeModels(providers.claude ?? {});
  const antigravityRaw = parseRawCapture(
    'antigravity',
    providers.antigravity ?? {},
    DEFAULT_ANTIGRAVITY_RAW_DIRECTORY,
    repoRoot,
  );
  const antigravityTransport = parseAntigravityTransport(providers.antigravity ?? {});
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
        configuredModels: claudeModels,
      },
      antigravity: {
        ...providerConfig.antigravity,
        ...antigravityRaw,
        ...antigravityTransport,
      },
      codex: {
        ...providerConfig.codex,
        ...codexRaw,
      },
    },
  };
}
