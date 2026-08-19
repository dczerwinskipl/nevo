// Human verification gate implementation with trusted state boundary.

import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';

/**
 * Abstract reader interface for accessing trusted human verification sign-off state.
 */
export class HumanVerificationReader {
  /**
   * Retrieves recorded human sign-off for a specific query.
   *
   * @param {object} query
   * @param {string} query.scope - 'task' | 'step' | 'change'
   * @param {string} query.targetId - Identifier of target task/step/change
   * @param {string} query.requiredRole - Role required (e.g. 'owner')
   * @returns {Promise<object|null>|object|null}
   */
  getSignoff(query) {
    throw new Error('HumanVerificationReader.getSignoff() must be implemented');
  }
}

/**
 * In-memory implementation of HumanVerificationReader for testing and composition.
 */
export class MemoryHumanVerificationReader extends HumanVerificationReader {
  /**
   * @param {Array<object>} [signoffs=[]]
   */
  constructor(signoffs = []) {
    super();
    this._signoffs = Array.isArray(signoffs) ? [...signoffs] : [];
  }

  /**
   * Records a sign-off in memory.
   * @param {object} signoff
   */
  addSignoff(signoff) {
    if (signoff && typeof signoff === 'object') {
      this._signoffs.push(signoff);
    }
  }

  getSignoff({ scope, targetId, requiredRole }) {
    return (
      this._signoffs.find((s) => {
        if (!s || typeof s !== 'object' || s.confirmed !== true) return false;
        if (s.scope !== scope) return false;
        if (s.targetId !== targetId) return false;
        const role = s.role || s.confirmedBy;
        if (requiredRole && role !== requiredRole) return false;
        return true;
      }) || null
    );
  }
}

/**
 * Gate enforcing mandatory human operator sign-off from a trusted verification state reader.
 * Raw caller JSON context cannot self-satisfy this gate.
 */
export class HumanVerificationGate extends GateContract {
  get type() {
    return 'human';
  }

  /**
   * Introspects human verification state from a trusted reader without modifying state.
   *
   * @param {object} config - Gate configuration (declaring required, role, message, scope)
   * @param {object} [context={}] - Context containing taskId/step and humanVerificationReader
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config = {}, context = {}) {
    const isRequired = config.required !== false;
    const requiredRole = config.role || 'owner';
    const scope = config.scope || 'task';
    const targetId = context.taskId || context.task?.id || context.step || 'current-step';
    const stepName = context.step || 'implementation';

    // Must query trusted reader, not caller-controlled raw JSON objects
    const reader = context.humanVerificationReader || context.verificationReader;

    if (!isRequired) {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'passed',
        target: targetId,
        message: `Human verification optional for '${targetId}'`,
        signoff: { requiredRole, scope, targetId },
        details: { required: false },
      });
    }

    if (!reader || typeof reader.getSignoff !== 'function') {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'human-verification-required',
        target: targetId,
        message: config.message || `Step '${stepName}' requires explicit human verification`,
        signoff: {
          requiredRole,
          scope,
          targetId,
        },
        details: {
          required: true,
          error: 'No trusted human verification reader configured in context',
        },
      });
    }

    let signoff = null;
    try {
      signoff = await reader.getSignoff({ scope, targetId, requiredRole });
    } catch (err) {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'human-verification-required',
        target: targetId,
        message: `Failed to query human verification reader: ${err.message}`,
        signoff: { requiredRole, scope, targetId },
        details: { required: true, error: err.message },
      });
    }

    // Strict validation of retrieved signoff contract
    const isConfirmed = signoff && typeof signoff === 'object' && signoff.confirmed === true;
    const scopeMatches = signoff?.scope === scope;
    const targetMatches = signoff?.targetId === targetId;
    const roleMatches = (signoff?.role || signoff?.confirmedBy) === requiredRole;

    if (!isConfirmed || !scopeMatches || !targetMatches || !roleMatches) {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'human-verification-required',
        target: targetId,
        message: config.message || `Step '${stepName}' requires explicit human verification`,
        signoff: {
          requiredRole,
          scope,
          targetId,
        },
        details: {
          required: true,
          recordedSignoff: null,
        },
      });
    }

    return new GateInspectionResult({
      gateType: this.type,
      status: 'passed',
      target: targetId,
      message: `Human verification recorded for '${targetId}'`,
      signoff: {
        requiredRole,
        scope,
        targetId,
        confirmedBy: signoff.confirmedBy || signoff.role || requiredRole,
        ...(signoff.timestamp ? { timestamp: signoff.timestamp } : {}),
      },
      details: {
        required: isRequired,
        recordedSignoff: signoff,
      },
    });
  }

  /**
   * Verifies that explicit human operator sign-off has been verified by the trusted reader.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config = {}, context = {}) {
    const inspection = await this.inspect(config, context);
    const passed = inspection.status === 'passed';

    return new GateVerificationResult({
      gateType: this.type,
      passed,
      status: passed ? 'passed' : 'blocked',
      message: inspection.message,
      details: {
        signoff: inspection.signoff,
        reason: inspection.reason,
      },
    });
  }
}
