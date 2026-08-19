// Human verification gate implementation.

import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';

/**
 * Gate enforcing mandatory human operator sign-off.
 * Machine-readable blocked state prevents AI agents from self-authorizing or skipping verification.
 */
export class HumanVerificationGate extends GateContract {
  get type() {
    return 'human';
  }

  /**
   * Introspects human verification state without altering sign-off records.
   *
   * @param {object} config - Gate configuration (declaring required, role, message)
   * @param {object} [context={}] - Context containing task/step identifiers and recorded sign-offs
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config = {}, context = {}) {
    const isRequired = config.required !== false;
    const requiredRole = config.role || 'owner';
    const scope = config.scope || 'task';
    const targetId = context.taskId || context.task?.id || context.step || 'current-step';
    const stepName = context.step || 'implementation';

    // Sign-off can be recorded in context.humanVerification or context.humanSignoffs[targetId]
    const recordedSignoff = context.humanVerification || context.humanSignoffs?.[targetId];
    const isSignedOff = Boolean(recordedSignoff && recordedSignoff.confirmed === true);

    if (isRequired && !isSignedOff) {
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
        ...(isSignedOff ? { confirmedBy: recordedSignoff.confirmedBy || 'operator', timestamp: recordedSignoff.timestamp } : {}),
      },
      details: {
        required: isRequired,
        recordedSignoff: recordedSignoff || null,
      },
    });
  }

  /**
   * Verifies that explicit human operator sign-off has been recorded in workflow state.
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
