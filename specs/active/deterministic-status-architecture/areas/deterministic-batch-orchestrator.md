# Area: Deterministic batch orchestrator

## Responsibility

Provide a deterministic, task-oriented (never session-oriented) scheduler that starts
several tasks a user selects and lets each continue on its own through
`areas/workflow-continuation-and-session-handover.md`'s orchestrator, without reusing legacy
`batch-*` lifecycle semantics. Per D32, task selection is a single checkbox-picker
mechanism, not named selection "modes." The same scheduler runs a dependency-invalidation
remediation group's fix attempts (D31) — it is not a separate mechanism for that case.

## Current state (grounded, 2026-09-21)

No deterministic batch/orchestration scheduler exists. Legacy `batch-*`
(`tools/specs/batch/{cli,operation}.mjs`, `tools/specs/lifecycle/batch.mjs`) has no
deterministic equivalent — `specs/archive/deterministic-workflow-foundation`'s own D16
explicitly deferred one ("`batch-*` … has no deterministic-workflow equivalent yet;
explicitly out of scope"). The deterministic dashboard UI supports only one task's
`startStep()` at a time.

## Requirements

- **Task-oriented scheduling.** The scheduler operates on tasks, not on one AI session
  responsible for a whole batch: each selected task gets its own implementer session, then
  independently continues through implementation → (fresh) review → human action if required,
  exactly as `areas/workflow-continuation-and-session-handover.md` already defines for a
  single task. The scheduler's own job is running the selection and concurrency bounding, not
  execution semantics.
- **Checkbox-picker selection (D32).** One selection mechanism: a checkbox-based task picker,
  pre-selected with whichever tasks are currently ready. The owner can freely check more
  (including tasks that aren't yet ready) or fewer — no separate "named-subset"/
  "all-approved-reachable" API concept; unconstrained manual selection already covers both.
- **Cross-selection dependency warning, never a hard block (D32).** If the current selection
  includes a task blocked by a dependency that is itself not in the selection and not yet
  satisfied, surface at least a warning identifying the specific blocking task — never
  silently start the blocked task (it cannot succeed), and never refuse the whole selection
  outright (the owner may be intentionally staging a multi-run batch).
- **Bounded concurrency.** A configurable concurrency limit (small default, e.g. 3, chosen as
  an ordinary implementation detail per D32) — the scheduler never starts more sessions
  concurrently than the limit; excess selected tasks queue.
- **Remediation-group reuse (D31).** When invoked to run a dependency-invalidation
  remediation group's fix attempts (`areas/dependency-release-and-invalidation.md`), the
  scheduler uses the same task-oriented execution path — the only difference is what
  produced the selected task-id set (a derived remediation group vs. a manual checkbox
  selection) and that the group's tasks feed into
  `areas/dependency-invalidation-remediation-review.md`'s combined review instead of each
  task's own independent `continueOnSuccess: auto` continuation.
- **Web-reachable.** The dashboard must provide a UI path for the checkbox picker —
  terminal/CLI-only access is not sufficient for the primary workflow.

## Constraints

- Independent of legacy `batch-*`/legacy task-status semantics — no reuse of
  `tools/specs/batch/**`'s implementation.
- Never makes one AI session own multiple tasks.
- Respects `areas/dependency-release-and-invalidation.md`'s suspension signal — a suspended
  (remediation-group) task is never offered as independently selectable/ready in the regular
  checkbox picker while suspended; it becomes selectable again only through the remediation
  flow that unsuspends it.

## Interfaces and boundaries

Exposes: a scheduler entry point (selected task ids + concurrency limit → queued/started task
executions, with a warning list for cross-selection dependency gaps), and a dashboard
checkbox-picker UI surface.

Consumed by: the dashboard's task-board/batch UI (manual selection);
`areas/dependency-invalidation-remediation-review.md` (remediation-group fix runs).

## Area-specific acceptance criteria

- The checkbox picker pre-selects exactly the currently-ready tasks; the owner can check/
  uncheck freely.
- Selecting a task blocked by an unselected, unsatisfied dependency produces a warning naming
  that dependency; the selection is still submittable.
- The concurrency limit is enforced — starting more selected tasks than the limit queues the
  excess rather than starting them immediately.
- Running the scheduler against a derived remediation group's task-id set behaves identically
  to a manual selection of the same ids, with no code path specific to "this selection came
  from invalidation."
- A web UI path exists for the checkbox picker — proven by an end-to-end dashboard
  interaction, not a CLI-only flag.

## Dependencies

`areas/workflow-continuation-and-session-handover.md` (per-task continuation),
`areas/dependency-release-and-invalidation.md` (suspension awareness and remediation-group
task-id sets).

## Out of scope

A fully general orchestration/workflow-engine framework beyond this one scheduler. Automatic
retry of failed tasks. Cross-change batch scheduling (scope is one change's task graph). The
combined cross-task-aware review of a remediation group's fixes
(`areas/dependency-invalidation-remediation-review.md`, task 33) — this area only runs the
fix attempts.
