import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readUtf8, writeUtf8 } from '../../lib/fs.mjs';
import {
  isTaskReady,
  DEPENDENCY_SATISFYING_STATUSES,
  hardStopReason,
} from '../lifecycle-primitives.mjs';
import { pathMatchesAllowedPattern } from './recovery.mjs';

// ── Batch execution and gating review (D10, D11, D19, D20, D24, D28, task 08) ─

export const BATCH_SELECTION_MODES = new Set([
  'currently-ready', 'all-approved-reachable', 'named-subset', 'until-checkpoint',
]);

// Kahn-style deterministic topological order over `depends_on` (a subset of
// `change.tasks`, already validated cycle-free by validateSpecs) — stable
// (input order preserved among tasks with no ordering constraint between
// them) since `visit` walks `tasks` in the order given.
function topoOrder(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set();
  const order = [];
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of byId.get(id)?.depends_on || []) {
      if (byId.has(dep)) visit(dep);
    }
    order.push(id);
  }
  for (const t of tasks) visit(t.id);
  return order;
}

// A candidate is excluded from an automatic (non-named-subset) selection when
// it carries its own unresolved owner-decision suspension — "blocked by ...
// an unresolved owner decision" (requirement 1). Confirm-required/automatic
// suspensions don't block selection; only owner-decision does, since that's
// the one kind the controller can never resolve on its own.
function blockedByOwnerDecision(task) {
  return task.execution?.suspension?.kind === 'owner-decision';
}

/**
 * Batch selection (D20) — a single function dispatching on `mode`, never four
 * independent code paths. Returns `{ ok: true, orderedTasks: [id, ...] }` or
 * `{ ok: false, reason }`. Pure: takes `change` as already loaded; ordering
 * follows the existing `depends_on`/`next` logic (a deterministic topological
 * sort), same as everywhere else in this codebase.
 */
export function selectBatch(mode, change, { taskIds } = {}) {
  if (!BATCH_SELECTION_MODES.has(mode)) {
    return { ok: false, reason: `Unknown batch selection mode '${mode}' — must be one of ${[...BATCH_SELECTION_MODES].join('/')}` };
  }

  if (mode === 'currently-ready') {
    const ready = change.tasks.filter(t => isTaskReady(t, change) && !blockedByOwnerDecision(t));
    return { ok: true, orderedTasks: topoOrder(ready) };
  }

  if (mode === 'named-subset') {
    if (!taskIds || !taskIds.length) return { ok: false, reason: 'named-subset requires at least one task id' };
    const unknown = taskIds.filter(id => !change.tasks.some(t => t.id === id));
    if (unknown.length) return { ok: false, reason: `Unknown task id(s): ${unknown.join(', ')}` };

    const selected = new Set(taskIds);
    const missingPrereqs = [];
    for (const id of taskIds) {
      const task = change.tasks.find(t => t.id === id);
      for (const dep of task.depends_on || []) {
        const depTask = change.tasks.find(t => t.id === dep);
        const satisfied = depTask && DEPENDENCY_SATISFYING_STATUSES.has(depTask.status);
        if (!satisfied && !selected.has(dep)) missingPrereqs.push(`'${id}' needs '${dep}'`);
      }
    }
    if (missingPrereqs.length) {
      return { ok: false, reason: `named-subset is missing required prerequisite(s): ${missingPrereqs.join('; ')}` };
    }
    return { ok: true, orderedTasks: topoOrder(change.tasks.filter(t => selected.has(t.id))) };
  }

  // all-approved-reachable / until-checkpoint: every approved task whose
  // *entire* dependency chain resolves — already terminal, or also reachable
  // — computed as a fixpoint so a multi-hop chain (A -> B -> C, all approved)
  // is fully included, not just the first `next`-ready task (requirement 1's
  // whole reason this mode exists). `until-checkpoint` selects the same
  // reachable set; its checkpoint only bounds *execution*, not selection —
  // the caller stops walking `orderedTasks` at the named checkpoint.
  const approved = change.tasks.filter(t => t.status === 'approved' && !blockedByOwnerDecision(t));
  const approvedIds = new Set(approved.map(t => t.id));
  const reachable = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of approvedIds) {
      if (reachable.has(id)) continue;
      const task = change.tasks.find(t => t.id === id);
      const depsOk = (task.depends_on || []).every(dep => {
        const depTask = change.tasks.find(t => t.id === dep);
        return depTask && (DEPENDENCY_SATISFYING_STATUSES.has(depTask.status) || reachable.has(dep));
      });
      if (depsOk) { reachable.add(id); grew = true; }
    }
  }
  return { ok: true, orderedTasks: topoOrder(change.tasks.filter(t => reachable.has(t.id))) };
}

/**
 * Pure validation for D20's `until-checkpoint` mode's `--checkpoint`
 * argument (PR re-review packet 04) — no filesystem/CLI-parsing concerns,
 * called by `handleBatchStart` after `selectBatch` has already computed
 * `orderedTasks`. `taskStatus` is the checkpoint task id's current `status`
 * in `change.yaml`, or `undefined` when no task with that id exists in the
 * change at all (an unknown checkpoint). Returns `{ ok: true }` or
 * `{ ok: false, reason }`.
 */
export function validateBatchCheckpoint(mode, checkpointId, orderedTasks, taskStatus) {
  if (mode !== 'until-checkpoint') {
    if (checkpointId) return { ok: false, reason: "--checkpoint is only valid with mode 'until-checkpoint'." };
    return { ok: true };
  }
  if (!checkpointId) return { ok: false, reason: "mode 'until-checkpoint' requires --checkpoint <task-id>." };
  if (taskStatus === undefined) return { ok: false, reason: `Checkpoint task '${checkpointId}' does not exist.` };
  if (!orderedTasks.includes(checkpointId)) {
    return {
      ok: false,
      reason: `Checkpoint task '${checkpointId}' is not part of the selected batch (${orderedTasks.join(', ')}).`,
    };
  }
  if (DEPENDENCY_SATISFYING_STATUSES.has(taskStatus)) {
    return {
      ok: false,
      reason: `Checkpoint task '${checkpointId}' already has status '${taskStatus}' — the checkpoint is already passed.`,
    };
  }
  return { ok: true };
}

/**
 * Batch progress, derived — never a second persisted copy (D10). `intent` is
 * the persisted batch-intent file's parsed content (`{ orderedTasks, ... }`
 * only — no progress fields). Reconstructs `completed`/`current`/`next`/
 * `failed` purely from each `orderedTasks` entry's current `status` and
 * `execution.suspension`/`self_check` in `change.yaml` — safe to call after
 * an interruption between writes, since there is nothing else to reconcile.
 *
 * `checkpointReached` (D20's `until-checkpoint` mode, PR re-review packet
 * 04): true once `intent.checkpointPolicy` names a task that is itself
 * terminal. Deliberately does **not** null out `current`/`next` — the
 * checkpoint only bounds *execution* (whether continuation is offered),
 * never *selection* (`orderedTasks` already holds the full reachable set,
 * same as `all-approved-reachable` — D20's own wording), and
 * `handleBatchReview` still needs a real `current` to correctly refuse
 * running the gating review while unstarted tasks remain beyond the
 * checkpoint. The caller offering continuation (`/nevo-ai:task-review`'s
 * step 9a0) is what must stop at this boundary instead of auto-continuing
 * into `current`.
 */
export function deriveBatchProgress(change, intent) {
  const completed = [];
  let current = null;
  let failed = null;

  for (const id of intent.orderedTasks) {
    const task = change.tasks.find(t => t.id === id);
    if (!task) continue;
    if (DEPENDENCY_SATISFYING_STATUSES.has(task.status)) { completed.push(id); continue; }
    if (current === null) {
      current = id;
      if (task.self_check?.status === 'failed' || task.execution?.suspension) failed = id;
    }
  }

  const currentIdx = current ? intent.orderedTasks.indexOf(current) : -1;
  const next = currentIdx >= 0 && currentIdx + 1 < intent.orderedTasks.length ? intent.orderedTasks[currentIdx + 1] : null;

  const checkpointTask = intent.checkpointPolicy || null;
  const checkpointReached = Boolean(checkpointTask) && completed.includes(checkpointTask);

  return { completed, current, next, failed, checkpointTask, checkpointReached };
}

// Every evidence-based full-review risk signal (D11, corrected by D24 to
// exclude the self-check outcome — that's hardStopReason's job instead).
export const RISK_SIGNALS = new Set([
  'declared-review-required', 'public-api-impact', 'security-impact', 'migration-impact',
  'owner-decision-criterion', 'scope-expansion', 'missing-automated-verification',
  'unexpected-files', 'implementation-divergence', 'owner-flagged-high-risk', 'inspection-only-evidence',
]);

/**
 * The structurally-detectable subset of D11's risk signals — `taskFm` is the
 * task file's own front matter, `diffFiles` the files this task's diff
 * actually touched (I/O, gathered by the caller). Signals that need semantic
 * judgment rather than structure (public-API impact, security impact,
 * migration/destructive-persistence behavior, implementation divergence) are
 * never guessed at here — a caller (the owner, or a self-check/review step)
 * asserts them explicitly via `extraSignals`, merged in unchanged. Touching
 * `src/**`/`tests/**`/`consequential_paths` alone is deliberately not a
 * signal (requirement, area doc) — only what's listed below is.
 */
export function detectRiskSignals(task, taskFm, { diffFiles = [], extraSignals = [] } = {}) {
  const signals = new Set();

  if (taskFm?.review === 'required') signals.add('declared-review-required');
  if (taskFm?.high_risk === true) signals.add('owner-flagged-high-risk');
  if (task.execution?.suspension?.code === 'REC-08') signals.add('scope-expansion');

  const allowed = [...(taskFm?.allowed_paths || []), ...(taskFm?.consequential_paths || [])];
  if (diffFiles.some(f => !allowed.some(p => pathMatchesAllowedPattern(f, p)))) {
    signals.add('unexpected-files');
  }

  for (const signal of extraSignals) {
    if (RISK_SIGNALS.has(signal)) signals.add(signal);
  }

  return [...signals];
}

/**
 * Whether this task needs its own full `task-review` before the batch can
 * complete it (requirement, D24): self-check must have already passed (no
 * hard stop) **and**, only then, at least one risk signal holds. A hard stop
 * always pre-empts this — it is never offered a full review as an
 * alternative path (D24's whole point).
 */
export function requiresFullReview(task, signals) {
  if (hardStopReason(task)) return false;
  return (signals || []).length > 0;
}

/**
 * Build the `self_check` block this task 08 is the sole writer of (D28) —
 * `commandResults` is `[{ command, exit_code }]` for every command the
 * task's own "## Verification" section names, already run by the caller.
 * `fingerprint`/`revision` are the task's *current* semantic fingerprint
 * (`computeTaskFingerprint`) and git revision at the moment the check ran —
 * exactly what `deriveStage`'s self-check-freshness comparison reads back.
 */
export function buildSelfCheckResult({ commandResults, fingerprint, revision }) {
  const failed = commandResults.filter(r => r.exit_code !== 0);
  const base = { fingerprint, revision, commands: commandResults };
  if (failed.length) {
    return { ...base, status: 'failed', failed_criteria: failed.map(r => r.command) };
  }
  return { ...base, status: 'passed' };
}

function touchedPathsOverlap(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * D-declared temporary-inconsistency pair (unchanged from the original
 * draft): two named tasks a batch declares up front are allowed to leave
 * `validate`/`check` failing *between* their two implementations (e.g. task A
 * introduces a schema task B is meant to complete) without that counting as a
 * batch-blocking failure. Symmetric — declaration order doesn't matter.
 */
export function isTemporaryInconsistency(intent, taskA, taskB) {
  return (intent.temporaryInconsistencies || []).some(
    pair => (pair[0] === taskA && pair[1] === taskB) || (pair[0] === taskB && pair[1] === taskA)
  );
}

/**
 * Whether a `validate`/`check` failure blocks batch progress right now
 * (requirement: enforced at every boundary except the one declared pair).
 * `hasValidationErrors` is the already-run `validate`/`check` result
 * (I/O, gathered by the caller) — this function only applies the exemption.
 */
export function batchValidationBlocks(intent, justCompletedTaskId, aboutToStartTaskId, hasValidationErrors) {
  if (!hasValidationErrors) return false;
  if (justCompletedTaskId && aboutToStartTaskId && isTemporaryInconsistency(intent, justCompletedTaskId, aboutToStartTaskId)) {
    return false;
  }
  return true;
}

/**
 * Evidence-freshness check (D19, self-check layer's comparison is D28) — run
 * immediately before the gating batch review, never folded silently into it.
 * For each already-self-checked task in `orderedTaskIds`, stale exactly when
 * either: (a) its *current* semantic fingerprint no longer matches what
 * `self_check` recorded (D28 — stale regardless of file overlap), or (b) a
 * later-batched task's touched paths overlap its own (requirement (1)) and
 * the pair isn't a declared temporary inconsistency (which only exempts
 * `validate`/`check`, not evidence staleness, from area doc: evidence that
 * cannot be refreshed is itself a hard stop, never a caveat the review
 * proceeds past). `taskTouchedPaths` is `{[taskId]: string[]}`,
 * `currentFingerprints` is `{[taskId]: string}` — both I/O, gathered by the
 * caller. Returns the list of task ids whose self-check must rerun before the
 * gating review may proceed.
 */
export function staleEvidenceTasks(change, orderedTaskIds, taskTouchedPaths, currentFingerprints) {
  const stale = [];
  for (let i = 0; i < orderedTaskIds.length; i++) {
    const id = orderedTaskIds[i];
    const task = change.tasks.find(t => t.id === id);
    if (!task?.self_check) continue;

    const currentFp = currentFingerprints[id];
    if (currentFp && task.self_check.fingerprint !== currentFp) {
      stale.push(id);
      continue;
    }

    const ownPaths = taskTouchedPaths[id] || [];
    const overlapsLaterTask = orderedTaskIds.slice(i + 1).some(laterId => {
      const laterPaths = taskTouchedPaths[laterId] || [];
      return laterPaths.some(lp => ownPaths.some(op => touchedPathsOverlap(op, lp)));
    });
    if (overlapsLaterTask) stale.push(id);
  }
  return stale;
}

/**
 * Attribute a whole-batch diff's changed files to the batched tasks whose
 * own declared paths (`allowed_paths` + `consequential_paths`, already
 * merged by the caller) match them (D19, gating batch review — PR re-review
 * packet 03) — real diff data, never the empty map `handleBatchReview` used
 * to pass in place of it. `taskDeclaredPaths` is `{[taskId]: string[]}`,
 * gathered by the caller (I/O — reads each task's own file). A file matching
 * more than one task's declared paths is attributed to *every* matching
 * task: the ambiguous-shared-file case is resolved by inclusion, not by
 * picking one arbitrary "real" owner — `staleEvidenceTasks` and
 * `detectBatchIntegrationFindings` below only care whether two tasks'
 * touched-path sets intersect, not which one alone owns a file. A changed
 * file matching no batched task's declared paths is simply attributed to
 * none of them (real, but not this review's evidence-staleness/integration
 * concern — e.g. a repository-wide generated index neither task declared).
 */
export function attributeTouchedPaths(orderedTaskIds, taskDeclaredPaths, changedFiles) {
  const result = {};
  for (const id of orderedTaskIds) {
    const patterns = taskDeclaredPaths[id] || [];
    result[id] = changedFiles.filter(f => patterns.some(p => pathMatchesAllowedPattern(f, p)));
  }
  return result;
}

/**
 * Deterministic whole-batch structural findings (D19/D24, gating batch
 * review Phase 3 — PR re-review packet 03) — computed here, never composed
 * as review prose, same convention as `computeBatchReviewVerdict` itself.
 * Currently detects one real, structural signal: two different batched
 * tasks whose attributed touched-paths (`attributeTouchedPaths`) share an
 * actually-changed file — real diff overlap, not merely overlapping
 * declared-path *patterns* (two tasks can validly declare adjacent paths
 * without ever touching the same file). A pair the batch already declared a
 * temporary inconsistency for (`isTemporaryInconsistency`) is skipped — that
 * overlap is already owner-sanctioned, not a fresh finding. `touchedPaths`
 * is `{[taskId]: string[]}`.
 */
export function detectBatchIntegrationFindings(intent, orderedTaskIds, touchedPaths) {
  const findings = [];
  for (let i = 0; i < orderedTaskIds.length; i++) {
    for (let j = i + 1; j < orderedTaskIds.length; j++) {
      const a = orderedTaskIds[i];
      const b = orderedTaskIds[j];
      if (isTemporaryInconsistency(intent, a, b)) continue;
      const aPaths = new Set(touchedPaths[a] || []);
      const shared = (touchedPaths[b] || []).filter(p => aPaths.has(p));
      if (shared.length) {
        findings.push({
          category: 'integration', tasks: [a, b], taskIds: [a, b], paths: shared,
          summary: `Tasks '${a}' and '${b}' both touched: ${shared.join(', ')}`,
        });
      }
    }
  }
  return findings;
}

export const BATCH_REVIEW_VERDICTS = new Set(['no-findings', 'changes-recommended', 'owner-decision-required']);

/**
 * Gating batch review verdict (requirement) — computed from an explicit
 * table, never composed as prose, same convention as
 * `spec-review`/`task-review`'s own decision tables. Never re-evaluates any
 * individual batched task's own acceptance criteria — `ownerDecisionFindings`/
 * `otherFindings` are whole-batch findings only (cross-task integration, open
 * blocking `follow-ups.yaml` entries), gathered by the caller.
 */
export function computeBatchReviewVerdict({ ownerDecisionFindings = 0, otherFindings = 0 } = {}) {
  if (ownerDecisionFindings > 0) return 'owner-decision-required';
  if (otherFindings > 0) return 'changes-recommended';
  return 'no-findings';
}

// ── Batch intent persistence ───────────────────────────────────────────────

export function batchIntentFile(change) {
  return join(change._dir, 'batch.json');
}

/** Load a change's active batch intent, or `null` if none is in progress. */
export function loadBatchIntent(change) {
  const file = batchIntentFile(change);
  if (!existsSync(file)) return null;
  const raw = readUtf8(file);
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

/** Persist a new batch's intent. */
export function writeBatchIntent(change, intent) {
  writeUtf8(batchIntentFile(change), JSON.stringify(intent, null, 2));
}

/** Clear a change's batch intent file once the batch is done (or abandoned). */
export function clearBatchIntent(change) {
  const file = batchIntentFile(change);
  if (existsSync(file)) writeUtf8(file, '');
}

