// Canonical pure deterministic task state projection (Task 12, D8, D9, D10, D15).
// Projects pure workflow and task state with zero git, readiness, or session dependencies.

import { resolveWorkflowPosition } from './step-runner.mjs';
import { describeStep, describeHumanInteraction } from './human-step/projection.mjs';
import {
  checkTaskDependencies,
  resolveTaskTerminalOutcome,
} from './dependency-satisfaction.mjs';
import { loadWorkflowDefinition } from './definitions/loader.mjs';

/**
 * Resolves workflow definition from change or passed definition.
 */
export function resolveDefinition(change, maybeDefinition, options = {}) {
  if (maybeDefinition?.steps) {
    return maybeDefinition;
  }
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
 * Computes canonical, pure TaskProjection for a deterministic task.
 *
 * Exposes:
 * - state: 'draft' | 'blocked' | 'ready' | 'active' | 'waiting-for-step-start' | 'human-interaction' | 'terminal'
 * - currentStep: string | null
 * - executor: 'agent' | 'human' | null
 * - currentAttempt: number | null
 * - nextStep: { id, executor, purpose, expectedWork } | null
 * - blockedBy: string[]
 * - blockingDependencies: Array<{ id: string, reason: string, outcome?: string }>
 * - humanInteraction: { actions: [...] } | null
 * - terminalOutcome: 'success' | 'failure' | null
 * - terminalStatus: string | null
 *
 * @param {object} task - Task object
 * @param {object} change - Change object
 * @param {object} [options]
 * @param {object} [options.definition] - Optional pre-loaded workflow definition
 * @returns {object} Pure task projection DTO
 */
export function projectTask(task, change, options = {}) {
  const definition = resolveDefinition(change, options.definition, options);
  if (!definition?.steps) {
    throw new Error(`Cannot project task '${task?.id}': workflow definition could not be resolved`);
  }

  const allTasks = Array.isArray(change?.tasks) ? change.tasks : [];
  const entryStepId = definition.entryStep || Object.keys(definition.steps)[0];
  const entryStepDescriptor = describeStep(definition, entryStepId);

  const wp = task?.workflow_progress;

  // Case 1: No workflow progress yet (phase === 'new')
  if (!wp || !wp.current_step) {
    // Draft / unpublished check: status 'draft' derives state 'draft'
    if (task.status === 'draft') {
      return {
        state: 'draft',
        canPublish: true,
        currentStep: null,
        executor: entryStepDescriptor?.executor ?? 'agent',
        currentAttempt: null,
        nextStep: entryStepDescriptor,
        blockedBy: [],
        blockingDependencies: [],
        humanInteraction: null,
        terminalOutcome: null,
        terminalStatus: null,
      };
    }

    // Published task pre-start: check dependency satisfaction
    const depCheck = checkTaskDependencies(task, change, allTasks, definition, options);
    if (!depCheck.satisfied) {
      return {
        state: 'blocked',
        canPublish: false,
        currentStep: null,
        executor: entryStepDescriptor?.executor ?? 'agent',
        currentAttempt: null,
        nextStep: entryStepDescriptor,
        blockedBy: depCheck.blockingDependencies.map(d => d.id),
        blockingDependencies: depCheck.blockingDependencies,
        humanInteraction: null,
        terminalOutcome: null,
        terminalStatus: null,
      };
    }

    return {
      state: 'ready',
      canPublish: false,
      currentStep: null,
      executor: entryStepDescriptor?.executor ?? 'agent',
      currentAttempt: null,
      nextStep: entryStepDescriptor,
      blockedBy: [],
      blockingDependencies: [],
      humanInteraction: null,
      terminalOutcome: null,
      terminalStatus: null,
    };
  }

  // Case 2: Workflow progress exists -> evaluate engine position
  const position = resolveWorkflowPosition(definition, task);

  if (position.phase === 'new') {
    if (task.status === 'draft') {
      return {
        state: 'draft',
        canPublish: true,
        currentStep: null,
        executor: entryStepDescriptor?.executor ?? 'agent',
        currentAttempt: null,
        nextStep: entryStepDescriptor,
        blockedBy: [],
        blockingDependencies: [],
        humanInteraction: null,
        terminalOutcome: null,
        terminalStatus: null,
      };
    }

    const depCheck = checkTaskDependencies(task, change, allTasks, definition, options);
    if (!depCheck.satisfied) {
      return {
        state: 'blocked',
        canPublish: false,
        currentStep: null,
        executor: entryStepDescriptor?.executor ?? 'agent',
        currentAttempt: null,
        nextStep: entryStepDescriptor,
        blockedBy: depCheck.blockingDependencies.map(d => d.id),
        blockingDependencies: depCheck.blockingDependencies,
        humanInteraction: null,
        terminalOutcome: null,
        terminalStatus: null,
      };
    }

    return {
      state: 'ready',
      canPublish: false,
      currentStep: null,
      executor: entryStepDescriptor?.executor ?? 'agent',
      currentAttempt: null,
      nextStep: entryStepDescriptor,
      blockedBy: [],
      blockingDependencies: [],
      humanInteraction: null,
      terminalOutcome: null,
      terminalStatus: null,
    };
  }

  if (position.phase === 'active') {
    const stepConfig = definition.steps[position.step];
    const stepExecutor = stepConfig?.executor ?? 'agent';

    if (stepExecutor === 'human') {
      const humanInteraction = describeHumanInteraction(task, definition);
      return {
        state: 'human-interaction',
        canPublish: false,
        currentStep: position.step,
        executor: 'human',
        currentAttempt: position.attempt,
        nextStep: null,
        blockedBy: [],
        blockingDependencies: [],
        humanInteraction,
        terminalOutcome: null,
        terminalStatus: null,
      };
    }

    return {
      state: 'active',
      canPublish: false,
      currentStep: position.step,
      executor: 'agent',
      currentAttempt: position.attempt,
      nextStep: null,
      blockedBy: [],
      blockingDependencies: [],
      humanInteraction: null,
      terminalOutcome: null,
      terminalStatus: null,
    };
  }

  if (position.phase === 'completed') {
    const nextStepDescriptor = describeStep(definition, position.nextStep);
    return {
      state: 'waiting-for-step-start',
      canPublish: false,
      currentStep: position.step,
      executor: nextStepDescriptor?.executor ?? 'agent',
      currentAttempt: position.attempt,
      nextStep: nextStepDescriptor,
      blockedBy: [],
      blockingDependencies: [],
      humanInteraction: null,
      terminalOutcome: null,
      terminalStatus: null,
    };
  }

  if (position.phase === 'terminal') {
    const term = resolveTaskTerminalOutcome(task, change, definition, options);
    const stepConfig = definition.steps[position.step];
    const stepExecutor = stepConfig?.executor ?? 'agent';

    return {
      state: 'terminal',
      canPublish: false,
      currentStep: position.step,
      executor: stepExecutor,
      currentAttempt: position.attempt,
      nextStep: null,
      blockedBy: [],
      blockingDependencies: [],
      humanInteraction: null,
      terminalOutcome: term.outcome,
      terminalStatus: term.status,
    };
  }

  throw new Error(`Unrecognized workflow position phase '${position.phase}' for task '${task.id}'`);
}

export const projectTaskState = projectTask;
export const getTaskProjection = projectTask;

export class TaskProjection {
  static from(task, change, options) {
    return projectTask(task, change, options);
  }

  static project(task, change, options) {
    return projectTask(task, change, options);
  }
}
