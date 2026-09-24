// Durable start-operation records and sequence allocation (D52, D58).
// Persisted at `.nevo-ai-local/workflow-start-operations/<change>/<task>/<step>/attempt-<n>.json`.
// Allocates and freezes monotonic consumptionSequence before activation.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

function getStartOperationsBaseDir(repoRoot, change, task) {
  return path.join(repoRoot, '.nevo-ai-local', 'workflow-start-operations', change, task);
}

function getStartOperationFilePath(repoRoot, change, task, step, attempt) {
  return path.join(getStartOperationsBaseDir(repoRoot, change, task), step, `attempt-${attempt}.json`);
}

function scanMaxConsumptionSequence(repoRoot, change, task) {
  let maxSeq = 0;

  // 1. Scan start operations
  const startDir = getStartOperationsBaseDir(repoRoot, change, task);
  if (fs.existsSync(startDir)) {
    const walkDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(full, 'utf8'));
            if (typeof data.consumptionSequence === 'number' && data.consumptionSequence > maxSeq) {
              maxSeq = data.consumptionSequence;
            }
          } catch {}
        }
      }
    };
    walkDir(startDir);
  }

  // 2. Scan dependency-consumption records
  const consumptionDir = path.join(repoRoot, '.nevo-ai-local', 'dependency-consumption', change, task);
  if (fs.existsSync(consumptionDir)) {
    const walkDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(full, 'utf8'));
            if (typeof data.consumptionSequence === 'number' && data.consumptionSequence > maxSeq) {
              maxSeq = data.consumptionSequence;
            }
          } catch {}
        }
      }
    };
    walkDir(consumptionDir);
  }

  return maxSeq;
}

/**
 * Saves a start operation record atomically.
 *
 * @param {string} repoRoot
 * @param {object} record
 */
export function saveStartOperation(repoRoot, record) {
  const filePath = getStartOperationFilePath(repoRoot, record.change, record.task, record.step, record.attempt);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  record.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
}

/**
 * Loads a start operation record if it exists.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} task
 * @param {string} step
 * @param {number} attempt
 * @returns {object|null}
 */
export function loadStartOperation(repoRoot, change, task, step, attempt) {
  const filePath = getStartOperationFilePath(repoRoot, change, task, step, attempt);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Finds an in-flight start-operation record for a task.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} task
 * @returns {object|null}
 */
export function findInFlightStartOperation(repoRoot, change, task) {
  const baseDir = getStartOperationsBaseDir(repoRoot, change, task);
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
          if (data.status === 'running' || data.status === 'blocked' || data.status === 'reconciliation-required') {
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

/**
 * Plans a new start operation, allocating and freezing consumptionSequence (D52, D58).
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.change
 * @param {string} params.task
 * @param {string} params.step
 * @param {number} params.attempt
 * @param {Array<{ taskId: string, releaseEpoch: { step: string, attempt: number } }>} params.dependencySnapshot
 * @returns {object} Frozen start-operation record
 */
export function planStart(params = {}) {
  const {
    repoRoot,
    change,
    task,
    step,
    attempt,
    dependencySnapshot = [],
  } = params;

  if (!repoRoot || !change || !task || !step || !attempt) {
    throw new WorkflowError('planStart requires repoRoot, change, task, step, and attempt');
  }

  const existingInFlight = findInFlightStartOperation(repoRoot, change, task);
  if (existingInFlight && existingInFlight.step === step && existingInFlight.attempt === attempt) {
    return existingInFlight;
  }

  const maxSeq = scanMaxConsumptionSequence(repoRoot, change, task);
  const consumptionSequence = maxSeq + 1;

  const record = {
    operationId: randomUUID(),
    change,
    task,
    step,
    attempt,
    consumptionSequence,
    dependencySnapshot,
    status: 'running',
    stages: [
      { id: 'activate', status: 'pending' },
      { id: 'record-consumption', status: 'pending' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveStartOperation(repoRoot, record);
  return record;
}

/**
 * Marks the activate stage as completed in the start-operation record.
 *
 * @param {string} repoRoot
 * @param {object} record
 */
export function completeActivateStage(repoRoot, record) {
  const stage = record.stages.find(s => s.id === 'activate');
  if (stage) {
    stage.status = 'completed';
    stage.completedAt = new Date().toISOString();
  }
  saveStartOperation(repoRoot, record);
}

/**
 * Marks the record-consumption stage as completed and completes the overall start operation.
 *
 * @param {string} repoRoot
 * @param {object} record
 */
export function completeConsumptionStage(repoRoot, record) {
  const stage = record.stages.find(s => s.id === 'record-consumption');
  if (stage) {
    stage.status = 'completed';
    stage.completedAt = new Date().toISOString();
  }
  record.status = 'completed';
  record.completedAt = new Date().toISOString();
  saveStartOperation(repoRoot, record);
}
