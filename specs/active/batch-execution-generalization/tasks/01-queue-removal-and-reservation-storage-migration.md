---
id: queue-removal-and-reservation-storage-migration
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/specs/workflow/queue/store.mjs
    - tools/specs/workflow/queue/evaluator.mjs
    - tools/specs/workflow/queue/reservation.mjs
    - tools/specs/workflow/queue/index.mjs
    - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
    - tools/dashboard/server/ai/orchestration/reconciliation.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/specs/workflow/queue/store.mjs
  - tools/specs/workflow/queue/evaluator.mjs
  - tools/specs/workflow/queue/reservation.mjs
  - tools/specs/workflow/queue/index.mjs
  - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - .nevo-ai/workflows/standard-v1.yaml
  - .nevo-ai/workflows/standard.yaml
  - tools/specs/workflow/templates/standard.yaml
  - tools/tests/deterministic-task-queue.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
---

# Task: Retire the generic sequential queue; re-home batch reservations

## Goal

Per `discovery.md`'s repository facts: the generic durable sequential queue
(`enqueueTasks`/`dequeueTask`/`evaluateTaskQueue`'s cross-task selection,
`schedulingPriority`) has no caller that single-task Start or same-task
auto-continuation actually needs — it is the mechanism responsible for the original
runaway-session incident, already worked around in `execution-settlement.mjs`
(`81bcfe45`) but never actually needed. Remove it. Separately, `groupReservations`
(the batch barrier/reservation) is call-graph independent of the plain queue but
storage-coupled to it (`reservation.mjs:8` imports `loadTaskQueue`/`saveTaskQueue`
from the same `store.mjs`, same JSON record). Re-home it to its own storage — owner's
decision: do this now, no compatibility shim perpetuating the old `task-queues` file.

## Requirements

- `deterministic-execution-plan.mjs`: resolve the single target task directly via
  canonical readiness (`evaluateBaseExecutionReadiness`/`evaluateExecutionReadiness` +
  `isTaskBarriered`), without loading or evaluating the durable queue file.
- `reconciliation.mjs`: keep `reconcileWorkflowPosition`'s same-task
  `continuationPolicy === 'auto'` gate and its direct admission, without calling
  `enqueueTasks`/`evaluateTaskQueue`. **Delete** the queue-wide drain section
  (`reconcileContinuation`'s multi-task durable-queue-draining path) outright — this
  is the mechanism with no `continuationPolicy` gate that caused the incident.
- `admission.mjs`: remove the single-task `dequeueTask` call site (no longer needed
  once nothing enqueues).
- `queue/store.mjs`, `queue/evaluator.mjs`: delete entirely (`enqueueTasks`,
  `dequeueTask`, `loadTaskQueue`, `saveTaskQueue`, `evaluateTaskQueue`,
  `computeQueueState`, `clearTaskQueue`, `listTaskQueues`, and the
  `schedulingPriority` sort key).
- `queue/reservation.mjs`: change its storage to a new, dedicated file
  (e.g. `.nevo-ai-local/batch-reservations/<changeSlug>.json`) owned entirely by this
  module — no dependency on `store.mjs`'s `loadTaskQueue`/`saveTaskQueue`. Preserve
  every existing exported function's behavior (`createGroupReservation`,
  `releaseGroupReservation`, `validateBatchCompatibility`, `isTaskBarriered`,
  `getTaskReservation`, `assessBatchReservationSettlement`,
  `reconcileCrashedReservation`) — this task changes *where* reservations are
  persisted, not their semantics (semantics change in task 02).
- `queue/index.mjs`: drop the plain-queue re-exports; keep the reservation re-exports.
- `definitions/schema.mjs`, the three workflow YAML files: remove `schedulingPriority`
  (schema field and its only non-default usage, `review: schedulingPriority: 10`).
- `tools/tests/deterministic-task-queue.test.mjs`: delete or rewrite — it directly
  tests the sort behavior being removed (its own `AC4`).

## Implementation constraints

- This task does not touch `isTaskBarriered`'s own logic or its 4 consumers outside
  the queue directory (`readiness-policy.mjs`, `cli.mjs`, `human-step/*.mjs`) — they
  import from `queue/reservation.mjs` directly and are unaffected by the storage move
  as long as the module's public functions keep their existing signatures.
- Do not touch `batch-start/`, `batch-finish/`, or `batch-context.mjs` — those are
  tasks 02-05's scope.

## Acceptance criteria

- `enqueueTasks`/`dequeueTask`/`loadTaskQueue`/`saveTaskQueue`/`evaluateTaskQueue`/
  `schedulingPriority` no longer exist anywhere in `tools/specs/workflow/queue/**`.
  `inspection: grep -rn "enqueueTasks\|dequeueTask\|evaluateTaskQueue\|schedulingPriority" tools/specs tools/dashboard --include=*.mjs`
  returns no production matches.
- A single-task manual Start still works end to end (no queue file touched).
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- Same-task auto-continuation (`continuationPolicy: auto`) still works end to end.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `groupReservations` functions (create/release/validate/barrier/settlement/crash-
  recovery) behave identically from the caller's perspective, now persisted at their
  own storage location.
  `automated: node --test tools/tests/batch-queue-reservation.test.mjs`
- Full suite has no regression.
  `automated: node --test tools/tests/*.test.mjs`

## Verification

```bash
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Batch admission/finish generalization (tasks 02-05), UI fix (task 06).
