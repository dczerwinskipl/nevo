// Pure two-tier human-step projection (Task 10, D5, D10, D16).
// Exposes generic step descriptor (tier 1) and human interaction actions descriptor (tier 2).

/**
 * Generic step descriptor function (tier 1).
 *
 * Given any step (current or next, active or not), returns
 * { id, executor, purpose, expectedWork } straight from the definition.
 * No activation state required, works for both agent and human steps.
 *
 * @param {object} stepOrDefinition - Step configuration object or parent workflow definition
 * @param {string} [stepId] - Step identifier when looking up in definition or providing explicit id
 * @returns {{ id: string|null, executor: string, purpose?: string, expectedWork?: object } | null}
 */
export function describeStep(stepOrDefinition, stepId) {
  let step = null;
  let id = stepId;

  if (stepOrDefinition?.steps && stepId) {
    step = stepOrDefinition.steps[stepId];
  } else if (stepOrDefinition) {
    step = stepOrDefinition;
    if (!id && step.id) {
      id = step.id;
    }
  }

  if (!step) {
    return null;
  }

  return {
    id: id ?? step.id ?? null,
    executor: step.executor ?? 'agent',
    purpose: step.purpose,
    expectedWork: step.expectedWork,
  };
}

export const projectStepDescriptor = describeStep;

import { isTaskBarriered } from '../queue/reservation.mjs';

/**
 * Human interaction actions descriptor function (tier 2).
 *
 * Given a task's currently active step, returns null when executor !== 'human',
 * else { actions: [...] } built from that step's transitions[].action metadata,
 * one entry per transition.
 *
 * For conditional transitions (transition declares 'value'), result is populated.
 * For unconditional transitions (no 'value'), 'result' key is omitted completely.
 *
 * @param {object} target - Active step object or task object
 * @param {object|boolean} [contextOrDefinition] - Workflow definition (if target is task), task context, or boolean
 * @param {object} [options] - Optional settings including barriered or changeSlug / repoRoot for barrier surfacing (D31)
 * @returns {{ actions: Array<{ result?: string, label?: string, feedbackRequired: boolean }>, barriered?: boolean } | null}
 */
export function describeHumanInteraction(target, contextOrDefinition, options = {}) {
  let step = null;
  let isActive = false;
  let taskId = null;
  const changeSlug = options?.changeSlug;

  if (target?.workflow_progress) {
    const task = target;
    taskId = task.id;
    const definition = contextOrDefinition;
    if (task.workflow_progress.state !== 'active') {
      return null;
    }
    const currentStepId = task.workflow_progress.current_step;
    if (!currentStepId || !definition?.steps?.[currentStepId]) {
      return null;
    }
    step = definition.steps[currentStepId];
    isActive = true;
  } else if (target?.transitions || target?.executor !== undefined) {
    step = target;
    if (contextOrDefinition?.workflow_progress) {
      isActive = contextOrDefinition.workflow_progress.state === 'active';
      taskId = contextOrDefinition.id;
    } else if (typeof contextOrDefinition?.isActive === 'boolean') {
      isActive = contextOrDefinition.isActive;
    } else if (contextOrDefinition === undefined || contextOrDefinition === true) {
      isActive = true;
    } else if (contextOrDefinition === false) {
      isActive = false;
    }
  }

  if (!step || !isActive) {
    return null;
  }

  const executor = step.executor ?? 'agent';
  if (executor !== 'human') {
    return null;
  }

  const transitions = Array.isArray(step.transitions) ? step.transitions : [];
  const actions = transitions.map(transition => {
    const entry = {};
    if (transition.value !== undefined) {
      entry.result = transition.value;
    }
    if (transition.action?.label !== undefined) {
      entry.label = transition.action.label;
    }
    entry.feedbackRequired = Boolean(transition.action?.feedback?.required);
    return entry;
  });

  const descriptor = {
    actions,
  };

  let barriered = false;
  if (typeof options?.barriered === 'boolean') {
    barriered = options.barriered;
  } else if (typeof target?.barriered === 'boolean') {
    barriered = target.barriered;
  } else if (taskId && (changeSlug || options?.repoRoot)) {
    try {
      barriered = isTaskBarriered(changeSlug, taskId, options);
    } catch {
      barriered = false;
    }
  }

  if (barriered) {
    descriptor.barriered = true;
  }

  return descriptor;
}

export const projectHumanInteraction = describeHumanInteraction;
