// Pure workflow mode resolution and legacy fallback logic.

import { WorkflowError } from './errors.mjs';

export const WORKFLOW_MODES = new Set(['legacy', 'deterministic']);
export const DEFAULT_WORKFLOW_MODE = 'legacy';
export const DEFAULT_WORKFLOW_VERSION = 1;
export const DEFAULT_WORKFLOW_DEFINITION = 'standard';

/**
 * Resolves the effective workflow mode, version, and definition reference for a given change.
 * 
 * Supports testing overrides via `options.forceDeterministic` or `options.deterministicFlow`,
 * while defaulting to the manifest state or 'legacy' if omitted.
 *
 * @param {object} [change] - Change manifest object
 * @param {object} [options] - Resolution options (e.g. CLI flags)
 * @param {boolean} [options.forceDeterministic] - Force deterministic mode for testing
 * @param {boolean} [options.deterministicFlow] - Alias for forceDeterministic
 * @returns {{ mode: 'legacy' | 'deterministic', version: number, definition: string, isExplicit: boolean }}
 */
export function resolveWorkflowMode(change = {}, options = {}) {
  const isTestingOverride = Boolean(options.forceDeterministic || options.deterministicFlow);
  if (isTestingOverride) {
    return {
      mode: 'deterministic',
      version: change?.workflow?.version || DEFAULT_WORKFLOW_VERSION,
      definition: change?.workflow?.definition || change?.type || DEFAULT_WORKFLOW_DEFINITION,
      isExplicit: true,
    };
  }

  if (change?.workflow !== undefined && change?.workflow_mode !== undefined) {
    throw new WorkflowError(
      `Ambiguous workflow configuration in '${change._file || change.id || 'change'}': cannot declare both 'workflow' object and shorthand 'workflow_mode'`
    );
  }

  if (change?.workflow && typeof change.workflow === 'object' && !Array.isArray(change.workflow)) {
    const mode = change.workflow.mode || DEFAULT_WORKFLOW_MODE;
    const version = Number.isInteger(change.workflow.version) && change.workflow.version >= 1
      ? change.workflow.version
      : DEFAULT_WORKFLOW_VERSION;
    const definition = (typeof change.workflow.definition === 'string' && change.workflow.definition.trim())
      ? change.workflow.definition.trim()
      : (change?.type || DEFAULT_WORKFLOW_DEFINITION);

    return {
      mode,
      version,
      definition,
      isExplicit: true,
    };
  }

  if (change?.workflow_mode) {
    return {
      mode: change.workflow_mode,
      version: DEFAULT_WORKFLOW_VERSION,
      definition: change?.type || DEFAULT_WORKFLOW_DEFINITION,
      isExplicit: true,
    };
  }

  return {
    mode: DEFAULT_WORKFLOW_MODE,
    version: DEFAULT_WORKFLOW_VERSION,
    definition: change?.type || DEFAULT_WORKFLOW_DEFINITION,
    isExplicit: false,
  };
}
