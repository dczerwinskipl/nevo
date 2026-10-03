// Bounded semantic and file relationship pair selection for remediation group review (Task 30, D31).
// Inspects pairs sharing: dependency contract, shared file (allowed_paths), or shared decisions.

/**
 * Normalizes path for comparison.
 */
function normalizePath(p) {
  return p ? p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
}

/**
 * Checks if two path patterns or sets overlap.
 */
export function pathsOverlap(pathsA = [], pathsB = []) {
  for (const pa of pathsA) {
    const na = normalizePath(pa);
    for (const pb of pathsB) {
      const nb = normalizePath(pb);
      if (na === nb) return true;
      // Handle simple glob prefix e.g. "tools/foo/**"
      if (na.endsWith('**') && nb.startsWith(na.slice(0, -2))) return true;
      if (nb.endsWith('**') && na.startsWith(nb.slice(0, -2))) return true;
    }
  }
  return false;
}

/**
 * Finds all candidate pairs among group members and change tasks that share a real relationship.
 *
 * @param {object} params
 * @param {Array<object>} params.tasks - List of task objects to compare
 * @param {string} [params.rootTaskId] - Root cause task id
 * @returns {Array<{ taskA: object, taskB: object, relationships: Array<{ type: string, detail?: any }> }>}
 */
export function selectRemediationReviewPairs(params = {}) {
  const { tasks = [], rootTaskId } = params;
  const pairs = [];
  const visited = new Set();

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const taskA = tasks[i];
      const taskB = tasks[j];
      const pairKey = [taskA.id, taskB.id].sort().join(':');
      if (visited.has(pairKey)) continue;

      const relationships = [];

      // 1. Dependency contract
      const aDependsOnB = (taskA.depends_on || []).includes(taskB.id);
      const bDependsOnA = (taskB.depends_on || []).includes(taskA.id);
      const aContracts = taskA.semantic_references?.dependencyContracts || [];
      const bContracts = taskB.semantic_references?.dependencyContracts || [];
      const contractRelated = aContracts.includes(taskB.id) || bContracts.includes(taskA.id);

      if (aDependsOnB || bDependsOnA || contractRelated) {
        relationships.push({
          type: 'dependency-contract',
          detail: { aDependsOnB, bDependsOnA, contractRelated },
        });
      }

      // 2. Shared file (allowed_paths overlap)
      const allowedA = taskA.allowed_paths || [];
      const allowedB = taskB.allowed_paths || [];
      if (pathsOverlap(allowedA, allowedB)) {
        relationships.push({
          type: 'shared-file',
          detail: { pathsA: allowedA, pathsB: allowedB },
        });
      }

      // 3. Shared semantic decisions
      const decisionsA = taskA.semantic_references?.decisions || [];
      const decisionsB = taskB.semantic_references?.decisions || [];
      const sharedDecisions = decisionsA.filter(d => decisionsB.includes(d));
      if (sharedDecisions.length > 0) {
        relationships.push({
          type: 'shared-decision',
          detail: { sharedDecisions },
        });
      }

      if (relationships.length > 0) {
        visited.add(pairKey);
        pairs.push({
          taskA,
          taskB,
          relationships,
        });
      }
    }
  }

  // If rootTaskId is specified, sort pairs involving rootTaskId first
  if (rootTaskId) {
    pairs.sort((a, b) => {
      const aHasRoot = a.taskA.id === rootTaskId || a.taskB.id === rootTaskId;
      const bHasRoot = b.taskA.id === rootTaskId || b.taskB.id === rootTaskId;
      if (aHasRoot && !bHasRoot) return -1;
      if (!aHasRoot && bHasRoot) return 1;
      return 0;
    });
  }

  return pairs;
}
