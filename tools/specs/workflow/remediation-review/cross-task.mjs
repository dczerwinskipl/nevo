// Cross-task consistency inspection pass for remediation review (Task 30, D31, D36).
// For each pair of group members sharing a real relationship (dependency contract, shared file,
// shared semantic decisions), inspects whether the root cause task's fix invalidates an assumption
// the other member's implementation still relies on.
// If the flagged member is terminal: produces `owner-decision-required`/`NEEDS_CLARIFICATION`
// and NEVER attempts an automatic fix or reopening.
// If the flagged member is non-terminal: adds member via `addDiscoveredMember` to durable record.

import { addDiscoveredMember } from '../remediation-record.mjs';
import { isTaskTerminal } from './per-task.mjs';

/**
 * Inspects cross-task consistency across candidate pairs.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {object} params.group - Durable remediation record
 * @param {Array<object>} params.pairs - Pairs selected by selectRemediationReviewPairs
 * @param {Map<string, object>} params.tasksMap - Map of taskId -> task object
 * @param {Function} [params.crossTaskInspector] - Custom inspection function ({ taskA, taskB, rootTaskId, relationships }) => inconsistency | null
 * @returns {Promise<{ findings: Array<object>, discoveredMembers: Array<string> }>}
 */
export async function inspectCrossTaskConsistency(params = {}) {
  const {
    repoRoot,
    changeSlug,
    group,
    pairs = [],
    tasksMap = new Map(),
    crossTaskInspector,
  } = params;

  const rootTaskId = group.invalidatedDependency?.taskId || group.rootTaskId;
  const findings = [];
  const discoveredMembers = [];
  const groupMemberIds = new Set((group.members || []).map(m => m.taskId));

  for (const pair of pairs) {
    const { taskA, taskB, relationships } = pair;

    let inconsistency = null;
    if (typeof crossTaskInspector === 'function') {
      inconsistency = await crossTaskInspector({
        taskA,
        taskB,
        rootTaskId,
        relationships,
        group,
      });
    }

    if (!inconsistency) continue;

    // Identify which task is flagged as needing adjustment
    const flaggedTaskId = inconsistency.flaggedTaskId ||
      (taskA.id === rootTaskId ? taskB.id : taskA.id);
    const citingTaskId = inconsistency.citingTaskId ||
      (flaggedTaskId === taskA.id ? taskB.id : taskA.id);

    const flaggedTask = tasksMap.get(flaggedTaskId) || { id: flaggedTaskId };
    const memberRecord = (group.members || []).find(m => m.taskId === flaggedTaskId);
    const terminal = isTaskTerminal(flaggedTask, memberRecord);

    const citedChange = inconsistency.citedChange || `Change in task ${citingTaskId}`;
    const reason = inconsistency.reason || `Implementation of task ${flaggedTaskId} relies on assumptions invalidated by ${citingTaskId}`;

    if (terminal) {
      // D31: A terminal group member whose assumptions no longer hold produces an
      // `owner-decision-required`/`NEEDS_CLARIFICATION` finding; never an automatic fix attempt.
      const finding = {
        taskId: flaggedTaskId,
        citingTaskId,
        citedChange,
        reason,
        severity: inconsistency.severity || 'owner-decision-required',
        category: 'NEEDS_CLARIFICATION',
        ownerDecisionRequired: true,
        terminal: true,
        relationships,
      };
      findings.push(finding);
    } else {
      // Non-terminal member needing adjustment
      const severity = inconsistency.severity || 'changes-required';
      const finding = {
        taskId: flaggedTaskId,
        citingTaskId,
        citedChange,
        reason,
        severity,
        changesRequired: severity === 'changes-required',
        terminal: false,
        relationships,
      };
      findings.push(finding);

      // D31, D36: If not already in group members, add to durable record via addDiscoveredMember
      if (!groupMemberIds.has(flaggedTaskId)) {
        groupMemberIds.add(flaggedTaskId);
        discoveredMembers.push(flaggedTaskId);
        if (repoRoot && changeSlug && group.remediationId) {
          addDiscoveredMember(repoRoot, changeSlug, group.remediationId, flaggedTaskId);
        }
      }
    }
  }

  return { findings, discoveredMembers };
}
