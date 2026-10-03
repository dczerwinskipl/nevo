// Suspension projection (D31, D37, D44).
// Reads remediation records and projects task suspensions independently of pure TaskProjection.

import { findActiveRemediationGroups } from './remediation-record.mjs';
import { TERMINAL_STATUSES } from '../status-vocabulary.mjs';

/**
 * Projects suspensions for a task based on active remediation groups (D44).
 * Kept strictly separate from pure task-projection.mjs.
 *
 * @param {object} task - Task object
 * @param {object} change - Change manifest
 * @param {object} [options]
 * @param {string} [options.repoRoot] - Repository root
 * @returns {Array<{ taskId: string, reason: string, groupId: string, advisory?: boolean }>}
 */
export function projectSuspensions(task, change, options = {}) {
  if (!task || !change) return [];
  const repoRoot = options.repoRoot;
  if (!repoRoot) return [];

  const changeSlug = change._slug || change.id;
  const activeGroups = findActiveRemediationGroups(repoRoot, changeSlug);
  const suspensions = [];

  const isTerminal = TERMINAL_STATUSES.has(task.status);

  for (const group of activeGroups) {
    const member = group.members?.find(m => m.taskId === task.id);
    if (member) {
      suspensions.push({
        taskId: task.id,
        reason: 'dependency-invalidated',
        groupId: group.remediationId,
        advisory: Boolean(member.terminal || isTerminal),
      });
    }
  }

  return suspensions;
}
