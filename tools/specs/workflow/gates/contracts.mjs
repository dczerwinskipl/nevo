// GateContract base abstraction and result data models.

import { WorkflowError } from '../errors.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Result of a non-mutating gate inspection.
 */
export class GateInspectionResult {
  /**
   * @param {object} params
   * @param {string} params.gateType - Type of gate ('command' | 'markdown' | 'human')
   * @param {'passed' | 'failed' | 'blocked' | 'pending'} params.status - Gate inspection status
   * @param {string} [params.reason=''] - Machine-readable reason code
   * @param {string} [params.target=''] - Target command, file path, or verification scope
   * @param {string} [params.message=''] - Human-readable summary
   * @param {boolean} [params.stale=false] - Whether cached result is stale
   * @param {Record<string, any>} [params.signoff] - Signoff metadata (for human gates)
   * @param {Record<string, any>} [params.details={}] - Additional details
   */
  constructor({
    gateType = '',
    status = 'pending',
    reason = '',
    target = '',
    message = '',
    stale = false,
    signoff,
    details = {},
  } = {}) {
    if (typeof gateType !== 'string' || !gateType.trim()) {
      throw new WorkflowError(`GateInspectionResult requires a non-empty string 'gateType', got '${gateType}'`);
    }

    const validStatuses = new Set(['passed', 'failed', 'blocked', 'pending']);
    if (!validStatuses.has(status)) {
      throw new WorkflowError(`GateInspectionResult 'status' must be one of: ${[...validStatuses].join(', ')}, got '${status}'`);
    }

    this.gateType = gateType.trim();
    this.status = status;
    this.reason = typeof reason === 'string' ? reason : '';
    this.target = typeof target === 'string' ? target : '';
    this.message = typeof message === 'string' ? message : '';
    this.stale = Boolean(stale);
    if (signoff !== undefined && isPlainObject(signoff)) {
      this.signoff = signoff;
    }
    this.details = isPlainObject(details) ? details : {};
  }

  toJSON() {
    return {
      gateType: this.gateType,
      status: this.status,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.target ? { target: this.target } : {}),
      ...(this.message ? { message: this.message } : {}),
      ...(this.stale ? { stale: this.stale } : {}),
      ...(this.signoff ? { signoff: this.signoff } : {}),
      details: this.details,
    };
  }
}

/**
 * Result of an explicit gate verification execution.
 */
export class GateVerificationResult {
  /**
   * @param {object} params
   * @param {string} params.gateType - Type of gate
   * @param {boolean} params.passed - Whether verification passed
   * @param {'passed' | 'failed' | 'blocked'} [params.status] - Status code
   * @param {string} [params.message=''] - Summary message
   * @param {Record<string, any>} [params.details={}] - Execution details
   * @param {Record<string, any>} [params.outputs={}] - Verification outputs
   */
  constructor({
    gateType = '',
    passed = false,
    status,
    message = '',
    details = {},
    outputs = {},
  } = {}) {
    if (typeof gateType !== 'string' || !gateType.trim()) {
      throw new WorkflowError(`GateVerificationResult requires a non-empty string 'gateType', got '${gateType}'`);
    }
    if (typeof passed !== 'boolean') {
      throw new WorkflowError(`GateVerificationResult 'passed' must be a strict boolean, got '${typeof passed}'`);
    }

    this.gateType = gateType.trim();
    this.passed = passed;
    this.status = status || (passed ? 'passed' : 'failed');
    this.message = typeof message === 'string' ? message : '';
    this.details = isPlainObject(details) ? details : {};
    this.outputs = isPlainObject(outputs) ? outputs : {};
  }

  toJSON() {
    return {
      gateType: this.gateType,
      passed: this.passed,
      status: this.status,
      message: this.message,
      details: this.details,
      outputs: this.outputs,
    };
  }
}

/**
 * Abstract base class defining the Gate contract.
 */
export class GateContract {
  /**
   * Gate type identifier ('command' | 'markdown' | 'human').
   * @returns {string}
   */
  get type() {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement get type()`);
  }

  /**
   * Non-mutating inspection of gate status without executing heavy actions or running test commands.
   *
   * @param {object} config - Gate configuration from workflow definition
   * @param {object} context - Environmental context
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement inspect(config, context)`);
  }

  /**
   * Explicit gate verification execution.
   *
   * @param {object} config - Gate configuration from workflow definition
   * @param {object} context - Environmental context
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context) {
    throw new Error(`GateContract subclass '${this.constructor.name}' must implement verify(config, context)`);
  }
}
