import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';
import {
  queryTaskActivity,
  querySpecOnlyActivity,
  queryFullSpecHistory,
  exportActivityAsJson,
} from '../../../specs/activity/query.mjs';

/**
 * Resolves options for activity queries from server configuration.
 *
 * @param {object} [config]
 * @returns {object}
 */
export function resolveActivityOptions(config = {}) {
  const repoRoot = config.root || config.repoRoot || REPOSITORY_ROOT;
  const activeDir = config.activeDir;
  const archiveDir = config.archiveDir;
  const customActivityDir = config.activityDir;

  return {
    repoRoot,
    ...(activeDir ? { activeDir } : {}),
    ...(archiveDir ? { archiveDir } : {}),
    ...(customActivityDir ? { activityDir: customActivityDir } : {}),
  };
}

/**
 * Creates an activity data adapter bound to the given server configuration.
 * Thin adapter calling tools/specs/activity/query.mjs — no persistence logic here.
 *
 * @param {object} [config]
 * @returns {object}
 */
export function createActivityDataAdapter(config = {}) {
  const baseOptions = resolveActivityOptions(config);

  return {
    getTaskActivity(specId, taskId, overrides = {}) {
      return queryTaskActivity(specId, taskId, { ...baseOptions, ...overrides });
    },
    getSpecOnlyActivity(specId, overrides = {}) {
      return querySpecOnlyActivity(specId, { ...baseOptions, ...overrides });
    },
    getFullSpecHistory(specId, overrides = {}) {
      return queryFullSpecHistory(specId, { ...baseOptions, ...overrides });
    },
    exportActivity(specId, exportOptions = {}) {
      return exportActivityAsJson(specId, { ...baseOptions, ...exportOptions });
    },
  };
}

export function getTaskActivity(specId, taskId, options = {}) {
  const baseOptions = resolveActivityOptions(options);
  return queryTaskActivity(specId, taskId, { ...baseOptions, ...options });
}

export function getSpecOnlyActivity(specId, options = {}) {
  const baseOptions = resolveActivityOptions(options);
  return querySpecOnlyActivity(specId, { ...baseOptions, ...options });
}

export function getFullSpecHistory(specId, options = {}) {
  const baseOptions = resolveActivityOptions(options);
  return queryFullSpecHistory(specId, { ...baseOptions, ...options });
}

export { queryTaskActivity, querySpecOnlyActivity, queryFullSpecHistory, exportActivityAsJson };
