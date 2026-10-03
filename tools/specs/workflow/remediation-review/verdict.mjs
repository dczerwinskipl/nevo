// Pure aggregate verdict computation for dependency-invalidation remediation review (Task 30, D31).
// Explicit evaluation table: blocked > owner-decision-required > changes-required > pass.
// Mirroring `computeMultiTaskReviewVerdict`'s own evaluation order.

export const EVALUATION_ORDER = [
  'blocked',
  'owner-decision-required',
  'changes-required',
  'pass',
];

/**
 * Computes aggregate verdict from explicit table.
 *
 * @param {object} params
 * @param {boolean} [params.validationFailed=false]
 * @param {Array<string>} [params.taskVerdicts=[]]
 * @param {number} [params.ownerDecisionFindings=0]
 * @param {number} [params.autoFixFindings=0]
 * @param {Array<object>} [params.findings=[]]
 * @returns {'blocked'|'owner-decision-required'|'changes-required'|'pass'}
 */
export function computeRemediationReviewVerdict(params = {}) {
  const {
    validationFailed = false,
    taskVerdicts = [],
    ownerDecisionFindings = 0,
    autoFixFindings = 0,
    findings = [],
  } = params;

  // 1. blocked
  if (validationFailed) return 'blocked';
  if (taskVerdicts.includes('blocked')) return 'blocked';
  if (findings.some(f => f.severity === 'blocked')) return 'blocked';

  // 2. owner-decision-required
  if (ownerDecisionFindings > 0) return 'owner-decision-required';
  if (taskVerdicts.includes('owner-decision-required')) return 'owner-decision-required';
  if (findings.some(f =>
    f.severity === 'owner-decision-required' ||
    f.severity === 'NEEDS_CLARIFICATION' ||
    f.category === 'NEEDS_CLARIFICATION' ||
    f.ownerDecisionRequired === true
  )) {
    return 'owner-decision-required';
  }

  // 3. changes-required
  if (taskVerdicts.includes('changes-required')) return 'changes-required';
  if (autoFixFindings > 0) return 'changes-required';
  if (findings.some(f =>
    f.severity === 'changes-required' ||
    f.severity === 'required-fix' ||
    f.changesRequired === true
  )) {
    return 'changes-required';
  }

  // 4. pass
  return 'pass';
}

/**
 * Returns the worst severity from a list of severities according to the explicit evaluation table.
 *
 * @param {Array<string>} severities
 * @returns {string}
 */
export function matchWorstSeverity(severities = []) {
  for (const level of EVALUATION_ORDER) {
    if (severities.includes(level)) {
      return level;
    }
  }
  return 'pass';
}
