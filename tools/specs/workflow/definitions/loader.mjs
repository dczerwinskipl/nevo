// Workflow definition loader, parser, and resolver.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { WorkflowDefinitionError } from '../errors.mjs';
import { validateWorkflowDefinition, normalizeWorkflowDefinition } from './schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEFINITIONS_DIR = __dirname;

/**
 * Parses a YAML workflow definition string, validates it, and returns the normalized definition.
 *
 * @param {string} yamlContent - YAML string
 * @param {object} [options] - Validation options
 * @returns {object} Normalized workflow definition
 * @throws {WorkflowDefinitionError} If YAML is invalid or definition violates schema
 */
export function parseWorkflowDefinition(yamlContent, options = {}) {
  let parsed;
  try {
    parsed = parse(yamlContent);
  } catch (err) {
    throw new WorkflowDefinitionError(`Invalid YAML in workflow definition: ${err.message}`);
  }

  const { valid, errors } = validateWorkflowDefinition(parsed, options);
  if (!valid) {
    throw new WorkflowDefinitionError(
      `Workflow definition validation failed:\n  ${errors.join('\n  ')}`,
      errors
    );
  }

  return normalizeWorkflowDefinition(parsed);
}

/**
 * Loads, parses, and validates a workflow definition from a file path or built-in definition name.
 *
 * @param {string} nameOrPath - Path to YAML file, or built-in name (e.g. 'standard')
 * @param {object} [options] - Validation options
 * @returns {object} Normalized workflow definition
 * @throws {WorkflowDefinitionError} If file cannot be found, parsed, or validated
 */
export function loadWorkflowDefinition(nameOrPath, options = {}) {
  if (!nameOrPath || typeof nameOrPath !== 'string') {
    throw new WorkflowDefinitionError('Workflow definition name or path must be a non-empty string');
  }

  let filePath;
  if (isAbsolute(nameOrPath) || nameOrPath.endsWith('.yaml') || nameOrPath.endsWith('.yml') || nameOrPath.includes('/') || nameOrPath.includes('\\')) {
    filePath = nameOrPath;
  } else {
    filePath = join(DEFINITIONS_DIR, `${nameOrPath}.yaml`);
  }

  if (!existsSync(filePath)) {
    throw new WorkflowDefinitionError(`Workflow definition not found at '${filePath}'`);
  }

  const content = readFileSync(filePath, 'utf8');
  return parseWorkflowDefinition(content, options);
}

/**
 * Lists all built-in workflow definitions available in tools/specs/workflow/definitions/.
 *
 * @returns {string[]} List of definition names
 */
export function listBuiltInWorkflowDefinitions() {
  if (!existsSync(DEFINITIONS_DIR)) return [];
  return readdirSync(DEFINITIONS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''));
}
