/**
 * Pure workflow-domain resolver for incoming transitions and execution parameters (D20).
 * Matches incoming transition to a target step based on prior history and result,
 * extracting authoritative execution role and session policy in a fail-closed manner.
 *
 * @param {object} task - Task manifest record with workflow_progress
 * @param {object} definition - Workflow definition object with steps
 * @param {string} targetStepName - Destination step identifier
 * @returns {{
 *   transition: object|null,
 *   role: string|null,
 *   session: string|null,
 *   ambiguous: boolean,
 *   error: string|null,
 *   reason?: string
 * }}
 */
export function resolveIncomingExecution(task, definition, targetStepName) {
  if (!task || typeof task !== 'object') {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'INVALID_ARGUMENTS',
      reason: 'Task record is required.',
    };
  }

  if (!definition || typeof definition !== 'object') {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'INVALID_ARGUMENTS',
      reason: 'Workflow definition is required.',
    };
  }

  if (!targetStepName || typeof targetStepName !== 'string') {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'INVALID_ARGUMENTS',
      reason: 'Target step name is required.',
    };
  }

  if (!definition.steps?.[targetStepName]) {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'TARGET_STEP_NOT_FOUND',
      reason: `Target step '${targetStepName}' does not exist in workflow definition.`,
    };
  }

  const history = task?.workflow_progress?.history || [];
  if (history.length === 0) {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'NO_INCOMING_TRANSITION',
      reason: `Task '${task.id || 'unknown'}' has no workflow history (entry step).`,
    };
  }

  const lastHistory = history[history.length - 1];
  if (lastHistory.transitioned_to && lastHistory.transitioned_to !== targetStepName) {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'NO_INCOMING_TRANSITION',
      reason: `Last history step '${lastHistory.step}' transitioned to '${lastHistory.transitioned_to}', not '${targetStepName}'.`,
    };
  }

  const priorStepDef = definition.steps?.[lastHistory.step];
  if (!priorStepDef) {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'PRIOR_STEP_NOT_FOUND',
      reason: `Prior step '${lastHistory.step}' from history does not exist in workflow definition.`,
    };
  }

  const candidateTransitions = (priorStepDef.transitions || []).filter(
    (t) => t.to === targetStepName || t.step === targetStepName,
  );

  if (candidateTransitions.length === 0) {
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: false,
      error: 'NO_INCOMING_TRANSITION',
      reason: `Prior step '${lastHistory.step}' has no transitions leading to '${targetStepName}'.`,
    };
  }

  const historyResult = lastHistory.result;

  const matching = candidateTransitions.filter((t) => {
    if (t.value !== undefined) {
      return t.value === historyResult;
    }
    return true;
  });

  if (matching.length === 1) {
    const transition = matching[0];
    return {
      transition,
      role: transition.execution?.role ?? transition.role ?? null,
      session: transition.execution?.session ?? transition.session ?? 'fresh',
      ambiguous: false,
      error: null,
    };
  }

  if (matching.length > 1) {
    const exactMatches = matching.filter((t) => t.value !== undefined && t.value === historyResult);
    if (exactMatches.length === 1) {
      const transition = exactMatches[0];
      return {
        transition,
        role: transition.execution?.role ?? transition.role ?? null,
        session: transition.execution?.session ?? transition.session ?? 'fresh',
        ambiguous: false,
        error: null,
      };
    }
    return {
      transition: null,
      role: null,
      session: null,
      ambiguous: true,
      error: 'AMBIGUOUS_TRANSITION_MATCH',
      candidates: matching,
      reason: `Ambiguous incoming transition to '${targetStepName}' from step '${lastHistory.step}' with result '${historyResult}' (${matching.length} candidates).`,
    };
  }

  return {
    transition: null,
    role: null,
    session: null,
    ambiguous: false,
    error: 'NO_INCOMING_TRANSITION',
    reason: `No matching transition from '${lastHistory.step}' with result '${historyResult}' to '${targetStepName}'.`,
  };
}

/**
 * Legacy compatibility wrapper matching the shape expected by existing callers.
 */
export function matchIncomingTransition(task, definition, targetStepName) {
  const res = resolveIncomingExecution(task, definition, targetStepName);
  if (res.ambiguous) {
    return {
      transition: null,
      ambiguous: true,
      ...(res.reason ? { reason: res.reason } : {}),
    };
  }
  if (!res.transition) {
    return {
      transition: null,
      ambiguous: false,
    };
  }
  return {
    transition: res.transition,
    ambiguous: false,
    role: res.role,
    session: res.session,
  };
}
