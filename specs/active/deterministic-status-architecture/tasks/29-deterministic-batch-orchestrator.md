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
  - tools/specs/workflow/batch/**
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/tests/deterministic-batch-orchestrator.test.mjs
forbidden_paths:
  - tools/specs/batch/**
  - tools/specs/lifecycle/batch.mjs
  - src/**
depends_on: [ automatic-workflow-continuation, dependency-release-and-invalidation ]
semantic_references:
  decisions: []
---

# Task: Deterministic batch orchestrator

## Goal

Build a deterministic, task-oriented scheduler that starts several independently-ready tasks
and lets each continue through `automatic-workflow-continuation`'s own per-task orchestration,
bounded by a concurrency limit, without reusing legacy `batch-*` implementation. **The default
selection mode and concurrency limit are OQ-B, not yet answered by the owner — this task's
acceptance criteria for the default behavior are provisional until answered; the mechanism
itself (selection modes, concurrency bounding, enqueue-on-release) is not blocked.**

## Implementation constraints

- New module tree, `tools/specs/workflow/batch/**` — independent of
  `tools/specs/batch/**`/`tools/specs/lifecycle/batch.mjs` (legacy; forbidden paths). Reuse
  legacy selection-mode *vocabulary* only where genuinely applicable; do not import legacy
  batch code.
- Implement all three selection modes: `currently-ready`, `named-subset` (explicit task-id
  list), `all-approved-reachable` (the approved DAG, including tasks reachable only via a
  `releasesDependencies` milestone from `dependency-release-and-invalidation`, task 28).
- Enforce a configurable concurrency limit — never start more sessions concurrently than the
  limit; queue the excess.
- When a dependency-release milestone makes a new task ready mid-run, enqueue it only if the
  active run's selection mode covers it (`currently-ready`/`all-approved-reachable`: yes;
  `named-subset`: only if named).
- Each selected task's own execution is delegated entirely to
  `automatic-workflow-continuation`'s per-task orchestration — this module never creates a
  session or calls `finishStep`/`startHumanStep` itself.
- Add a dashboard UI surface (in `specification-overview.tsx`, or the smallest addition that
  lets a user select/start multiple ready tasks) — a web path is required, not CLI-only.
- **Do not hardcode a specific default selection mode or concurrency number as final** — wire
  both as explicit, named configuration values (e.g. exported constants or a definition-level
  config field) so the actual default can be set/changed in one place once OQ-B is answered,
  without touching the scheduler's core logic.

## Acceptance criteria

- `currently-ready` selection on a change with two independently-ready tasks starts both,
  each with its own implementer session, without exceeding the concurrency limit.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- `named-subset` selection starts only the named tasks, even if other tasks are also ready.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- `all-approved-reachable` selection includes a task made reachable only via a
  `releasesDependencies` milestone, not only tasks satisfied by a terminal transition.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- The concurrency limit is enforced: selecting more ready tasks than the limit queues the
  excess rather than starting them immediately.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- A web dashboard interaction can select and start a named subset of ready tasks end to end.
- **Provisional, pending OQ-B:** once the owner answers, the confirmed default selection mode
  and concurrency limit are exercised as the no-argument invocation's actual behavior — not
  claimed as complete until then.

## Verification

```bash
node --test tools/tests/deterministic-batch-orchestrator.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Legacy `batch-*` itself (unchanged). Automatic retry of failed tasks. Cross-change
scheduling. The default selection mode/concurrency value (OQ-B, set once answered).
