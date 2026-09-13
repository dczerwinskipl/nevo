// Durable finish-operation record persistence/query (D14/D23) — the on-disk
// `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json` convention (git-ignored
// local runtime directory, atomic temp-file-then-rename writes, following the pattern
// already established by `tools/dashboard/server/ai/sessions/binding-service.mjs`).
//
// Extracted out of `finish-operation.mjs` (D37 correction) so `step-context.mjs`'s
// `step start` activation guard — which must check whether a just-completed step's own
// finish operation has actually settled before activating the next step — can read
// these records without importing `finish-operation.mjs` and creating a cycle
// (`finish-operation.mjs` already imports from `step-context.mjs`). `finish-operation.mjs`
// re-exports these same functions so every existing import path is unaffected.

import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { WorkflowError } from './errors.mjs';

function operationsDir(repoRoot, changeSlug, taskId) {
  return join(repoRoot, '.nevo-ai-local', 'workflow-operations', changeSlug, taskId);
}

export function operationFilePath(repoRoot, changeSlug, taskId, stepName, attempt) {
  if (!stepName || !attempt) {
    throw new WorkflowError(`operationFilePath requires stepName and attempt (got stepName: '${stepName}', attempt: '${attempt}')`);
  }
  return join(operationsDir(repoRoot, changeSlug, taskId), stepName, `attempt-${attempt}.json`);
}

export function loadOperationRecord(repoRoot, changeSlug, taskId, stepName, attempt) {
  const file = operationFilePath(repoRoot, changeSlug, taskId, stepName, attempt);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new WorkflowError(`Failed to read finish-operation record at '${file}': ${err.message}`);
  }
}

export function saveOperationRecord(repoRoot, record) {
  if (!record || !record.step || !record.attempt) {
    throw new WorkflowError(`saveOperationRecord requires record.step and record.attempt to be set`);
  }
  const file = operationFilePath(repoRoot, record.change, record.task, record.step, record.attempt);
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tempFile, file);
}

function findJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('.tmp')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Finds this task's one in-flight (not yet `completed`) operation record, regardless of
 * which step or attempt it belongs to (D23/C8). A task can only ever be mid-finish on one
 * step/attempt at a time.
 *
 * Invariant: At most one in-flight operation per task.
 * - 0 uncompleted records -> returns null.
 * - Exactly 1 uncompleted record -> returns that in-flight record for resumption.
 * - >= 2 uncompleted records -> fails closed immediately, throwing WorkflowError
 *   (code: 'MULTIPLE_IN_FLIGHT_OPERATIONS').
 *
 * @returns {object|null} The in-flight record, or `null` if none exists
 */
export function findInFlightOperationRecord(repoRoot, changeSlug, taskId) {
  const dir = operationsDir(repoRoot, changeSlug, taskId);
  if (!existsSync(dir)) return null;
  const jsonFiles = findJsonFiles(dir);
  const uncompleted = [];
  for (const file of jsonFiles) {
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (record && record.status !== 'completed') {
      uncompleted.push({ record, file });
    }
  }
  if (uncompleted.length === 0) return null;
  if (uncompleted.length === 1) return uncompleted[0].record;

  const paths = uncompleted.map(u => u.file).join(', ');
  const ids = uncompleted.map(u => u.record.operationId || 'unknown').join(', ');
  throw new WorkflowError(
    `Multiple in-flight finish operations found for task '${taskId}' (${uncompleted.length} found: [${ids}] at [${paths}]). Cannot safely resume.`,
    { code: 'MULTIPLE_IN_FLIGHT_OPERATIONS', change: changeSlug, task: taskId, count: uncompleted.length }
  );
}
