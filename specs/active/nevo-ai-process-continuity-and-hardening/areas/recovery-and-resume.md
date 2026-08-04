# Area: Recovery and resume

> Refined 2026-08-04 — see `owner-decisions.md` D8. Scenario count corrected from eight
> to nine; recovery is now defined through action postconditions, not status transitions
> alone.

## Responsibility

Own the canonical recovery scenario set (`REC-01`..`REC-09`), the
`completed`/`safe_to_retry`/`partially_completed`/`not_retryable` postcondition model for
every state-changing controller action, writing/clearing `execution.suspension`, and
extending `deriveStage` into a suspension-aware controller entry point other areas'
conversational logic (area `conversational-continuity`) can call.

## Current state

Every failure in `tools/specs.mjs` is an uncaught/`CliError` exception caught once at
`runCli` (`tools/specs.mjs:440-452`) — no classification, no retry (see `overview.md` §
"Recovery and errors"). `deriveStage` (`lifecycle.mjs:207-284`) already computes a
correct, tested `{stage, detail, nextCommand}` result; `spec-status.md` surfaces it but
never acts on it.

## Requirements

1. **Canonical scenario set — nine, not eight.** `REC-01 WRONG_BRANCH` ·
   `REC-02 REMOTE_BRANCH_ONLY` · `REC-03 STALE_GENERATED_FILE` ·
   `REC-04 MECHANICAL_VALIDATION_FAILURE` · `REC-05 DIRTY_WORKTREE_TASK_FILES` ·
   `REC-06 DIRTY_WORKTREE_UNRELATED_FILES` · `REC-07 STALE_REVIEW_AFTER_SEMANTIC_CHANGE` ·
   `REC-08 SCOPE_EXPANSION` · `REC-09 ADR_CONFLICT`. For each, define: error class
   (automatic / confirm-required / owner-decision / unsafe-manual), stable code (the
   `REC-xx` identifier itself), recoverable?, confirmation required?, proposed recovery,
   `execution.suspension` payload if one is persisted, retry target
   (`previous_action`), stop condition, and expected `status` after recovery (always the
   task's pre-existing status — recovery never changes `status`, only clears/sets
   `execution.suspension`).
2. **Postcondition contracts.** For every state-changing controller action
   (`approve`, `start`, `complete`, `verify`, and this change's own new operations —
   batch continuation, mechanical auto-approval), define: preconditions, intended side
   effects, a completion postcondition (a checkable predicate over real state, not "exit
   code 0"), safe partial states, a recovery procedure, and which of
   `completed`/`safe_to_retry`/`partially_completed`/`not_retryable` applies to a given
   observed state. `start-task`'s contract is worked out in full in `overview.md` §
   "Recovery model" as the reference example — implement the others by the same pattern.
3. Recovery always inspects postconditions and executes only the missing effects — it
   never repeats a completed, externally-visible effect (e.g. never re-runs `git checkout
   -b` against a branch that already exists).
4. `not_retryable`: when an original action's preconditions no longer hold (e.g. approval
   was revoked, dependencies changed since the suspension was recorded), the controller
   creates a **new** suspension describing the new situation rather than blindly retrying
   the stale `previous_action`.
5. Extend `branchExists` (`tools/lib/git.mjs:18-25`) to also check `origin/<name>` when
   the local ref is missing (`REC-02`'s concrete fix); `handleStart` uses this to check
   out the existing remote branch instead of creating a diverging one.
6. `execution.suspension` is written only for a stop that must survive a session
   boundary (i.e., `confirm-required`, `owner-decision`, or `unsafe-manual` classes still
   unresolved when the operation returns control) — never for a same-turn `automatic`
   recovery that already completed before returning.
7. `deriveStage` (or a thin wrapper) becomes suspension-aware: a task with an active
   `execution.suspension` reports that instead of its stage's usual `nextCommand`, naming
   the suspension's `kind`/`code` and, for `confirm-required`, the confirmation still
   needed.

## Constraints

- Recovery classification must not change any existing successful-path behavior.
- "Retry" means re-running the *missing* effects of the original operation once — never
  an unbounded loop, never a different operation.
- `handleStart`'s existing pre-flight checks remain authoritative; this area adds
  classification, postcondition inspection, and remote-branch detection around them.
- The term "idempotent" keeps its existing, narrower codebase meaning
  (`validateTransition`'s "already at target status" flag) — this area's own vocabulary
  (`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`) is used for
  action-level postcondition reasoning and must not be described as "idempotent" in any
  new code comment or doc text, to avoid re-introducing the ambiguity the refinement
  flagged.

## Interfaces and boundaries

Exposes: the `REC-01`..`REC-09` table with codes; postcondition contracts per action; the
suspension writer/clearer; the extended `branchExists`; suspension-aware `deriveStage`.

Consumes: `state-and-fingerprint-semantics`' `execution.suspension` schema and corrected
`depsSatisfied`.

## Area-specific acceptance criteria

- A test exists for each of the nine `REC-xx` scenarios, asserting its class, code, and
  (for blocking classes) that `execution.suspension` is written with the correct
  `previous_action`.
- A test proves `start` on a `REC-02` branch (remote-only) checks it out rather than
  creating a diverging one.
- A test proves a `partially_completed` `start` (branch created, status not yet written)
  recovers by writing only the missing status, never re-creating the branch.
- A test proves a `not_retryable` case produces a new suspension rather than repeating
  the stale `previous_action`.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — needs the `execution.suspension` schema and
corrected `depsSatisfied` before recovery can persist or reason about state meaningfully.

## Out of scope

- Any conversational/menu behavior for presenting a suspension to the owner (area
  `conversational-continuity`, task 04).
- Reusing `blocked`/`needs-decision` as landing statuses — explicitly reversed by D8.
