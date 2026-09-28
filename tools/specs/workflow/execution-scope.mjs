import { WorkflowError } from './errors.mjs';

/**
 * Validates whether an object is a well-formed ExecutionScope:
 * - { kind: "task", taskId: string }
 * - { kind: "task-batch", taskIds: string[] } (length >= 2, non-empty strings)
 *
 * @param {any} scope
 * @returns {{ ok: boolean, error?: string, scope?: object }}
 */
export function validateExecutionScope(scope) {
  if (!scope || typeof scope !== 'object') {
    return { ok: false, valid: false, error: 'ExecutionScope must be an object' };
  }

  if (scope.kind === 'task') {
    if (typeof scope.taskId !== 'string' || scope.taskId.trim().length === 0) {
      return { ok: false, valid: false, error: "ExecutionScope of kind 'task' requires a non-empty 'taskId' string" };
    }
    return {
      ok: true,
      valid: true,
      scope: {
        kind: 'task',
        taskId: scope.taskId.trim(),
      },
    };
  }

  if (scope.kind === 'task-batch') {
    if (!Array.isArray(scope.taskIds)) {
      return { ok: false, valid: false, error: "ExecutionScope of kind 'task-batch' requires a 'taskIds' array" };
    }
    if (scope.taskIds.length < 2) {
      return {
        ok: false,
        valid: false,
        error: `ExecutionScope of kind 'task-batch' requires at least 2 task IDs (got ${scope.taskIds.length})`,
      };
    }
    const seen = new Set();
    for (let i = 0; i < scope.taskIds.length; i++) {
      const id = scope.taskIds[i];
      if (typeof id !== 'string' || id.trim().length === 0) {
        return { ok: false, valid: false, error: `ExecutionScope of kind 'task-batch' contains invalid taskId at index ${i}` };
      }
      const trimmed = id.trim();
      if (seen.has(trimmed)) {
        return { ok: false, valid: false, error: `ExecutionScope of kind 'task-batch' contains duplicate taskId '${trimmed}'` };
      }
      seen.add(trimmed);
    }
    return {
      ok: true,
      valid: true,
      scope: {
        kind: 'task-batch',
        taskIds: scope.taskIds.map((t) => t.trim()),
      },
    };
  }

  return { ok: false, valid: false, error: `Unknown ExecutionScope kind: '${scope.kind}'` };
}

/**
 * Asserts that an object is a valid ExecutionScope, throwing a WorkflowError if not.
 *
 * @param {any} scope
 * @returns {object} validated scope
 */
export function assertExecutionScope(scope) {
  const result = validateExecutionScope(scope);
  if (!result.ok) {
    throw new WorkflowError(result.error);
  }
  return result.scope;
}

export function isExecutionScope(scope) {
  return validateExecutionScope(scope).ok;
}

export function createTaskScope(taskId) {
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new WorkflowError("createTaskScope requires a non-empty 'taskId' string");
  }
  return { kind: 'task', taskId: taskId.trim() };
}

export function createBatchScope(taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length < 2) {
    throw new WorkflowError('createBatchScope requires an array of at least 2 task IDs');
  }
  const cleaned = taskIds.map((t) => {
    if (typeof t !== 'string' || !t.trim()) {
      throw new WorkflowError('createBatchScope taskIds must be non-empty strings');
    }
    return t.trim();
  });
  return { kind: 'task-batch', taskIds: cleaned };
}

export function getScopeTaskIds(scope) {
  const validated = assertExecutionScope(scope);
  return validated.kind === 'task' ? [validated.taskId] : [...validated.taskIds];
}

export function scopeContainsTask(scope, taskId) {
  if (!scope || !taskId) return false;
  const result = validateExecutionScope(scope);
  if (!result.ok) return false;
  if (result.scope.kind === 'task') {
    return result.scope.taskId === taskId;
  }
  return result.scope.taskIds.includes(taskId);
}

export function normalizeExecutionScope(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw.kind) {
    const res = validateExecutionScope(raw);
    return res.ok ? res.scope : null;
  }
  if (typeof raw.scope === 'object' && raw.scope?.kind) {
    const res = validateExecutionScope(raw.scope);
    return res.ok ? res.scope : null;
  }
  if (typeof raw.executionScope === 'object' && raw.executionScope?.kind) {
    const res = validateExecutionScope(raw.executionScope);
    return res.ok ? res.scope : null;
  }
  if (typeof raw.taskId === 'string' && raw.taskId.trim().length > 0) {
    return createTaskScope(raw.taskId);
  }
  if (Array.isArray(raw.taskIds) && raw.taskIds.length >= 2) {
    const res = validateExecutionScope({ kind: 'task-batch', taskIds: raw.taskIds });
    return res.ok ? res.scope : null;
  }
  return null;
}
