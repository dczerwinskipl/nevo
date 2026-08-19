// Workflow definition loader, parser, and repository-local resolver.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { WorkflowDefinitionError } from '../errors.mjs';
import { validateWorkflowDefinition, normalizeWorkflowDefinition } from './schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repository-relative path where runtime workflow configurations reside */
export const WORKFLOWS_REL_DIR = '.nevo-ai/workflows';

/** Path to initialization templates (strictly for scaffolding, never a runtime fallback) */
export const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

const SAFE_WORKFLOW_NAME_REGEX = /^[a-zA-Z0-9_-]+(?:\.(?:yaml|yml))?$/;

/**
 * Validates and securely resolves a repository-local workflow definition path.
 * Strictly prevents path traversal, absolute paths, and escaping .nevo-ai/workflows/.
 *
 * @param {string} nameOrPath - Workflow definition identifier
 * @param {string} repoRoot - Absolute repository root path
 * @returns {{ workflowsDir: string, fileName: string, targetPath: string, definitionName: string }}
 * @throws {WorkflowDefinitionError} If path is invalid or attempts traversal
 */
export function resolveWorkflowPath(nameOrPath, repoRoot) {
  if (!nameOrPath || typeof nameOrPath !== 'string' || !nameOrPath.trim()) {
    throw new WorkflowDefinitionError(
      'Workflow definition name or reference must be a non-empty string',
      { code: 'INVALID_WORKFLOW_DEFINITION_NAME' }
    );
  }

  const trimmed = nameOrPath.trim();

  // Reject absolute paths
  if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new WorkflowDefinitionError(
      `Absolute paths are forbidden for workflow definitions: '${trimmed}'. Workflow definitions must be logical identifiers inside '${WORKFLOWS_REL_DIR}/'.`,
      { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: trimmed }
    );
  }

  // Reject path traversal indicators
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new WorkflowDefinitionError(
      `Path traversal and subdirectory paths are forbidden in workflow definition names: '${trimmed}'. Workflows must resolve directly within '${WORKFLOWS_REL_DIR}/'.`,
      { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: trimmed }
    );
  }

  // Enforce safe identifier format
  if (!SAFE_WORKFLOW_NAME_REGEX.test(trimmed)) {
    throw new WorkflowDefinitionError(
      `Invalid workflow definition name '${trimmed}'. Workflow names must contain only alphanumeric characters, dashes, and underscores.`,
      { code: 'INVALID_WORKFLOW_DEFINITION_NAME', requested: trimmed }
    );
  }

  const resolvedRoot = resolve(repoRoot || process.cwd());
  const workflowsDir = resolve(resolvedRoot, WORKFLOWS_REL_DIR);
  const fileName = trimmed.endsWith('.yaml') || trimmed.endsWith('.yml') ? trimmed : `${trimmed}.yaml`;
  const definitionName = fileName.replace(/\.(yaml|yml)$/, '');
  const targetPath = resolve(workflowsDir, fileName);

  // Guard against path traversal or sibling prefix collisions
  const normalizedTarget = normalize(targetPath);
  const normalizedWorkflowsDir = normalize(workflowsDir);

  const isStrictlyInside = normalizedTarget.startsWith(normalizedWorkflowsDir + sep);
  if (!isStrictlyInside) {
    throw new WorkflowDefinitionError(
      `Workflow definition path '${targetPath}' escapes '${WORKFLOWS_REL_DIR}'.`,
      { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: trimmed, targetPath }
    );
  }

  return {
    workflowsDir: normalizedWorkflowsDir,
    fileName,
    targetPath: normalizedTarget,
    definitionName,
  };
}

/**
 * Parses a YAML workflow definition string, validates it, and returns the normalized definition.
 * Pure and filesystem-independent.
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
 * Loads, parses, and validates a repository-local workflow definition from <repo-root>/.nevo-ai/workflows/<name>.yaml.
 * Fails closed without falling back to built-in templates.
 *
 * @param {string} name - Workflow definition name (e.g. 'standard')
 * @param {object} [options] - Loader and validation options
 * @param {string} [options.repoRoot] - Repository root directory (defaults to process.cwd())
 * @param {Set<string>|Array<string>} [options.knownActions] - Optional set of registered action IDs
 * @param {Set<string>|Array<string>} [options.knownGates] - Optional set of allowed gate types
 * @returns {object} Normalized workflow definition
 * @throws {WorkflowDefinitionError} If file cannot be found, parsed, or validated
 */
export function loadWorkflowDefinition(name, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const { fileName, targetPath, definitionName } = resolveWorkflowPath(name, repoRoot);

  if (!existsSync(targetPath)) {
    throw new WorkflowDefinitionError(
      `Deterministic workflow definition '${definitionName}' not found at repository-local location '${join(WORKFLOWS_REL_DIR, fileName)}' (resolved: '${targetPath}'). Deterministic workflows must be declared under '${WORKFLOWS_REL_DIR}/'.`,
      {
        code: 'WORKFLOW_DEFINITION_NOT_FOUND',
        definition: definitionName,
        expectedRelativePath: join(WORKFLOWS_REL_DIR, fileName),
        resolvedPath: targetPath,
        repoRoot: resolve(repoRoot),
      }
    );
  }

  let content;
  try {
    content = readFileSync(targetPath, 'utf8');
  } catch (err) {
    throw new WorkflowDefinitionError(
      `Failed to read workflow definition at '${targetPath}': ${err.message}`,
      { code: 'WORKFLOW_DEFINITION_READ_ERROR', targetPath, cause: err }
    );
  }

  return parseWorkflowDefinition(content, options);
}

/**
 * Lists all repository-local workflow definitions available in <repo-root>/.nevo-ai/workflows/.
 *
 * @param {string} [repoRoot] - Repository root directory (defaults to process.cwd())
 * @returns {string[]} List of definition names
 */
export function listRepositoryWorkflowDefinitions(repoRoot = process.cwd()) {
  const workflowsDir = resolve(repoRoot, WORKFLOWS_REL_DIR);
  if (!existsSync(workflowsDir)) return [];
  return readdirSync(workflowsDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''));
}

/**
 * Lists all built-in workflow templates available in tools/specs/workflow/templates/.
 * (For scaffolding only).
 *
 * @returns {string[]} List of template names
 */
export function listBuiltInWorkflowTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''));
}
