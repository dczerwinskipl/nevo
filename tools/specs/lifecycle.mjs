// Task and change status rules for tools/specs.mjs — no Commander, no
// filesystem access. See docs/ai/specification-workflow.md and
// references/review-policy.md for the policy this enforces.

// Separate status sets for separate concepts — a task being "done" for
// dependency purposes is not the same question as a change being active.
export const TERMINAL_STATUSES = new Set(['implemented', 'verified', 'archived', 'abandoned']);
export const READY_STATUSES = new Set(['approved']);
export const ACTIVE_CHANGE_STATUSES = new Set(['approved', 'in-implementation', 'needs-decision', 'draft', 'blocked']);

export function depsSatisfied(task, change) {
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = change.tasks.find(t => t.id === depId);
    return Boolean(dep) && TERMINAL_STATUSES.has(dep.status);
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
      reason: `Review is missing 'spec_fingerprint' front matter — it predates this check. ` +
        `Re-run the review before approving.`,
    };
  }
  if (review.spec_fingerprint !== currentFingerprint) {
    return {
      ok: false,
      reason: `Review is stale: its spec_fingerprint (${review.spec_fingerprint}) does not match ` +
        `the current specification state (${currentFingerprint}). Re-run the review before approving.`,
    };
  }

  return { ok: true, idempotent: false };
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
 * Pure lifecycle-stage classifier: given a change's tasks and the same `facts` bag
 * `validateFinalize` takes, name exactly where this change currently sits in the full
 * spec → task → PR → merge chain, and the single next action — never more than one, and
 * never composed as prose. Read-only in intent: callers (handleStatus in
 * tools/specs.mjs) must not use this to decide anything to *write*; it only classifies
 * what's already true. Evaluated top to bottom, first match wins, same convention as
 * validateApproval/validateFinalize.
 *
 * Returns `{ stage, detail, nextCommand }`. `stage` is one of: `needs-approval` |
 * `ready-to-start` | `in-progress` | `cannot-verify-pr` | `needs-pr` | `pr-draft` |
 * `needs-comment-resolution` | `needs-verification-fixes` | `ready-to-finalize` |
 * `done`.
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
    return {
      stage: 'ready-to-start',
      detail: `Task '${approved.id}' is approved but not started.`,
      nextCommand: `/nevo-ai:task-start ${change._slug || change.id} ${approved.id}`,
    };
  }

  const inProgress = change.tasks.find(t => t.status === 'in-implementation');
  if (inProgress) {
    return {
      stage: 'in-progress',
      detail: `Task '${inProgress.id}' is in-implementation.`,
      nextCommand: `Implement, then /nevo-ai:task-review ${change._slug || change.id} ${inProgress.id}`,
    };
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
