// Authoritative BatchContext builder (Task 03, D8, D11, D25, D32).
// Owns the complete, final BatchContext — dedup, cross-task overlap, and lineage all included.

import * as git from '../../lib/git.mjs';
import { attributeTouchedPaths, detectBatchIntegrationFindings } from '../lifecycle/batch.mjs';
import { resolveIncomingExecution } from '../workflow/resolve-incoming-execution.mjs';
import { createAgentSessionBindingService } from '../../dashboard/server/ai/sessions/binding-service.mjs';

/**
 * Deduplicates an array of items across tasks, tracking usedBy taskIds.
 *
 * @param {Array<{ taskId: string, items: any[] }>} taskItemPairs
 * @param {(item: any) => string} keyFn
 * @returns {Array<object>}
 */
function deduplicateWithAttribution(taskItemPairs, keyFn) {
  const map = new Map(); // key -> { item, usedBy: Set<string> }

  for (const { taskId, items } of taskItemPairs) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item) continue;
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          item: typeof item === 'object' ? { ...item } : item,
          usedBy: new Set(),
        });
      }
      map.get(key).usedBy.add(taskId);
    }
  }

  const result = [];
  for (const { item, usedBy } of map.values()) {
    const usedByArray = Array.from(usedBy).sort();
    if (typeof item === 'object' && item !== null) {
      result.push({
        ...item,
        usedBy: usedByArray,
      });
    } else {
      result.push({
        value: item,
        usedBy: usedByArray,
      });
    }
  }

  return result;
}

/**
 * Resolves per-member predecessorSession lineage via resolveIncomingExecution (D8, D25).
 * Fail-closed to null on ambiguity or missing session — never guesses.
 *
 * @param {object} params
 * @param {object[]} params.tasks
 * @param {object} params.definition
 * @param {string} params.targetStepName
 * @param {string} [params.specId]
 * @param {string} [params.repoRoot]
 * @param {object} [params.bindingService]
 * @returns {Array<{ taskId: string, sessionId: string|null, priorStep?: string, priorAttempt?: number }>}
 */
export function resolveBatchLineage(params = {}) {
  const { tasks = [], definition, targetStepName, specId, repoRoot, bindingService } = params;

  let service = bindingService;
  if (!service && repoRoot) {
    try {
      service = createAgentSessionBindingService(repoRoot);
    } catch {
      service = null;
    }
  }

  const result = [];

  for (const task of tasks) {
    const incoming = definition ? resolveIncomingExecution(task, definition, targetStepName) : null;
    const history = task.workflow_progress?.history || [];
    const lastHistory = history.length > 0 ? history[history.length - 1] : null;
    const priorStep = lastHistory?.step || null;
    const priorAttempt = lastHistory?.attempt;

    // If ambiguous transition match or no history, fail closed to null (D8, D25)
    if (incoming?.ambiguous || !lastHistory) {
      result.push({
        taskId: task.id,
        sessionId: null,
        ...(priorStep ? { priorStep } : {}),
        ...(priorAttempt !== undefined ? { priorAttempt } : {}),
      });
      continue;
    }

    let foundSessionId = null;

    if (service) {
      try {
        const query = {
          ...(specId ? { specId } : {}),
          taskId: task.id,
          ...(priorStep ? { step: priorStep } : {}),
        };
        const matchingBindings = service.listBindingsSync
          ? service.listBindingsSync(query)
          : [];

        const matchingSessionIds = Array.from(new Set(matchingBindings.map((b) => b.sessionId).filter(Boolean)));

        if (matchingSessionIds.length === 1) {
          foundSessionId = matchingSessionIds[0];
        } else {
          // 0 matches or >1 matches (ambiguous lineage) -> null
          foundSessionId = null;
        }
      } catch {
        foundSessionId = null;
      }
    }

    if (!foundSessionId && task.execution?.sessionId) {
      foundSessionId = task.execution.sessionId;
    }

    result.push({
      taskId: task.id,
      sessionId: foundSessionId || null,
      ...(priorStep ? { priorStep } : {}),
      ...(priorAttempt !== undefined ? { priorAttempt } : {}),
    });
  }

  return result;
}

/**
 * Builds the complete, authoritative BatchContext (D32, D11, D25).
 *
 * @param {object} params
 * @param {object} params.change
 * @param {object[]} params.tasks
 * @param {object} params.definition
 * @param {Record<string, object>} params.memberStepContexts
 * @param {object} params.reservation
 * @param {string} [params.repoRoot]
 * @param {object} [params.bindingService]
 * @returns {object} Full BatchContext
 */
export function buildBatchContext(params = {}) {
  const {
    change,
    tasks = [],
    definition,
    memberStepContexts = {},
    reservation,
    repoRoot,
    bindingService,
  } = params;

  const changeSlug = change.id || change._slug;
  const specId = change.id || change._slug;
  const taskIds = reservation?.taskIds || tasks.map(t => t.id);

  // 1. Members sorted deterministically by order ascending, then ID ascending
  const sortedTasks = [...tasks].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.id).localeCompare(String(b.id));
  });

  const members = sortedTasks.map((t) => {
    const stepContext = memberStepContexts[t.id] || null;
    return {
      taskId: t.id,
      title: t.title,
      order: t.order ?? 0,
      status: t.status,
      allowedPaths: t.allowed_paths || stepContext?.expectedWork?.allowedPaths || [],
      forbiddenPaths: t.forbidden_paths || stepContext?.expectedWork?.forbiddenPaths || [],
      stepContext,
    };
  });

  // Target step from explicit param, first member step context, or definition
  const firstMemberContext = Object.values(memberStepContexts)[0];
  const targetStepName = params.targetStepName
    || firstMemberContext?.currentStep
    || firstMemberContext?.step
    || firstMemberContext?.runtimeState?.step
    || definition?.entryStep
    || 'review';

  // 2. Deduplicate requiredContext with usedBy attribution
  const requiredContextPairs = members.map((m) => ({
    taskId: m.taskId,
    items: m.stepContext?.requiredContext || [],
  }));
  const dedupedRequiredContext = deduplicateWithAttribution(
    requiredContextPairs,
    (item) => (typeof item === 'string' ? item : item.path || item.id || JSON.stringify(item))
  );

  // 3. Deduplicate relevantDocs with usedBy attribution
  const relevantDocsPairs = members.map((m) => ({
    taskId: m.taskId,
    items: m.stepContext?.relevantDocs || [],
  }));
  const dedupedRelevantDocs = deduplicateWithAttribution(
    relevantDocsPairs,
    (item) => item.ref || item.path || item.url || JSON.stringify(item)
  );

  // 4. Cross-task overlap attribution (reusing attributeTouchedPaths / detectBatchIntegrationFindings)
  const taskDeclaredPaths = {};
  for (const m of members) {
    taskDeclaredPaths[m.taskId] = [...(m.allowedPaths || []), ...(m.forbiddenPaths || [])];
  }

  let changedFiles = [];
  if (repoRoot) {
    try {
      changedFiles = git.getDirtyFiles(repoRoot).map(f => (f.includes(' -> ') ? f.split(' -> ')[1] : f));
    } catch {
      changedFiles = [];
    }
    try {
      const headChanged = git.getChangedFiles(repoRoot, 'HEAD~1');
      changedFiles = [...new Set([...changedFiles, ...headChanged])];
    } catch {}
  }

  const touchedPaths = attributeTouchedPaths(taskIds, taskDeclaredPaths, changedFiles);
  const rawFindings = detectBatchIntegrationFindings({ temporaryInconsistencies: [] }, taskIds, touchedPaths);
  const crossTaskFindings = (rawFindings || []).map((f) => ({
    ...f,
    affectedTaskIds: f.tasks || f.taskIds || [],
  }));

  const crossTask = {
    findings: crossTaskFindings,
    touchedPaths,
  };

  // 5. Lineage resolution per member (D8, D25)
  const predecessorSessions = resolveBatchLineage({
    tasks: sortedTasks,
    definition,
    targetStepName,
    specId,
    repoRoot,
    bindingService,
  });

  return {
    batchExecutionId: reservation?.batchExecutionId,
    change: changeSlug,
    targetStep: targetStepName,
    executionScope: { kind: 'task-batch', taskIds: [...taskIds] },
    executionConfigSnapshot: reservation?.executionConfigSnapshot || {},
    members,
    requiredContext: dedupedRequiredContext,
    relevantDocs: dedupedRelevantDocs,
    crossTask,
    predecessorSessions,
  };
}
