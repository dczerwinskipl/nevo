export interface BoundTaskInfo {
  id: string;
  title?: string;
  /** Authoritative `task.status` from the server, or `null`/absent when genuinely unknown — never fabricated. */
  status?: string | null;
  stage?: string;
  /** Authoritative `workflow_progress.current_attempt`, or `null`/absent when there is no active attempt yet. */
  attempt?: number | null;
  /** Authoritative `workflow_progress.current_step`, or `null`/absent outside an active deterministic step. */
  currentStep?: string | null;
}

/**
 * Formats a bound task's label strictly from authoritative server-projected deterministic
 * workflow fields. Never invents `in-implementation` or `attempt 1` when the server hasn't
 * reported a value — an unknown status renders as an explicit "unknown" label instead.
 * Only meaningful for a specification actually running under the deterministic engine
 * (see `formatLegacyTaskLabel` for the legacy counterpart) — see owner-decisions.md D15.
 */
export function formatBoundTaskLabel(task: BoundTaskInfo): string {
  const isVerified = task.status === 'verified';
  if (isVerified) {
    return `✓ ${task.id} (verified)`;
  }
  const statusLabel = task.currentStep || task.status || 'unknown';
  const attemptLabel = task.attempt ? ` · attempt ${task.attempt}` : '';
  return `● ${task.id} (${statusLabel}${attemptLabel})`;
}

/**
 * Formats a bound task's label for a LEGACY specification: identity/title only, never a
 * deterministic workflow status, step, or attempt — there is no such state to report, and
 * fabricating "(unknown)" for every task is exactly the misleading UX D15 removes.
 */
export function formatLegacyTaskLabel(task: BoundTaskInfo): string {
  return task.title ? `${task.id} · ${task.title}` : task.id;
}
