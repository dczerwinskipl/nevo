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
  decisions: [D32, D31]
---

# Task: Deterministic batch orchestrator

## Goal

Build a deterministic, task-oriented scheduler with the checkbox-picker selection model D32
decided: a dashboard UI lets the owner select any set of tasks (pre-checked with currently-
ready ones), starts each independently through `automatic-workflow-continuation`'s own
per-task orchestration, bounded by a concurrency limit, and warns (never hard-blocks) when
the selection includes a task blocked by a dependency outside the selection. The same
scheduler runs a dependency-invalidation remediation group's fix attempts (D31) via the
identical task-oriented path — no separate mechanism for that case.

## Implementation constraints

- New module tree, `tools/specs/workflow/batch/**` — independent of
  `tools/specs/batch/**`/`tools/specs/lifecycle/batch.mjs` (legacy; forbidden paths).
- Accept an explicit set of selected task ids (no named "modes") plus a concurrency limit
  (default a small configurable value, e.g. 3). Compute, for the given selection, which
  selected tasks are ready now vs. blocked by a dependency; for each blocked-and-selected
  task whose blocking dependency is **not** itself in the selection and not yet satisfied,
  produce a structured warning naming the blocking task — never silently start it, never
  reject the whole selection.
- Start ready selected tasks up to the concurrency limit; queue the rest, starting queued
  tasks as running ones free capacity or as previously-blocked selected tasks become ready.
- Each selected task's own execution is delegated entirely to
  `automatic-workflow-continuation`'s per-task orchestration — this module never creates a
  session or calls `finishStep`/`startHumanStep` itself.
- Add the checkbox-picker UI to `specification-overview.tsx` (or the smallest real addition),
  pre-checking currently-ready tasks (read from the existing task-projection/readiness data),
  freely togglable, surfacing the cross-selection dependency warning inline.
- Expose the same scheduling entry point for a dependency-invalidation remediation group's
  task-id set (`areas/dependency-release-and-invalidation.md`) — no separate code path;
  the caller (task 33's review flow) simply passes that group's ids as the selection.

## Acceptance criteria

- Selecting two independently-ready tasks starts both, each with its own implementer
  session, without exceeding the concurrency limit.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- Selecting a task blocked by a dependency that is not in the selection and not yet
  satisfied produces a warning naming that dependency; the rest of the selection still
  starts.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- Selecting a task blocked by a dependency that **is** also in the selection produces no
  warning for that pair — the dependency starts, and the dependent starts once satisfied
  (including via a `releasesDependencies` milestone, task 28).
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- The concurrency limit is enforced: selecting more ready tasks than the limit queues the
  excess rather than starting them immediately.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- Passing a remediation group's task-id set (task 28) through this same entry point starts
  each group member's fix attempt identically to a manual selection of the same ids.
  `automated: node --test tools/tests/deterministic-batch-orchestrator.test.mjs`
- A web dashboard interaction can check/uncheck tasks (pre-checked with ready ones) and start
  the resulting selection end to end.

## Verification

```bash
node --test tools/tests/deterministic-batch-orchestrator.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Legacy `batch-*` itself (unchanged). Automatic retry of failed tasks. Cross-change
scheduling. The combined cross-task-aware review of a remediation group's fixes
(`areas/dependency-invalidation-remediation-review.md`, task 33) — this task only runs the
fix attempts.
