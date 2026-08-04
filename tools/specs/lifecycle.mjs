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
 * Returns `{ ok: true, idempotent: boolean }` or `{ ok: false, reason }`.
 */
export function validateApproval(taskStatus, review, currentFingerprint) {
  const transition = validateTransition('approve', taskStatus);
  if (!transition.ok) return transition;
  if (transition.idempotent) return transition;

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
// `dir/*` one-level prefix. Not a general glob engine.
function pathMatchesAllowedPattern(filePath, pattern) {
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
 * the caller was able to compute it; omitted (or non-matching) reads as
 * "cannot confirm freshness," which conservatively reports `passed-but-stale`
 * rather than falsely claiming `passed-and-fresh`.
 */
function describeSelfCheck(task, current) {
  const selfCheck = task.self_check;
  if (!selfCheck) return { state: 'not-run' };
  if (selfCheck.status === 'failed') return { state: 'failed', failedCriteria: selfCheck.failed_criteria || [] };
  const fresh = Boolean(current) && selfCheck.fingerprint === current.fingerprint && selfCheck.revision === current.revision;
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
 * `needs-approval` | `ready-to-start` | `in-progress` | `cannot-verify-pr` | `needs-pr` |
 * `pr-draft` | `needs-comment-resolution` | `needs-verification-fixes` |
 * `ready-to-finalize` | `done`.
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

  const approved = change.tasks.find(t => t.status === 'approved');
  if (approved) {
    return withSuspension(approved, {
      stage: 'ready-to-start',
      detail: `Task '${approved.id}' is approved but not started.`,
      nextCommand: `/nevo-ai:task-start ${change._slug || change.id} ${approved.id}`,
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
