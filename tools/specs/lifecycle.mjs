// Task and change status rules for tools/specs.mjs — no Commander, no
// filesystem access. See docs/ai/specification-workflow.md and
// references/review-policy.md for the policy this enforces.

// Separate status sets for separate concepts — a task being "done" for
// dependency purposes is not the same question as a change being active.
export const TERMINAL_STATUSES = new Set(['implemented', 'verified', 'archived', 'abandoned']);
// `abandoned` is terminal (finalize doesn't wait on it) but must not satisfy a
// dependent's depends_on — a dependent cannot build on work that was dropped.
export const DEPENDENCY_SATISFYING_STATUSES = new Set(['implemented', 'verified', 'archived']);
export const READY_STATUSES = new Set(['approved']);
export const ACTIVE_CHANGE_STATUSES = new Set(['approved', 'in-implementation', 'draft']);

// `blocked`/`needs-decision` are removed from the vocabulary entirely (D16) —
// `execution.suspension` is now the only supported temporary-blocker model, at
// both task and change level. This is the single enum both levels validate
// against (validation.mjs); no new status names are introduced (C7).
export const TASK_STATUSES = new Set([
  'draft', 'approved', 'in-implementation', 'implemented', 'verified', 'abandoned', 'archived',
]);
export const CHANGE_STATUSES = new Set([
  'draft', 'approved', 'in-implementation', 'implemented', 'verified', 'abandoned', 'archived',
]);
export const REMOVED_STATUSES = new Set(['blocked', 'needs-decision']);

/** The fixed migration message D16 requires for a removed status value. */
export function removedStatusMessage(value) {
  return `Status \`${value}\` is no longer supported. Use \`execution.suspension\`.`;
}

export function depsSatisfied(task, change) {
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = change.tasks.find(t => t.id === depId);
    return Boolean(dep) && DEPENDENCY_SATISFYING_STATUSES.has(dep.status);
  });
}

export function isTaskReady(task, change) {
  return READY_STATUSES.has(task.status) && depsSatisfied(task, change);
}

// ── Task lifecycle state machine ───────────────────────────────────────────
//
// The one place task status transitions are defined. Every command that
// changes a task's status validates against this table instead of assigning
// an arbitrary status.

export const TRANSITIONS = {
  approve: { from: 'draft', to: 'approved' },
  start: { from: 'approved', to: 'in-implementation' },
  complete: { from: 'in-implementation', to: 'implemented' },
  verify: { from: 'implemented', to: 'verified' },
};

/**
 * Validate a status transition for `command` against the task's current
 * status. Returns `{ ok: true, idempotent: boolean }` on success —
 * `idempotent: true` means the task is already at the target status, which
 * is treated as a safe no-op (re-running a command should not be an error),
 * never as license to skip a transition's own gate checks the first time it
 * actually runs. Returns `{ ok: false, reason }` for any other status.
 */
export function validateTransition(command, currentStatus) {
  const rule = TRANSITIONS[command];
  if (!rule) throw new Error(`Unknown transition command '${command}'`);
  if (currentStatus === rule.to) return { ok: true, idempotent: true };
  if (currentStatus !== rule.from) {
    return {
      ok: false,
      reason: `Task has status '${currentStatus}' — '${command}' requires status '${rule.from}'.`,
    };
  }
  return { ok: true, idempotent: false };
}

/**
 * Pure approval-gate check: given a task's current status, its change's review
 * front matter (or null if no review file exists), and the freshly-computed
 * current spec fingerprint, decide whether `approve` may proceed. Does not
 * touch the filesystem — see handleApprove in tools/specs.mjs for the I/O
 * around this.
 *
 * `mechanicalExempt` (D14, task 07 — "review-exempt deterministic approval"):
 * when true, skips only the review/verdict/fingerprint checks below — the
 * `draft`→`approved` transition check above still applies unchanged, and the
 * caller still performs the same explicit `approve` write either way. The
 * caller (`tools/specs/validation.mjs`'s `computeMechanicalExemption`)
 * already re-verified all six D14 conditions before setting this, since
 * `validateApproval` itself stays filesystem-free.
 *
 * Returns `{ ok: true, idempotent: boolean }` or `{ ok: false, reason }`.
 */
export function validateApproval(
  taskStatus, review, currentFingerprint,
  { mechanicalExempt = false, taskId = null, currentTaskFingerprint = null } = {}
) {
  const transition = validateTransition('approve', taskStatus);
  if (!transition.ok) return transition;
  if (transition.idempotent) return transition;

  if (mechanicalExempt) return { ok: true, idempotent: false };

  if (!review) {
    return {
      ok: false,
      reason: 'No review found. A specification review must exist before a task can be approved.',
    };
  }
  if (review.verdict !== 'ready-for-approval') {
    return { ok: false, reason: `Review verdict is '${review.verdict}', not 'ready-for-approval'. Cannot approve.` };
  }

  const unresolvedFixes = Number(review.unresolved_required_fixes ?? 0);
  const unresolvedDecisions = Number(review.unresolved_owner_decisions ?? 0);
  const unresolvedClarifications = Number(review.unresolved_needs_clarification ?? 0);
  if (unresolvedFixes > 0 || unresolvedDecisions > 0 || unresolvedClarifications > 0) {
    return {
      ok: false,
      reason: `Review has unresolved items (required fixes: ${unresolvedFixes}, ` +
        `owner decisions: ${unresolvedDecisions}, needs clarification: ${unresolvedClarifications}). ` +
        `Cannot approve.`,
    };
  }

  if (!review.spec_fingerprint) {
    return {
      ok: false,
      code: 'missing-fingerprint',
      reason: `Review is missing 'spec_fingerprint' front matter — it predates this check. ` +
        `Re-run the review before approving.`,
    };
  }
  if (review.spec_fingerprint !== currentFingerprint) {
    return {
      ok: false,
      // Recovery classification (REC-07 STALE_REVIEW_AFTER_SEMANTIC_CHANGE) —
      // handleApprove checks this code, not the message text, to decide whether
      // to raise a classified RecoveryError.
      code: 'stale-fingerprint',
      reason: `Review is stale: its spec_fingerprint (${review.spec_fingerprint}) does not match ` +
        `the current specification state (${currentFingerprint}). Re-run the review before approving.`,
    };
  }

  // Task-level fingerprint (PR re-review packet 01): change_fingerprint
  // deliberately excludes each task's own body/acceptance-criteria/context
  // (D7 — otherwise any task edit would invalidate every other task's
  // approval readiness). But a spec review's own "Semantic-reference
  // completeness" step reads exactly that per-task content, so the reviewed
  // task's own body changing after review must invalidate *this* task's
  // approval even though it never touches change_fingerprint. Only checked
  // when the caller passes `taskId` (handleApprove always does) — a review
  // predating this check, or one that reviewed a different task set, is
  // reported by name rather than silently skipped.
  if (taskId) {
    const recorded = review.task_fingerprints?.[taskId];
    if (!recorded) {
      return {
        ok: false,
        code: 'missing-task-fingerprint',
        reason: `Review is missing a task_fingerprints entry for '${taskId}' — it predates this check, or reviewed ` +
          `a different task set. Re-run the review before approving.`,
      };
    }
    if (recorded !== currentTaskFingerprint) {
      return {
        ok: false,
        code: 'stale-task-fingerprint',
        reason: `Review is stale for task '${taskId}': its recorded task_fingerprints entry (${recorded}) does not ` +
          `match the task's current content (${currentTaskFingerprint}). Re-run the review before approving.`,
      };
    }
  }

  return { ok: true, idempotent: false };
}

// ── Postcondition-based recovery (D8, D17, area recovery-and-resume) ───────
//
// Five result-class values cover every postcondition-inspection outcome for a
// state-changing controller action. "Idempotent" keeps its narrower,
// pre-existing validateTransition meaning ("already at the target status") —
// it is one specific case of `completed`, not a synonym for this vocabulary.
export const POSTCONDITION_RESULTS = new Set([
  'completed', 'safe_to_retry', 'partially_completed', 'not_retryable', 'unsafe_manual',
]);

/**
 * Postcondition inspection for `start` — the reference contract worked out in
 * `overview.md` § "Recovery model". Pure: takes already-observed state
 * (`tools/specs.mjs`'s handleStart does the actual git/filesystem reads), and
 * is safely re-invokable after a partial repair — calling it again with fresh
 * state *is* the "resumable recovery handle" requirement 4a describes, since it
 * re-derives from real state rather than a stored diff.
 *
 * `depsOk` should already account for `validateTransition`'s own idempotent
 * case (pass `true` when the transition is idempotent, since deps no longer
 * matter once a task is already in-implementation).
 */
export function inspectStartPostconditions({ taskStatus, depsOk, onExpectedBranch, localBranchExists, remoteBranchExists, unsatisfiedDeps }) {
  if (taskStatus !== 'approved' && taskStatus !== 'in-implementation') {
    return { result: 'not_retryable', missing: [], reason: `Task has status '${taskStatus}', expected 'approved'.` };
  }
  if (taskStatus === 'approved' && !depsOk) {
    const detail = unsatisfiedDeps?.length ? `: ${unsatisfiedDeps.join(', ')}` : '.';
    return { result: 'not_retryable', missing: [], reason: `Dependencies are no longer satisfied${detail}` };
  }

  const branchDone = onExpectedBranch;
  const statusDone = taskStatus === 'in-implementation';

  if (branchDone && statusDone) return { result: 'completed', missing: [] };
  if (branchDone && !statusDone) return { result: 'partially_completed', missing: ['status'] };
  if (!branchDone && statusDone) {
    // status already says in-implementation, but the branch effect that should
    // have produced it is gone — the original action's own precondition (a
    // branch existing) no longer holds, so this is a fresh situation, not a
    // safe replay of the old one.
    return {
      result: 'not_retryable', missing: [],
      reason: 'Task is in-implementation but its expected branch no longer exists locally or remotely.',
    };
  }
  // Neither effect has happened yet — safe to run the whole action from scratch.
  return {
    result: 'safe_to_retry',
    missing: remoteBranchExists ? ['branch (checkout from origin — REC-02)', 'status'] : ['branch', 'status'],
    remoteOnly: Boolean(remoteBranchExists),
  };
}

/**
 * Postcondition classification for the three single-effect transitions
 * (`approve`/`complete`/`verify`) — each is one atomic YAML write, so there is
 * no genuine partial-completion window the way there is for `start`.
 */
export function classifySimpleActionPostcondition(transitionResult) {
  if (!transitionResult.ok) {
    return { result: 'not_retryable', reason: transitionResult.reason };
  }
  return { result: transitionResult.idempotent ? 'completed' : 'safe_to_retry' };
}

/**
 * `approve`'s own postcondition contract — the second action worked out by the
 * `start-task` pattern (implementation constraints), since task 04 needs it
 * for the combined approve+start path (D3). Takes `validateApproval`'s own
 * result directly rather than re-deriving the same gate logic: `approve` is a
 * single atomic write, so `not_retryable` covers every rejection reason
 * (wrong status, no/stale/unresolved review) uniformly — none of them leaves
 * a retryable partial effect behind.
 */
export function inspectApprovePostconditions(approvalResult) {
  if (!approvalResult.ok) {
    return { result: 'not_retryable', missing: [], reason: approvalResult.reason, code: approvalResult.code };
  }
  return {
    result: approvalResult.idempotent ? 'completed' : 'safe_to_retry',
    missing: approvalResult.idempotent ? [] : ['status'],
  };
}

// Minimal glob support for `allowed_paths` entries as they actually appear in
// this repository: an exact file path, a `dir/**` recursive prefix, or a
// `dir/*` one-level prefix. Not a general glob engine. Exported (PR re-review
// packet 03) — `attributeTouchedPaths` reuses the exact same matching rule
// `classifyDirtyWorktree` already applies, rather than a second
// reimplementation of "does this concrete path match this declared pattern."
export function pathMatchesAllowedPattern(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return normalized.startsWith(`${prefix}/`) && !normalized.slice(prefix.length + 1).includes('/');
  }
  return normalized === pattern;
}

/**
 * Classify a dirty working tree against a task's own `allowed_paths` —
 * REC-05 (every dirty file is task-related — confirm-required) vs. REC-06 (at
 * least one dirty file is unrelated — owner-decision, never auto-touched).
 * Returns `null` for a clean tree.
 */
export function classifyDirtyWorktree(dirtyFiles, allowedPaths) {
  if (!dirtyFiles.length) return null;
  const patterns = allowedPaths || [];
  const unrelated = dirtyFiles.filter(f => !patterns.some(p => pathMatchesAllowedPattern(f, p)));
  if (unrelated.length) {
    return { code: 'REC-06', class: 'owner-decision', files: unrelated };
  }
  return { code: 'REC-05', class: 'confirm-required', files: dirtyFiles };
}

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
 * `{ taskId, baseline, changedPaths }` mappings — pure, no repository I/O,
 * so `handleApplyProvenance` (tools/specs.mjs) can write from it without the
 * parsing/validation logic itself being repository-bound. Owner correction
 * (seventh refinement pass, area requirement 8): several proposed legacy
 * provenance reconstructions may be confirmed in one owner action via
 * `--mappings` (a JSON array), all resolved together under the caller's one
 * `--confirm` — never one prompt per task. A single task id with
 * `baseline`/`changedPaths` options keeps the original single-task shape.
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
      throw new Error('apply-provenance --mappings must be valid JSON: an array of {task, baseline, changedPaths}.');
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
    changedPaths: options.changedPaths ? options.changedPaths.split(',').map(s => s.trim()).filter(Boolean) : [],
  }];
}

// ── Resume-and-continue controller (D2/D3/D8/D17, task 03) ─────────────────
//
// An authorized scope is a single task id or an already-resolved ordered
// list of task ids. Batch selection/ordering itself — the four D20 named
// modes — is area batch-execution-and-gating-review's job (task 08); this
// area only takes the resolved order and enforces the "never continue past
// it" boundary (D2).
export function scopeOf(taskIds) {
  return { taskIds: Array.isArray(taskIds) ? taskIds : [taskIds] };
}

export function isEndOfScope(scope, taskId) {
  const idx = scope.taskIds.indexOf(taskId);
  return idx === -1 || idx === scope.taskIds.length - 1;
}

export function nextInScope(scope, taskId) {
  const idx = scope.taskIds.indexOf(taskId);
  if (idx === -1 || idx === scope.taskIds.length - 1) return null;
  return scope.taskIds[idx + 1];
}

// Every named reason the expansive-continuation boundary (overview.md §
// "Interaction model") can stop for. Not all of these are detected by this
// area's own logic — `failed-acceptance-criterion`/`public-contract-impact`/
// `high-risk-evidence`/`stale-batch-evidence` are area batch-execution-and-
// gating-review's signals (task 08); `planContinuation`'s `externalStopReason`
// lets a caller report one of those through this same decision point instead
// of duplicating stop/continue logic elsewhere.
export const CONTINUATION_STOP_REASONS = new Set([
  'scope-expansion', 'architectural-decision', 'unsafe-manual', 'unrelated-dirty-files',
  'owner-decision', 'not-retryable', 'partially-completed', 'failed-acceptance-criterion',
  'public-contract-impact', 'high-risk-evidence', 'stale-batch-evidence', 'end-of-scope',
]);

/**
 * The resume-and-continue controller (requirement 3, AC3/AC4): given the
 * postcondition result of the action just performed for `taskId` and the
 * authorized `scope`, decide whether the loop may continue to the next task
 * automatically. Only `completed`/`safe_to_retry` are continuable —
 * `not_retryable` and `unsafe_manual` always stop, and so does
 * `partially_completed` reaching this decision point (it never auto-
 * continues past an unresolved suspension). Never continues past the end of
 * `scope`, regardless of how safe the next step looks (AC4). `externalStopReason`
 * lets a caller (e.g. a batch controller, task 08) force a stop for a reason
 * this area doesn't itself detect, through this same decision point —
 * checked before the postcondition result.
 */
export function planContinuation(postconditionResult, scope, taskId, { externalStopReason } = {}) {
  if (externalStopReason) {
    if (!CONTINUATION_STOP_REASONS.has(externalStopReason)) {
      throw new Error(`Unknown continuation stop reason '${externalStopReason}'`);
    }
    return { action: 'stop', reason: externalStopReason };
  }
  if (postconditionResult === 'not_retryable') return { action: 'stop', reason: 'not-retryable' };
  if (postconditionResult === 'unsafe_manual') return { action: 'stop', reason: 'unsafe-manual' };
  if (postconditionResult === 'partially_completed') return { action: 'stop', reason: 'partially-completed' };
  if (postconditionResult !== 'completed' && postconditionResult !== 'safe_to_retry') {
    throw new Error(`Unknown postcondition result '${postconditionResult}'`);
  }
  const next = nextInScope(scope, taskId);
  if (!next) return { action: 'stop', reason: 'end-of-scope' };
  return { action: 'continue', next };
}

/**
 * `start`'s own requirement 4 (AC4, task 02 recovery-classification): when
 * `inspectStartPostconditions` returns `not_retryable` and the task already
 * carries a suspension, the new situation gets a *new* suspension describing
 * it — never a blind retry of the stale `previous_action`. Returns the
 * `setTaskSuspension` payload the caller should write, or `null` when there is
 * no pre-existing suspension to replace (nothing to do). Pure — `now` is
 * injected so the caller's real timestamp is testable without mocking `Date`.
 */
export function nextSuspensionForNotRetryable(existingSuspension, now = new Date().toISOString()) {
  if (!existingSuspension) return null;
  return { kind: 'owner-decision', code: existingSuspension.code, previous_action: 'start', created_at: now };
}

/**
 * Maps a persisted `execution.suspension` to one of the boundary's named stop
 * reasons, so a caller reports *why* the controller stopped using the same
 * vocabulary `planContinuation` returns rather than a suspension-specific one.
 */
export function stopReasonForSuspension(suspension) {
  if (suspension.code === 'REC-08') return 'scope-expansion';
  if (suspension.code === 'REC-06') return 'unrelated-dirty-files';
  if (suspension.kind === 'unsafe-manual') return 'unsafe-manual';
  return 'owner-decision';
}

/**
 * D17 repair-and-retry resume-in-place: a `confirm-required`-class stop
 * inside an owner-already-authorized combined transition (e.g. `approve` ->
 * `start`) does not end the transition — once the owner confirms, the caller
 * re-runs the recovery action's own postcondition-inspection function against
 * fresh state (that re-invocation *is* the resumable recovery handle
 * requirement 4a describes) and passes the fresh result here. Resolved: the
 * combined transition continues, having executed only the still-missing
 * effects the fresh inspection reported. Still unresolved: AC6 — a
 * confirmation is never asked a second time for the same repair, so the
 * result is forced to `not_retryable` (or passed through as `unsafe_manual`),
 * a fresh stop the caller presents as new rather than repeating the old
 * prompt.
 */
export function resolveAfterConfirmedRepair(freshInspection) {
  if (freshInspection.result === 'completed' || freshInspection.result === 'safe_to_retry') {
    return { ...freshInspection, resumed: true };
  }
  if (freshInspection.result === 'unsafe_manual') {
    return { ...freshInspection, resumed: true };
  }
  return {
    result: 'not_retryable',
    missing: freshInspection.missing || [],
    resumed: true,
    reason: 'Confirmed repair did not resolve the blocking condition' +
      (freshInspection.reason ? `: ${freshInspection.reason}` : '.'),
  };
}

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

/**
 * Hard-stop predicate (D24, third refinement pass) — checked before any risk
 * signal, never a fallthrough case inside the risk-signal logic, and never
 * bypassable by a full `task-review`. Returns `{ code, detail }` or `null`.
 * A hard stop's report reads `self_check.status`/`failed_criteria` directly —
 * it is not a separate, parallel record of the same fact (D28).
 */
export function hardStopReason(task) {
  if (!task.self_check) {
    return { code: 'unresolved-self-check', detail: 'No self-check has been recorded for this task yet.' };
  }
  if (task.self_check.status === 'failed') {
    return {
      code: 'failed-self-check',
      detail: `Self-check failed: ${(task.self_check.failed_criteria || []).join(', ') || '(no failed_criteria recorded)'}`,
    };
  }
  return null;
}

/**
 * Whether `complete` must refuse this task (D24/D28, PR re-review packet
 * 02). Outside an active batch, only an *existing, failed* self-check blocks
 * completion — self-check stays optional there, unchanged from the original
 * behavior. Inside an active batch that includes this task, a *missing*
 * self-check blocks it too: the area doc's hard-stop list names "an
 * unresolved self-check" unconditionally (same predicate `hardStopReason`
 * already reports for `batch-status`), so a task must never reach
 * `implemented` inside a batch without ever having been self-checked, not
 * only when a self-check exists and failed. Returns the same
 * `hardStopReason` shape, or `null`.
 */
export function completionHardStop(task, { inActiveBatch = false } = {}) {
  const stop = hardStopReason(task);
  if (!stop) return null;
  return (task.self_check || inActiveBatch) ? stop : null;
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
          category: 'integration', tasks: [a, b], paths: shared,
          summary: `Tasks '${a}' and '${b}' both touched: ${shared.join(', ')}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Bounded pair selection for the semantic cross-task integration pass
 * (D34/D35, task 16, area implementation-review-orchestration requirement
 * 16) — the deterministic "which pairs get inspected" half; the actual
 * semantic inspection across the eleven named signal categories (dependency
 * contracts, public CLI changes, shared schemas, ...) is a model-review step
 * over the selected pairs, same split this workflow already uses for
 * semantic-reference completeness (D26). A pair is selected when either: (a)
 * it already appears in `fileOverlapPairs` (reused from
 * `detectBatchIntegrationFindings`'s own file-overlap detection — never
 * recomputed a second way), or (b) one task's `semantic_references.decisions`/
 * `dependency_contracts` names the other, or they share a decision — a real
 * relationship `attributeTouchedPaths` alone cannot see (two tasks can share
 * a dependency contract without ever touching the same file). `taskSemanticRefs`
 * is `{[taskId]: { decisions: string[], dependencyContracts: string[] }}`.
 * Never selects every pair in scope — that would defeat "bounded."
 */
export function selectSemanticIntegrationPairs(orderedTaskIds, taskSemanticRefs, fileOverlapPairs = []) {
  const pairs = new Map();
  const key = (a, b) => [a, b].sort().join(' ');
  for (const [a, b] of fileOverlapPairs) pairs.set(key(a, b), [a, b].sort());

  const refs = taskSemanticRefs || {};
  for (let i = 0; i < orderedTaskIds.length; i++) {
    for (let j = i + 1; j < orderedTaskIds.length; j++) {
      const a = orderedTaskIds[i];
      const b = orderedTaskIds[j];
      const ra = refs[a] || {};
      const rb = refs[b] || {};
      const dependencyRelated = (ra.dependencyContracts || []).includes(b) || (rb.dependencyContracts || []).includes(a);
      const sharedDecision = (ra.decisions || []).some(d => (rb.decisions || []).includes(d));
      if (dependencyRelated || sharedDecision) pairs.set(key(a, b), [a, b].sort());
    }
  }
  return [...pairs.values()];
}

/** The complete structured per-task record `implementation-review` carries forward from a per-task review into the aggregate/consolidated stage (area requirement 19) — every field a caller must populate, none inferred silently. */
export const PER_TASK_REVIEW_FIELDS = [
  'taskId', 'verdict', 'acCovered', 'acTotal', 'scopeStatus', 'blockingFindings',
  'pendingOwnerDecisions', 'pendingScopeDecisions', 'clarificationRequests',
  'followUpCandidates', 'reviewArtifact', 'implementationFingerprint',
];

/**
 * Validates a per-task structured review record carries every field
 * `PER_TASK_REVIEW_FIELDS` requires (area requirement 19) — throws naming
 * the missing field(s) rather than silently proceeding with an incomplete
 * record the consolidated stage would then under-report from.
 */
export function validatePerTaskReviewRecord(record) {
  const missing = PER_TASK_REVIEW_FIELDS.filter(f => !(f in (record || {})));
  if (missing.length) {
    throw new Error(`Per-task review record for '${record?.taskId || '?'}' is missing required field(s): ${missing.join(', ')}`);
  }
  return true;
}

/**
 * Collects every reviewed task's pending decisions and follow-up candidates
 * into the one consolidated stage (D34/D35, task 16, area requirement 21) —
 * never per-task. Scope decisions are grouped by resolution path
 * (`outsideAllowed` vs. `forbidden`, mirroring task 13's own classification)
 * since only the former is eligible for the lightweight acceptance menu.
 * `records` are `PER_TASK_REVIEW_FIELDS`-shaped (validated by the caller via
 * `validatePerTaskReviewRecord` before reaching here). Eligibility for the
 * bulk-transition menu reuses `selectEligibleForVerification` verbatim —
 * never re-derived a second way.
 */
export function buildConsolidatedDecisionStage(records) {
  const ownerDecisions = [];
  const scopeDecisionsOutsideAllowed = [];
  const scopeDecisionsForbidden = [];
  const clarificationRequests = [];
  const followUpCandidates = [];

  for (const record of records || []) {
    for (const d of record.pendingOwnerDecisions || []) ownerDecisions.push({ taskId: record.taskId, ...d });
    for (const s of record.pendingScopeDecisions || []) {
      const bucket = s.classification === 'forbidden' ? scopeDecisionsForbidden : scopeDecisionsOutsideAllowed;
      bucket.push({ taskId: record.taskId, ...s });
    }
    for (const c of record.clarificationRequests || []) clarificationRequests.push({ taskId: record.taskId, ...c });
    for (const f of record.followUpCandidates || []) followUpCandidates.push({ taskId: record.taskId, ...f });
  }

  return {
    ownerDecisions,
    scopeDecisions: { outsideAllowed: scopeDecisionsOutsideAllowed, forbidden: scopeDecisionsForbidden },
    clarificationRequests,
    followUpCandidates,
    eligibleForBulkTransition: selectEligibleForVerification(
      (records || []).map(r => ({ id: r.taskId, verdict: r.verdict, blockingFindings: r.blockingFindings })),
    ),
  };
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

/**
 * Pure finalize-gate check: given a change's tasks and a bag of already-fetched facts
 * (git state, PR state, verification results), decide whether `finalize` may merge the
 * PR and archive the change. Does not touch git, GitHub, or the filesystem — see
 * handleFinalize in tools/specs.mjs for the I/O that gathers `facts` and acts on the
 * result. Every condition is evaluated and the *first* failing one is reported —
 * finalize never merges/archives on a partial pass.
 *
 * `facts` shape:
 *   {
 *     gitClean: boolean,
 *     branch: { hasUpstream: boolean, ahead: number|null, behind: number|null },
 *     pr: { number, state, isDraft, unresolvedThreads } | null,
 *     verification: [{ name: string, passed: boolean, detail?: string }],
 *     openBlockingFollowUps: [{ id: string, reason: string }],
 *   }
 *
 * Returns `{ ok: true, idempotent: boolean }` or `{ ok: false, reason }`.
 * `idempotent: true` means the PR is already merged — a safe no-op, same convention as
 * validateTransition's idempotent re-runs.
 */
export function validateFinalize(change, facts) {
  const notTerminal = change.tasks.filter(t => !TERMINAL_STATUSES.has(t.status));
  if (notTerminal.length) {
    return {
      ok: false,
      reason: `Task(s) not in a terminal status: ${notTerminal.map(t => t.id).join(', ')}. ` +
        `Every task must be implemented/verified before finalizing.`,
    };
  }

  // Follow-up ledger gate (D15, area context-and-validation-hardening,
  // task 06) — a still-open, blocking-severity entry blocks finalize exactly
  // like a non-terminal task, evaluated alongside it.
  if (facts.openBlockingFollowUps?.length) {
    return {
      ok: false,
      reason: `Open blocking follow-up(s): ${facts.openBlockingFollowUps.map(f => f.id).join(', ')}. ` +
        `Resolve, or dismiss with a recorded owner decision, before finalizing.`,
    };
  }

  if (!facts.gitClean) {
    return { ok: false, reason: 'Working tree has uncommitted changes. Commit or discard them first.' };
  }

  if (facts.branch.behind > 0) {
    return {
      ok: false,
      reason: `Local branch is ${facts.branch.behind} commit(s) behind its remote — pull/rebase first.`,
    };
  }
  if (!facts.branch.hasUpstream || facts.branch.ahead > 0) {
    return { ok: false, reason: 'Branch has commits not yet pushed to origin. Push before finalizing.' };
  }

  // facts.pr === null is ambiguous by itself: "checked, genuinely no PR" and "couldn't
  // check" produce the same null. facts.ghAvailable is what disambiguates them — never
  // report "no PR" when the real answer is "unknown," since that could send someone to
  // open a second PR for a branch that already has one.
  if (facts.ghAvailable === false) {
    return { ok: false, reason: 'gh CLI is not available — cannot verify PR/review-thread state. Install/authenticate gh and retry.' };
  }
  if (!facts.pr) {
    return { ok: false, reason: 'No pull request found for this branch. Open one before finalizing.' };
  }
  if (facts.pr.state === 'MERGED') {
    return { ok: true, idempotent: true };
  }
  if (facts.pr.isDraft) {
    return { ok: false, reason: `PR #${facts.pr.number} is still a draft.` };
  }
  if (facts.pr.state !== 'OPEN') {
    return { ok: false, reason: `PR #${facts.pr.number} has state '${facts.pr.state}', expected 'OPEN' or 'MERGED'.` };
  }
  if (facts.pr.unresolvedThreads > 0) {
    return {
      ok: false,
      reason: `PR #${facts.pr.number} has ${facts.pr.unresolvedThreads} unresolved review thread(s). ` +
        `Resolve every comment (including bot reviewers) before finalizing.`,
    };
  }

  const failedChecks = facts.verification.filter(v => !v.passed);
  if (failedChecks.length) {
    return {
      ok: false,
      reason: `Verification failed: ${failedChecks.map(v => v.detail ? `${v.name} (${v.detail})` : v.name).join('; ')}.`,
    };
  }

  return { ok: true, idempotent: false };
}

/**
 * Suspension-aware override for one task's stage result (D8, requirement 7): a
 * task with an active `execution.suspension` needs to surface the stop reason
 * and, for `confirm-required`, that a confirmation is still owed — not the
 * stage's usual `nextCommand`, which would silently be wrong until the
 * suspension resolves. Returns `stageResult` unchanged when there is none.
 */
function withSuspension(task, stageResult) {
  const suspension = task.execution?.suspension;
  if (!suspension) return stageResult;
  const needsOwner = suspension.kind === 'owner-decision' || suspension.kind === 'unsafe-manual';
  return {
    ...stageResult,
    detail: `${stageResult.detail} Suspended: ${suspension.code} (${suspension.kind}), ` +
      `retry target '${suspension.previous_action}'.`,
    nextCommand: needsOwner
      ? `Owner must resolve ${suspension.code} before continuing.`
      : `Confirm/resolve ${suspension.code}, then retry ${suspension.previous_action}.`,
    suspension,
  };
}

/**
 * Read-only `self_check` state classifier (D28, requirement 8) — never writes
 * `self_check` itself (area `batch-execution-and-gating-review` is the sole
 * writer). `current` is `{ fingerprint, revision }` for the task right now, if
 * the caller was able to compute it; omitted (or non-matching fingerprint)
 * reads as "cannot confirm freshness," which conservatively reports
 * `passed-but-stale` rather than falsely claiming `passed-and-fresh`.
 *
 * Freshness is `fingerprint`-only (D18's task-level semantic projection) —
 * `current.revision` is accepted for callers that still pass it (harmless,
 * ignored) but is never compared. `self_check.revision` is audit/provenance
 * metadata only (owner-decisions.md D33): the repository's global `HEAD`
 * advances for reasons that have nothing to do with this task (another task
 * committing, an unrelated fix), so comparing it here would report a task as
 * stale purely because time passed elsewhere — the exact over-invalidation
 * D33 already rejected for the batch gating review's equivalent check
 * (`staleEvidenceTasks`). Detecting the narrower real risk revision once
 * stood in for (this task's own already-self-checked commit being amended or
 * rebased after the fact) is deferred to a future task-specific provenance
 * mechanism, same as D33's own deferral.
 */
function describeSelfCheck(task, current) {
  const selfCheck = task.self_check;
  if (!selfCheck) return { state: 'not-run' };
  if (selfCheck.status === 'failed') return { state: 'failed', failedCriteria: selfCheck.failed_criteria || [] };
  const fresh = Boolean(current) && selfCheck.fingerprint === current.fingerprint;
  return { state: fresh ? 'passed-and-fresh' : 'passed-but-stale' };
}

/**
 * Pure lifecycle-stage classifier: given a change's tasks and the same `facts` bag
 * `validateFinalize` takes, name exactly where this change currently sits in the full
 * spec → task → PR → merge chain, and the single next action — never more than one, and
 * never composed as prose. Read-only in intent: callers (handleStatus in
 * tools/specs.mjs) must not use this to decide anything to *write*; it only classifies
 * what's already true. Evaluated top to bottom, first match wins, same convention as
 * validateApproval/validateFinalize.
 *
 * Returns `{ stage, detail, nextCommand }`, plus `suspension` when the relevant task has
 * one (D8) and `selfCheck` for the in-implementation stage (D28). `stage` is one of:
 * `needs-approval` | `ready-to-start` | `blocked-on-dependencies` | `in-progress` |
 * `cannot-verify-pr` | `needs-pr` | `pr-draft` | `needs-comment-resolution` |
 * `needs-verification-fixes` | `ready-to-finalize` | `done`.
 */
export function deriveStage(change, facts) {
  const draft = change.tasks.find(t => t.status === 'draft');
  if (draft) {
    return {
      stage: 'needs-approval',
      detail: `Task '${draft.id}' is still draft.`,
      nextCommand: `/nevo-ai:spec-review ${change._slug || change.id}`,
    };
  }

  // D34/D35, task 18 (closes FU-004) — an `approved` task is only
  // `ready-to-start` when `depsSatisfied` actually holds, the same predicate
  // `start` itself uses; reporting the first `approved` task unconditionally
  // let `status` recommend a task `start` would immediately reject. If an
  // earlier-ordered approved task is blocked but a later one is genuinely
  // ready, that later one is the real next action (requirement 8) — `.find`
  // over `change.tasks` in its existing declared order already expresses
  // this without a second sort.
  const approvedTasks = change.tasks.filter(t => t.status === 'approved');
  const readyApproved = approvedTasks.find(t => depsSatisfied(t, change));
  if (readyApproved) {
    return withSuspension(readyApproved, {
      stage: 'ready-to-start',
      detail: `Task '${readyApproved.id}' is approved but not started.`,
      nextCommand: `/nevo-ai:task-start ${change._slug || change.id} ${readyApproved.id}`,
    });
  }

  const inProgress = change.tasks.find(t => t.status === 'in-implementation');
  if (inProgress) {
    const base = withSuspension(inProgress, {
      stage: 'in-progress',
      detail: `Task '${inProgress.id}' is in-implementation.`,
      nextCommand: `Implement, then /nevo-ai:task-review ${change._slug || change.id} ${inProgress.id}`,
    });
    return { ...base, selfCheck: describeSelfCheck(inProgress, facts.currentTaskState) };
  }

  // Every approved task exists but none is ready, and no draft/in-implementation
  // task above already explained why (a chain of approved-but-blocked tasks,
  // or a dependency that's `abandoned`/missing rather than merely not-yet-
  // started) — report the block explicitly, naming the unmet dependency(ies),
  // rather than falling through to the "every task terminal" logic below,
  // which would be wrong: real, non-terminal work is still pending.
  if (approvedTasks.length) {
    const blocked = approvedTasks[0];
    const unmet = (blocked.depends_on || []).filter(depId => {
      const dep = change.tasks.find(t => t.id === depId);
      return !dep || !DEPENDENCY_SATISFYING_STATUSES.has(dep.status);
    });
    const unmetDescriptions = unmet.map(depId => {
      const dep = change.tasks.find(t => t.id === depId);
      return `'${depId}' (${dep ? dep.status : 'missing'})`;
    });
    return withSuspension(blocked, {
      stage: 'blocked-on-dependencies',
      detail: `Task '${blocked.id}' is approved but blocked on: ${unmetDescriptions.join(', ')}.`,
      nextCommand: `Resolve blocking dependenc${unmet.length === 1 ? 'y' : 'ies'}: ${unmet.join(', ')}.`,
    });
  }

  // Every task is now in a terminal status (implemented/verified/archived/abandoned) —
  // the rest of the chain is about the PR, not the tasks. facts.pr === null is
  // ambiguous on its own (see validateFinalize's identical guard) — check ghAvailable
  // first, or "gh isn't installed" silently reads as "no PR exists yet."
  if (facts.ghAvailable === false) {
    return {
      stage: 'cannot-verify-pr',
      detail: 'Every task is terminal, but gh CLI is not available — PR/comment state is unknown, not confirmed absent.',
      nextCommand: 'Install/authenticate gh, then re-check. Do not assume no PR exists.',
    };
  }
  if (!facts.pr) {
    return {
      stage: 'needs-pr',
      detail: 'Every task is terminal. No pull request found for this branch yet.',
      nextCommand: "nevo-ai-github skill's \"Create a PR\" flow (open a pull request)",
    };
  }
  if (facts.pr.state === 'MERGED') {
    return { stage: 'done', detail: `PR #${facts.pr.number} is merged.`, nextCommand: 'None.' };
  }
  if (facts.pr.isDraft) {
    return {
      stage: 'pr-draft',
      detail: `PR #${facts.pr.number} is still a draft.`,
      nextCommand: 'Mark the PR ready for review on GitHub.',
    };
  }
  if (facts.pr.unresolvedThreads > 0) {
    return {
      stage: 'needs-comment-resolution',
      detail: `PR #${facts.pr.number} has ${facts.pr.unresolvedThreads} unresolved review thread(s).`,
      nextCommand: `Resolve the open comments on PR #${facts.pr.number} (any reviewer, including bot reviewers).`,
    };
  }
  const failedChecks = facts.verification.filter(v => !v.passed);
  if (failedChecks.length) {
    return {
      stage: 'needs-verification-fixes',
      detail: `Verification failing: ${failedChecks.map(v => v.name).join(', ')}.`,
      nextCommand: `Fix: ${failedChecks.map(v => v.detail ? `${v.name} (${v.detail})` : v.name).join('; ')}.`,
    };
  }

  return {
    stage: 'ready-to-finalize',
    detail: `PR #${facts.pr.number} is open, no unresolved threads, verification green.`,
    nextCommand: `/nevo-ai:spec-finalize ${change._slug || change.id}`,
  };
}

// ── Multi-task implementation review orchestration (D30, task 12) ──────────
//
// `/nevo-ai:implementation-review`'s deterministic surface: resolving
// `--all`/`--tasks` into an eligibility-checked scope, the overall verdict
// table, which tasks are eligible for the bulk-verification offer, and the
// atomic bulk status transition. The per-task review depth itself is
// `task-review`'s own flow, reused, not reimplemented here (area
// implementation-review-orchestration, requirement 3) — nothing in this
// section re-evaluates an individual task's own acceptance criteria.

// A task has something real to review only once it has entered
// implementation — `draft`/`approved` have no diff yet, `abandoned` was
// explicitly dropped. `archived` is included (a task can be individually
// archived independently of its whole change) but never needs a further
// bulk-transition hop — see computeBulkTransitionTarget below.
export const MULTI_REVIEW_ELIGIBLE_STATUSES = new Set(['in-implementation', 'implemented', 'verified', 'archived']);

// ── Scoped and incremental spec-review (D34/D35, task 17) ──────────────────

export const SPEC_REVIEW_SCOPE_MODES = new Set(['all', 'tasks', 'changed']);

/**
 * Resolve `--all`/`--tasks <spec>`/`--changed` into an ordered, deduplicated
 * list of task ids for a scoped `/nevo-ai:spec-review` run (area
 * scoped-spec-review requirement 1) — distinct from `resolveReviewScope`
 * (task 12), which filters by `MULTI_REVIEW_ELIGIBLE_STATUSES`;
 * `spec-review` reviews a task's *specification*, before it ever reaches
 * that lifecycle point, so no status filtering applies here. Exactly one of
 * `all`/`tasks`/`changed` is accepted — no flag given is the caller's job to
 * treat as `all` (the compatibility default), not this function's.
 * `changedTaskIds` (for `changed`) is supplied by the caller — computed via
 * `selectChangedTaskIds`, since fingerprint comparison needs file access this
 * pure function doesn't have.
 */
export function resolveSpecReviewScope(change, { all = false, tasks: tasksSpec, changed = false, changedTaskIds = [] } = {}) {
  const modesGiven = [all, Boolean(tasksSpec), changed].filter(Boolean).length;
  if (modesGiven !== 1) {
    return { ok: false, reason: 'Exactly one of --all/--tasks/--changed is required.' };
  }
  if (all) return { ok: true, mode: 'all', taskIds: change.tasks.map(t => t.id) };
  if (changed) return { ok: true, mode: 'changed', taskIds: [...changedTaskIds] };

  const parsed = parseTaskOrderSpec(tasksSpec);
  if (!parsed.ok) return parsed;
  const byOrder = new Map(change.tasks.map(t => [t.order, t.id]));
  const taskIds = [];
  for (const order of parsed.orders) {
    const id = byOrder.get(order);
    if (!id) return { ok: false, reason: `--tasks names order ${order}, which doesn't resolve to a real task in this change.` };
    taskIds.push(id);
  }
  return { ok: true, mode: 'tasks', taskIds: [...new Set(taskIds)] };
}

/**
 * `--changed` selection (area requirement 3) — exactly the tasks whose
 * current semantic fingerprint (D18) doesn't match what the prior review
 * recorded, or that have no recorded entry at all (a genuinely new task).
 * `evaluableTaskIds` is the set `--changed` is allowed to select from (the
 * caller excludes D32-grandfathered tasks the same way step 5a already
 * does) — this function never invents that exemption itself.
 */
export function selectChangedTaskIds(evaluableTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  const prior = priorTaskFingerprints || {};
  const current = currentTaskFingerprints || {};
  return evaluableTaskIds.filter(id => prior[id] === undefined || prior[id] !== current[id]);
}

/**
 * Names every out-of-scope task that is potentially impacted by this run
 * (area requirement 4, corrected) — an out-of-scope task's own current
 * `computeTaskFingerprint` no longer matching the baseline recorded for it in
 * `reviews/spec.md`'s `task_fingerprints` map. This is exactly
 * `scopedReviewBaselineValid`'s own `invalidTaskIds` computation, exposed
 * under this name for the reporting step (as distinct from the verdict-gate
 * use of the same check) — one deterministic signal, two consumers, never two
 * divergent computations.
 *
 * Reading or referencing an older, out-of-scope task as a
 * `semantic_references.dependency_contracts` entry of a selected task is
 * never, by itself, evidence of impact — a prior version of this function
 * used that direction as its signal, which is backwards: a new task
 * depending on an older one means the older task is context/dependency
 * input for the new one, not something the new task's existence can
 * invalidate. That direction-based check has been removed; `depIds`/`refs`
 * about the *selected* scope are not inputs to this function at all. Any
 * real cross-contract impact the deterministic fingerprint comparison
 * doesn't represent is a model-inspection judgment made at review time
 * (area requirement 4), reported separately in the review body — never
 * inferred by an automated function from a dependency reference alone.
 */
export function findPotentiallyImpactedOutOfScopeTasks(outOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  return scopedReviewBaselineValid(outOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints).invalidTaskIds;
}

/**
 * The scoped-verdict guard (area requirement 5) — a scoped review cannot
 * claim `ready-for-approval`/`approved-for-implementation` for the whole
 * change unless every task *outside* the selected scope still has a
 * fingerprint matching what the last review recorded for it.
 * `checkableOutOfScopeTaskIds` is the out-of-scope subset this check applies
 * to (the caller excludes D32-grandfathered tasks, same exemption step 5a
 * already uses) — a task with no prior recorded fingerprint at all is
 * treated as invalid (nothing to trust), not silently skipped.
 */
export function scopedReviewBaselineValid(checkableOutOfScopeTaskIds, priorTaskFingerprints, currentTaskFingerprints) {
  const prior = priorTaskFingerprints || {};
  const current = currentTaskFingerprints || {};
  const invalidTaskIds = checkableOutOfScopeTaskIds.filter(id => prior[id] === undefined || prior[id] !== current[id]);
  return { valid: invalidTaskIds.length === 0, invalidTaskIds };
}

/**
 * Adapts task 14's compact-checklist rendering shape (`renderCompactReviewChecklist`)
 * to a scoped `spec-review` run's own five-value verdict vocabulary (area
 * requirement 6) — reused, not a second, divergent renderer. Only for the
 * fully-passing case (`ready-for-approval`/`approved-for-implementation`,
 * zero unresolved findings of any kind) — a review with any unresolved
 * finding keeps the full report shape, unchanged.
 */
export function renderScopedSpecReviewBody({
  status, unresolvedRequiredFixes = 0, unresolvedOwnerDecisions = 0, unresolvedNeedsClarification = 0,
} = {}, { title } = {}) {
  const passing = (status === 'ready-for-approval' || status === 'approved-for-implementation')
    && unresolvedRequiredFixes === 0 && unresolvedOwnerDecisions === 0 && unresolvedNeedsClarification === 0;
  if (!passing) {
    throw new Error('renderScopedSpecReviewBody is only for a fully-passing scoped review result.');
  }
  const lines = [
    '- [x] No unresolved required fix',
    '- [x] No unresolved owner decision',
    '- [x] No unresolved clarification request',
    `- [x] Verdict: ${status}`,
  ];
  return `# ${title}\n\n${lines.join('\n')}`;
}

/**
 * Parse a `--tasks` spec into the requested `order` numbers — a dash range
 * (`01-03`, inclusive, both bounds required and non-decreasing) or a
 * comma-separated list (`01,03,07`, deduplicated) — never both forms mixed
 * in one spec. Returns `{ ok: true, orders: [number, ...] }` or
 * `{ ok: false, reason }`.
 */
export function parseTaskOrderSpec(spec) {
  const trimmed = String(spec ?? '').trim();
  if (/^\d+-\d+$/.test(trimmed)) {
    const [start, end] = trimmed.split('-').map(Number);
    if (start > end) {
      return { ok: false, reason: `Invalid range '${trimmed}' — start (${start}) is after end (${end}).` };
    }
    const orders = [];
    for (let o = start; o <= end; o++) orders.push(o);
    return { ok: true, orders };
  }
  if (/^\d+(,\d+)*$/.test(trimmed)) {
    return { ok: true, orders: [...new Set(trimmed.split(',').map(Number))] };
  }
  return {
    ok: false,
    reason: `Invalid --tasks spec '${trimmed}' — expected a dash range (e.g. '01-03') or a comma list (e.g. '01,03,07').`,
  };
}

/**
 * Resolve `--all`/`--tasks` into an ordered, deduplicated, eligibility-
 * checked task id list (area implementation-review-orchestration,
 * requirement 2) — deterministic, CLI-backed, never agent-parsed. Exactly
 * one of `all`/`tasks` is required (no default, same "no implicit default"
 * principle as batch selection, D20). Order numbers are resolved against
 * each task's own `order` field. Rejects, naming the specific problem: an
 * order number that doesn't resolve to a real task; an invalid `--tasks`
 * spec; or any resolved task whose `status` isn't in
 * `MULTI_REVIEW_ELIGIBLE_STATUSES`.
 */
export function resolveReviewScope(change, { all = false, tasks: tasksSpec } = {}) {
  if (Boolean(all) === Boolean(tasksSpec)) {
    return { ok: false, reason: 'Exactly one of --all or --tasks is required.' };
  }

  let orderedIds;
  if (all) {
    orderedIds = [...change.tasks]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(t => t.id);
  } else {
    const parsed = parseTaskOrderSpec(tasksSpec);
    if (!parsed.ok) return parsed;

    const byOrder = new Map(change.tasks.map(t => [t.order, t]));
    const unresolved = parsed.orders.filter(o => !byOrder.has(o));
    if (unresolved.length) {
      return { ok: false, reason: `Order number(s) not found in this change: ${unresolved.join(', ')}.` };
    }
    orderedIds = [...parsed.orders].sort((a, b) => a - b).map(o => byOrder.get(o).id);
  }

  const ineligible = orderedIds
    .map(id => change.tasks.find(t => t.id === id))
    .filter(t => !MULTI_REVIEW_ELIGIBLE_STATUSES.has(t.status));
  if (ineligible.length) {
    return {
      ok: false,
      reason: `Task(s) not eligible for review (status must be one of ${[...MULTI_REVIEW_ELIGIBLE_STATUSES].join('/')}): ` +
        ineligible.map(t => `'${t.id}' (${t.status})`).join(', '),
    };
  }

  return { ok: true, orderedTasks: orderedIds };
}

export const MULTI_TASK_REVIEW_VERDICTS = new Set(['pass', 'changes-required', 'owner-decision-required', 'blocked']);

/**
 * Deterministic consistency guard between an aggregate `implementation-review`
 * and the per-task canonical review artifacts (`reviews/<task-id>.md`) it
 * summarizes — the exact class of contradiction a 2026-08-06 reconciliation
 * pass found by hand (an aggregate report claiming `pass` for a task whose own
 * `reviews/<task-id>.md` frontmatter still said `changes-required`). The
 * aggregate must never override or invent a per-task verdict in prose; this
 * function is what enforces that mechanically instead of relying on the
 * writer to remember. `perTaskReviews` is `{[taskId]: ReviewFrontmatter |
 * null}` — `null` (or absent) means the review file is missing/unreadable,
 * gathered by the caller (I/O). `ReviewFrontmatter` is `{ verdict,
 * unresolvedRequiredFixes, unresolvedOwnerDecisions,
 * unresolvedNeedsClarification }`, read verbatim from that file's frontmatter.
 * `aggregateRow` is `{[taskId]: verdict}`, the aggregate's own per-task
 * `Verdict` column as written. Returns `{ ok: true }` or `{ ok: false, reason
 * }` naming the first disagreement found, evaluated in `Object.keys(aggregateRow)`
 * order. Does not itself compare task fingerprints — no per-task review
 * currently persists one in its own frontmatter (unlike `spec-review`'s
 * `task_fingerprints` map); adding that is separate, larger work, not folded
 * in here silently.
 */
export function validateAggregateAgainstCanonicalReviews(perTaskReviews, aggregateRow) {
  for (const taskId of Object.keys(aggregateRow)) {
    const review = perTaskReviews[taskId];
    if (!review) {
      return { ok: false, reason: `'${taskId}': no canonical review artifact found (reviews/${taskId}.md missing or unreadable).` };
    }
    const unresolvedCount = (review.unresolvedRequiredFixes ?? 0) + (review.unresolvedOwnerDecisions ?? 0) + (review.unresolvedNeedsClarification ?? 0);
    if (review.verdict === 'pass' && unresolvedCount > 0) {
      return {
        ok: false,
        reason: `'${taskId}': canonical review (reviews/${taskId}.md) verdict is 'pass' but records ${unresolvedCount} unresolved finding(s) — internally inconsistent artifact, fix the review file first.`,
      };
    }
    if (review.verdict !== 'pass' && unresolvedCount === 0) {
      return {
        ok: false,
        reason: `'${taskId}': canonical review (reviews/${taskId}.md) verdict is '${review.verdict}' but records zero unresolved findings — internally inconsistent artifact, fix the review file first.`,
      };
    }
    if (aggregateRow[taskId] !== review.verdict) {
      return {
        ok: false,
        reason: `'${taskId}': aggregate row claims '${aggregateRow[taskId]}' but its canonical review (reviews/${taskId}.md) says '${review.verdict}'.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Overall verdict for `/nevo-ai:implementation-review` (D30, task 12,
 * area implementation-review-orchestration requirement 10) — computed from
 * an explicit table, never composed as prose, same convention as every other
 * verdict in this workflow. `taskVerdicts` are each selected task's own
 * `task-review`-equivalent verdict (`pass`/`changes-required`/`blocked`),
 * gathered by the caller — this function never re-evaluates any individual
 * task's own acceptance criteria itself. `ownerDecisionFindings`/
 * `autoFixFindings` count unresolved findings at either the per-task or the
 * cross-task-integration level, already merged by the caller.
 * `NON_BLOCKING`/`INFORMATIONAL` findings never participate, by construction
 * (the caller never passes them in).
 */
export function computeMultiTaskReviewVerdict({
  validationFailed = false,
  taskVerdicts = [],
  ownerDecisionFindings = 0,
  autoFixFindings = 0,
} = {}) {
  if (validationFailed) return 'blocked';
  if (taskVerdicts.includes('blocked')) return 'blocked';
  if (ownerDecisionFindings > 0) return 'owner-decision-required';
  if (taskVerdicts.includes('changes-required') || autoFixFindings > 0) return 'changes-required';
  return 'pass';
}

/**
 * Tasks eligible for the bulk-verification offer (area
 * implementation-review-orchestration, requirement 9): a task's own verdict
 * is `pass` **and** it carries zero unresolved blocking findings at either
 * the per-task or the cross-task-integration level. Every other selected
 * task must remain unchanged, regardless of which bulk-confirmation option
 * is chosen — this is a hard rule, not a per-run judgment call.
 * `taskResults` is `[{ id, verdict, blockingFindings }]`, gathered by the
 * caller from each task's own review and the cross-task integration pass.
 */
export function selectEligibleForVerification(taskResults) {
  return (taskResults || [])
    .filter(t => t.verdict === 'pass' && (t.blockingFindings || 0) === 0)
    .map(t => t.id);
}

export const MULTI_REVIEW_OUTCOMES = new Set(['self-verified', 'verified']);

/**
 * Compute one task's target status under a chosen bulk-transition outcome
 * (area implementation-review-orchestration, requirement 12). `self-verified`
 * never goes past `implemented`; `verified` always ends at `verified`,
 * hopping through `implemented` first for a task still `in-implementation`.
 * Never regresses an already-`verified` (or `archived`) task — those are
 * always a no-op regardless of outcome. Returns `{ ok: true, to, noop }` or
 * `{ ok: false, reason }` — the caller (`validateBulkTransition`) must
 * validate every selected task this way *before* writing any of them
 * (all-or-nothing).
 */
export function computeBulkTransitionTarget(currentStatus, outcome) {
  if (!MULTI_REVIEW_OUTCOMES.has(outcome)) {
    return { ok: false, reason: `Unknown outcome '${outcome}' — must be one of ${[...MULTI_REVIEW_OUTCOMES].join('/')}.` };
  }
  if (currentStatus === 'archived') return { ok: true, to: 'archived', noop: true };

  if (outcome === 'self-verified') {
    if (currentStatus === 'in-implementation') return { ok: true, to: 'implemented', noop: false };
    if (currentStatus === 'implemented' || currentStatus === 'verified') return { ok: true, to: currentStatus, noop: true };
    return { ok: false, reason: `Cannot apply outcome 'self-verified' to a task with status '${currentStatus}'.` };
  }

  // outcome === 'verified'
  if (currentStatus === 'in-implementation' || currentStatus === 'implemented') return { ok: true, to: 'verified', noop: false };
  if (currentStatus === 'verified') return { ok: true, to: 'verified', noop: true };
  return { ok: false, reason: `Cannot apply outcome 'verified' to a task with status '${currentStatus}'.` };
}

/**
 * Validate every eligible task's computed bulk-transition target *before*
 * anything is written (area implementation-review-orchestration, requirement
 * 12) — all-or-nothing: the first invalid task rejects the whole operation,
 * naming it. A task hopping through `implemented` (currentStatus ===
 * 'in-implementation' and the target isn't a no-op) is also checked against
 * the same hard-stop `complete` already performs standalone
 * (`completionHardStop` with `inActiveBatch: false` — this bulk operation is
 * not part of the D10/D20 batch-intent mechanism, so only an *existing,
 * failed* self-check blocks it, matching `complete`'s own out-of-batch
 * behavior). Returns `{ ok: true, transitions: [{ id, from, to, noop }] }` or
 * `{ ok: false, reason }`.
 */
// ── Review report compaction and scope exceptions (D31, task 13) ───────────
//
// The deterministic surface behind `task-review.md`/`implementation-review.md`'s
// compact checklist shape and owner-approved scope-exception model (area
// review-report-compaction-and-scope-exceptions). Reuses `pathMatchesAllowedPattern`
// (already used by `classifyDirtyWorktree`/`attributeTouchedPaths`) rather than a
// second glob matcher.

// The seven-item compact checklist's stable item ids, in the exact order the
// checklist itself renders them (area requirement 1).
export const TASK_REVIEW_CHECKLIST_ITEMS = [
  'ac-coverage', 'verification', 'scope', 'forbidden-path', 'docs', 'blocking-findings', 'owner-decision',
];

export const TASK_REVIEW_VERDICTS = new Set(['pass', 'changes-required', 'blocked']);

/**
 * Deterministic verdict-consistency guard (area requirement 5) — computed from
 * the seven checklist items, never composed as prose. `scopeStatus` is
 * `'compliant'` (every touched path is inside `allowed_paths`), `'accepted-exception'`
 * (an `outside-allowed` violation has a valid, matching `scope_exceptions` entry —
 * see `isScopeExceptionValid`), or `'unresolved'` (an `outside-allowed` violation
 * with no valid recorded exception). `forbiddenPathClean` is checked and reported
 * separately from `scopeStatus` (area requirement 10 — a `forbidden_paths`
 * violation is never resolvable through the exception mechanism, so it can never
 * be folded into `scopeStatus`). `missingRequiredAutomatedTest` is reported
 * independently of `acCoverageComplete` and is always `AUTO_FIX`-classified,
 * never merely non-blocking (area requirement, D31's own consequences) —
 * mirrors the existing rule that a passing verification command alone never
 * satisfies AC coverage for a scenario the tests don't actually exercise.
 * `pass` requires every one of the seven items to resolve clean; any single
 * failure yields `changes-required` — `blocked` is reserved for the task's own
 * more fundamental stops (e.g. verification evidence that cannot be produced at
 * all) that this checklist does not itself model, so it is never returned by
 * this function directly, only ever composed by the caller when such a stop is
 * detected outside these seven inputs. Returns `{ verdict, unresolvedItems }`,
 * `unresolvedItems` being `[{ item, category, reason }]` in checklist order.
 */
export function computeTaskReviewChecklist({
  acCoverageComplete,
  missingRequiredAutomatedTest = false,
  verificationPassed,
  scopeStatus,
  forbiddenPathClean,
  docsConsistent,
  unresolvedBlockingCount = 0,
  unresolvedOwnerDecisionCount = 0,
} = {}) {
  if (!['compliant', 'accepted-exception', 'unresolved'].includes(scopeStatus)) {
    throw new Error(`Unknown scope status '${scopeStatus}' — must be one of compliant/accepted-exception/unresolved.`);
  }

  const unresolvedItems = [];

  if (!acCoverageComplete) {
    unresolvedItems.push({
      item: 'ac-coverage', category: 'OWNER_DECISION',
      reason: 'Not every acceptance criterion is met, partially met, tested, or unquestionable.',
    });
  }
  if (missingRequiredAutomatedTest) {
    unresolvedItems.push({
      item: 'ac-coverage', category: 'AUTO_FIX',
      reason: 'An explicitly required automated test is missing — a passing verification command alone does not cover it.',
    });
  }
  if (!verificationPassed) {
    unresolvedItems.push({ item: 'verification', category: 'AUTO_FIX', reason: 'Required automated verification did not pass.' });
  }
  if (scopeStatus === 'unresolved') {
    unresolvedItems.push({
      item: 'scope', category: 'OWNER_DECISION',
      reason: 'A scope violation outside allowed_paths has no valid, recorded owner-approved exception.',
    });
  }
  if (!forbiddenPathClean) {
    unresolvedItems.push({
      item: 'forbidden-path', category: 'AUTO_FIX',
      reason: 'A forbidden_paths violation remains — revert or re-attribute it; it is never resolvable via scope_exceptions.',
    });
  }
  if (!docsConsistent) {
    unresolvedItems.push({ item: 'docs', category: 'AUTO_FIX', reason: 'Architecture/documentation is not consistent with the change.' });
  }
  if (unresolvedBlockingCount > 0) {
    unresolvedItems.push({
      item: 'blocking-findings', category: 'AUTO_FIX',
      reason: `${unresolvedBlockingCount} unresolved blocking finding(s) remain.`,
    });
  }
  if (unresolvedOwnerDecisionCount > 0) {
    unresolvedItems.push({
      item: 'owner-decision', category: 'OWNER_DECISION',
      reason: `${unresolvedOwnerDecisionCount} unresolved owner decision(s) remain.`,
    });
  }

  return { verdict: unresolvedItems.length ? 'changes-required' : 'pass', unresolvedItems };
}

const TASK_REVIEW_CHECKLIST_LABELS = {
  'ac-coverage': 'All acceptance criteria covered',
  'verification': 'Required automated verification passed',
  'scope': 'Scope check resolved',
  'forbidden-path': 'No forbidden-path violation remains unresolved',
  'docs': 'Architecture and documentation remain consistent',
  'blocking-findings': 'No unresolved blocking findings',
  'owner-decision': 'No unresolved owner decision',
};

/**
 * Deterministic checklist renderer (task 14, area
 * review-report-compaction-and-scope-exceptions §E requirement 25) — renders
 * `computeTaskReviewChecklist`'s output as the seven-item Markdown block
 * `templates/review-report.md` documents, so the passing/failing shape is a
 * real function's output, not prompt wording composed independently each run.
 * A checked item (`[x]`) carries no further line. A failed item (`[ ]`) gets
 * one indented `- <reason>` line per unresolved-item reason recorded against
 * it, in `unresolvedItems` order. `scopeExceptionCount > 0` appends the
 * owner-approved-exception note under the (still checked) "Scope check
 * resolved" item (requirement 14, task 13) — never the false-compliance
 * wording ("stays within `allowed_paths`").
 */
export function renderCompactReviewChecklist({ unresolvedItems = [] } = {}, { scopeExceptionCount = 0 } = {}) {
  const failuresByItem = new Map();
  for (const u of unresolvedItems) {
    if (!failuresByItem.has(u.item)) failuresByItem.set(u.item, []);
    failuresByItem.get(u.item).push(u.reason);
  }
  const lines = [];
  for (const item of TASK_REVIEW_CHECKLIST_ITEMS) {
    const failures = failuresByItem.get(item);
    if (failures) {
      lines.push(`- [ ] ${TASK_REVIEW_CHECKLIST_LABELS[item]}`);
      for (const reason of failures) lines.push(`  - ${reason}`);
    } else {
      lines.push(`- [x] ${TASK_REVIEW_CHECKLIST_LABELS[item]}`);
      if (item === 'scope' && scopeExceptionCount > 0) {
        lines.push(`  - ${scopeExceptionCount} owner-approved exception${scopeExceptionCount === 1 ? '' : 's'} recorded`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Deterministic 4-non-empty-line body for a normal passing
 * `task-review`/`implementation-review` per-task report (D34/D35, area §E
 * requirements 21-25, corrected by owner review — final pre-approval pass).
 *
 * The original version of this renderer rendered all seven
 * `computeTaskReviewChecklist` items (via `renderCompactReviewChecklist`) even
 * when every one of them passed — technically ≤10 lines, but still full
 * positive-proof narration for four gates (verification, forbidden-path,
 * docs/architecture, owner-decision) that have nothing to say when they pass.
 * Corrected shape: exactly three rows — AC coverage, Scope, Findings — plus
 * the title, normally four non-empty lines total (one more when an accepted
 * scope exception adds its nested note). The four checklist items dropped
 * from direct rendering (verification/forbidden-path/docs/owner-decision)
 * remain mandatory *internal* gates — `computeTaskReviewChecklist`'s own
 * seven-item verdict computation and semantics are completely unchanged; this
 * function only stops re-stating what a checked item already proved. `pass`
 * is still required to call this renderer at all (thrown otherwise) — a
 * failing/exception-pending report uses `renderCompactReviewChecklist`'s
 * expanded shape instead, where a failed item is exactly "the relevant
 * failed result," unchanged from task 13.
 */
export function renderNormalPassingReportBody(checklistResult, { title, totalAcceptanceCriteria, scopeExceptionCount = 0 } = {}) {
  if (!checklistResult || checklistResult.verdict !== 'pass') {
    throw new Error('renderNormalPassingReportBody is only for a passing checklist result — a failing/exception-bearing report uses the expanded shape instead.');
  }
  if (!Number.isInteger(totalAcceptanceCriteria) || totalAcceptanceCriteria < 1) {
    throw new Error('renderNormalPassingReportBody requires totalAcceptanceCriteria (a positive integer) to render the acceptance-criteria coverage line.');
  }
  const scopeLine = scopeExceptionCount > 0
    ? `- [x] Scope: resolved\n  - ${scopeExceptionCount} owner-approved exception${scopeExceptionCount === 1 ? '' : 's'} recorded`
    : '- [x] Scope: compliant';
  const lines = [
    `- [x] Acceptance criteria: ${totalAcceptanceCriteria}/${totalAcceptanceCriteria}`,
    scopeLine,
    '- [x] Findings: none unresolved',
  ];
  return `# ${title}\n\n${lines.join('\n')}`;
}

/**
 * Structural guard (area §E requirement 22) — AC coverage, scope, and
 * findings must each appear exactly once in a rendered report body, never
 * restated under a second heading/section for emphasis. Counts occurrences of
 * each concept's marker text; a count of 0 is fine (the concept may be
 * entirely represented by a checked checklist item with nothing further to
 * say), a count > 1 is the defect this guard exists to catch.
 */
export function checkReportSectionUniqueness(reportBody) {
  const markers = {
    'ac-coverage': [/All acceptance criteria covered/gi, /## Acceptance-criteria coverage/gi, /Acceptance criteria: \d+\/\d+/gi],
    'scope': [/Scope check resolved/gi, /## Scope compliance/gi, /- \[x\] Scope: (compliant|resolved)/gi],
    'findings': [/## Findings/gi, /- \[x\] Findings: (none unresolved|\d+)/gi],
  };
  const duplicates = [];
  for (const [section, patterns] of Object.entries(markers)) {
    const count = patterns.reduce((sum, re) => sum + (reportBody.match(re) || []).length, 0);
    if (count > 1) duplicates.push({ section, count });
  }
  return { ok: duplicates.length === 0, duplicates };
}

/**
 * Scope-finding classification (area requirement 9/10) — reuses
 * `pathMatchesAllowedPattern` verbatim rather than a new glob matcher.
 * `forbidden` is checked first so a path that (mis)matches both an
 * `allowed_paths` and a `forbidden_paths` pattern is never misclassified as
 * `compliant` — `forbidden_paths` is the hard exclusion, by construction.
 */
export function classifyScopeFinding(path, { allowedPaths = [], forbiddenPaths = [] } = {}) {
  if (forbiddenPaths.some(p => pathMatchesAllowedPattern(path, p))) return 'forbidden';
  if (allowedPaths.some(p => pathMatchesAllowedPattern(path, p))) return 'compliant';
  return 'outside-allowed';
}

/**
 * Which touched paths `/nevo-ai:task-review`'s own step 4 scope check
 * (`references/review-policy.md` § "Owner-approved scope exceptions")
 * should classify for a given task (D34/D35, task 15 AC6 — wired here by
 * task 19, since task 15's own `forbidden_paths` excludes
 * `.claude/commands/**`). Deliberately a **union**, not a replacement: the
 * live-diff paths the caller already inspected (step 3) are always included
 * — `implementation.changed_paths` is itself computed as a subset of a
 * task's own `allowed_paths` (`computeTaskAttributedChangedPaths`), so it can
 * *never* contain a genuine out-of-scope violation by construction; treating
 * it as the sole source would silently hide exactly the class of finding
 * step 4 exists to catch (this repository hit the concrete case directly —
 * task 15's own `tools/lib/git.mjs` scope exception, D36/D41 — which only a
 * live-diff scan, never a persisted `changed_paths` read, could have found).
 * The persisted record is still real, additive value: it guarantees
 * already-committed work since `baseline_revision` is included even if the
 * caller's own live-diff step only inspected current `git status` (dirty
 * files), and it gives a deterministic, already-resolved "this is definitely
 * this task's own attributed footprint" signal for cross-task disambiguation
 * in a shared working tree — never a narrower substitute for step 3's own
 * inspection. Never re-derives or mutates either input; the actual per-path
 * classification still goes through `classifyScopeFinding` unchanged.
 */
export function resolveScopeCheckPaths(task, liveDiffPaths) {
  const persisted = task?.implementation?.changed_paths || [];
  const live = liveDiffPaths || [];
  return [...new Set([...persisted, ...live])].sort();
}

/**
 * Exception-validity check across re-review (area requirement 15) —
 * deterministic half only: the same concrete path and the same task
 * fingerprint (D18's `computeTaskFingerprint`, passed in by the caller — this
 * function does no fingerprinting itself). A changed task fingerprint or a
 * different path invalidates the exception outright. Whether the *nature* of
 * the change has "materially expanded" beyond that is a model-inspection step
 * the caller (`task-review.md`'s re-review flow) performs separately — this
 * function cannot and does not decide that half.
 */
export function isScopeExceptionValid(exception, { path, taskFingerprint }) {
  if (!exception) return false;
  return exception.path === path && exception.task_fingerprint === taskFingerprint;
}

export function validateBulkTransition(change, taskIds, outcome) {
  const transitions = [];
  for (const id of taskIds) {
    const task = change.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: `Task '${id}' not found.` };

    const target = computeBulkTransitionTarget(task.status, outcome);
    if (!target.ok) return { ok: false, reason: `'${id}': ${target.reason}` };

    if (task.status === 'in-implementation' && !target.noop) {
      const stop = completionHardStop(task, { inActiveBatch: false });
      if (stop) {
        return {
          ok: false,
          reason: `'${id}' has a hard-stopped self-check (${stop.code}: ${stop.detail}) — correct the ` +
            `implementation and rerun its self-check before it can be marked complete.`,
        };
      }
    }

    transitions.push({ id, from: task.status, to: target.to, noop: target.noop });
  }
  return { ok: true, transitions };
}
