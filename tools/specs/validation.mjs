// Structural validation for specs/active and specs/archive change manifests.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWithinBase, readUtf8 } from '../lib/fs.mjs';
import { parseFrontMatterFile, parseYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import {
  listChanges, ACTIVE_DIR, ARCHIVE_DIR, parseOwnerDecisions, parseConstraints,
  pathGlobsOverlap, FOLLOW_UP_STATUSES, FOLLOW_UP_SEVERITIES,
} from './service.mjs';
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

/**
 * D13: `context_exceptions: [{omitted, decision, reason}]` — every entry's
 * `decision` must resolve to a real entry in the change's own
 * `owner-decisions.md`; an unresolvable reference is a `validate` error
 * naming the offending path (AC1).
 */
export function validateContextExceptions(fm, decisionsMap, errors, label) {
  for (const entry of fm.context_exceptions || []) {
    if (!entry.decision || !decisionsMap.has(entry.decision)) {
      errors.push(`${label}: context_exceptions entry for '${entry.omitted}' has an unresolvable decision '${entry.decision}'`);
    }
  }
}

/**
 * `consequential_paths` must never overlap `forbidden_paths` — a
 * `consequential_paths` write is not flagged as a scope violation by
 * `task-review`, so an overlap would silently let a task touch what its own
 * `forbidden_paths` say it can't (AC3).
 */
export function validateConsequentialPaths(fm, errors, label) {
  const consequential = fm.consequential_paths || [];
  const forbidden = fm.forbidden_paths || [];
  for (const c of consequential) {
    for (const f of forbidden) {
      if (pathGlobsOverlap(c, f)) {
        errors.push(`${label}: consequential_paths '${c}' overlaps forbidden_paths '${f}'`);
      }
    }
  }
}

/**
 * Whether a follow-up's `resolver_task` resolves to a real task id — either
 * in this change (`task-id`) or an explicitly named other change
 * (`change-id/task-id`, D15 "an explicitly named change"). `null` is always
 * valid (the field is nullable).
 */
function resolverTaskResolves(ref, change, allChanges) {
  if (!ref) return true;
  if (ref.includes('/')) {
    const [changeId, taskId] = ref.split('/');
    const target = allChanges.find(c => c.id === changeId);
    return Boolean(target && target.tasks.some(t => t.id === taskId));
  }
  return change.tasks.some(t => t.id === ref);
}

/**
 * Dismissing a `blocking` entry requires a recorded owner decision, referenced
 * from `resolution` by its `D<n>` id (the same convention `semantic_references`
 * uses to point at `owner-decisions.md`) — a `non-blocking` entry needs no such
 * reference to be dismissed.
 */
function dismissalHasRecordedDecision(entry, decisionsMap) {
  const ref = String(entry.resolution || '').match(/\bD\d+\b/)?.[0];
  return Boolean(ref && decisionsMap.has(ref));
}

/**
 * D15/D22: validate one change's mutable `follow-ups.yaml` ledger — malformed
 * content (invalid YAML, missing required field, an unrecognized `status`/
 * `severity`) fails with a specific reason (AC9); a stale `resolver_task` is
 * detected (AC6); dismissing a `blocking` entry without a recorded owner
 * decision is rejected (AC5). Does not require the file to exist at all — an
 * absent ledger is not an error, just an empty one.
 */
export function validateFollowUps(change, decisionsMap, allChanges, errors) {
  const file = join(change._dir, 'follow-ups.yaml');
  if (!existsSync(file)) return;

  let parsed;
  try {
    parsed = parseYamlFile(file);
  } catch (err) {
    errors.push(err instanceof CliError ? err.message : `${file}: ${err.message}`);
    return;
  }

  const list = parsed?.follow_ups;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(`${file}: 'follow_ups' must be a list`);
    return;
  }

  const ids = new Set();
  for (const entry of list) {
    const label = `${file}: entry '${entry?.id ?? '?'}'`;
    if (!entry?.id) { errors.push(`${file}: entry missing 'id'`); continue; }
    if (ids.has(entry.id)) { errors.push(`${label}: duplicate id`); continue; }
    ids.add(entry.id);

    if (!entry.source_task) errors.push(`${label}: missing 'source_task'`);
    if (!entry.kind) errors.push(`${label}: missing 'kind'`);
    if (!entry.reason) errors.push(`${label}: missing 'reason'`);
    if (!FOLLOW_UP_SEVERITIES.has(entry.severity)) {
      errors.push(`${label}: severity must be one of ${[...FOLLOW_UP_SEVERITIES].join('/')}, got '${entry.severity}'`);
    }
    if (!FOLLOW_UP_STATUSES.has(entry.status)) {
      errors.push(`${label}: status must be one of ${[...FOLLOW_UP_STATUSES].join('/')}, got '${entry.status}'`);
    }
    if ((entry.status === 'resolved' || entry.status === 'dismissed') && !entry.resolution) {
      errors.push(`${label}: status '${entry.status}' requires a 'resolution'`);
    }
    if (!resolverTaskResolves(entry.resolver_task, change, allChanges)) {
      errors.push(`${label}: resolver_task '${entry.resolver_task}' does not resolve to a real task id`);
    }
    if (entry.status === 'dismissed' && entry.severity === 'blocking' && !dismissalHasRecordedDecision(entry, decisionsMap)) {
      errors.push(`${label}: dismissing a blocking entry requires 'resolution' to reference a recorded owner decision (e.g. 'D12: ...')`);
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
            validateContextExceptions(fm, decisionsMap, errors, label);
            validateConsequentialPaths(fm, errors, label);
          }
        } catch (err) {
          const reason = err instanceof CliError ? err.message : String(err);
          errors.push(`${change._file}: task '${task.id}' has an unsafe file path: ${reason}`);
        }
      }
    }

    validateFollowUps(change, decisionsMap, changes, errors);

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
