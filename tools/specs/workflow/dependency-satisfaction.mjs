// Pure deterministic dependency satisfaction module (Task 11, D9).
// Resolves a dependency task's matched terminal transition from workflow history and outcome.

import { TERMINAL_STATUSES } from '../status-vocabulary.mjs';
import { loadWorkflowDefinition } from './definitions/loader.mjs';

/**
 * Resolves workflow definition from given parameters.
 */
function resolveDefinition(changeOrDefinition, maybeDefinition, options = {}) {
  if (changeOrDefinition?.steps) {
    return changeOrDefinition;
  }
  if (maybeDefinition?.steps) {
    return maybeDefinition;
  }
  const change = changeOrDefinition;
  if (change?.workflowDefinition?.steps) {
    return change.workflowDefinition;
  }
  const definitionId = change?.workflow?.definition || change?.workflow_definition;
  if (typeof definitionId === 'string') {
    try {
      return loadWorkflowDefinition(definitionId, options);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Evaluates whether a single dependency task has completed successfully.
 *
 * Given a dependency task and its change/definition:
 * 1. Read workflow_progress.history's last entry: { step, transitioned_to, result? }.
 * 2. Look up that step's declared transitions in the workflow definition.
 * 3. Find the transition whose to === transitioned_to (and whose value === result if conditional).
 * 4. If transition's to is not terminal (or no history or step is active) -> unsatisfied.
 * 5. If found and to is terminal: satisfied only when outcome is 'success'.
 *
 * @param {object} dependencyTask - Task to check
 * @param {object} changeOrDefinition - Task's change or workflow definition
 * @param {object} [maybeDefinition] - Workflow definition if change was passed
 * @param {object} [options]
 * @returns {{ satisfied: boolean, reason: string|null, outcome?: string|null, terminalStatus?: string|null }}
 */
export function evaluateDependencySatisfaction(dependencyTask, changeOrDefinition, maybeDefinition, options = {}) {
  if (!dependencyTask) {
    return { satisfied: false, reason: 'Task is missing or null' };
  }

  const progress = dependencyTask.workflow_progress;
  if (!progress) {
    return { satisfied: false, reason: 'Task has no workflow progress' };
  }

  if (progress.state === 'active') {
    return {
      satisfied: false,
      reason: `Task is currently active on step '${progress.current_step}'`,
    };
  }

  const history = progress.history;
  if (!Array.isArray(history) || history.length === 0) {
    return { satisfied: false, reason: 'Task has empty workflow history' };
  }

  const lastEntry = history.at(-1);
  if (!lastEntry) {
    return { satisfied: false, reason: 'Task has no history entries' };
  }

  const definition = resolveDefinition(changeOrDefinition, maybeDefinition, options);
  if (!definition?.steps) {
    return { satisfied: false, reason: 'Workflow definition could not be resolved' };
  }

  const stepName = lastEntry.step;
  const stepConfig = definition.steps[stepName];
  if (!stepConfig) {
    return { satisfied: false, reason: `Step '${stepName}' not declared in workflow definition` };
  }

  const transitionedTo = lastEntry.transitioned_to;
  const result = lastEntry.result;
  const transitions = Array.isArray(stepConfig.transitions) ? stepConfig.transitions : [];

  const matchedTransition = transitions.find(t => {
    if (t.to !== transitionedTo) return false;
    if (t.value !== undefined) {
      return t.value === result;
    }
    return true;
  });

  if (!matchedTransition) {
    return {
      satisfied: false,
      reason: `No matching transition found from step '${stepName}' to '${transitionedTo}'`,
    };
  }

  const isTerminal = TERMINAL_STATUSES.has(transitionedTo);
  if (!isTerminal) {
    return {
      satisfied: false,
      reason: `Task transitioned from step '${stepName}' to internal step '${transitionedTo}', not a terminal status`,
    };
  }

  const outcome = matchedTransition.outcome;
  if (outcome === 'success') {
    return {
      satisfied: true,
      reason: null,
      outcome: 'success',
      terminalStatus: transitionedTo,
    };
  }

  if (outcome === 'failure') {
    return {
      satisfied: false,
      reason: `Terminal transition from step '${stepName}' to '${transitionedTo}' ended with failure outcome`,
      outcome: 'failure',
      terminalStatus: transitionedTo,
    };
  }

  return {
    satisfied: false,
    reason: `Terminal transition from step '${stepName}' to '${transitionedTo}' has unexpected outcome '${outcome}'`,
    outcome: outcome ?? null,
    terminalStatus: transitionedTo,
  };
}

/**
 * Boolean helper for dependency satisfaction check.
 *
 * @param {object} dependencyTask
 * @param {object} changeOrDefinition
 * @param {object} [maybeDefinition]
 * @param {object} [options]
 * @returns {boolean}
 */
export function isDependencySatisfied(dependencyTask, changeOrDefinition, maybeDefinition, options = {}) {
  return evaluateDependencySatisfaction(dependencyTask, changeOrDefinition, maybeDefinition, options).satisfied;
}

/**
 * Resolves terminal outcome for any task whose workflow history ends at a terminal status.
 *
 * @param {object} task
 * @param {object} changeOrDefinition
 * @param {object} [maybeDefinition]
 * @param {object} [options]
 * @returns {{ isTerminal: boolean, outcome: 'success'|'failure'|null, status: string|null }}
 */
export function resolveTaskTerminalOutcome(task, changeOrDefinition, maybeDefinition, options = {}) {
  const result = evaluateDependencySatisfaction(task, changeOrDefinition, maybeDefinition, options);
  if (result.terminalStatus) {
    return {
      isTerminal: true,
      outcome: result.outcome ?? null,
      status: result.terminalStatus,
    };
  }
  return {
    isTerminal: false,
    outcome: null,
    status: null,
  };
}

/**
 * Checks all dependencies declared in task.depends_on against a task list.
 *
 * @param {object} task - Downstream task
 * @param {object} changeOrDefinition
 * @param {Array<object>} allTasks - All tasks in change
 * @param {object} [maybeDefinition]
 * @param {object} [options]
 * @returns {{ satisfied: boolean, blockingDependencies: Array<{ id: string, reason: string, outcome?: string }> }}
 */
export function checkTaskDependencies(task, changeOrDefinition, allTasks = [], maybeDefinition, options = {}) {
  const dependsOn = Array.isArray(task?.depends_on) ? task.depends_on : [];
  if (dependsOn.length === 0) {
    return { satisfied: true, blockingDependencies: [] };
  }

  const blockingDependencies = [];
  for (const depId of dependsOn) {
    const depTask = allTasks.find(t => t.id === depId || t.file?.endsWith(`/${depId}.md`) || t.file?.endsWith(`\\${depId}.md`));
    if (!depTask) {
      blockingDependencies.push({ id: depId, reason: `Dependency task '${depId}' not found` });
      continue;
    }
    const evalResult = evaluateDependencySatisfaction(depTask, changeOrDefinition, maybeDefinition, options);
    if (!evalResult.satisfied) {
      blockingDependencies.push({
        id: depId,
        reason: evalResult.reason,
        outcome: evalResult.outcome,
      });
    }
  }

  return {
    satisfied: blockingDependencies.length === 0,
    blockingDependencies,
  };
}
