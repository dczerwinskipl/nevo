import { AiValidationError } from '../contracts.mjs';

export const MODEL_SOURCES = Object.freeze(['discovered', 'configured', 'known']);

function requiredString(value, field, { max = 256 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  return value.trim();
}

/**
 * Validates advisory model traits.
 * All trait fields are optional, with `undefined` denoting unknown rather than false.
 */
export function validateAgentModelTraits(value, field = 'traits') {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError(`'${field}' must be an object.`, { field });
  }

  const result = {};

  if (value.supportsReasoning !== undefined && value.supportsReasoning !== null) {
    if (typeof value.supportsReasoning !== 'boolean') {
      throw new AiValidationError(`'${field}.supportsReasoning' must be a boolean.`, {
        field: `${field}.supportsReasoning`,
      });
    }
    result.supportsReasoning = value.supportsReasoning;
  }

  if (value.supportedReasoningEfforts !== undefined && value.supportedReasoningEfforts !== null) {
    if (!Array.isArray(value.supportedReasoningEfforts) || value.supportedReasoningEfforts.length > 20) {
      throw new AiValidationError(
        `'${field}.supportedReasoningEfforts' must be an array of at most 20 strings.`,
        { field: `${field}.supportedReasoningEfforts` },
      );
    }
    result.supportedReasoningEfforts = value.supportedReasoningEfforts.map((effort, i) => {
      if (typeof effort !== 'string' || !effort.trim() || effort.length > 50) {
        throw new AiValidationError(
          `'${field}.supportedReasoningEfforts[${i}]' must be a non-empty string of at most 50 characters.`,
          { field: `${field}.supportedReasoningEfforts[${i}]` },
        );
      }
      return effort.trim();
    });
  }

  if (value.defaultReasoningEffort !== undefined && value.defaultReasoningEffort !== null) {
    if (
      typeof value.defaultReasoningEffort !== 'string' ||
      !value.defaultReasoningEffort.trim() ||
      value.defaultReasoningEffort.length > 50
    ) {
      throw new AiValidationError(
        `'${field}.defaultReasoningEffort' must be a non-empty string of at most 50 characters.`,
        { field: `${field}.defaultReasoningEffort` },
      );
    }
    result.defaultReasoningEffort = value.defaultReasoningEffort.trim();
  }

  if (value.inputModalities !== undefined && value.inputModalities !== null) {
    if (!Array.isArray(value.inputModalities) || value.inputModalities.length > 20) {
      throw new AiValidationError(
        `'${field}.inputModalities' must be an array of at most 20 strings.`,
        { field: `${field}.inputModalities` },
      );
    }
    result.inputModalities = value.inputModalities.map((modality, i) => {
      if (typeof modality !== 'string' || !modality.trim() || modality.length > 50) {
        throw new AiValidationError(
          `'${field}.inputModalities[${i}]' must be a non-empty string of at most 50 characters.`,
          { field: `${field}.inputModalities[${i}]` },
        );
      }
      return modality.trim();
    });
  }

  if (value.supportsVision !== undefined && value.supportsVision !== null) {
    if (typeof value.supportsVision !== 'boolean') {
      throw new AiValidationError(`'${field}.supportsVision' must be a boolean.`, {
        field: `${field}.supportsVision`,
      });
    }
    result.supportsVision = value.supportsVision;
  }

  if (value.maxContextTokens !== undefined && value.maxContextTokens !== null) {
    if (!Number.isSafeInteger(value.maxContextTokens) || value.maxContextTokens <= 0) {
      throw new AiValidationError(`'${field}.maxContextTokens' must be a positive integer.`, {
        field: `${field}.maxContextTokens`,
      });
    }
    result.maxContextTokens = value.maxContextTokens;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validates a canonical AgentModelDescriptor.
 */
export function validateAgentModelDescriptor(value, field = 'model') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError(`'${field}' must be an object.`, { field });
  }

  const id = requiredString(value.id, `${field}.id`, { max: 255 });
  const label = requiredString(value.label, `${field}.label`, { max: 255 });

  if (!MODEL_SOURCES.includes(value.source)) {
    throw new AiValidationError(
      `'${field}.source' must be one of ${MODEL_SOURCES.join(', ')}.`,
      { field: `${field}.source`, value: value.source },
    );
  }

  const descriptor = {
    id,
    label,
    source: value.source,
  };

  if (value.isDefault !== undefined && value.isDefault !== null) {
    if (typeof value.isDefault !== 'boolean') {
      throw new AiValidationError(`'${field}.isDefault' must be a boolean.`, { field: `${field}.isDefault` });
    }
    descriptor.isDefault = value.isDefault;
  }

  const traits = validateAgentModelTraits(value.traits, `${field}.traits`);
  if (traits !== undefined) {
    descriptor.traits = traits;
  }

  return descriptor;
}

export function createAgentModelDescriptor({ id, label, isDefault, source = 'known', traits } = {}) {
  return validateAgentModelDescriptor({
    id,
    label,
    source,
    ...(isDefault !== undefined ? { isDefault } : {}),
    ...(traits !== undefined ? { traits } : {}),
  });
}

/**
 * Permissive passthrough normalizer for model identifiers.
 * Unrecognized model strings emit an advisory trace warning without throwing validation errors.
 */
export function normalizeModelIdentifier(modelId, catalog = [], { onWarning = console.warn } = {}) {
  if (modelId === undefined || modelId === null || modelId === '') {
    return undefined;
  }
  if (typeof modelId !== 'string') {
    throw new AiValidationError("Model identifier must be a non-empty string.", { field: 'modelId' });
  }
  const trimmed = modelId.trim();
  if (!trimmed || trimmed.length > 255) {
    throw new AiValidationError("Model identifier must be between 1 and 255 characters.", { field: 'modelId' });
  }
  if (Array.isArray(catalog) && catalog.length > 0) {
    const isKnown = catalog.some((m) => (typeof m === 'string' ? m === trimmed : m?.id === trimmed));
    if (!isKnown) {
      onWarning?.(`[ai-model] Warning: Unrecognized model identifier '${trimmed}' passed through to provider.`);
    }
  }
  return trimmed;
}

export const permissiveModelPassthrough = normalizeModelIdentifier;
export const validateModelIdentifier = normalizeModelIdentifier;
