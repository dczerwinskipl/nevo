import { pathMatchesAllowedPattern } from './recovery.mjs';
import { updateYamlFile } from '../../lib/yaml.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

// ── Implementation provenance & changed path attribution (D34/D35, task 15) ─

/**
 * Narrows a raw changed-file list (e.g. `git.getChangedFiles`'s output) down
 * to paths actually attributable to this task's own declared scope
 * (D34/D35, area implementation-provenance-and-attribution, task 15) —
 * deliberately narrower than "everything that changed since baseline," which
 * would also catch a later, unrelated task's own edit to a file this task
 * never declared. Reuses `pathMatchesAllowedPattern`, same matcher
 * `classifyDirtyWorktree` already uses for the equivalent recovery-time
 * classification.
 */
export function computeTaskAttributedChangedPaths(changedFiles, allowedPaths) {
  const patterns = allowedPaths || [];
  const attributed = changedFiles.filter(f => patterns.some(p => pathMatchesAllowedPattern(f, p)));
  return [...new Set(attributed)].sort();
}

/**
 * Unions a task's already-persisted `changed_paths` with a freshly-attributed
 * increment — the write self-check's `--incremental` mode uses (area
 * spec-detail-and-workflow-feature-slice review fix) so a later self-check re-run
 * *extends* a task's own evidence with what changed since its own last
 * `review_revision`, rather than re-deriving the full since-`baseline_revision` range
 * every time (which re-absorbs any sibling task's entire unrelated work that happens
 * to also match this task's declared `allowed_paths`, once that sibling's own commits
 * land inside the range). Pure set union — order-independent, deduplicated, sorted.
 */
export function mergeAttributedChangedPaths(existingPaths, newlyAttributedPaths) {
  return [...new Set([...(existingPaths || []), ...(newlyAttributedPaths || [])])].sort();
}

/**
 * Detects a real provenance overlap (D34/D35, task 15, AC7/AC9) — this
 * task's freshly-recomputed `attributedPaths` (from the current self-check
 * re-run) shares a file with another task's own already-persisted
 * `implementation.changed_paths`. Surfaces the same class of signal
 * `staleEvidenceTasks`/`detectBatchIntegrationFindings` already detect at
 * batch-review time, but at the single-self-check granularity, so a shared
 * file's cross-attribution is visible the moment it happens, not only when a
 * later gating batch review runs. Deliberately data-only (persisted
 * `implementation.changed_paths`, never a fresh git/HEAD comparison) — same
 * "no global HEAD-equality check" constraint D33/AC9 already established for
 * `describeSelfCheck`/`staleEvidenceTasks`, extended here to the new
 * provenance fields. `tasks` is a change's full `tasks` array; `taskId` is
 * the task whose self-check just ran.
 */
export function detectProvenanceOverlap(tasks, taskId, attributedPaths) {
  const overlaps = [];
  for (const other of tasks || []) {
    if (other.id === taskId) continue;
    const otherPaths = other.implementation?.changed_paths || [];
    const shared = (attributedPaths || []).filter(p => otherPaths.includes(p));
    if (shared.length) overlaps.push({ taskId: other.id, paths: shared });
  }
  return overlaps;
}

/**
 * Decides the `baseline_revision` to persist for `implementation` (area
 * implementation-provenance-and-attribution requirement 3) — recorded once,
 * on the task's first successful transition into `in-implementation`, never
 * overwritten by a later idempotent/`safe_to_retry` `start`. `existing` is
 * the task's current `implementation` block (or `undefined`); `revision` is
 * the current git revision this call would record if nothing was set yet.
 */
export function nextImplementationBaseline(existing, revision) {
  return existing?.baseline_revision || revision;
}

/**
 * Parses/validates `apply-provenance`'s input into a normalized list of
 * `{ taskId, baseline, reviewRevision, changedPaths }` mappings — pure, no
 * repository I/O, so `handleApplyProvenance` (tools/specs.mjs) can write
 * from it without the parsing/validation logic itself being repository-bound.
 * Owner correction (seventh refinement pass, area requirement 8): several
 * proposed legacy provenance reconstructions may be confirmed in one owner
 * action via `--mappings` (a JSON array), all resolved together under the
 * caller's one `--confirm` — never one prompt per task. A single task id with
 * `baseline`/`changedPaths` options keeps the original single-task shape.
 * `reviewRevision` is optional in both shapes — when omitted, callers fall
 * back to `baseline` (the original legacy-task reconstruction behavior,
 * where a task has never actually been reviewed past its own baseline).
 * When supplied, it lets a correction preserve a task's real, already-reviewed
 * revision instead of resetting `review_revision` back to `baseline_revision`
 * — the case where a task's `changed_paths` need correcting (e.g. sibling-task
 * contamination) but the task genuinely was reviewed at a later revision.
 * Throws a plain `Error` on invalid input — the caller wraps it as needed.
 */
export function resolveProvenanceMappings(taskIdOrList, options = {}) {
  const taskIds = String(taskIdOrList ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!taskIds.length) throw new Error('apply-provenance requires at least one task id.');

  if (options.mappings) {
    let parsed;
    try {
      parsed = JSON.parse(options.mappings);
    } catch {
      throw new Error('apply-provenance --mappings must be valid JSON: an array of {task, baseline, reviewRevision, changedPaths}.');
    }
    if (!Array.isArray(parsed) || !parsed.length) {
      throw new Error('apply-provenance --mappings must be a non-empty JSON array.');
    }
    return parsed.map(entry => {
      if (!entry.task || !entry.baseline) {
        throw new Error('Each --mappings entry requires "task" and "baseline".');
      }
      return {
        taskId: entry.task,
        baseline: entry.baseline,
        reviewRevision: entry.reviewRevision || entry.baseline,
        changedPaths: Array.isArray(entry.changedPaths) ? entry.changedPaths : [],
      };
    });
  }

  if (taskIds.length > 1) {
    throw new Error('apply-provenance for more than one task requires --mappings (one JSON array, confirmed together under this single --confirm) — --baseline/--changed-paths only cover a single task.');
  }
  if (!options.baseline) throw new Error('apply-provenance requires --baseline <revision>.');
  return [{
    taskId: taskIds[0],
    baseline: options.baseline,
    reviewRevision: options.reviewRevision || options.baseline,
    changedPaths: options.changedPaths ? options.changedPaths.split(',').map(s => s.trim()).filter(Boolean) : [],
  }];
}

// ── Unowned-drift correction (D34/D35, task 19) ─────────────────────────────

export const UNOWNED_DRIFT_CLASSIFICATIONS = new Set(['owned', 'forbidden', 'unowned-drift']);

/**
 * Classifies a path a review/implementation touched that falls outside the
 * task currently under review/implementation's own scope (area
 * unowned-drift-correction requirement 1) — 'forbidden' when it matches any
 * task's `forbidden_paths` (never eligible for the lightweight
 * maintenance-correction option, requirement 5, mirrors task 13's own
 * `forbidden_paths` exclusion); 'owned' when it's inside some task's
 * `allowed_paths`/`consequential_paths`, or attributed to the task currently
 * under review via `currentTaskChangedPaths` (e.g. that task's own persisted
 * `implementation.changed_paths`, task 15); 'unowned-drift' otherwise —
 * outside every task's declared scope and not attributable to the current
 * task's own diff. `taskPaths` is `{[taskId]: { allowedPaths: string[],
 * consequentialPaths: string[], forbiddenPaths: string[] }}`.
 */
export function classifyUnownedDrift(path, taskPaths, { currentTaskChangedPaths = [] } = {}) {
  const entries = Object.values(taskPaths || {});
  if (entries.some(p => (p.forbiddenPaths || []).some(pat => pathMatchesAllowedPattern(path, pat)))) {
    return 'forbidden';
  }
  if (currentTaskChangedPaths.includes(path)) return 'owned';
  if (entries.some(p => [...(p.allowedPaths || []), ...(p.consequentialPaths || [])].some(pat => pathMatchesAllowedPattern(path, pat)))) {
    return 'owned';
  }
  return 'unowned-drift';
}

/** The three-option owner menu for a classified `unowned-drift` path (area requirement 2) — 'maintenance-correction' is never offered for a 'forbidden' classification. */
export const UNOWNED_DRIFT_OPTIONS = ['create-corrective-task', 'amend-existing-task', 'maintenance-correction'];

/**
 * Validates a `kind: maintenance-correction` follow-up entry's own required
 * fields (area requirement 3), beyond what `validateFollowUps`
 * (`tools/specs/validation.mjs`) already checks for every follow-up entry
 * (`id`/`source_task`/`kind`/`reason`/`severity`/`status`/`resolver_task`):
 * exact `paths` (never a glob — a blanket path defeats the whole point of a
 * narrow, auditable correction), the `reason`, explicit owner confirmation
 * (`confirmed_by: owner`), `confirmed_at`, and the `revision` that performed
 * the correction. Returns `{ ok: true }` or `{ ok: false, missing }`.
 */
export function validateMaintenanceCorrectionEntry(entry) {
  const missing = [];
  if (!Array.isArray(entry?.paths) || entry.paths.length === 0) missing.push('paths');
  else if (entry.paths.some(p => typeof p !== 'string' || p.includes('*'))) missing.push('paths (no globs allowed — one exact path per entry)');
  if (!entry?.reason) missing.push('reason');
  if (entry?.confirmed_by !== 'owner') missing.push('confirmed_by');
  if (!entry?.confirmed_at) missing.push('confirmed_at');
  if (!entry?.revision) missing.push('revision');
  return missing.length ? { ok: false, missing } : { ok: true };
}

// ── Implementation provenance & self-check persistence ─────────────────────

/** Write `task`'s `implementation` provenance block — overwrites any prior value. */
export function writeImplementationProvenance(change, taskId, implementation) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('implementation', implementation);
  });
}

/** Write `task`'s `self_check` block — overwrites any prior value. */
export function writeSelfCheck(change, taskId, selfCheck) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('self_check', selfCheck);
  });
}

