// Query and JSON export layer for Activity records.
//
// Exposes the three required read scopes over a specification's Activity store:
// 1. Task activity: entries where scope.taskId matches.
// 2. Spec-only activity: entries where scope.taskId is absent.
// 3. Full spec history: all entries for specId, unfiltered.
//
// Also exposes exportActivityAsJson as a thin, explicitly-named export entry point.
// All query functions preserve physical file append order and inherit read-side
// deduplication-by-id from readActivities in store.mjs.

import { readActivities } from './store.mjs';

/**
 * Queries all activity records scoped to a specific task within a specification.
 *
 * @param {string|object} specId - Specification identifier (UUID, slug, or object)
 * @param {string} taskId - Target task identifier
 * @param {object} [options] - Optional store options (e.g. activityDir, repoRoot)
 * @returns {Array<object>} Task-scoped activity records in append order
 */
export function queryTaskActivity(specId, taskId, options = {}) {
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    return [];
  }
  const activities = readActivities(specId, options);
  return activities.filter(entry => entry.scope?.taskId === taskId);
}

/**
 * Queries activity records that are spec-level only (entries where scope.taskId is absent).
 *
 * @param {string|object} specId - Specification identifier (UUID, slug, or object)
 * @param {object} [options] - Optional store options (e.g. activityDir, repoRoot)
 * @returns {Array<object>} Spec-only activity records in append order
 */
export function querySpecOnlyActivity(specId, options = {}) {
  const activities = readActivities(specId, options);
  return activities.filter(entry => !entry.scope?.taskId);
}

/**
 * Queries the full activity history for a specification (all entries, unfiltered).
 *
 * @param {string|object} specId - Specification identifier (UUID, slug, or object)
 * @param {object} [options] - Optional store options (e.g. activityDir, repoRoot)
 * @returns {Array<object>} All activity records for the specification in append order
 */
export function queryFullSpecHistory(specId, options = {}) {
  return readActivities(specId, options);
}

/**
 * Exports queried activity records as a plain JSON-serializable array.
 *
 * Supports querying by scope:
 * - scope: 'full' | 'all' (or omitted) -> full history
 * - scope: 'spec-only' | 'spec' -> spec-only activity
 * - scope: 'task' (with taskId) or scope: { taskId } -> task-scoped activity
 *
 * @param {string|object} specId - Specification identifier
 * @param {object} [options] - Export options including scope, taskId, and store options
 * @param {string|object} [options.scope] - Read scope selector
 * @param {string} [options.taskId] - Task identifier when querying task scope
 * @returns {Array<object>} Plain JSON-serializable array of activity records
 */
export function exportActivityAsJson(specId, options = {}) {
  const { scope, taskId, ...storeOptions } = options;

  if (!scope) {
    if (taskId) {
      return queryTaskActivity(specId, taskId, storeOptions);
    }
    return queryFullSpecHistory(specId, storeOptions);
  }

  if (typeof scope === 'string') {
    const normalized = scope.trim().toLowerCase();
    if (normalized === 'full' || normalized === 'all') {
      return queryFullSpecHistory(specId, storeOptions);
    }
    if (normalized === 'spec-only' || normalized === 'spec' || normalized === 'speconly') {
      return querySpecOnlyActivity(specId, storeOptions);
    }
    if (normalized === 'task') {
      return queryTaskActivity(specId, taskId, storeOptions);
    }
    // String scope may be the taskId itself
    return queryTaskActivity(specId, taskId || scope, storeOptions);
  }

  if (typeof scope === 'object' && scope !== null) {
    if (scope.taskId) {
      return queryTaskActivity(specId, scope.taskId, storeOptions);
    }
    if (scope.specOnly || scope.type === 'spec-only' || scope.type === 'spec') {
      return querySpecOnlyActivity(specId, storeOptions);
    }
    if (scope.type === 'task') {
      return queryTaskActivity(specId, scope.taskId || taskId, storeOptions);
    }
    return queryFullSpecHistory(specId, storeOptions);
  }

  return queryFullSpecHistory(specId, storeOptions);
}
