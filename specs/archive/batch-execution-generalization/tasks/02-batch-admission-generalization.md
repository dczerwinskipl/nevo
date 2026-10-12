---
id: batch-admission-generalization
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/specs/workflow/batch-start/operation.mjs
    - tools/specs/workflow/queue/reservation.mjs
    - tools/specs/workflow/resolve-incoming-execution.mjs
    - tools/specs/workflow/readiness-policy.mjs
    - tools/specs/workflow/task-projection.mjs
    - tools/specs/context/batch-context.mjs
    - tools/specs/workflow/start-operation.mjs
    - tools/specs/workflow/dependency-consumption.mjs
    - tools/specs/workflow/cli.mjs
  optional:
    - tools/specs/workflow/finish-operation.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/specs/workflow/batch-start/operation.mjs
  - tools/specs/workflow/queue/reservation.mjs
  - tools/specs/context/batch-context.mjs
  - tools/tests/batch-start-and-context-bootstrap.test.mjs
  - tools/tests/batch-queue-reservation.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/batch-finish/**
  - tools/specs/workflow/queue/store.mjs
  - tools/specs/workflow/queue/evaluator.mjs
depends_on: []
---

# Task: Generalize batch admission for dependency-ordered, entry-step members

## Goal

Fix `discovery.md` Gaps 1, 4, and the batch-start half of Gap 6: `executeBatchStart`
cannot admit any batch of brand-new tasks today (every entry-step member fails
`resolveIncomingExecution`'s `NO_INCOMING_TRANSITION`), and `validateBatchCompatibility`
rejects any member blocked by another member of the same batch. Fix both; keep
batches homogeneous by full execution contract (confirmed sufficient — a
dependency-blocked task's canonical `nextStep` is unchanged by the block, per
`task-projection.mjs:89-96`). Also allocate each member's dependency-consumption
`consumptionSequence` before activation (reusing `planStart`), snapshotting external
dependency epochs immediately and recording intra-batch edges as pending.

## Requirements

- `validateBatchCompatibility` (`reservation.mjs:81-190`): when a member is
  individually not-`ready` with code `DEPENDENCY_UNSATISFIED`, inspect
  `readiness.blockedBy` — if every blocking id is a member of the *same* candidate
  batch, treat this member as compatible (the dependency becomes an in-batch ordering
  constraint, not a compatibility failure); if any blocking id is outside the batch,
  compatibility still fails exactly as today. The same-`targetStepId`/same-role/
  `session: fresh` checks stay — homogeneity by contract is confirmed correct and is
  not relaxed.
- `executeBatchStart` (`batch-start/operation.mjs:104-141`): remove the redundant
  per-member `assertBaseExecutionReadiness` call (the batch-level compatibility check,
  already run when the reservation was created, is now authoritative for this
  exception — do not re-derive single-task rules here). For incoming-transition
  resolution: accept a member with no workflow history (`resolveIncomingExecution`
  returning `NO_INCOMING_TRANSITION` because `history.length === 0`) as a normal
  entry-step case — these members start fresh, by construction `session: fresh`,
  with no incoming transition to validate. Only check `incoming.session === 'fresh'`
  where an incoming transition actually exists.
- `buildBatchContext` (`batch-context.mjs:151-240`): add `members[].dependsOn` —
  each member's own `task.depends_on`, filtered to ids that are also members of this
  same batch (external dependencies are not the agent's concern inside the session).
- Dependency-consumption (Gap 6, start half): for each member with
  `consumesDependencies === true` on its target step, call `planStart` (reusing
  `start-operation.mjs`'s existing function, same frozen-sequence invariant) before
  that member's own activation, to allocate and freeze its `consumptionSequence`. For
  each of that member's `depends_on` entries: if the dependency is outside the batch,
  resolve its real `releaseEpoch` now (same as `cli.mjs:409-429`'s existing pattern)
  and snapshot it; if the dependency is a member of the same batch, record a pending
  entry (schema detail — e.g. `releaseEpoch: null` — settle the exact shape during
  implementation) in the same `dependencySnapshot` array shape. Do not call
  `recordDependencyConsumption` yet for pending entries — that happens in task 04,
  during batch finish, using this already-allocated sequence.

## Implementation constraints

- Do not add a generic `force`/`ignoreDependencies` escape hatch to ordinary
  single-task readiness (`evaluateBaseExecutionReadiness`) — the in-batch exception
  lives entirely inside `validateBatchCompatibility`'s own batch-scoped evaluation.
- Do not add a per-member target-step field to `BatchContext` — the single shared
  `targetStepName` stays correct for homogeneous batches (confirmed, Gap 4).
- Do not call `recordDependencyConsumption` for intra-batch pending entries in this
  task — only allocate the sequence and snapshot what's already resolvable. Task 04
  owns materializing pending entries.

## Acceptance criteria

- A batch of 3 brand-new tasks (`T1`, `T2 depends_on T1`, `T3 depends_on T1`, none
  with any `workflow_progress`) passes `validateBatchCompatibility` and
  `executeBatchStart` successfully.
  `automated: node --test tools/tests/batch-queue-reservation.test.mjs tools/tests/batch-start-and-context-bootstrap.test.mjs`
- A batch where one member's only blocking dependency is outside the batch still
  fails compatibility with the existing `DEPENDENCY_UNSATISFIED`-derived reason.
  `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- `BatchContext.members[].dependsOn` contains exactly the in-batch dependency ids for
  each member, empty for members with none.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- Each `consumesDependencies` member's `consumptionSequence` is allocated and frozen
  at batch-start time, before activation; external dependencies are snapshotted with
  a real `releaseEpoch`; intra-batch dependencies are recorded pending, not silently
  dropped.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- The existing homogeneous "review together" batch-start path (members already
  individually ready, no intra-batch dependencies) is unchanged.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`

## Verification

```bash
node --test tools/tests/batch-queue-reservation.test.mjs tools/tests/batch-start-and-context-bootstrap.test.mjs
node tools/specs.mjs validate
```

## Out of scope

`BatchFinish` changes (task 03), materializing pending dependency-consumption entries
(task 04), handover partitioning (task 05).
