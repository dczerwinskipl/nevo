---
id: deterministic-status-architecture.deterministic-batch-orchestrator
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-batch-orchestrator.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/queue/**
  - tools/tests/deterministic-task-queue.test.mjs
forbidden_paths:
  - tools/specs/batch/**
  - tools/specs/lifecycle/batch.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ workflow-continuation-schema, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D32, D33, D34, D38]
---

# Task: Deterministic sequential task queue (corrected — was "batch orchestrator")

## Goal

Build a **pure domain** sequential queue under `tools/specs/workflow/queue/**` (D38) — zero
AI/session/dashboard awareness — implementing the single-active-execution invariant (D33):
for one specification, at most one agent-owned execution may ever be the "next runnable
item." A checkbox-picker UI (D32) selects tasks; the queue computes eligibility, warns
(never hard-blocks) on a cross-selection dependency gap, and orders eligible items by
declarative `schedulingPriority` (D34) — never by step-name comparison. **This task must not
contain any concurrency limit, bounded-concurrency value, or "start N sessions" concept of
any kind** — those were a wrongly-introduced assumption this task corrects.

## Implementation constraints

- `tools/specs/workflow/queue/**` (new): pure functions/small durable-state module. Exports
  a queue-state function: given selected+queued task ids for a change, each task's current
  `TaskProjection` (including `suspensions`, task 27), and each candidate transition's
  `schedulingPriority`/`continuation`, returns `{eligible: TaskStepRef[], nextRunnable:
  TaskStepRef | null, warnings: {taskId, blockedByTaskId}[]}`. **`nextRunnable` is always
  exactly one item or `null` — never an array, never a set.**
- Ordering: sort eligible items by `(schedulingPriority ascending, task.order ascending,
  eligibleAt ascending)` — first item wins. No `if`/`switch`/lookup keyed on a step id or
  name anywhere in this module.
- **Zero imports from `tools/dashboard/**` (D38, enforced).** This module has no concept of
  AI sessions, providers, or "is an execution currently running" — that state lives entirely
  in the dashboard-side orchestrator (`automatic-workflow-continuation`, task 29), which
  calls this module's function each time it becomes free and wants to know what's next. Add
  an explicit import-boundary check (mirroring D8's own regression-test pattern) asserting no
  file under `tools/specs/workflow/queue/**` imports `tools/dashboard/**`.
- Durable queue-membership state: persist selected/queued task ids for a change (so a
  dashboard reload doesn't lose the batch selection) using the same
  `.nevo-ai-local/`-local-runtime convention already used elsewhere in this directory tree
  (`operation-record.mjs`, `remediation-record.mjs`) — this is "pure" in the sense of no
  AI/session awareness, not "no I/O."
- The checkbox-picker UI itself is owned by `dashboard-orchestration-wiring` (task 32), which
  calls this module's function and renders `warnings` inline — this task exposes the pure
  function/data only, it owns no UI file.
- Remediation-group reuse (D31): accept a remediation group's task-id set
  (`tools/specs/workflow/remediation-record.mjs`, task 27) as an ordinary selection — no
  separate code path.
- **Do not add a concurrency limit, a "max parallel sessions" config, or any mechanism that
  could return more than one `nextRunnable` item.** If a future requirement genuinely needs
  more than one active execution per spec, that is a new owner decision superseding D33 — not
  something this task should provision for speculatively.

## Acceptance criteria

- Given a selection containing a task blocked by an unselected, unsatisfied dependency, the
  queue function returns a warning naming that dependency without refusing the selection.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Given three eligible items (`T1 review` at `schedulingPriority: 10`, `T2`/`T3
  implementation` at the default `0`), `nextRunnable` is always one of `T2`/`T3` until
  neither remains eligible, only then `T1 review`.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- **Invariant test:** across a realistic multi-task, multi-transition fixture run to
  completion, `nextRunnable` is never an array/set of more than one item at any inspected
  point.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Passing a remediation group's task-id set through this same queue behaves identically to a
  manual selection of the same ids.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- `tools/specs/workflow/queue/**` contains zero imports of `tools/dashboard/**` — an explicit
  automated boundary check.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- No concurrency-limit field, config value, or test exists anywhere in this task's own files.

## Verification

```bash
node --test tools/tests/deterministic-task-queue.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Legacy `batch-*` itself (unchanged). Automatic retry of failed tasks. Cross-change
scheduling. Creating sessions or calling `startHumanStep` (`automatic-workflow-continuation`,
task 29 — this task only computes the plan). The combined cross-task-aware review of a
remediation group's fixes (`dependency-invalidation-remediation-review`, task 30). Any form
of concurrent execution, per-task Git worktrees, merge orchestration, or workspace isolation.
