---
id: intra-batch-dependency-consumption-materialization
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/specs/workflow/batch-finish/operation.mjs
    - tools/specs/workflow/dependency-consumption.mjs
    - tools/specs/workflow/start-operation.mjs
    - tools/specs/workflow/cli.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/specs/workflow/batch-finish/operation.mjs
  - tools/tests/batch-finish-operation.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/start-operation.mjs
  - tools/specs/workflow/batch-start/**
depends_on: [batch-admission-generalization, batch-finish-phase-neutral-generalization]
---

# Task: Materialize intra-batch dependency-consumption in topological order

## Goal

Complete `discovery.md` Gap 6 (the batch-finish half): task 02 allocates each
member's `consumptionSequence` at batch-start and records intra-batch dependencies as
pending (no `releaseEpoch` yet). This task processes batch members in `depends_on`
topological order during `executeBatchFinish`, and — immediately after an upstream
member's own transition creates its release epoch — materializes any downstream
member's pending entry that pointed at it, calling the existing
`recordDependencyConsumption` with the **already-allocated** `consumptionSequence`
from task 02 (never a new one, preserving `planStart`'s frozen-snapshot invariant).
No new provenance system — this reuses `dependency-consumption.mjs` exactly as the
single-task path does, only the timing differs.

## Requirements

- `executeBatchFinish`'s Stage 4 member loop (as restructured by task 03) must
  process members in `depends_on` topological order among the batch's own members
  (independent members in any stable order, e.g. the batch's own member order).
- After a member's own transition is derived (but the shared commit from task 03 has
  not necessarily landed yet — confirm the exact ordering against task 03's final
  stage sequence during implementation, since dependency-consumption recording is a
  `.nevo-ai-local` write, not a source-control write, so it does not need to wait for
  the shared commit): for every *other*, not-yet-finished member whose pending
  dependency snapshot (from task 02) names this member, resolve the just-created
  `releaseEpoch` and call `recordDependencyConsumption` with that member's own,
  already-allocated `consumptionSequence`, then close that member's `record-
  consumption` stage.
- This must be idempotent/resumable the same way the rest of `BatchFinish`'s stages
  are (durable record, skip if already completed) — a crash between materializing one
  pending entry and finishing the next member must not re-materialize or lose the
  entry on retry.

## Implementation constraints

- Do not change `dependency-consumption.mjs` or `start-operation.mjs`'s own logic
  (forbidden paths) — this task only calls their existing exports in a new place and
  order.
- Do not attempt to wire up `findConsumersOfEpoch`/`createRemediationRecord` or any
  other consumer of these records — confirmed out of scope (zero production call
  sites today, per `discovery.md` Gap 6); this task only keeps the *recorded* data
  correct for intra-batch edges.

## Acceptance criteria

- For `T2 depends_on T1` in the same implementation batch: after batch finish, a
  `recordDependencyConsumption` record exists for `T2` naming `T1`'s real
  `releaseEpoch` (not null/pending), using the `consumptionSequence` that was
  allocated for `T2` at batch-start (not a new one).
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- A member with no intra-batch dependencies is unaffected — its external dependencies
  (already snapshotted at batch-start) are recorded exactly as the single-task path
  would.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Simulating a crash between materializing one pending entry and finishing the next
  member, then resuming, does not duplicate or lose the materialized entry.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/batch-finish-operation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Handover partitioning (task 05). Any change to the dependency-consumption record
schema itself, or to its remediation/invalidation consumer side.
