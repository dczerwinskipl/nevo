---
id: deterministic-status-architecture.deterministic-sequential-queue
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/deterministic-sequential-queue.md
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
  decisions: [D32, D33, D34, D38, D45]
---

# Task: Deterministic sequential queue (renamed from "batch orchestrator", D46)

## Goal

Build a **pure domain** sequential queue under `tools/specs/workflow/queue/**` (D38) — zero
AI/session/dashboard awareness — implementing the eligibility/ordering half of the
single-active-execution invariant (D33): computes exactly one `nextRunnable` item, ordered by
declarative `schedulingPriority` (D34), never by step-name comparison. **This task does not
decide whether an execution may actually start** — that atomic admission decision is
`admitAgentExecution` (D41, owned by `automatic-workflow-continuation`, task 29), which calls this
module for "what's next" and separately claims the spec-level slot. This task must not
contain any concurrency limit, bounded-concurrency value, or "start N sessions" concept of
any kind.

## Implementation constraints

- `tools/specs/workflow/queue/**` (new): pure functions/small durable-state module. Exports a
  queue-state function: given selected+queued task ids for a change, each task's
  `ExecutionReadiness` verdict (already-existing layer, task 13, now composing
  `TaskProjection` + `SuspensionProjection` per D44 — this module reads the composed verdict,
  never `TaskProjection`/`suspensions` directly itself), and each candidate transition's
  `schedulingPriority`/`continuation`, returns `{eligible: TaskStepRef[], nextRunnable:
  TaskStepRef | null, warnings: {taskId, blockedByTaskId}[]}`. **`nextRunnable` is always
  exactly one item or `null` — never an array, never a set.**
- Ordering: sort eligible items by `(schedulingPriority ascending, task.order ascending,
  eligibleAt ascending)` — first item wins. No `if`/`switch`/lookup keyed on a step id or
  name anywhere in this module.
- **A suspended task is ineligible (D37/D44); a pending human decision elsewhere is not
  (D45).** A task with a non-empty `suspensions` (surfaced through `ExecutionReadiness`'s
  refusal) is excluded from `eligible` exactly like any other readiness failure. A *different*
  task's pending human interaction never affects this task's own eligibility — the queue
  computes eligibility per task/step independently; nothing in this module checks "is some
  other task waiting on a human."
- **Zero imports from `tools/dashboard/**` (D38, enforced).** Add an explicit import-boundary
  check (mirroring D8's own regression-test pattern) asserting no file under
  `tools/specs/workflow/queue/**` imports `tools/dashboard/**`.
- Durable queue-membership state: persist selected/queued task ids for a change using the
  same `.nevo-ai-local/`-local-runtime convention already used elsewhere in this directory
  tree — "pure" here means no AI/session awareness, not "no I/O."
- The checkbox-picker UI itself is owned by `dashboard-orchestration-wiring` (task 32), which
  calls this module's function and renders `warnings` inline — this task owns no UI file.
- Remediation-group reuse (D31): accept a remediation group's task-id set
  (`tools/specs/workflow/remediation-record.mjs`, task 27) as an ordinary selection — no
  separate code path.
- **Do not add a concurrency limit, a "max parallel sessions" config, or any mechanism that
  could return more than one `nextRunnable` item.**

## Acceptance criteria

- Given a selection containing a task blocked by an unselected, unsatisfied dependency, the
  queue function returns a warning naming that dependency without refusing the selection.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Given a selection containing a suspended task, the queue function excludes it from
  `eligible` (via `ExecutionReadiness`'s own refusal) — proven directly, not inferred.
  `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Given a task with no suspension of its own, but a *different* task in the same spec has a
  pending human interaction, the first task's eligibility is unaffected.
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
scheduling. The `admitAgentExecution` atomic admission gate (`automatic-workflow-continuation`,
task 29 — this task only computes the plan). Creating sessions or calling `startHumanStep`
(task 29). The combined cross-task-aware review of a remediation group's fixes
(`dependency-invalidation-remediation-review`, task 30). Any form of concurrent execution,
per-task Git worktrees, merge orchestration, or workspace isolation.
