export interface BoundTaskInfo {
  id: string;
  title?: string;
  status?: string;
  stage?: string;
  attempt?: number;
  currentStep?: string;
}

export function formatBoundTaskLabel(task: BoundTaskInfo): string {
  const isVerified = task.status === 'verified';
  if (isVerified) {
    return `✓ ${task.id} (verified)`;
  }
  const statusLabel = task.status || 'in-implementation';
  const attemptLabel = task.attempt ? ` · attempt ${task.attempt}` : '';
  return `● ${task.id} (${statusLabel}${attemptLabel})`;
}
