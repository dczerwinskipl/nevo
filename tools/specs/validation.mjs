// Structural validation for specs/active and specs/archive change manifests.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWithinBase, readUtf8 } from '../lib/fs.mjs';
import { parseFrontMatterFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { listChanges, ACTIVE_DIR, ARCHIVE_DIR, parseOwnerDecisions, parseConstraints } from './service.mjs';
import { TASK_STATUSES, CHANGE_STATUSES, REMOVED_STATUSES, removedStatusMessage } from './lifecycle.mjs';

const SUSPENSION_KINDS = new Set(['automatic', 'confirm-required', 'owner-decision', 'unsafe-manual']);

export function validateStatusValue(value, allowed, errors, label) {
  if (value === undefined) return;
  if (REMOVED_STATUSES.has(value)) {
    errors.push(`${label}: ${removedStatusMessage(value)}`);
  } else if (!allowed.has(value)) {
    errors.push(`${label}: invalid status '${value}'`);
  }
}

export function validateSuspension(task, errors, label) {
  const suspension = task.execution?.suspension;
  if (!suspension) return;
  if (!SUSPENSION_KINDS.has(suspension.kind)) {
    errors.push(`${label}: execution.suspension.kind must be one of ${[...SUSPENSION_KINDS].join('/')}, got '${suspension.kind}'`);
  }
  if (typeof suspension.code !== 'string' || !suspension.code) {
    errors.push(`${label}: execution.suspension.code must be a non-empty string`);
  }
}

export function validateSelfCheck(task, errors, label) {
  const selfCheck = task.self_check;
  if (!selfCheck) return;
  if (selfCheck.status !== 'failed' && selfCheck.status !== 'passed') {
    errors.push(`${label}: self_check.status must be 'failed' or 'passed', got '${selfCheck.status}'`);
  }
  if (selfCheck.failed_criteria !== undefined && selfCheck.status !== 'failed') {
    errors.push(`${label}: self_check.failed_criteria is only valid when status is 'failed'`);
  }
  (selfCheck.commands || []).forEach((cmd, i) => {
    if (typeof cmd.command !== 'string' || !cmd.command) {
      errors.push(`${label}: self_check.commands[${i}].command must be a non-empty string`);
    }
    if (!Number.isInteger(cmd.exit_code)) {
      errors.push(`${label}: self_check.commands[${i}].exit_code must be an integer`);
    }
  });
}

/** Follow a decision's `supersededBy` chain to the id a reference to it should use instead. */
function resolveSupersedingId(decisionsMap, id, seen = new Set()) {
  const entry = decisionsMap.get(id);
  if (!entry || !entry.supersededBy || seen.has(id)) return id;
  seen.add(id);
  return resolveSupersedingId(decisionsMap, entry.supersededBy, seen);
}

export function validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, label) {
  const sr = fm.semantic_references;
  if (!sr) return;

  for (const dc of sr.dependency_contracts || []) {
    if (!(task.depends_on || []).includes(dc)) {
      errors.push(`${label}: semantic_references.dependency_contracts entry '${dc}' is not in this task's own depends_on`);
    }
  }
  for (const id of sr.decisions || []) {
    const entry = decisionsMap.get(id);
    if (!entry) {
      errors.push(`${label}: semantic_references.decisions entry '${id}' does not resolve in owner-decisions.md`);
    } else if (entry.supersededBy) {
      const replacement = resolveSupersedingId(decisionsMap, id);
      errors.push(`${label}: semantic_references.decisions entry '${id}' is superseded — reference '${replacement}' instead`);
    }
  }
  for (const id of sr.constraints || []) {
    if (!constraintsMap.has(id)) {
      errors.push(`${label}: semantic_references.constraints entry '${id}' does not resolve in overview.md's Constraints section`);
    }
  }
}

export function validateSpecs() {
  const errors = [];
  const changes = [...listChanges(ACTIVE_DIR), ...listChanges(ARCHIVE_DIR)];
  const changeIds = new Map();

  for (const change of changes) {
    if (!change.id) {
      errors.push(`${change._file}: missing 'id'`);
    } else if (changeIds.has(change.id)) {
      errors.push(`${change._file}: duplicate change id '${change.id}' (also in ${changeIds.get(change.id)})`);
    } else {
      changeIds.set(change.id, change._file);
    }
    if (!change.title) errors.push(`${change._file}: missing 'title'`);
    if (!change.status) errors.push(`${change._file}: missing 'status'`);
    validateStatusValue(change.status, CHANGE_STATUSES, errors, `${change._file}: change.status`);

    const decisionsMap = parseOwnerDecisions(
      existsSync(join(change._dir, 'owner-decisions.md')) ? readUtf8(join(change._dir, 'owner-decisions.md')) : ''
    );
    const constraintsMap = parseConstraints(
      existsSync(join(change._dir, 'overview.md')) ? readUtf8(join(change._dir, 'overview.md')) : ''
    );

    const ids = new Set();
    for (const task of change.tasks) {
      if (!task.id) { errors.push(`${change._file}: task missing 'id'`); continue; }
      if (ids.has(task.id)) errors.push(`${change._file}: duplicate task id '${task.id}'`);
      ids.add(task.id);

      const label = `${change._file}: task '${task.id}'`;
      validateStatusValue(task.status, TASK_STATUSES, errors, `${label}.status`);
      validateSuspension(task, errors, label);
      validateSelfCheck(task, errors, label);

      for (const dep of task.depends_on || []) {
        if (!ids.has(dep) && !change.tasks.find(t => t.id === dep)) {
          errors.push(`${change._file}: task '${task.id}' depends_on unknown task '${dep}'`);
        }
      }

      if (task.file) {
        try {
          const taskFile = resolveWithinBase(change._dir, task.file);
          if (!existsSync(taskFile)) {
            errors.push(`${change._file}: task '${task.id}' file not found: ${task.file}`);
          } else {
            const fm = parseFrontMatterFile(taskFile);
            validateSemanticReferences(task, fm, decisionsMap, constraintsMap, errors, label);
          }
        } catch (err) {
          const reason = err instanceof CliError ? err.message : String(err);
          errors.push(`${change._file}: task '${task.id}' has an unsafe file path: ${reason}`);
        }
      }
    }

    // Cycle detection: DFS with path tracking (handles diamond deps correctly)
    const safelyExplored = new Set();
    const dfs = (id, path) => {
      if (path.has(id)) { errors.push(`${change._file}: dependency cycle involving '${id}'`); return; }
      if (safelyExplored.has(id)) return;
      path.add(id);
      const t = change.tasks.find(t => t.id === id);
      for (const d of t?.depends_on || []) dfs(d, path);
      path.delete(id);
      safelyExplored.add(id);
    };
    for (const task of change.tasks) dfs(task.id, new Set());
  }

  return errors;
}
