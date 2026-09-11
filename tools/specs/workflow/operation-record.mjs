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

function operationFilePath(repoRoot, changeSlug, taskId, stepName) {
  return join(operationsDir(repoRoot, changeSlug, taskId), `${stepName}.json`);
}

export function loadOperationRecord(repoRoot, changeSlug, taskId, stepName) {
  const file = operationFilePath(repoRoot, changeSlug, taskId, stepName);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new WorkflowError(`Failed to read finish-operation record at '${file}': ${err.message}`);
  }
}

export function saveOperationRecord(repoRoot, record) {
  const file = operationFilePath(repoRoot, record.change, record.task, record.step);
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tempFile, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tempFile, file);
}

/**
 * Finds this task's one in-flight (not yet `completed`) operation record, regardless of
 * which step it belongs to (D23). A task can only ever be mid-finish on one step at a
 * time, but which step that is may no longer match a *fresh* `resolveActiveStepName`
 * resolution if `update-task` already set `workflow_progress.state = 'completed'` before
 * the rest of the operation finished (D37; the exact crash window C18 exists to recover
 * from) — position resolution would then say the task has *nothing* active (its step
 * looks done, awaiting the next `step start`), even though `commit`/`push`/`transition`
 * are still outstanding for it. So "the currently active step" and "the step with an
 * in-flight operation" can genuinely differ for one retried call, and only a scan (not a
 * guess) finds the right one.
 *
 * @returns {object|null} The in-flight record, or `null` if none exists
 */
export function findInFlightOperationRecord(repoRoot, changeSlug, taskId) {
  const dir = operationsDir(repoRoot, changeSlug, taskId);
  if (!existsSync(dir)) return null;
  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('.tmp'));
  } catch {
    return null;
  }
  for (const file of files) {
    let record;
    try {
      record = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (record && record.status !== 'completed') return record;
  }
  return null;
}
