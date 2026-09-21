# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) instead of hardcoded to
"the dependency's own terminal transition with `outcome: success`" — the real dogfooding run
showed this kept downstream tasks `blocked` for a dependency's entire review duration, even
once its implementation artifact already existed. When a released dependency's own review
later turns out to have been premature, this area also derives the automatic remediation
group it invalidates and suspends (D31) — the cross-task-aware review of that group's fix is
a separate area (`areas/dependency-invalidation-remediation-review.md`, task 33), which
consumes this area's signal rather than duplicating it.

## Current state (grounded, 2026-09-21)

`evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) requires the dependency's
last `workflow_progress.history` entry to resolve to a declared transition whose `to` is a
`TERMINAL_STATUSES` member **and** whose own `outcome === 'success'` (D9, unchanged) — there
is no earlier release point. No `stale`/`suspend`/`revalidation-required` concept exists in
this file or in `task-projection.mjs`; repository-wide `provenance`/`stale`/`suspend` hits
(`tools/specs/lifecycle/{stage,provenance}.mjs`) are legacy-lifecycle concepts, unconnected to
deterministic dependency tracking.

## Requirements

- **Declarative release (D28).** An additive per-transition field, `releasesDependencies:
  true`, may be declared on an internal (step-to-step) transition. When a task's
  `workflow_progress` history's last entry matches such a transition, its dependents are
  satisfied even though the task's own workflow has not reached a terminal transition.
  Default, unmarked behavior for every existing transition/definition is unchanged —
  dependents wait for `outcome: success` on a terminal transition exactly as today.
- **Automatic remediation-group derivation (D31).** When a task whose matched transition
  previously satisfied dependents via `releasesDependencies` later transitions *backward* to
  an earlier step (the release turns out to have been premature), derive the remediation
  group: that task plus every dependent task that started (reached `active` on any step)
  while the release was in effect and has not yet reached its own terminal transition. This
  derivation reads only existing `workflow_progress` history — it introduces no new
  persisted bookkeeping the owner must maintain by hand.
- **Suspension, not rollback (D31).** Every task in the derived remediation group is marked
  so it cannot start its own *next* step (a new `blockedBy` entry, extending the existing
  `TaskProjection.blockedBy` field rather than inventing a second one) until the group's
  remediation completes (defined by `areas/dependency-invalidation-remediation-review.md`).
  No group member's already-completed `workflow_progress` history is altered or reverted.
- **Group growth is a first-class signal, not a defect to hide (D31).** If the remediation
  review (task 33) determines that an additional task outside the originally-derived group
  also needs a fix (e.g. because of a change to the group's own root cause task), that task
  is added to the group and suspended the same way — this area's derivation function must be
  re-invokable/extendable by task 33, not a one-shot computation.

## Constraints

- No destructive rollback of a downstream task's already-completed work.
- The release-point field lives on the transition, mirroring `outcome`'s existing placement
  (D9) — never on the step, never a definition-level flag.
- The remediation-group derivation is pure/read-only against `workflow_progress` history —
  it does not itself drive re-implementation or review; that orchestration belongs to
  `areas/deterministic-batch-orchestrator.md` (running the group's fix attempts) and
  `areas/dependency-invalidation-remediation-review.md` (the combined review).

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s extended logic (declarative release); a
remediation-group derivation function (root task → group member task ids); the extended
`TaskProjection.blockedBy` suspension entry.

Consumed by: `areas/deterministic-batch-orchestrator.md` (must respect suspension when
computing what's startable, and is the mechanism that runs a remediation group's fix
attempts once unsuspended for that purpose), `areas/dependency-invalidation-remediation-review.md`
(reads the derived group, may extend it).

## Area-specific acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` satisfies its
  dependents immediately, before its own workflow reaches a terminal transition — proven for
  a task whose dependency is still `active` in `review` after its `implementation → review`
  transition released dependents.
- A transition without `releasesDependencies` (or every existing transition in today's five
  definitions) preserves exactly today's behavior — dependents wait for `outcome: success` on
  a terminal transition.
- A dependency that transitions backward after having released dependents produces a
  remediation group containing itself and every dependent that started against the release
  and hasn't reached terminal — proven for a fixture with one dependency and two dependents,
  only one of which had actually started.
- Every group member is suspended from its own next step start; none of their
  `workflow_progress` history is altered.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`

## Dependencies

`tasks/26-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`).

## Out of scope

Retrying or rolling back a task's own completed work. The cross-task-aware review pass that
determines when a remediation group's fix is complete and whether it must grow
(`areas/dependency-invalidation-remediation-review.md`, task 33). Running the group's actual
fix implementation attempts (`areas/deterministic-batch-orchestrator.md`, task 29).
