# Area: Deterministic batch orchestrator

## Responsibility

Provide a deterministic, task-oriented (never session-oriented) scheduler that can start
several independently-ready tasks and let each continue on its own through
`areas/workflow-continuation-and-session-handover.md`'s orchestrator, without reusing legacy
`batch-*` lifecycle semantics. The default task-selection mode and concurrency limit are a
genuinely open question (OQ-B) this area's own task must not silently resolve.

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
  single task. The scheduler's own job is selection and concurrency bounding, not execution
  semantics.
- **Selection modes (evaluate all three; OQ-B decides the default).** `currently-ready` (tasks
  ready right now, no lookahead); `named-subset` (an explicit list of task ids);
  `all-approved-reachable` (every task in the approved DAG reachable given current and
  future-releasable dependencies, per `areas/dependency-release-and-invalidation.md`'s
  declarative release).
- **Concurrency.** A bounded concurrency limit (exact default value is OQ-B, not decided
  here) — the scheduler must never start unboundedly many concurrent sessions. When a
  dependency-release milestone (D28) makes newly-ready tasks available mid-run, the scheduler
  may enqueue them, still respecting the concurrency bound.
- **Web-reachable.** The dashboard must provide a UI path for selecting/starting multiple
  tasks — terminal/CLI-only access is not sufficient for the primary workflow (the owner's
  explicit constraint).
- **OQ-B (NOT DECIDED — do not implement until answered).** Default selection mode: (a)
  `currently-ready` (safer default, no surprise mass-starts) vs. (b)
  `all-approved-reachable` (starts the whole approved DAG proactively). Default concurrency
  limit: a specific small bounded number (e.g. 3, configurable) vs. unbounded-by-default. This
  task's own acceptance criteria are drafted against option (a) + a small bounded default as
  the current recommendation only — marked explicitly provisional — and must be confirmed or
  replaced once the owner answers.

## Constraints

- Independent of legacy `batch-*`/legacy task-status semantics — no reuse of
  `tools/specs/batch/**`'s implementation, only its selection-mode vocabulary where genuinely
  still applicable.
- Never makes one AI session own multiple tasks.
- Respects `areas/dependency-release-and-invalidation.md`'s declarative release and (once
  OQ-A is answered) its invalidation suspension — a task suspended by dependency invalidation
  is never selected as newly-ready.

## Interfaces and boundaries

Exposes: a scheduler entry point (selection mode + optional named subset → enqueued task
executions, concurrency-bounded), and a dashboard UI surface for invoking it.

Consumed by: the dashboard's task-board/batch UI; internally calls
`areas/workflow-continuation-and-session-handover.md`'s per-task orchestrator for each
selected task, never reimplementing session/continuation logic itself.

## Area-specific acceptance criteria

- Selecting `currently-ready` on a change with two independently-ready tasks starts both,
  each with its own implementer session, bounded by the configured concurrency limit.
- A task that becomes newly ready mid-run (via a dependency-release milestone) is only
  auto-enqueued if the scheduler's own selection mode covers it (e.g. not for a
  `named-subset` run that didn't name it).
- The concurrency bound is enforced — starting more ready tasks than the limit queues the
  excess rather than starting them immediately.
- (Provisional, pending OQ-B) once answered: the confirmed default selection mode and
  concurrency limit are exercised as the no-argument invocation's actual behavior.
- A web UI path exists for selecting and starting a named subset of ready tasks — proven by
  an end-to-end dashboard interaction, not a CLI-only flag.

## Dependencies

`areas/workflow-continuation-and-session-handover.md` (per-task continuation),
`areas/dependency-release-and-invalidation.md` (release/invalidation awareness).

## Out of scope

A fully general orchestration/workflow-engine framework beyond this one scheduler. Retrying
failed tasks automatically. Cross-change batch scheduling (scope is one change's task graph).
