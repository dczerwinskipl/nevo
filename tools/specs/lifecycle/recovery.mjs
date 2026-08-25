import { DEPENDENCY_SATISFYING_STATUSES, validateTransition } from '../lifecycle-primitives.mjs';

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
