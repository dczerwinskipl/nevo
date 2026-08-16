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
