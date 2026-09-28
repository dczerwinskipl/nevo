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
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/readiness-policy.mjs
  - tools/tests/deterministic-task-queue.test.mjs
  - tools/tests/batch-queue-reservation.test.mjs
  - tools/tests/batch-barrier-enforcement.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - tools/specs/lifecycle/batch.mjs
  - src/**
depends_on: [ execution-scope-model ]
semantic_references:
  decisions: [D5, D6, D9, D12, D18, D19, D20, D31, D36]
  constraints: [C2]
  dependency_contracts: [execution-scope-model]
---

# Task: Batch queue reservation and action barrier

## Goal

Let the sequential queue durably reserve an explicit, compatible set of ready review items as one
unit consumed by one `task-batch` execution, without changing ordinary single-item scheduling for
any other queue item, and without introducing any concurrency (D33 unchanged). **Also implement
the canonical action barrier (D31)**: the same reservation record is the barrier state, and this
task wires `isTaskBarriered` checks into the real workflow-core mutation boundaries — not only
into dashboard projection.

## Dependencies

`execution-scope-model` — the `ExecutionScope` type a reservation's group becomes when the batch
session is created, and the shared `resolveIncomingExecution` resolver this task's compatibility
check reuses.

## Implementation constraints

- The batch-selection (compatibility) function is a pure function reusing the existing
  `ExecutionReadiness`/role-resolution the queue evaluator already reads, plus `execution-scope-model`'s
  `resolveIncomingExecution` (D20) for the "same authoritative incoming-transition role" check — it
  is not a second, parallel eligibility computation, and it never re-derives transition matching.
  It enforces strict compatibility criteria:
  1. Same change (`spec_id` / `slug`);
  2. Same target workflow step (e.g. `review`);
  3. Same authoritative incoming-transition role (`executor: agent`, role e.g. `reviewer`, resolved
     via `resolveIncomingExecution`, never re-derived inline);
  4. All members individually eligible and runnable (no unsatisfied dependencies or gate suspensions);
  5. All members require `session: fresh` semantics for the batch session in v1.
- Generate the canonical `batchExecutionId` exactly once, here, at the moment a compatible group is
  reserved (D18) — the single correlation identity every later task's durable record carries. The
  reservation record's identity field is named `batchExecutionId`, not `reservationId`.
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
- Crash recovery uses a **scope-aware** settlement check (D19) — conceptually
  `assessExecutionSettlement({ executionScope, batchExecutionId, ... })` or a dedicated batch
  checker — verifying the durable batch session/finish state as a whole. Do not reuse the existing
  singular `assessExecutionSettlement({ taskId })` by picking one member as representative; a
  reservation with no corresponding live/settled execution is never force-cleared without that
  scope-aware proof.
- **Synchronous rollback (D19)**: if reservation succeeds but admission/session creation then
  fails, release the reservation synchronously, in the same call — do not leave this for boot-time
  recovery to discover later.
- Provider/model/mode selection for the resulting session is untouched by this task (D12) — this
  task only produces the reserved scope, session creation and its provider picker belong to
  `dashboard-batch-review-ux`.
- **Action barrier wiring (D31)**: export `isTaskBarriered(change, taskId)` from this task's own
  queue/reservation module (no separate `batch-barrier.mjs`). Add an explicit guard call — before
  any existing mutation/readiness logic runs — at each of:
  1. `readiness-policy.mjs`'s `assertExecutionReadiness` (a barriered task is never reported
     ready);
  2. `step-runner.mjs`'s step-activation entry point (rejects a barriered task's
     `workflow step start`, including a direct/raw CLI invocation, not only dashboard-mediated
     dispatch);
  3. `human-step/operations.mjs`'s `activateAndSubmitHumanStep` (rejects a barriered task's human
     submission from any caller).
  The queue evaluator's own `nextRunnable` exclusion of reserved items (already implemented above)
  is the fourth, already-covered boundary — no separate change needed there.
- Release of the reservation/barrier is **not** this task's job to call — it exposes the release
  function, but `batch-completion-orchestration` (a later task) decides *when* to call it, as part
  of its own ordered sequence (D35).

## Acceptance criteria

- Given three eligible `review`/`reviewer` tasks in the same change, the selection function
  accepts them; given the same three plus one `implementation` task, it rejects the mixed set,
  naming the incompatible member. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- While a group is reserved, `nextRunnable` never returns a reserved member but does return an
  eligible non-member item unchanged. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- A crashed reservation (no live/settled execution) is reconciled via the scope-aware settlement
  check, never by inspecting one representative member, and never auto-cleared without proof.
  `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- If admission/session creation fails right after a successful reservation, the reservation is
  released synchronously in that same call. `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- Every member of a reserved group shares one `batchExecutionId`, generated exactly once at
  reservation time, matching the batch session's own `executionScope.taskIds` once created (D36).
  `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- While a member is barriered: `assertExecutionReadiness` reports it not ready;
  a **direct** call to `workflow step start` for it is rejected (not merely hidden from the
  dashboard); a **direct** call to `activateAndSubmitHumanStep` for it is rejected — each proven
  independently. `automated: node --test tools/tests/batch-barrier-enforcement.test.mjs`
- Existing single-item queue behavior is unchanged. `automated: node --test tools/tests/deterministic-task-queue.test.mjs`
- Existing single-task readiness/step-start/human-step behavior for a non-barriered task is
  unchanged. `automated: node --test tools/tests/batch-barrier-enforcement.test.mjs`

## Verification

```bash
node --test tools/tests/batch-queue-reservation.test.mjs tools/tests/batch-barrier-enforcement.test.mjs tools/tests/deterministic-task-queue.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/workflow-engine.md`'s sequential-queue description to include group
reservation, in the same branch.

## Out of scope

Automatic/heuristic grouping (D5, deferred). Session creation and its provider/model/mode picker
(`dashboard-batch-review-ux`). Activating member steps or resolving `StepContext`/`BatchContext`
(`batch-start-and-context-bootstrap`). The batch-finish operation itself (`batch-finish-operation`)
— this task only reserves queue items and exposes the barrier check, it never applies a task
mutation. Deciding *when* to release the barrier, and continuation dispatch
(`batch-completion-orchestration`, D35) — this task only exposes the release mechanism.
