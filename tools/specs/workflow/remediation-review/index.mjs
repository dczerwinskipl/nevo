// Combined, cross-task-aware remediation review for dependency invalidation (Task 30, D31, D36, D37, D43).
// Two-pass design: per-task reviews first (bounded context, non-terminal members only),
// followed by cross-task consistency pass over related pairs (dependency contract, shared file, shared decisions).
// Aggregate verdict from explicit evaluation table (blocked > owner-decision-required > changes-required > pass).
// Suspensions cleared if and only if aggregate verdict is `pass`.

import { loadRemediationGroup, resolveRemediationGroup } from '../remediation-record.mjs';
import { WorkflowError } from '../errors.mjs';
import { computeRemediationReviewVerdict, EVALUATION_ORDER } from './verdict.mjs';
import { selectRemediationReviewPairs } from './pairs.mjs';
import { reviewGroupMembers } from './per-task.mjs';
import { inspectCrossTaskConsistency } from './cross-task.mjs';

export {
  computeRemediationReviewVerdict,
  EVALUATION_ORDER,
  selectRemediationReviewPairs,
  reviewGroupMembers,
  inspectCrossTaskConsistency,
};

/**
 * Runs a combined remediation group review.
 *
 * @param {object} params
 * @param {string} params.repoRoot - Repository root
 * @param {string} params.changeSlug - Change identifier
 * @param {string} params.remediationId - Remediation group ID
 * @param {object} [params.change] - Optional parsed change manifest
 * @param {Array<object>} [params.tasks] - Optional task objects for change
 * @param {Function} [params.taskReviewer] - Optional custom per-task review function
 * @param {Function} [params.crossTaskInspector] - Optional custom cross-task consistency inspector
 * @returns {Promise<{
 *   remediationId: string,
 *   group: object,
 *   perTaskResults: Map<string, object>,
 *   crossTaskFindings: Array<object>,
 *   aggregateVerdict: 'blocked'|'owner-decision-required'|'changes-required'|'pass',
 *   suspensionsCleared: boolean,
 *   discoveredMembers: Array<string>,
 * }>}
 */
export async function runRemediationReview(params = {}) {
  const {
    repoRoot,
    changeSlug,
    remediationId,
    change,
    tasks = [],
    taskReviewer,
    crossTaskInspector,
  } = params;

  if (!repoRoot || !changeSlug || !remediationId) {
    throw new WorkflowError('runRemediationReview requires repoRoot, changeSlug, and remediationId');
  }

  // 1. Resolve scope from durable remediation group record (D31, D36)
  const group = loadRemediationGroup(repoRoot, changeSlug, remediationId);
  if (!group) {
    throw new WorkflowError(`Remediation group '${remediationId}' not found for change '${changeSlug}'`);
  }

  // Build task map from provided tasks or change.tasks
  const allTasksList = tasks.length > 0 ? tasks : (change?.tasks || []);
  const tasksMap = new Map();
  for (const t of allTasksList) {
    tasksMap.set(t.id, t);
  }

  // Collect all known group members (members + discoveredMembers)
  const membersMap = new Map();
  for (const m of group.members || []) {
    membersMap.set(m.taskId, m);
  }
  for (const d of group.discoveredMembers || []) {
    const taskId = typeof d === 'string' ? d : d.taskId;
    if (!membersMap.has(taskId)) {
      const task = tasksMap.get(taskId);
      const isTerminal = task?.status === 'verified';
      membersMap.set(taskId, { taskId, role: 'consumer', terminal: isTerminal });
    }
  }

  const allMembers = Array.from(membersMap.values());

  // 2. Pass 1: Per-task reviews for non-terminal members first (D31)
  const perTaskResults = await reviewGroupMembers({
    members: allMembers,
    tasksMap,
    taskReviewer,
  });

  // Collect per-task verdicts and findings
  const taskVerdicts = [];
  const perTaskFindings = [];
  for (const [, res] of perTaskResults) {
    taskVerdicts.push(res.verdict);
    if (Array.isArray(res.findings)) {
      perTaskFindings.push(...res.findings);
    }
  }

  // 3. Pass 2: Cross-task consistency pass over related pairs (D31)
  // Candidate tasks to inspect: all group members + any related tasks in change
  const candidateTasks = Array.from(new Set([
    ...allMembers.map(m => m.taskId),
    ...(allTasksList.map(t => t.id)),
  ])).map(id => tasksMap.get(id) || { id });

  const rootTaskId = group.invalidatedDependency?.taskId || group.rootTaskId;
  const pairs = selectRemediationReviewPairs({
    tasks: candidateTasks,
    rootTaskId,
  });

  const { findings: crossTaskFindings, discoveredMembers } = await inspectCrossTaskConsistency({
    repoRoot,
    changeSlug,
    group,
    pairs,
    tasksMap,
    crossTaskInspector,
  });

  // Re-read updated group if any discovered member was added
  const updatedGroup = loadRemediationGroup(repoRoot, changeSlug, remediationId) || group;

  // 4. Compute aggregate verdict from explicit evaluation table (D31)
  const allFindings = [...perTaskFindings, ...crossTaskFindings];
  const ownerDecisionFindings = allFindings.filter(f =>
    f.severity === 'owner-decision-required' || f.ownerDecisionRequired === true
  ).length;
  const autoFixFindings = allFindings.filter(f =>
    f.severity === 'changes-required' || f.changesRequired === true
  ).length;

  const aggregateVerdict = computeRemediationReviewVerdict({
    taskVerdicts,
    ownerDecisionFindings,
    autoFixFindings,
    findings: allFindings,
  });

  // 5. Suspension clearance (D31, D37):
  // Cleared for every non-terminal group member if and only if aggregate verdict is `pass`.
  let suspensionsCleared = false;
  if (aggregateVerdict === 'pass') {
    resolveRemediationGroup(repoRoot, changeSlug, remediationId);
    suspensionsCleared = true;
  }

  return {
    remediationId,
    group: updatedGroup,
    perTaskResults,
    crossTaskFindings,
    allFindings,
    aggregateVerdict,
    suspensionsCleared,
    discoveredMembers,
  };
}

/**
 * Resolves an advisory finding on a terminal group member by owner decision.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.remediationId
 * @param {string} params.taskId
 * @param {string} [params.resolution]
 * @returns {object|null}
 */
export function resolveTerminalAdvisoryFinding(params = {}) {
  const { repoRoot, changeSlug, remediationId, taskId } = params;
  const group = loadRemediationGroup(repoRoot, changeSlug, remediationId);
  if (!group) return null;

  if (!group.resolvedTerminalFindings) {
    group.resolvedTerminalFindings = [];
  }
  if (!group.resolvedTerminalFindings.includes(taskId)) {
    group.resolvedTerminalFindings.push(taskId);
  }

  // If all members are now satisfied and group has no other unresolved items, resolve group
  return resolveRemediationGroup(repoRoot, changeSlug, remediationId);
}
