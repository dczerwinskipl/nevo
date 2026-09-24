// Dependency-consumption provenance and sequence-based authoritative matching (D52, D53, D58).
// Persisted at `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json`.

import fs from 'node:fs';
import path from 'node:path';
import { WorkflowError } from './errors.mjs';

function getConsumptionBaseDir(repoRoot, change, task) {
  return path.join(repoRoot, '.nevo-ai-local', 'dependency-consumption', change, task);
}

function getConsumptionFilePath(repoRoot, change, task, step, attempt) {
  return path.join(getConsumptionBaseDir(repoRoot, change, task), step, `attempt-${attempt}.json`);
}

/**
 * Records dependency consumption for a step attempt.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.change
 * @param {string} params.consumingTaskId
 * @param {string} params.consumingStep
 * @param {number} params.consumingAttempt
 * @param {number} params.consumptionSequence
 * @param {Array<{ taskId: string, releaseEpoch: { step: string, attempt: number } }>} params.dependencies
 * @returns {object} The recorded consumption entry
 */
export function recordDependencyConsumption(params = {}) {
  const {
    repoRoot,
    change,
    consumingTaskId,
    consumingStep,
    consumingAttempt,
    consumptionSequence,
    dependencies = [],
  } = params;

  if (!repoRoot || !change || !consumingTaskId || !consumingStep || !consumingAttempt || typeof consumptionSequence !== 'number') {
    throw new WorkflowError('recordDependencyConsumption requires repoRoot, change, consumingTaskId, consumingStep, consumingAttempt, and consumptionSequence');
  }

  const filePath = getConsumptionFilePath(repoRoot, change, consumingTaskId, consumingStep, consumingAttempt);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const record = {
    consumingTaskId,
    consumingStep,
    consumingAttempt,
    consumptionSequence,
    dependencies,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/**
 * Loads a dependency consumption record if it exists.
 *
 * @param {string} repoRoot
 * @param {string} change
 * @param {string} task
 * @param {string} step
 * @param {number} attempt
 * @returns {object|null}
 */
export function loadDependencyConsumption(repoRoot, change, task, step, attempt) {
  const filePath = getConsumptionFilePath(repoRoot, change, task, step, attempt);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Sequence-based authoritative matching of epoch consumers (D58).
 * For each task that consumed dependencyTaskId, resolves its record with the highest consumptionSequence
 * and checks if that authoritative record consumed the specified releaseEpoch.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {string} params.change
 * @param {string} params.dependencyTaskId
 * @param {{ step: string, attempt: number }} params.releaseEpoch
 * @returns {Array<{ taskId: string, consumingTaskId: string, consumingStep: string, consumingAttempt: number, consumptionSequence: number, record: object }>}
 */
export function findConsumersOfEpoch(params = {}) {
  const {
    repoRoot,
    change,
    dependencyTaskId,
    releaseEpoch,
  } = params;

  if (!repoRoot || !change || !dependencyTaskId || !releaseEpoch) {
    return [];
  }

  const changeDir = path.join(repoRoot, '.nevo-ai-local', 'dependency-consumption', change);
  if (!fs.existsSync(changeDir)) return [];

  const allRecords = [];
  const walkDir = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          allRecords.push(data);
        } catch {}
      }
    }
  };

  walkDir(changeDir);

  // Group records by consumingTaskId
  const recordsByTask = new Map();
  for (const rec of allRecords) {
    const list = recordsByTask.get(rec.consumingTaskId) || [];
    list.push(rec);
    recordsByTask.set(rec.consumingTaskId, list);
  }

  const matchingConsumers = [];

  for (const [taskId, records] of recordsByTask.entries()) {
    // Filter records naming dependencyTaskId
    const namingDep = records.filter(r =>
      Array.isArray(r.dependencies) && r.dependencies.some(d => d.taskId === dependencyTaskId)
    );
    if (namingDep.length === 0) continue;

    // D58: Authoritative record is the one with highest consumptionSequence
    namingDep.sort((a, b) => (b.consumptionSequence || 0) - (a.consumptionSequence || 0));
    const authRecord = namingDep[0];

    // Check if authoritative record consumed this exact release epoch
    const depEntry = authRecord.dependencies.find(d => d.taskId === dependencyTaskId);
    if (!depEntry?.releaseEpoch) continue;

    if (
      depEntry.releaseEpoch.step === releaseEpoch.step &&
      depEntry.releaseEpoch.attempt === releaseEpoch.attempt
    ) {
      matchingConsumers.push({
        taskId,
        consumingTaskId: taskId,
        consumingStep: authRecord.consumingStep,
        consumingAttempt: authRecord.consumingAttempt,
        consumptionSequence: authRecord.consumptionSequence,
        record: authRecord,
      });
    }
  }

  return matchingConsumers;
}
