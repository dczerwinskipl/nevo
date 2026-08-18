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
 * Thrown when a workflow definition fails structural or semantic validation.
 */
export class WorkflowDefinitionError extends WorkflowError {
  /**
   * @param {string} message - Error message
   * @param {string[]} validationErrors - List of validation error strings
   */
  constructor(message, validationErrors = []) {
    super(message, { validationErrors });
    this.name = 'WorkflowDefinitionError';
    this.validationErrors = validationErrors;
  }
}
