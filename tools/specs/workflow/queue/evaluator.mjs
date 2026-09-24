// Pure domain sequential queue evaluator (Task 28, D32, D33, D34, D38, D45).
// Zero AI/session/dashboard awareness.
// Enforces single-active-execution invariant (D33): computes exactly one nextRunnable item,
// ordered declaratively by (schedulingPriority ascending, task.order ascending, eligibleAt ascending),
// never branching on step ids or step names.

import { evaluateExecutionReadiness } from '../readiness-policy.mjs';

/**
 * Normalizes various selection input shapes into an array of string task IDs.
 * Accepts string array, Set, remediation group object ({ taskIds: [...] } or { members: [...] }),
 * or queue record.
 *
 * @param {any} selection
 * @returns {string[]}
 */
export function normalizeTaskSelection(selection) {
  if (!selection) return [];
  if (Array.isArray(selection)) {
    return selection.map(item => (typeof item === 'string' ? item : item?.taskId || item?.id)).filter(Boolean);
  }
  if (selection instanceof Set) {
    return Array.from(selection).map(item => (typeof item === 'string' ? item : item?.taskId || item?.id)).filter(Boolean);
  }
  if (Array.isArray(selection.taskIds)) {
    return [...selection.taskIds].map(item => (typeof item === 'string' ? item : item?.taskId || item?.id)).filter(Boolean);
  }
  if (Array.isArray(selection.tasks)) {
    return selection.tasks.map(item => (typeof item === 'string' ? item : item?.taskId || item?.id)).filter(Boolean);
  }
  if (Array.isArray(selection.members)) {
    return selection.members.map(m => m.taskId).filter(Boolean);
  }
  return [];
}

/**
 * Evaluates the sequential queue state for a specification.
 *
 * @param {object} params
 * @param {object} params.change - Change manifest object
 * @param {object[]} [params.tasks] - Task list (defaults to change.tasks)
 * @param {string[]|Set|object} [params.selectedTaskIds] - Selection of task IDs or remediation group
 * @param {Map<string, object>|Record<string, object>} [params.readinessByTaskId] - Optional precomputed readiness verdicts
 * @param {Function} [params.getReadiness] - Optional custom readiness evaluator function
 * @param {Map<string, number>|Record<string, number>} [params.eligibleAtMap] - Timestamp mapping for FIFO ordering
 * @param {object} [params.queueRecord] - Durable queue record with eligibleAt timestamps
 * @param {object} [params.definition] - Optional pre-loaded workflow definition
 * @param {string} [params.repoRoot] - Optional repository root for readiness evaluation
 * @param {Array} [params.suspensions] - Optional override suspensions
 * @returns {{
 *   eligible: Array<{
 *     taskId: string,
 *     stepId: string,
 *     order: number,
 *     schedulingPriority: number,
 *     eligibleAt: number,
 *     executor: string,
 *     readiness: object
 *   }>,
 *   nextRunnable: {
 *     taskId: string,
 *     stepId: string,
 *     order: number,
 *     schedulingPriority: number,
 *     eligibleAt: number,
 *     executor: string,
 *     readiness: object
 *   } | null,
 *   warnings: Array<{ taskId: string, blockedByTaskId: string }>
 * }}
 */
export function evaluateTaskQueue(params = {}) {
  const {
    change,
    tasks = change?.tasks || [],
    selectedTaskIds,
    readinessByTaskId,
    getReadiness,
    eligibleAtMap,
    queueRecord,
    definition,
    repoRoot,
    suspensions,
  } = params;

  const rawSelection = selectedTaskIds ?? queueRecord?.taskIds ?? tasks.map(t => t.id);
  const selectedIds = normalizeTaskSelection(rawSelection);
  const selectedSet = new Set(selectedIds);

  const eligible = [];
  const warnings = [];

  for (const taskId of selectedIds) {
    let task = tasks.find(t => t.id === taskId || t.file?.endsWith(`/${taskId}.md`) || t.file?.endsWith(`\\${taskId}.md`));
    if (!task) {
      continue;
    }

    // Resolve readiness verdict: read composed verdict, never TaskProjection/suspensions directly (D44)
    let readiness;
    if (readinessByTaskId) {
      readiness = readinessByTaskId instanceof Map
        ? readinessByTaskId.get(taskId)
        : readinessByTaskId[taskId];
    } else if (typeof getReadiness === 'function') {
      readiness = getReadiness(task, change);
    } else {
      readiness = evaluateExecutionReadiness(task, change, 'agent', {
        definition,
        repoRoot,
        suspensions,
      });
    }

    if (!readiness) {
      continue;
    }

    // Ineligible cases (D37, D44, D45)
    if (!readiness.ready) {
      // Check for unselected, unsatisfied dependencies (AC1, D32)
      if (Array.isArray(readiness.blockedBy) && readiness.blockedBy.length > 0) {
        for (const depId of readiness.blockedBy) {
          if (!selectedSet.has(depId)) {
            warnings.push({
              taskId: task.id,
              blockedByTaskId: depId,
            });
          }
        }
      }
      // A suspended task is excluded from eligible via ExecutionReadiness refusal (code: 'TASK_SUSPENDED')
      continue;
    }

    // Task is ready and eligible for agent execution
    const targetStep = readiness.targetStep;
    const stepId = targetStep?.id || readiness.projection?.nextStep?.id || readiness.projection?.currentStep;
    const schedulingPriority = targetStep?.schedulingPriority ?? 0;
    const order = task.order ?? 999;

    let eligibleAt = 0;
    if (eligibleAtMap) {
      eligibleAt = eligibleAtMap instanceof Map ? (eligibleAtMap.get(task.id) ?? 0) : (eligibleAtMap[task.id] ?? 0);
    } else if (queueRecord?.eligibleAt?.[task.id] !== undefined) {
      eligibleAt = queueRecord.eligibleAt[task.id];
    }

    eligible.push({
      taskId: task.id,
      stepId,
      order,
      schedulingPriority,
      eligibleAt,
      executor: targetStep?.executor || 'agent',
      readiness,
    });
  }

  // Pure sort: (schedulingPriority ascending, task.order ascending, eligibleAt ascending) (D34)
  // No step id or name branching anywhere in this module.
  eligible.sort((a, b) => {
    // 1. schedulingPriority ascending
    const prioA = a.schedulingPriority ?? 0;
    const prioB = b.schedulingPriority ?? 0;
    if (prioA !== prioB) {
      return prioA - prioB;
    }

    // 2. task.order ascending
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // 3. eligibleAt ascending (FIFO)
    const timeA = typeof a.eligibleAt === 'number' ? a.eligibleAt : (new Date(a.eligibleAt).getTime() || 0);
    const timeB = typeof b.eligibleAt === 'number' ? b.eligibleAt : (new Date(b.eligibleAt).getTime() || 0);
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    return 0;
  });

  // Exactly one item or null — never an array, never a set (D33)
  const nextRunnable = eligible.length > 0 ? eligible[0] : null;

  return {
    eligible,
    nextRunnable,
    warnings,
  };
}

/**
 * Convenient alias matching the area documentation terminology.
 */
export const computeQueueState = evaluateTaskQueue;
