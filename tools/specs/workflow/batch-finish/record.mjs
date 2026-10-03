// Durable batch-finish operation record (Task 04, D21, D22, D30).
// Persisted at `.nevo-ai-local/batch-finishes/<changeSlug>/<batchExecutionId>.json`.
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from '../errors.mjs';

export function getBatchFinishDir(repoRoot, changeSlug) {
  return path.join(repoRoot, '.nevo-ai-local', 'batch-finishes', changeSlug);
}

export function getBatchFinishRecordPath(repoRoot, changeSlug, batchExecutionId) {
  return path.join(getBatchFinishDir(repoRoot, changeSlug), `${batchExecutionId}.json`);
}

/**
 * Loads a batch-finish operation record from disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @returns {object|null}
 */
export function loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId) {
  if (!repoRoot || !changeSlug || !batchExecutionId) return null;
  const filePath = getBatchFinishRecordPath(repoRoot, changeSlug, batchExecutionId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new WorkflowError(`Failed to load batch-finish record at ${filePath}: ${err.message}`, {
      code: 'BATCH_FINISH_RECORD_LOAD_FAILED',
      cause: err,
    });
  }
}

/**
 * Saves a batch-finish operation record atomically to disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {object} record
 * @returns {object} The persisted record
 */
export function saveBatchFinishRecord(repoRoot, changeSlug, record) {
  if (!repoRoot || !changeSlug || !record?.batchExecutionId) {
    throw new WorkflowError('saveBatchFinishRecord requires repoRoot, changeSlug, and record.batchExecutionId');
  }

  const dir = getBatchFinishDir(repoRoot, changeSlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const targetPath = getBatchFinishRecordPath(repoRoot, changeSlug, record.batchExecutionId);
  const tempPath = path.join(dir, `${record.batchExecutionId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

  const updatedRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  const payload = JSON.stringify(updatedRecord, null, 2);
  fs.writeFileSync(tempPath, payload, 'utf8');

  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EBUSY') {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
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

  return updatedRecord;
}

/**
 * Creates and persists a batch-finish operation record in state 'validated' (D21).
 * Zero durable writes occur prior to prevalidation passing.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {string[]} params.taskIds
 * @param {object} [params.results]
 * @param {string} params.reportPath
 * @param {object} [params.crossTaskFindings]
 * @param {string} [params.sessionId]
 * @returns {object} The created record
 */
export function createBatchFinishRecord(params = {}) {
  const {
    repoRoot,
    changeSlug,
    batchExecutionId,
    taskIds = [],
    results = {},
    reportPath,
    crossTaskFindings = [],
    sessionId = null,
  } = params;

  if (!repoRoot || !changeSlug || !batchExecutionId) {
    throw new WorkflowError('createBatchFinishRecord requires repoRoot, changeSlug, and batchExecutionId');
  }

  const existing = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record = {
    batchExecutionId,
    changeSlug,
    status: 'validated',
    taskIds: [...taskIds],
    sessionId,
    results,
    reportPath,
    crossTaskFindings,
    stages: {
      reportCommit: { status: 'pending' },
      memberFinishes: {},
    },
    createdAt: now,
    updatedAt: now,
  };

  saveBatchFinishRecord(repoRoot, changeSlug, record);
  return record;
}

/**
 * Mutates an existing batch-finish operation record atomically.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @param {Function} updater - Receives record, mutates or returns updated record
 * @returns {object}
 */
export function updateBatchFinishRecord(repoRoot, changeSlug, batchExecutionId, updater) {
  const current = loadBatchFinishRecord(repoRoot, changeSlug, batchExecutionId);
  if (!current) {
    throw new WorkflowError(`Batch-finish record '${batchExecutionId}' not found for change '${changeSlug}'`, {
      code: 'BATCH_FINISH_RECORD_NOT_FOUND',
      batchExecutionId,
      changeSlug,
    });
  }

  const updated = updater(current) || current;
  return saveBatchFinishRecord(repoRoot, changeSlug, updated);
}
