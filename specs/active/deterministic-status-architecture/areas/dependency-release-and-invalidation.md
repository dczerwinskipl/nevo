# Area: Dependency release and invalidation

## Responsibility

Make the dependency-satisfaction release point declarative (D28) instead of hardcoded to
"the dependency's own terminal transition with `outcome: success`" — the real dogfooding run
showed this kept downstream tasks `blocked` for a dependency's entire review duration, even
once its implementation artifact already existed. The invalidation consequence — what happens
when a released dependency's own review later fails after a downstream task has already
started against it — is a genuinely open question (OQ-A) this area's own task must not
silently resolve; it is routed to the owner before the corresponding acceptance criteria are
finalized.

## Current state (grounded, 2026-09-21)

`evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) requires the dependency's
last `workflow_progress.history` entry to resolve to a declared transition whose `to` is a
`TERMINAL_STATUSES` member **and** whose own `outcome === 'success'` (D9, unchanged) — there
is no earlier release point. No `stale`/`suspend`/`revalidation-required` concept exists in
this file or in `task-projection.mjs`; repository-wide `provenance`/`stale`/`suspend` hits
(`tools/specs/lifecycle/{stage,provenance}.mjs`) are legacy-lifecycle concepts, unconnected to
deterministic dependency tracking.

## Requirements

- **Declarative release (D28, decided).** An additive per-transition field,
  `releasesDependencies: true`, may be declared on an internal (step-to-step) transition.
  When a task's `workflow_progress` history's last entry matches such a transition, its
  dependents are satisfied even though the task's own workflow has not reached a terminal
  transition. Default, unmarked behavior for every existing transition/definition is
  unchanged — dependents wait for `outcome: success` on a terminal transition exactly as
  today.
- **Invalidation consequence (OQ-A, NOT DECIDED — do not implement until answered).** When a
  released dependency's workflow later returns from `review` (or wherever review lives) back
  to an earlier step (i.e., the release turns out to have been premature), what happens to
  a downstream task that already started against the release? Recorded options, not yet
  chosen by the owner:
  - (a) a new `blockedBy: {taskId, reason: 'dependency-invalidated'}` suspension state on the
    downstream task's `workflow_progress`, blocking only its *next* `start-step`/
    `startHumanStep` — no rollback of work already done — until the upstream dependency is
    satisfied again;
  - (b) a dashboard-only warning banner, no engine-level effect;
  - (c) the same suspension as (a), plus a required explicit owner acknowledgment before the
    downstream task may resume.
  This task's own acceptance criteria for the invalidation half are drafted against option
  (a) as the current recommendation only — marked explicitly provisional — and must be
  confirmed or replaced once the owner answers.

## Constraints

- No destructive rollback of a downstream task's already-completed work under any option
  (explicitly ruled out by the corrective-pass brief).
- The release-point field lives on the transition, mirroring `outcome`'s existing placement
  (D9) — never on the step, never a definition-level flag.
- Do not implement the invalidation half against an unconfirmed option — land the release
  half (D28) independently; gate the invalidation half's task completion on OQ-A's answer.

## Interfaces and boundaries

Exposes: `evaluateDependencySatisfaction`'s extended logic (declarative release), and —
pending OQ-A — a suspension/invalidation signal on `TaskProjection.blockedBy` (the existing
field, extended in shape, not a new one, if option (a)/(c) is chosen).

Consumed by: `TaskProjection` (existing `blockedBy` field), `areas/deterministic-batch-orchestrator.md`
(a scheduler must respect both the release point and any invalidation suspension when
deciding what's newly startable).

## Area-specific acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` satisfies its
  dependents immediately, before its own workflow reaches a terminal transition — proven for
  a task whose dependency is still `active` in `review` after its `implementation → review`
  transition released dependents.
- A transition without `releasesDependencies` (or every existing transition in today's five
  definitions) preserves exactly today's behavior — dependents wait for `outcome: success` on
  a terminal transition.
- (Provisional, pending OQ-A) once answered, at minimum: a downstream task that started
  against a released dependency, where that dependency's review later returns it to an
  earlier step, cannot start its own *next* step until re-satisfied — proven without deleting
  or reverting any of the downstream task's own `workflow_progress` history.

## Dependencies

`tasks/26-workflow-continuation-schema.md` (schema carrier for `releasesDependencies`).

## Out of scope

Retrying or rolling back a task's own completed work as an invalidation response (excluded
under every OQ-A option). A general revalidation workflow beyond the one suspension signal
OQ-A's answer will define.
