---
id: deterministic-status-architecture.dependency-release-and-invalidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/specs/workflow/task-projection.mjs
  - tools/tests/deterministic-dependency-satisfaction.test.mjs
  - tools/tests/deterministic-task-projection.test.mjs
forbidden_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/dashboard/**
depends_on: [ workflow-continuation-schema ]
semantic_references:
  decisions: [D28]
---

# Task: Dependency release and invalidation

## Goal

Implement the declarative release half decided by D28: `evaluateDependencySatisfaction`
reads a matched internal transition's `releasesDependencies: true` (task 26's schema) as an
alternate satisfaction path, alongside the existing, unchanged terminal-transition
`outcome: success` path (D9). **The invalidation half (what happens when a released
dependency's review later fails) is OQ-A, not yet answered by the owner — do not implement
it.** This task's scope, until OQ-A is answered, is the release half only; its acceptance
criteria below are split accordingly, with the invalidation criteria marked blocked.

## Implementation constraints

- `evaluateDependencySatisfaction`: alongside the existing terminal-transition-with-
  `outcome: success` check, also satisfy a dependent when the dependency's last
  `workflow_progress.history` entry matches an *internal* transition declaring
  `releasesDependencies: true` — resolved the same way the existing check resolves the
  matched transition (against the definition's declared `transitions` for that step), never
  by step name.
- Do not change the existing terminal-transition path's behavior at all — every existing test
  covering it must pass unchanged.
- **Stop here pending OQ-A.** Do not add a `blockedBy`/suspension field, a "stale" state, or
  any invalidation-consequence code until the owner has answered OQ-A
  (`areas/dependency-release-and-invalidation.md`). If OQ-A is answered before this task is
  implemented, this task's scope expands to include it — update this file's own acceptance
  criteria to no longer be provisional before starting that half.

## Acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` satisfies its
  dependents while the dependency's own workflow is still `active` at a later step (e.g.
  `review`) — proven directly against `evaluateDependencySatisfaction`'s output, not
  inferred.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Every existing terminal-transition-`outcome: success` test continues passing unchanged.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A dependency with no `releasesDependencies`-marked transition anywhere in its history
  behaves exactly as today — dependents wait for its terminal transition.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- **Blocked pending OQ-A** — invalidation-consequence acceptance criteria are written and
  finalized only once the owner answers OQ-A; this task does not claim to satisfy them yet.

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The invalidation consequence (OQ-A, blocked). The batch scheduler that consumes this release
signal (`deterministic-batch-orchestrator`, task 29). The `releasesDependencies` schema field
itself (`workflow-continuation-schema`, task 26).
