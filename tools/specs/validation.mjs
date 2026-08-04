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

// ── Mechanical task type — review-exempt deterministic approval (D14, task 07) ─

function loadTaskFmAndBody(change, task) {
  if (!task?.file) return null;
  try {
    const file = resolveWithinBase(change._dir, task.file);
    if (!existsSync(file)) return null;
    const raw = readUtf8(file);
    const fm = parseFrontMatterFile(file);
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return { fm, body };
  } catch {
    return null;
  }
}

/**
 * Parse the "## Acceptance criteria" section's numbered items into an array
 * of item text (continuation lines folded in) — used only to check for the
 * per-criterion `automated:`/`inspection:`/`owner-decision:` tag (D14
 * condition 6), not as a general Markdown parser. `null` if the section
 * can't be found at all.
 */
function parseAcceptanceCriteriaItems(body) {
  const match = body.match(/##\s*Acceptance criteria\s*\r?\n([\s\S]*?)(\r?\n##\s|\r?\n?$)/i);
  if (!match) return null;
  const items = [];
  let current = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const m = rawLine.match(/^\s*\d+[a-z]?\.\s+(.*)$/);
    if (m) {
      if (current !== null) items.push(current);
      current = m[1];
    } else if (current !== null && rawLine.trim() !== '') {
      current += ` ${rawLine.trim()}`;
    }
  }
  if (current !== null) items.push(current);
  return items;
}

/**
 * D14's six conjunctive conditions for `type: mechanical`'s review-exemption
 * — never a score/majority check, every condition must hold. Pure over
 * already-loaded data: `deriveFm` is the `derived_from` task's own front
 * matter, or `null` if it doesn't resolve to a real, loadable task.
 * `failedConditions` is empty exactly when `eligible` is true.
 */
export function inspectMechanicalConditions(fm, body, change, deriveFm) {
  const failed = [];
  const derivedFromId = fm.mechanical?.derived_from;
  const derivedFromTask = derivedFromId ? change.tasks.find(t => t.id === derivedFromId) : null;

  if (!derivedFromTask) {
    failed.push(`derived_from ('${derivedFromId ?? 'missing'}') must name a real task in this change`);
  } else if (derivedFromTask.status === 'draft') {
    failed.push(`derived_from task '${derivedFromId}' must already be approved (or later), not 'draft'`);
  }

  if (fm.mechanical?.deterministic !== true) failed.push("mechanical.deterministic must be explicitly 'true'");
  if (fm.mechanical?.no_public_behavior_change !== true) failed.push("mechanical.no_public_behavior_change must be explicitly 'true'");
  if (fm.mechanical?.no_new_design_decision !== true) failed.push("mechanical.no_new_design_decision must be explicitly 'true'");

  if (derivedFromTask) {
    if (!deriveFm) {
      failed.push(`could not load derived_from task '${derivedFromId}' to check its own declared paths`);
    } else {
      const derivedAllowed = new Set([...(deriveFm.allowed_paths || []), ...(deriveFm.consequential_paths || [])]);
      const ownPaths = [...(fm.allowed_paths || []), ...(fm.consequential_paths || [])];
      const outside = ownPaths.filter(p => !derivedAllowed.has(p));
      if (outside.length) {
        failed.push(`allowed_paths/consequential_paths not already declared on derived_from task '${derivedFromId}': ${outside.join(', ')}`);
      }
    }
  }

  const items = parseAcceptanceCriteriaItems(body);
  if (!items || !items.length) {
    failed.push('acceptance criteria could not be parsed to verify per-criterion automated: tags');
  } else {
    items.forEach((text, i) => {
      if (/\bowner-decision:/i.test(text)) {
        failed.push(`acceptance criterion ${i + 1} carries an owner-decision: tag — not allowed for type: mechanical`);
      } else if (/\binspection:/i.test(text)) {
        failed.push(`acceptance criterion ${i + 1} carries an inspection: tag — not allowed for type: mechanical`);
      } else if (!/\bautomated:/i.test(text)) {
        failed.push(`acceptance criterion ${i + 1} is missing an automated: tag`);
      }
    });
  }

  return { eligible: failed.length === 0, failedConditions: failed };
}

/**
 * I/O + the pure check above, combined: loads `task`'s own file and (if
 * declared) its `mechanical.derived_from` task's file, then evaluates the six
 * D14 conditions. `eligible` is always `false` when the task isn't declared
 * `type: mechanical` at all — nothing to exempt. The one function both
 * `validateSpecs` (hard `validate` error, AC2) and `tools/specs.mjs`'s
 * `handleApprove` (the actual exemption decision, AC1) call — never a
 * parallel re-implementation of the six conditions in either caller.
 */
export function computeMechanicalExemption(change, task) {
  const own = loadTaskFmAndBody(change, task);
  if (!own || own.fm.type !== 'mechanical') return { eligible: false, failedConditions: [] };

  const derivedFromId = own.fm.mechanical?.derived_from;
  const derivedFromTask = derivedFromId ? change.tasks.find(t => t.id === derivedFromId) : null;
  const derived = derivedFromTask ? loadTaskFmAndBody(change, derivedFromTask) : null;

  return inspectMechanicalConditions(own.fm, own.body, change, derived?.fm ?? null);
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

            if (fm.type !== undefined && fm.type !== 'mechanical') {
              errors.push(`${label}: unrecognized type '${fm.type}' (only 'mechanical' is defined)`);
            }
            if (fm.type === 'mechanical') {
              const { eligible, failedConditions } = computeMechanicalExemption(change, task);
              if (!eligible) {
                errors.push(`${label}: type: mechanical conditions failed — ${failedConditions.join('; ')}`);
              }
            }
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
