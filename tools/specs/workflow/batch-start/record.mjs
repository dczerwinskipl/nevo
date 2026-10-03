// Durable batch-start operation record (Task 03, D28, D38).
// Persisted at `.nevo-ai-local/batch-start/<changeSlug>/<batchExecutionId>.json`.
// Pure workflow domain logic: zero dashboard imports.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowError } from '../errors.mjs';

export function getBatchStartDir(repoRoot, changeSlug) {
  return path.join(repoRoot, '.nevo-ai-local', 'batch-start', changeSlug);
}

export function getBatchStartRecordPath(repoRoot, changeSlug, batchExecutionId) {
  return path.join(getBatchStartDir(repoRoot, changeSlug), `${batchExecutionId}.json`);
}

/**
 * Loads a batch-start operation record from disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @returns {object|null}
 */
export function loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId) {
  if (!repoRoot || !changeSlug || !batchExecutionId) return null;
  const filePath = getBatchStartRecordPath(repoRoot, changeSlug, batchExecutionId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new WorkflowError(`Failed to load batch-start record at ${filePath}: ${err.message}`, {
      code: 'BATCH_START_RECORD_LOAD_FAILED',
      cause: err,
    });
  }
}

/**
 * Saves a batch-start operation record atomically to disk.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {object} record
 * @returns {object} The persisted record
 */
export function saveBatchStartRecord(repoRoot, changeSlug, record) {
  if (!repoRoot || !changeSlug || !record?.batchExecutionId) {
    throw new WorkflowError('saveBatchStartRecord requires repoRoot, changeSlug, and record.batchExecutionId');
  }

  const dir = getBatchStartDir(repoRoot, changeSlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const targetPath = getBatchStartRecordPath(repoRoot, changeSlug, record.batchExecutionId);
  const tempPath = path.join(dir, `${record.batchExecutionId}.${randomUUID()}.tmp`);

  const updatedRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(tempPath, JSON.stringify(updatedRecord, null, 2), 'utf8');
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
 * Creates and persists a fresh batch-start operation record before any member activation (D28, D38).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.batchExecutionId
 * @param {object} params.executionScope
 * @param {string} [params.sessionId]
 * @param {object} [params.executionConfigSnapshot]
 * @param {object} [params.preflight]
 * @param {object} [params.memberStages]
 * @param {object} [params.workspaceBaseline]
 * @returns {object} The created record
 */
export function createBatchStartRecord(params = {}) {
  const {
    repoRoot,
    changeSlug,
    batchExecutionId,
    executionScope,
    sessionId = null,
    executionConfigSnapshot = {},
    preflight = {},
    memberStages = {},
    workspaceBaseline = null,
  } = params;

  if (!repoRoot || !changeSlug || !batchExecutionId) {
    throw new WorkflowError('createBatchStartRecord requires repoRoot, changeSlug, and batchExecutionId');
  }

  const existing = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record = {
    batchExecutionId,
    changeSlug,
    executionScope,
    sessionId,
    status: 'running',
    executionConfigSnapshot,
    preflight,
    memberStages,
    workspaceBaseline,
    createdAt: now,
    updatedAt: now,
  };

  return saveBatchStartRecord(repoRoot, changeSlug, record);
}

/**
 * Mutates an existing batch-start operation record atomically.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @param {Function} updater - Receives record, mutates or returns updated record
 * @returns {object}
 */
export function updateBatchStartRecord(repoRoot, changeSlug, batchExecutionId, updater) {
  const current = loadBatchStartRecord(repoRoot, changeSlug, batchExecutionId);
  if (!current) {
    throw new WorkflowError(`Batch-start record '${batchExecutionId}' not found for change '${changeSlug}'`, {
      code: 'BATCH_START_RECORD_NOT_FOUND',
      batchExecutionId,
      changeSlug,
    });
  }

  const updated = updater(current) || current;
  return saveBatchStartRecord(repoRoot, changeSlug, updated);
}

/**
 * Finds an in-flight batch-start operation record for a change if one exists.
 *
 * @param {string} repoRoot
 * @param {string} changeSlug
 * @returns {object|null}
 */
export function findInFlightBatchStartRecord(repoRoot, changeSlug) {
  if (!repoRoot || !changeSlug) return null;
  const dir = getBatchStartDir(repoRoot, changeSlug);
  if (!fs.existsSync(dir)) return null;

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.tmp'));
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.status === 'running' || parsed.status === 'pending') {
          return parsed;
        }
      } catch {}
    }
  } catch {}

  return null;
}
