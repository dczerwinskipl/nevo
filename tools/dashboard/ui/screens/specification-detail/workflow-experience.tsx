import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  type WorkflowExperienceMode,
  WORKFLOW_EXPERIENCE_STORAGE_KEY,
  getStoredWorkflowExperienceMode,
  setStoredWorkflowExperienceMode,
  // Split into its own file (rather than `./workflow-experience`) because a sibling
  // `workflow-experience.ts` and `workflow-experience.tsx` sharing one base name is an
  // ambiguous bare-specifier module resolution collision: TypeScript/Vite resolved bare
  // `'./workflow-experience'` imports to the `.ts` file exclusively, so consumers that
  // needed this file's own exports (`useWorkflowExperienceMode`, `WorkflowExperienceToggle`)
  // failed to build with "has no exported member" even though this file re-exported them.
} from './workflow-experience-storage';

export {
  type WorkflowExperienceMode,
  WORKFLOW_EXPERIENCE_STORAGE_KEY,
  getStoredWorkflowExperienceMode,
  setStoredWorkflowExperienceMode,
};

export function useWorkflowExperienceMode(): [WorkflowExperienceMode, (mode: WorkflowExperienceMode) => void] {
  const [mode, setModeState] = useState<WorkflowExperienceMode>(getStoredWorkflowExperienceMode);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WORKFLOW_EXPERIENCE_STORAGE_KEY) {
        const val = event.newValue;
        if (val === 'classic' || val === 'deterministic') {
          setModeState(val);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setMode = useCallback((nextMode: WorkflowExperienceMode) => {
    setModeState(nextMode);
    setStoredWorkflowExperienceMode(nextMode);
  }, []);

  return [mode, setMode];
}

export interface WorkflowExperienceToggleProps {
  mode: WorkflowExperienceMode;
  onModeChange: (mode: WorkflowExperienceMode) => void;
  className?: string;
}

export function WorkflowExperienceToggle({
  mode,
  onModeChange,
  className,
}: WorkflowExperienceToggleProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 text-xs', className)}>
      <span className="text-[11px] font-medium text-fg-muted">Workflow Experience:</span>
      <div
        className="inline-flex rounded-lg border border-border bg-surface-raised p-0.5 text-xs"
        role="group"
        aria-label="Workflow Experience"
      >
        <button
          type="button"
          onClick={() => onModeChange('classic')}
          aria-pressed={mode === 'classic'}
          className={cn(
            'cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
            mode === 'classic'
              ? 'bg-surface font-semibold text-fg-primary shadow-xs'
              : 'text-fg-muted hover:text-fg-primary',
          )}
        >
          Classic
        </button>
        <button
          type="button"
          onClick={() => onModeChange('deterministic')}
          aria-pressed={mode === 'deterministic'}
          className={cn(
            'cursor-pointer rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
            mode === 'deterministic'
              ? 'bg-surface font-semibold text-fg-primary shadow-xs'
              : 'text-fg-muted hover:text-fg-primary',
          )}
        >
          Deterministic Preview
        </button>
      </div>
    </div>
  );
}
