# Area: Deterministic task publish

## Responsibility

Give deterministic specs an independent, deterministic-native way to mark a task's
definition ready for execution (`workflow task publish`), and remove the deterministic
CLI's remaining reliance on legacy `task.status` for default-task resolution.

## Current state

`workflow task publish` does not exist anywhere in the repository — confirmed absent by
discovery. The closest analog is legacy `approve` (`tools/specs/approve/operation.mjs`),
which gates on a spec review's `verdict === 'ready-for-approval'` and fingerprint freshness
— review/fingerprint semantics that do not belong to a transitional, pre-authoring-workflow
publish step, and which this area's operation must not call or inherit.
`resolveDefaultTask()` (`tools/specs/workflow/cli.mjs`) currently resolves an omitted task
id for `workflow step start`/`workflow step finish`/`workflow verify-human` by scanning for
`status === 'in-implementation'` — a legacy-status read this area removes per
`owner-decisions.md` D2.

## Requirements

- New operation `workflow task publish <change> <task>`:
  - Deterministic specs only (uses the guard from `areas/lifecycle-boundary-guards.md`).
  - Task must exist; task must still be pre-execution (`status: draft`).
  - The task's own definition must validate (`node tools/specs.mjs validate`-equivalent
    checks) and its `depends_on` entries must reference valid tasks in the same change.
  - The task's workflow must not already have started (no `workflow_progress` present).
  - On success, marks the task published/ready — may temporarily persist
    `task.status: approved` as compatibility storage, product-facing wording "Ready"/
    "Published," never "Approved."
  - Must not invoke or reuse legacy `approveTask` (`tools/specs/approve/operation.mjs`), and
    must not inherit its review-verdict/fingerprint-freshness gate.
  - Does not commit unrelated repository changes — publication and any future Git-commit
    semantics stay separate; the existing clean-worktree requirement for starting a new
    deterministic attempt is unaffected by this operation.
- `resolveDefaultTask()`'s fallback to legacy `status === 'in-implementation'` is removed.
  Per D2, deterministic commands that omit a task id now require an explicit task id and
  fail clearly instead of guessing — no new "in-flight" state is introduced in this change.

## Constraints

- This operation is independent deterministic application logic using temporary
  legacy-compatible persistence — it is not a thin wrapper over `approve`.
- No change to legacy `approve`'s own behavior for legacy specs.

## Interfaces and boundaries

Exposes: `workflow task publish <change> <task>` (new CLI subcommand under the existing
`workflow` group in `tools/specs.mjs`/`tools/specs/workflow/cli.mjs`).

Consumed by: `areas/deterministic-projection-and-human-interaction.md`'s projection (a
published task is no longer `draft`) and `areas/execution-readiness-and-session-bootstrap.md`'s
readiness policy (publication is one of its preconditions).

## Area-specific acceptance criteria

- Publishing a draft, valid, dependency-clean, not-yet-started deterministic task succeeds
  and the task's projection (once area 3 exists) reports it as ready/published, not "draft."
- Publishing a task whose definition fails validation, whose `depends_on` references a
  nonexistent task, or whose workflow has already started, fails clearly and writes nothing.
- Publishing a task on a legacy spec fails via the shared guard, before any mutation.
- Grepping the publish operation's own module for any call into
  `tools/specs/approve/operation.mjs`'s `approveTask` returns none.
- `workflow step start`/`workflow step finish`/`workflow verify-human` invoked without a
  task id on a deterministic spec with more than one non-terminal task fail with a clear
  "task id required" error instead of guessing from legacy status.

## Dependencies

`areas/lifecycle-boundary-guards.md` (the deterministic-mode guard this operation reuses).

## Out of scope

Any new deterministic "in-flight task" state model (D2). Git-commit semantics for
publication. Legacy `approve`'s own review/fingerprint gate (unchanged).
