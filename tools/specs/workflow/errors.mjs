// Workflow engine error classes

import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Base error for workflow operations.
 */
export class WorkflowError extends CliError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.details = details;
    if (details?.code) {
      this.code = details.code;
    }
  }
}

/**
 * Thrown when an action or step precondition is violated (e.g., missing required input).
 */
export class PreconditionError extends WorkflowError {
  /**
   * @param {string} message - Human-readable error message
   * @param {Array<{ field: string, message: string, code?: string }>} errors - Field-level error list
   * @param {string} [actionId] - Action identifier
   */
  constructor(message, errors = [], actionId = null) {
    super(message, { errors, actionId });
    this.name = 'PreconditionError';
    this.errors = errors;
    this.actionId = actionId;
  }
}

/**
 * Thrown when workflow transition is blocked by one or more gates.
 */
export class GateBlockedError extends WorkflowError {
  /**
   * @param {string} message - Blocked description
   * @param {Array<any>} blockedGates - List of blocked gates
   * @param {string} [reason] - Machine-readable blocked reason
   */
  constructor(message, blockedGates = [], reason = 'gate-blocked') {
    super(message, { blockedGates, reason });
    this.name = 'GateBlockedError';
    this.blockedGates = blockedGates;
    this.reason = reason;
  }
}

/**
 * Thrown when a workflow definition fails structural or semantic validation, or resolution.
 */
export class WorkflowDefinitionError extends WorkflowError {
  /**
   * @param {string} message - Error message
   * @param {string[]|object} [detailsOrErrors] - List of validation error strings or details object
   */
  constructor(message, detailsOrErrors = {}) {
    const isArray = Array.isArray(detailsOrErrors);
    const details = isArray
      ? { validationErrors: detailsOrErrors }
      : (detailsOrErrors && typeof detailsOrErrors === 'object' ? detailsOrErrors : {});
    super(message, details);
    this.name = 'WorkflowDefinitionError';
    this.validationErrors = isArray ? detailsOrErrors : (details.validationErrors || []);
  }
}
