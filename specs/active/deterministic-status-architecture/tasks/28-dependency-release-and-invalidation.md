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
  decisions: [D28, D31]
---

# Task: Dependency release and invalidation

## Goal

Implement D28's declarative release: `evaluateDependencySatisfaction` reads a matched
internal transition's `releasesDependencies: true` (task 26's schema) as an alternate
satisfaction path, alongside the existing, unchanged terminal-transition `outcome: success`
path (D9). Implement D31's remediation-group derivation: when a task whose release already
satisfied dependents later transitions backward to an earlier step, derive the set of
dependents that started against that release and haven't reached terminal, and mark the
whole group (root task + those dependents) suspended from starting their own next step via
an extended `TaskProjection.blockedBy` entry — without rolling back any group member's
existing `workflow_progress` history.

## Implementation constraints

- `evaluateDependencySatisfaction`: alongside the existing terminal-transition-with-
  `outcome: success` check, also satisfy a dependent when the dependency's last
  `workflow_progress.history` entry matches an *internal* transition declaring
  `releasesDependencies: true` — resolved the same way the existing check resolves the
  matched transition (against the definition's declared `transitions` for that step), never
  by step name. Do not change the existing terminal-transition path's behavior at all.
- Add a remediation-group derivation function: given a task whose `workflow_progress.history`
  shows a `releasesDependencies` transition followed by a *later* entry for an earlier step
  (i.e. the workflow moved backward from where the release fired), walk the change's other
  tasks' `depends_on` to find dependents that reached `active` on any step while the release
  was in effect and have not reached a terminal transition. Return the root task id plus this
  dependent set as the remediation group.
- Extend `TaskProjection.blockedBy` with a suspension entry shape (e.g. `{taskId, reason:
  'dependency-invalidated', groupId}`) for every group member — additive to whatever
  `blockedBy` already models for ordinary unsatisfied dependencies, not a replacement of that
  existing shape.
- Expose the derivation function so `areas/dependency-invalidation-remediation-review.md`
  (task 33) can re-invoke/extend the group (D31's "group can grow" requirement) — do not
  make the derivation a one-shot internal computation with no external entry point.
- No rollback of any group member's `workflow_progress` history under any circumstance.

## Acceptance criteria

- A dependency whose matched transition declares `releasesDependencies: true` satisfies its
  dependents immediately, before its own workflow reaches a terminal transition.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Every existing terminal-transition-`outcome: success` test continues passing unchanged.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A dependency with no `releasesDependencies`-marked transition anywhere in its history
  behaves exactly as today.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- A fixture with one root task (released dependents, then moved backward) and two
  dependents — one that started against the release, one that didn't — derives a
  remediation group containing exactly the root task and the dependent that started.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`
- Every derived group member's `TaskProjection.blockedBy` contains a
  `dependency-invalidated` entry; none of their `workflow_progress.history` entries are
  modified or removed.
  `automated: node --test tools/tests/deterministic-task-projection.test.mjs`
- The derivation function is externally callable (not private to this module) so task 33 can
  re-invoke it to extend a group.
  `automated: node --test tools/tests/deterministic-dependency-satisfaction.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-dependency-satisfaction.test.mjs
node --test tools/tests/deterministic-task-projection.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Running the remediation group's fix attempts (`areas/deterministic-batch-orchestrator.md`,
task 29). The combined cross-task-aware review and suspension-clearing
(`areas/dependency-invalidation-remediation-review.md`, task 33). The `releasesDependencies`
schema field itself (`workflow-continuation-schema`, task 26).
