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
 * Formats a bound task's label strictly from authoritative server-projected fields.
 * Never invents `in-implementation` or `attempt 1` when the server hasn't reported a
 * value — an unknown status renders as an explicit "unknown" label instead.
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
