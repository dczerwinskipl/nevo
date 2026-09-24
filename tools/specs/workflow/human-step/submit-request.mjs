// Durable human-submit operation records (Task 29, D73, D90, D91, D94, D96).
// Persisted at `.nevo-ai-local/human-submit-operations/<change>/<task>/<step>/attempt-<n>.json`.
// <step> is a required path segment, avoiding collisions across multiple human-owned steps.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowError } from '../errors.mjs';

export function getHumanSubmitOperationDir(repoRoot, changeSlug, taskId, step) {
  if (!repoRoot || !changeSlug || !taskId || !step) {
    throw new WorkflowError('getHumanSubmitOperationDir requires repoRoot, changeSlug, taskId, and step');
  }
  return path.join(repoRoot, '.nevo-ai-local', 'human-submit-operations', changeSlug, taskId, step);
}

export function getHumanSubmitOperationFilePath(repoRoot, changeSlug, taskId, step, attempt) {
  if (attempt === undefined || attempt === null) {
    throw new WorkflowError('getHumanSubmitOperationFilePath requires attempt');
  }
  return path.join(getHumanSubmitOperationDir(repoRoot, changeSlug, taskId, step), `attempt-${attempt}.json`);
}

/**
 * Loads a human-submit operation record at the exact durable key regardless of status.
 * Used for duplicate/conflict/terminal classification (D94/D96).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @returns {object|null}
 */
export function loadHumanSubmitOperation(params = {}) {
  const { repoRoot, changeSlug, taskId, step, attempt } = params;
  if (!repoRoot || !changeSlug || !taskId || !step || attempt === undefined) {
    return null;
  }
  const filePath = getHumanSubmitOperationFilePath(repoRoot, changeSlug, taskId, step, attempt);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Finds an in-flight (non-terminal) human-submit operation record.
 * Returns null if absent or terminal (completed / failed).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @returns {object|null}
 */
export function findInFlightHumanSubmitOperation(params = {}) {
  const record = loadHumanSubmitOperation(params);
  if (!record) return null;
  if (record.status === 'completed' || record.status === 'failed') {
    return null;
  }
  return record;
}

/**
 * Creates and persists a durable human-submit operation record.
 * Status defaults to 'pending'.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @param {string} [params.result]
 * @param {string} [params.feedback]
 * @param {object} [params.inputs]
 * @param {string} [params.requestId]
 * @returns {object} The created record
 */
export function createHumanSubmitOperationRecord(params = {}) {
  const {
    repoRoot,
    changeSlug,
    taskId,
    step,
    attempt,
    result,
    feedback,
    inputs = {},
    requestId = randomUUID(),
  } = params;

  if (!repoRoot || !changeSlug || !taskId || !step || attempt === undefined) {
    throw new WorkflowError('createHumanSubmitOperationRecord requires repoRoot, changeSlug, taskId, step, and attempt');
  }

  const dir = getHumanSubmitOperationDir(repoRoot, changeSlug, taskId, step);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const record = {
    changeSlug,
    taskId,
    step,
    attempt,
    result,
    feedback: feedback || '',
    inputs,
    requestId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const targetPath = getHumanSubmitOperationFilePath(repoRoot, changeSlug, taskId, step, attempt);
  const tempPath = path.join(dir, `attempt-${attempt}.${randomUUID()}.tmp`);

  fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
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

  return record;
}

/**
 * Updates the status of a durable human-submit operation record.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.changeSlug
 * @param {string} params.taskId
 * @param {string} params.step
 * @param {number} params.attempt
 * @param {'pending'|'completed'|'failed'|'reconciliation-required'} params.status
 * @param {object} [params.extra]
 * @returns {object} The updated record
 */
export function updateHumanSubmitOperationStatus(params = {}) {
  const { repoRoot, changeSlug, taskId, step, attempt, status, ...extra } = params;
  const record = loadHumanSubmitOperation({ repoRoot, changeSlug, taskId, step, attempt });
  if (!record) {
    throw new WorkflowError(`Human submit operation record not found at ${changeSlug}/${taskId}/${step}/attempt-${attempt}`);
  }

  record.status = status;
  record.updatedAt = new Date().toISOString();
  Object.assign(record, extra);

  const dir = getHumanSubmitOperationDir(repoRoot, changeSlug, taskId, step);
  const targetPath = getHumanSubmitOperationFilePath(repoRoot, changeSlug, taskId, step, attempt);
  const tempPath = path.join(dir, `attempt-${attempt}.${randomUUID()}.tmp`);

  fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
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

  return record;
}
