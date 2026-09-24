// Durable task queue membership persistence (D38, Task 28).
// Persisted at `.nevo-ai-local/task-queues/<changeSlug>.json`.
// Pure domain storage: zero AI/session/dashboard awareness.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowError } from '../errors.mjs';

export function getQueueDir(repoRoot) {
  return path.join(repoRoot, '.nevo-ai-local', 'task-queues');
}

export function getQueueFilePath(repoRoot, changeSlug) {
  return path.join(getQueueDir(repoRoot), `${changeSlug}.json`);
}

/**
 * Loads the durable queue record for a change.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @returns {{ changeSlug: string, taskIds: string[], eligibleAt: Record<string, number>, updatedAt: string, metadata?: object } | null}
 */
export function loadTaskQueue(repoRoot, changeSlug) {
  if (!repoRoot || !changeSlug) {
    throw new WorkflowError('loadTaskQueue requires repoRoot and changeSlug');
  }
  const filePath = getQueueFilePath(repoRoot, changeSlug);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new WorkflowError(`Failed to load task queue from ${filePath}: ${err.message}`, {
      code: 'TASK_QUEUE_LOAD_FAILED',
      cause: err,
    });
  }
}

/**
 * Saves the durable queue record for a change atomically.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string[]|object} taskIdsOrRecord
 * @param {object} [options]
 * @returns {object} The persisted queue record
 */
export function saveTaskQueue(repoRoot, changeSlug, taskIdsOrRecord, options = {}) {
  if (!repoRoot || !changeSlug) {
    throw new WorkflowError('saveTaskQueue requires repoRoot and changeSlug');
  }

  const dir = getQueueDir(repoRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let taskIds = [];
  let eligibleAt = {};
  let metadata = {};

  if (Array.isArray(taskIdsOrRecord)) {
    taskIds = [...taskIdsOrRecord];
    eligibleAt = options.eligibleAt || {};
    metadata = options.metadata || {};
  } else if (taskIdsOrRecord && typeof taskIdsOrRecord === 'object') {
    taskIds = Array.isArray(taskIdsOrRecord.taskIds) ? [...taskIdsOrRecord.taskIds] : [];
    eligibleAt = taskIdsOrRecord.eligibleAt || options.eligibleAt || {};
    metadata = taskIdsOrRecord.metadata || options.metadata || {};
  }

  const now = Date.now();
  for (const id of taskIds) {
    if (eligibleAt[id] === undefined) {
      eligibleAt[id] = now;
    }
  }

  const record = {
    changeSlug,
    taskIds,
    eligibleAt,
    metadata,
    updatedAt: new Date(now).toISOString(),
  };

  const targetPath = getQueueFilePath(repoRoot, changeSlug);
  const tempPath = path.join(dir, `${changeSlug}.${randomUUID()}.tmp`);

  fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    // Windows atomic replacement fallback
    if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EBUSY') {
      try {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);
      } catch (retryErr) {
        try { fs.unlinkSync(tempPath); } catch {}
        throw retryErr;
      }
    } else {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  return record;
}

/**
 * Appends task IDs to a change's queue (deduplicating, preserving order).
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string[]|string} taskIds
 * @param {object} [options]
 * @returns {object} The updated queue record
 */
export function enqueueTasks(repoRoot, changeSlug, taskIds, options = {}) {
  const current = loadTaskQueue(repoRoot, changeSlug) || {
    changeSlug,
    taskIds: [],
    eligibleAt: {},
    metadata: {},
  };

  const toAdd = Array.isArray(taskIds) ? taskIds : [taskIds];
  const existingSet = new Set(current.taskIds);
  const now = options.eligibleAt || Date.now();

  for (const id of toAdd) {
    if (!id || typeof id !== 'string') continue;
    if (!existingSet.has(id)) {
      current.taskIds.push(id);
      existingSet.add(id);
      current.eligibleAt[id] = now;
    }
  }

  return saveTaskQueue(repoRoot, changeSlug, current);
}

/**
 * Removes a task ID from the queue.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} taskId
 * @returns {object} The updated queue record
 */
export function dequeueTask(repoRoot, changeSlug, taskId) {
  const current = loadTaskQueue(repoRoot, changeSlug);
  if (!current) {
    return { changeSlug, taskIds: [], eligibleAt: {}, updatedAt: new Date().toISOString() };
  }

  current.taskIds = current.taskIds.filter(id => id !== taskId);
  delete current.eligibleAt[taskId];

  return saveTaskQueue(repoRoot, changeSlug, current);
}

/**
 * Clears/deletes the queue for a change.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @returns {boolean} True if cleared
 */
export function clearTaskQueue(repoRoot, changeSlug) {
  const filePath = getQueueFilePath(repoRoot, changeSlug);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Lists all active queue records across specs.
 *
 * @param {string} repoRoot
 * @returns {object[]}
 */
export function listTaskQueues(repoRoot) {
  const dir = getQueueDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const records = [];
  for (const ent of entries) {
    if (ent.isFile() && ent.name.endsWith('.json') && !ent.name.includes('.tmp')) {
      try {
        const raw = fs.readFileSync(path.join(dir, ent.name), 'utf8');
        records.push(JSON.parse(raw));
      } catch {}
    }
  }
  return records;
}
