// tools/specs/lifecycle-primitives.mjs — Pure lifecycle status and transition primitives

export const TERMINAL_STATUSES = new Set(['implemented', 'verified', 'archived', 'abandoned']);
export const DEPENDENCY_SATISFYING_STATUSES = new Set(['implemented', 'verified', 'archived']);
export const READY_STATUSES = new Set(['approved']);
export const ACTIVE_CHANGE_STATUSES = new Set(['approved', 'in-implementation', 'draft']);

export const TASK_STATUSES = new Set([
  'draft', 'approved', 'in-implementation', 'implemented', 'verified', 'abandoned', 'archived',
]);
export const CHANGE_STATUSES = new Set([
  'draft', 'approved', 'in-implementation', 'implemented', 'verified', 'abandoned', 'archived',
]);
export const REMOVED_STATUSES = new Set(['blocked', 'needs-decision']);

export function removedStatusMessage(value) {
  return `Status \`${value}\` is no longer supported. Use \`execution.suspension\`.`;
}

export function depsSatisfied(task, change) {
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = change.tasks.find(t => t.id === depId);
    return Boolean(dep) && DEPENDENCY_SATISFYING_STATUSES.has(dep.status);
  });
}

export function isTaskReady(task, change) {
  return READY_STATUSES.has(task.status) && depsSatisfied(task, change);
}

export const TRANSITIONS = {
  approve: { from: 'draft', to: 'approved' },
  start: { from: 'approved', to: 'in-implementation' },
  complete: { from: 'in-implementation', to: 'implemented' },
  verify: { from: 'implemented', to: 'verified' },
};

export function validateTransition(command, currentStatus) {
  const rule = TRANSITIONS[command];
  if (!rule) throw new Error(`Unknown transition command '${command}'`);
  if (currentStatus === rule.to) return { ok: true, idempotent: true };
  if (currentStatus !== rule.from) {
    return {
      ok: false,
      reason: `Task has status '${currentStatus}' — '${command}' requires status '${rule.from}'.`,
    };
  }
  return { ok: true, idempotent: false };
}

export function hardStopReason(task) {
  if (!task.self_check) {
    return { code: 'unresolved-self-check', detail: 'No self-check has been recorded for this task yet.' };
  }
  if (task.self_check.status === 'failed') {
    return {
      code: 'failed-self-check',
      detail: `Self-check failed: ${(task.self_check.failed_criteria || []).join(', ') || '(no failed_criteria recorded)'}`,
    };
  }
  return null;
}

export function completionHardStop(task, { inActiveBatch = false } = {}) {
  const stop = hardStopReason(task);
  if (!stop) return null;
  return (task.self_check || inActiveBatch) ? stop : null;
}

export function validateApproval(
  taskStatus, review, currentFingerprint,
  { mechanicalExempt = false, taskId = null, currentTaskFingerprint = null } = {}
) {
  const transition = validateTransition('approve', taskStatus);
  if (!transition.ok) return transition;
  if (transition.idempotent) return transition;

  if (mechanicalExempt) return { ok: true, idempotent: false };

  if (!review) {
    return {
      ok: false,
      reason: 'No review found. A specification review must exist before a task can be approved.',
    };
  }
  if (review.verdict !== 'ready-for-approval') {
    return { ok: false, reason: `Review verdict is '${review.verdict}', not 'ready-for-approval'. Cannot approve.` };
  }

  const unresolvedFixes = Number(review.unresolved_required_fixes ?? 0);
  const unresolvedDecisions = Number(review.unresolved_owner_decisions ?? 0);
  const unresolvedClarifications = Number(review.unresolved_needs_clarification ?? 0);
  if (unresolvedFixes > 0 || unresolvedDecisions > 0 || unresolvedClarifications > 0) {
    return {
      ok: false,
      reason: `Review has unresolved items (required fixes: ${unresolvedFixes}, ` +
        `owner decisions: ${unresolvedDecisions}, needs clarification: ${unresolvedClarifications}). ` +
        `Cannot approve.`,
    };
  }

  if (!review.spec_fingerprint) {
    return {
      ok: false,
      code: 'missing-fingerprint',
      reason: `Review is missing 'spec_fingerprint' front matter — it predates this check. ` +
        `Re-run the review before approving.`,
    };
  }
  if (review.spec_fingerprint !== currentFingerprint) {
    return {
      ok: false,
      code: 'stale-fingerprint',
      reason: `Review is stale: its spec_fingerprint (${review.spec_fingerprint}) does not match ` +
        `the current specification state (${currentFingerprint}). Re-run the review before approving.`,
    };
  }

  if (taskId) {
    const recorded = review.task_fingerprints?.[taskId];
    if (!recorded) {
      return {
        ok: false,
        code: 'missing-task-fingerprint',
        reason: `Review is missing a task_fingerprints entry for '${taskId}' — it predates this check, or reviewed ` +
          `a different task set. Re-run the review before approving.`,
      };
    }
    if (recorded !== currentTaskFingerprint) {
      return {
        ok: false,
        code: 'stale-task-fingerprint',
        reason: `Review is stale for task '${taskId}': its recorded task_fingerprints entry (${recorded}) does not ` +
          `match the task's current content (${currentTaskFingerprint}). Re-run the review before approving.`,
      };
    }
  }

  return { ok: true, idempotent: false };
}

