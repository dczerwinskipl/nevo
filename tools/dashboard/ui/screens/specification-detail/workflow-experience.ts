export type WorkflowExperienceMode = 'classic' | 'deterministic';

export const WORKFLOW_EXPERIENCE_STORAGE_KEY = 'nevo:workflow-experience:mode';

export function getStoredWorkflowExperienceMode(): WorkflowExperienceMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(WORKFLOW_EXPERIENCE_STORAGE_KEY);
      if (stored === 'classic' || stored === 'deterministic') {
        return stored;
      }
    }
  } catch {}
  return 'deterministic';
}

export function setStoredWorkflowExperienceMode(mode: WorkflowExperienceMode): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKFLOW_EXPERIENCE_STORAGE_KEY, mode);
    }
  } catch {}
}
