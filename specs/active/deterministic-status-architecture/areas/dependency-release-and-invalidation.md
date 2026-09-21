# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) instead of hardcoded to
"the dependency's own terminal transition with `outcome: success`." A release means a
downstream task may **enter the sequential queue's runnable set** (D33) — never that it
starts concurrently with the releasing task's own continued execution. When a released
dependency's own review later turns out to have been premature, this area also derives the
automatic remediation group it invalidates and suspends (D31), **including consumers that
have already reached a terminal transition** (D31, corrected — a terminal consumer is not
retroactively correct merely because it finished), persisted durably (D36) since a
cross-task review can extend the group beyond what pure derivation alone produces. The
cross-task-aware review of that group's fix is a separate area
(`areas/dependency-invalidation-remediation-review.md`), which consumes this area's signal
rather than duplicating it.

## Current state (grounded, 2026-09-21)

`evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) requires the dependency's
last `workflow_progress.history` entry to resolve to a declared transition whose `to` is a
`TERMINAL_STATUSES` member **and** whose own `outcome === 'success'` (D9, unchanged) — there
is no earlier release point. No `stale`/`suspend`/`revalidation-required` concept exists in
this file or in `task-projection.mjs`. `blockedBy` is a plain `string[]` of task ids
consumed directly by three UI call sites (`status-board.tsx`, `task-dialog.tsx`) — it must
not be overloaded into a mixed shape (D37).

## Requirements

- **Declarative release (D28).** An additive per-transition field, `releasesDependencies:
  true`, may be declared on an internal (step-to-step) transition — `standard-v1.yaml`'s
  `implementation → review` transition carries it. When a task's `workflow_progress` history's
  last entry matches such a transition, its dependents may enter the sequential queue's
  runnable set — never that they execute concurrently with it. Default, unmarked behavior for
  every other transition/definition is unchanged.
- **Automatic remediation-group derivation, including terminal consumers (D31, corrected).**
  When a task whose matched transition previously satisfied dependents via
  `releasesDependencies` later transitions *backward* to an earlier step, derive the
  remediation group: that task plus **every** dependent task that actually consumed the
  release — regardless of current state (`active`, `waiting`, `completed`, or already
  `terminal`). This derivation reads existing `workflow_progress` history — no new manual
  bookkeeping for the owner. A terminal consumer is never reopened or reverted (reopening a
  completed deterministic workflow is not a supported engine operation); it is instead
  flagged with a `suspensions[]` entry (below) whose meaning is advisory
  ("this result requires revalidation"), since it has no next step to enforceably block.
- **Suspension via `suspensions`, not `blockedBy` (D37).** Every non-terminal group member is
  marked so it cannot start its own *next* step, via a new, separate `suspensions:
  [{taskId, reason: 'dependency-invalidated', groupId}]` field — additive to the existing DTO,
  never merged into or replacing `blockedBy`, which keeps its plain `string[]` shape and
  ordinary-dependency meaning unchanged. A terminal group member gets the same `suspensions`
  entry, understood as advisory rather than an enforceable block.
- **Durable, extensible remediation record (D36).** Group membership persists at
  `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json` (`remediationId,
  rootTaskId, causeAttempt, members, discoveredMembers, state`) — orchestration state,
  distinct from `workflow_progress` (which stays the sole authoritative workflow-history
  record). This area owns creating/reading the initial derivation into the record; only
  `areas/dependency-invalidation-remediation-review.md` extends `discoveredMembers`.

## Constraints

- No destructive rollback of a downstream task's already-completed work, and no reopening of
  a terminal task's workflow.
- The release-point field lives on the transition, mirroring `outcome`'s existing placement.
- `blockedBy`'s shape and meaning are never changed by this area — `suspensions` is the only
  new field.
- The remediation-group derivation is pure/read-only against `workflow_progress` history for
  its *initial* computation; extension (`discoveredMembers`) is owned exclusively by the
  durable record, never re-derived silently.

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s extended logic (declarative release); a
remediation-group derivation function (root task → member task ids, including terminal
ones) plus the durable record's read/create primitives; the new `suspensions` field.

Consumed by: `areas/deterministic-batch-orchestrator.md`'s sequential queue (must respect
`suspensions` when computing eligibility, and runs a remediation group's fix attempts once
unsuspended for that purpose), `areas/dependency-invalidation-remediation-review.md` (reads
and may extend the durable record).

## Area-specific acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` makes its
  dependents eligible to enter the queue immediately, before its own workflow reaches a
  terminal transition — proven for a task whose dependency is still `active` in `review`
  after its `implementation → review` transition released dependents, and proven that the
  dependent and the dependency are never both "the current running item" simultaneously.
- A dependency that transitions backward after having released dependents produces a
  remediation group containing itself and **every** dependent that started against the
  release, including one that already reached `verified` — proven for a fixture with three
  dependents: one still active, one waiting, one terminal.
- Every non-terminal group member gets a `suspensions` entry and is excluded from the queue's
  eligible set; the terminal member gets the same entry but is not treated as blocking
  anything enforceable.
- The durable remediation record survives a simulated process restart with its
  `discoveredMembers` intact.
- `blockedBy`'s existing tests are unaffected — its shape/values are unchanged by this area's
  work.

## Dependencies

`tasks/25-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`).

## Out of scope

Retrying, rolling back, or reopening a task's own completed work. The cross-task-aware
review pass that determines when a remediation group's fix is complete and whether it must
grow (`areas/dependency-invalidation-remediation-review.md`). Running the group's actual fix
implementation attempts (`areas/deterministic-batch-orchestrator.md`).
