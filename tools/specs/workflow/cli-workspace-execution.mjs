// Durable tracking of cli-manual workspace executions (D85).
// Dependency-consumption-independent home for cli-manual workspaceOwnerId.
// Persisted at `.nevo-ai-local/cli-workspace-executions/<change>/<task>/<step>/attempt-<n>.json`.

import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

function getExecutionBaseDir(repoRoot, change, taskId) {
  return path.join(repoRoot, '.nevo-ai-local', 'cli-workspace-executions', change, taskId);
}

function getExecutionFilePath(repoRoot, change, taskId, step, attempt) {
  return path.join(getExecutionBaseDir(repoRoot, change, taskId), step, `attempt-${attempt}.json`);
}

/**
 * Records a new cli-manual workspace execution attempt.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.change
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @param {string} params.workspaceOwnerId
 * @returns {object} The recorded execution entry
 */
export function recordCliWorkspaceExecution(params = {}) {
  const {
    repoRoot,
    change,
    taskId,
    step,
    attempt,
    workspaceOwnerId,
  } = params;

  if (!repoRoot || !change || !taskId || !step || !attempt || !workspaceOwnerId) {
    throw new WorkflowError('recordCliWorkspaceExecution requires repoRoot, change, taskId, step, attempt, and workspaceOwnerId');
  }

  const filePath = getExecutionFilePath(repoRoot, change, taskId, step, attempt);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const record = {
    change,
    taskId,
    step,
    attempt,
    workspaceOwnerId,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/**
 * Loads a cli-manual workspace execution record.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} taskId
 * @param {string} step
 * @param {number} attempt
 * @returns {object|null}
 */
export function loadCliWorkspaceExecution(repoRoot, change, taskId, step, attempt) {
  const filePath = getExecutionFilePath(repoRoot, change, taskId, step, attempt);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Updates the status of a cli-manual workspace execution ('completed' | 'failed').
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} taskId
 * @param {string} step
 * @param {number} attempt
 * @param {'active'|'completed'|'failed'} status
 * @returns {object|null}
 */
export function updateCliWorkspaceExecutionStatus(repoRoot, change, taskId, step, attempt, status) {
  const filePath = getExecutionFilePath(repoRoot, change, taskId, step, attempt);
  try {
    if (!fs.existsSync(filePath)) return null;
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    record.status = status;
    record.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    return record;
  } catch {
    return null;
  }
}

/**
 * Finds an in-flight cli-manual execution record for a task.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} taskId
 * @returns {object|null}
 */
export function findInFlightCliWorkspaceExecution(repoRoot, change, taskId) {
  const baseDir = getExecutionBaseDir(repoRoot, change, taskId);
  if (!fs.existsSync(baseDir)) return null;

  let inFlight = null;
  const walkDir = (dir) => {
    if (inFlight) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (inFlight) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (data.status === 'active') {
            inFlight = data;
            return;
          }
        } catch {}
      }
    }
  };

  walkDir(baseDir);
  return inFlight;
}
