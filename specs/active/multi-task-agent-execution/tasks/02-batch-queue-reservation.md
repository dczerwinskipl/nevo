---
id: multi-task-agent-execution.batch-queue-reservation
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-queue-reservation.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/queue/**
  - tools/tests/deterministic-task-queue.test.mjs
  - tools/tests/batch-queue-reservation.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - tools/specs/lifecycle/batch.mjs
  - src/**
depends_on: [ execution-scope-model ]
semantic_references:
  decisions: [D5, D6, D9, D12]
  constraints: [C2]
  dependency_contracts: [execution-scope-model]
---

# Task: Batch queue reservation

## Goal

Let the sequential queue durably reserve an explicit, compatible set of ready review items as one
unit consumed by one `task-batch` execution, without changing ordinary single-item scheduling for
any other queue item, and without introducing any concurrency (D33 unchanged).

## Dependencies

`execution-scope-model` — the `ExecutionScope` type a reservation's group becomes when the batch
session is created.

## Implementation constraints

- The batch-selection (compatibility) function is a pure function reusing the existing
  `ExecutionReadiness`/role-resolution the queue evaluator already reads — it is not a second,
  parallel eligibility computation.
- Grouping is explicit/user-triggered only (D5) — never invoked automatically by the evaluator on
  its own eligibility pass.
- No hard batch-size limit (D6) — accept any compatible set size ≥ 2.
- The reservation record extends the existing queue store file
  (`.nevo-ai-local/task-queues/<changeSlug>.json`) with a `groupReservations` list; do not
  introduce a second, separate durable file for this. This durable reservation of the exact
  grouped queue items (D9) is this task's central mechanism.
- While reserved, none of the group's member items may be returned as `nextRunnable` to any other
  candidate; every eligible non-member item is returned exactly as today.
- Reservation writes go through the same atomic critical-section convention the workspace-control
  lock already uses — no new locking primitive.
- Crash recovery reuses `assessExecutionSettlement` — a reservation with no corresponding live/
  settled execution is never force-cleared without that proof.
- Provider/model/mode selection for the resulting session is untouched by this task (D12) — this
  task only produces the reserved scope, session creation and its provider picker belong to
  `dashboard-batch-review-ux`.

## Acceptance criteria

- Given three eligible `review`/`reviewer` tasks in the same change, the selection function
  accepts them; given the same three plus one `implementation` task, it rejects the mixed set,
  naming the incompatible member. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- While a group is reserved, `nextRunnable` never returns a reserved member but does return an
  eligible non-member item unchanged. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- A crashed reservation (no live/settled execution) is reconciled via settlement assessment, never
  auto-cleared without it. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- Existing single-item queue behavior is unchanged. `automated: node --test tools/tests/deterministic-task-queue.test.mjs`

## Verification

```bash
node --test tools/tests/batch-queue-reservation.test.mjs tools/tests/deterministic-task-queue.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/workflow-engine.md`'s sequential-queue description to include group
reservation, in the same branch.

## Out of scope

Automatic/heuristic grouping (D5, deferred). Session creation and its provider/model/mode picker
(`dashboard-batch-review-ux`). The batch-finish operation itself (`batch-finish-operation`) — this
task only reserves queue items, it never applies a task mutation.
