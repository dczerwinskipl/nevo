// Per-task review runner for remediation group review (Task 30, D31).
// Per-task reviews run first, for every non-terminal member.
// A terminal member is inspected read-only in the cross-task pass only;
// zero per-task review attempt is executed against it (there is nothing to re-execute).

import { TERMINAL_STATUSES } from '../../status-vocabulary.mjs';

/**
 * Checks whether a task has reached terminal status for remediation review.
 * A terminal member (e.g. verified, archived, abandoned) is inspected read-only;
 * non-terminal members undergoing fix attempts are reviewed.
 *
 * @param {object} task
 * @param {object} [memberRecord]
 * @returns {boolean}
 */
export function isTaskTerminal(task, memberRecord) {
  if (memberRecord?.terminal !== undefined) return Boolean(memberRecord.terminal);
  if (!task) return false;
  return task.status === 'verified' || task.status === 'archived' || task.status === 'abandoned';
}

/**
 * Executes per-task reviews for group members.
 *
 * @param {object} params
 * @param {Array<object>} params.members - Remediation group member records
 * @param {Map<string, object>} params.tasksMap - Map of taskId -> task object
 * @param {Function} [params.taskReviewer] - Optional custom per-task review function (task, member) => { verdict, findings }
 * @returns {Promise<Map<string, object>>} Map of taskId -> per-task review result
 */
export async function reviewGroupMembers(params = {}) {
  const { members = [], tasksMap = new Map(), taskReviewer } = params;
  const results = new Map();

  for (const member of members) {
    const taskId = member.taskId;
    const task = tasksMap.get(taskId) || { id: taskId, status: member.terminal ? 'verified' : 'draft' };
    const terminal = isTaskTerminal(task, member);

    if (terminal) {
      // D31: A terminal group member is reviewed read-only in the cross-task pass only —
      // no per-task "review" attempt is made against it.
      results.set(taskId, {
        taskId,
        verdict: 'pass',
        terminal: true,
        readOnly: true,
        attempted: false,
        findings: [],
      });
      continue;
    }

    // Non-terminal member: run per-task review
    let reviewResult;
    if (typeof taskReviewer === 'function') {
      reviewResult = await taskReviewer(task, member);
    } else {
      // Default: inspect task status or verification result
      const isImplemented = task.status === 'implemented' || task.status === 'in-implementation';
      reviewResult = {
        verdict: isImplemented ? 'pass' : 'changes-required',
        findings: isImplemented ? [] : [
          {
            taskId,
            severity: 'changes-required',
            reason: `Task ${taskId} is not in implemented state (current: ${task.status})`,
          },
        ],
      };
    }

    results.set(taskId, {
      taskId,
      verdict: reviewResult.verdict || 'pass',
      terminal: false,
      readOnly: false,
      attempted: true,
      findings: reviewResult.findings || [],
      ...reviewResult,
    });
  }

  return results;
}
