# Area: Deterministic batch orchestrator (sequential queue)

## Responsibility

Provide a deterministic **sequential queue** — never a concurrent scheduler — as pure domain
logic under `tools/specs/workflow/queue/**` (D38). **Single-execution invariant (D33): for
one specification, at most one agent-owned execution may be running at a time**, covering
every current and future agent-owned step kind. A "batch" means the user selects several
tasks; Nevo enqueues them; executes one runnable item; on its transition, recomputes
readiness/eligibility; selects the next runnable item (by declarative scheduling priority,
D34); repeats until the queue is exhausted, a real owner action is required, execution
fails/blocks, or remediation requires intervention. It never means two task sessions running
concurrently. This module has zero knowledge of AI sessions, providers, or execution policy —
those belong to `areas/workflow-continuation-and-session-handover.md`'s application-layer
orchestrator, which consumes this module's plan.

## Current state (grounded, 2026-09-21)

No deterministic batch/queue scheduler exists. Legacy `batch-*`
(`tools/specs/batch/{cli,operation}.mjs`, `tools/specs/lifecycle/batch.mjs`) has no
deterministic equivalent — `specs/archive/deterministic-workflow-foundation`'s own D16
explicitly deferred one. The deterministic dashboard UI supports only one task's
`startStep()` at a time. No `tools/specs/workflow/batch/` (or `queue/`) directory exists yet.
Confirmed: no file under `tools/specs/workflow/**` imports anything from
`tools/dashboard/**` today — the reverse (dashboard importing workflow core) is the
established, correct direction, and this area's own module must preserve it.

## Requirements

- **Pure domain queue, no AI/session awareness (D38).** `tools/specs/workflow/queue/**`
  exposes: given a change's selected+queued task ids, each task's current `TaskProjection`,
  and each candidate transition's `schedulingPriority`/`continuation`, compute (a) which
  queued tasks are currently eligible (ready now, or blocked — surfaced as a warning, never
  silently dropped or hard-blocked) and (b) the single next-runnable item, ordered by
  `schedulingPriority` ascending, then `task.order` ascending, then FIFO-by-eligible-time
  (D34) — a pure sort, no step-name branch anywhere. It also owns the queue's own durable
  membership state (local FS I/O, same family as `operation-record.mjs`, additive to but
  independent of `workflow_progress`).
- **Checkbox-picker selection (D32, unchanged in this dimension).** One selection mechanism:
  a checkbox-based task picker, pre-selected with whichever tasks are currently ready. The
  owner can freely check more (including tasks that aren't yet ready) or fewer.
- **Cross-selection dependency warning, never a hard block (D32).** If the current selection
  includes a task blocked by a dependency that is itself not in the selection and not yet
  satisfied, surface a warning naming the specific blocking task — never silently start it,
  never refuse the whole selection.
- **No concurrency of any kind (D33, corrected — replaces this area's own prior "bounded
  concurrency limit" content in full).** There is no concurrency limit to configure because
  there is no concurrency: exactly one agent-owned execution is active for the spec at any
  time, enforced by this module's own "next runnable item" being a single item, never a set.
  A queued item whose dependency becomes satisfied mid-run (e.g. via a `releasesDependencies`
  milestone) becomes eligible and is considered for the *next* slot — it is never started
  alongside the currently-running item.
- **Same-task continuation and cross-task queue share one scheduler (D33).** A same-task
  automatic continuation (D25) is enqueued exactly like any other eligible destination and
  competes for the single next-runnable slot through this same module — it is never a
  parallel side path that bypasses the queue.
- **Remediation-group reuse (D31).** When invoked to run a dependency-invalidation
  remediation group's fix attempts (`areas/dependency-release-and-invalidation.md`), this
  module treats the group's task-id set as an ordinary queue — no separate mechanism.
- **Web-reachable.** The dashboard must provide a UI path for the checkbox picker.

## Constraints

- `tools/specs/workflow/queue/**` never imports anything from `tools/dashboard/**` — verified
  by the same kind of import-boundary check D8's own regression test already established for
  a different pair.
- Independent of legacy `batch-*`/legacy task-status semantics — no reuse of
  `tools/specs/batch/**`'s implementation.
- Never makes one AI session own multiple tasks (this was already true; restated because it
  is now the *only* execution shape, not one of several).
- Respects `areas/dependency-release-and-invalidation.md`'s suspension signal (`suspensions`,
  D37) — a suspended remediation-group task is never offered as independently selectable/
  ready in the regular checkbox picker while suspended.

## Interfaces and boundaries

Exposes (pure domain, `tools/specs/workflow/queue/**`): a queue-state function (selected task
ids + concurrency-irrelevant, single-slot semantics → ordered eligible list + the one
next-runnable item + warnings for cross-selection dependency gaps); durable queue-membership
persistence.

Consumed by: `areas/workflow-continuation-and-session-handover.md`'s application-layer
orchestrator (the only caller that actually starts anything — creates sessions, calls
`startHumanStep`); the dashboard's checkbox-picker UI (reads eligibility/warnings for
display); `areas/dependency-invalidation-remediation-review.md` (remediation-group fix runs).

## Area-specific acceptance criteria

- The checkbox picker pre-selects exactly the currently-ready tasks; the owner can check/
  uncheck freely.
- Selecting a task blocked by an unselected, unsatisfied dependency produces a warning naming
  that dependency; the selection is still submittable.
- Given three eligible items (`T1 review` at `schedulingPriority: 10`, `T2`/`T3
  implementation` at the default `0`), the queue's next-runnable item is always one of `T2`/
  `T3` until neither remains eligible, only then `T1 review` — proven directly against the
  pure sort function, no step-name special-casing in the implementation.
- At every point in a multi-task queue run, exactly one item is ever the "next runnable" —
  never a set of more than one — proven as an explicit invariant test across a realistic
  three-task fixture.
- A same-task automatic continuation and a separately-selected task's own first execution
  compete through the identical eligibility/ordering function — no separate code path exists
  for "continuation" vs. "fresh batch item."
- Running this module against a derived remediation group's task-id set behaves identically
  to a manual selection of the same ids.
- A web UI path exists for the checkbox picker.
- `tools/specs/workflow/queue/**` contains zero imports of `tools/dashboard/**` — an explicit
  automated check, not merely an unstated convention.

## Dependencies

`areas/workflow-continuation-and-session-handover.md` (consumes this area's plan; this area
does not depend back on it), `areas/dependency-release-and-invalidation.md` (suspension
awareness and remediation-group task-id sets), `tasks/25-workflow-continuation-schema.md`
(`schedulingPriority`/`continuation` fields this area reads).

## Out of scope

A fully general orchestration/workflow-engine framework beyond this one queue. Automatic
retry of failed tasks. Cross-change batch scheduling (scope is one change's task graph). Any
form of concurrent/parallel execution, per-task Git worktrees, merge orchestration, or
workspace isolation — none of this is required or introduced (D33). The combined
cross-task-aware review of a remediation group's fixes
(`areas/dependency-invalidation-remediation-review.md`) — this area only runs the fix
attempts, one at a time.
