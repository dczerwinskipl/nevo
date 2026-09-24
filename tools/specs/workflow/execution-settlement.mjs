// Concrete, reusable execution settlement checker (D59, D60).
// Verifies whether an execution has genuinely settled across 4 conditions:
// 1. No in-flight start-operation record.
// 2. No in-flight finish-operation record.
// 3. Task workflow_progress position is not active.
// 4. No dirty tracked change within the execution's owned scope.

import fs from 'node:fs';
import path from 'node:path';
import { requireChange, requireTask } from '../store.mjs';
import { findInFlightOperationRecord } from './operation-record.mjs';
import { findInFlightStartOperation } from './start-operation.mjs';
import { resolveTaskScope, resolveWorkflowOwnedPaths } from './step-context.mjs';
import * as git from '../../lib/git.mjs';

function matchesFilePattern(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (normalizedPattern === '*' || normalizedPattern === '**') return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalized.startsWith(`${prefix}/`) && !normalized.slice(prefix.length + 1).includes('/');
  }
  return normalized === normalizedPattern;
}

function expandDirtyPaths(repoRoot, paths) {
  const result = [];
  for (const p of paths) {
    const full = path.join(repoRoot, p);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const walk = dir => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const child = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(child);
            } else {
              result.push(path.relative(repoRoot, child).replace(/\\/g, '/'));
            }
          }
        };
        walk(full);
      } else {
        result.push(p.replace(/\\/g, '/'));
      }
    } catch {
      result.push(p.replace(/\\/g, '/'));
    }
  }
  return result;
}

/**
 * Assesses whether execution for a given task has settled safely.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.taskId
 * @param {string} [params.activeDir]
 * @returns {Promise<{ settled: boolean, reason?: string, details?: any, dirtyPaths?: string[] }>}
 */
export async function assessExecutionSettlement({ repoRoot, changeSlug, taskId, activeDir }) {
  if (!repoRoot || !changeSlug || !taskId) {
    return { settled: false, reason: 'missing-parameters' };
  }

  const resolvedActiveDir = activeDir || path.join(repoRoot, 'specs', 'active');

  // 1. Check in-flight start operation
  const inFlightStart = findInFlightStartOperation(repoRoot, changeSlug, taskId);
  if (inFlightStart) {
    return {
      settled: false,
      reason: 'in-flight-start-operation',
      details: { startOperation: inFlightStart },
    };
  }

  // 2. Check in-flight finish operation
  const inFlightFinish = findInFlightOperationRecord(repoRoot, changeSlug, taskId);
  if (inFlightFinish) {
    return {
      settled: false,
      reason: 'in-flight-finish-operation',
      details: { finishOperation: inFlightFinish },
    };
  }

  // 3. Check task workflow progress state is not active
  let change;
  let task;
  try {
    change = requireChange(changeSlug, resolvedActiveDir);
    task = requireTask(change, taskId);
  } catch (err) {
    return {
      settled: false,
      reason: `Failed to load task '${taskId}': ${err.message}`,
    };
  }

  const wp = task.workflow_progress;
  if (wp?.state === 'active') {
    return {
      settled: false,
      reason: 'task-active',
      details: {
        step: wp.current_step,
        attempt: wp.current_attempt,
      },
    };
  }

  // 4. Check dirty tracked changes in owned scope
  const rawDirtyPaths = git.getDirtyPaths(repoRoot).filter(p => !p.startsWith('.nevo-ai-local/') && p !== '.nevo-ai-local');
  const dirtyPaths = expandDirtyPaths(repoRoot, rawDirtyPaths);

  if (dirtyPaths.length > 0) {
    const { allowedPaths } = resolveTaskScope(change, task, { repoRoot, activeDir: resolvedActiveDir });
    const workflowOwnedPaths = resolveWorkflowOwnedPaths({ repoRoot, changeSlug, activeDir: resolvedActiveDir });
    const ownedScope = [
      ...(allowedPaths || []),
      ...(workflowOwnedPaths || []),
    ];

    const inScopeDirty = dirtyPaths.filter(p => ownedScope.some(pat => matchesFilePattern(p, pat)));
    if (inScopeDirty.length > 0) {
      return {
        settled: false,
        reason: 'dirty-in-scope-files',
        dirtyPaths: inScopeDirty,
      };
    }
  }

  return { settled: true };
}
