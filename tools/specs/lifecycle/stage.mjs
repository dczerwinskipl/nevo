import {
  depsSatisfied,
  DEPENDENCY_SATISFYING_STATUSES,
} from '../lifecycle-primitives.mjs';
import { evaluateGate } from '../gates.mjs';

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
  const result = evaluateGate('finalize', { change, ...facts }, { mode: 'full' });
  return {
    ok: result.ok,
    idempotent: result.idempotent,
    ...(result.reason ? { reason: result.reason } : {}),
  };
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
  const failedChecks = (facts.verification || []).filter(v => !v.passed);
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
