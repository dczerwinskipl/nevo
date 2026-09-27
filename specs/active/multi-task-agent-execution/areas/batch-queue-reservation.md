# Area: Batch queue reservation

## Responsibility

Let the sequential queue understand that several queued review items may be consumed by one
`task-batch` execution: selection (compatibility check), durable reservation of the exact group,
removal/completion, and crash recovery — without changing ordinary single-item scheduling for
every other queue item.

## Current state

- `evaluateTaskQueue` (`tools/specs/workflow/queue/evaluator.mjs`, lines 73–196): computes
  exactly one `nextRunnable` item or `null` — "never an array, never a set (D33)" (line 188-189).
  Sort order: `(schedulingPriority asc, task.order asc, eligibleAt asc)`.
- Durable queue membership: `.nevo-ai-local/task-queues/<changeSlug>.json`
  (`tools/specs/workflow/queue/store.mjs`) — a flat `taskIds: string[]` + `eligibleAt` map, no
  grouping/session concept.
- Role-based execution policy (`tools/dashboard/server/ai/sessions/execution-policy-service.mjs`,
  `resolveExecutionPolicy`, lines 145–191): precedence task override > role > change-level
  default, persisted at `.nevo-ai-local/execution-policy/<changeSlug>.json`.
- `standard-v1.yaml`'s `review` step already declares `execution: {session: fresh, role:
  reviewer}` on its inbound transition and `value: pass|fail` on its outbound transitions — the
  generic transition-value vocabulary this change's batch-finish reuses (`areas/batch-finish-operation.md`).

## Requirements

- A **batch-selection function** determines whether a candidate set of queue items is a
  compatible review batch: same specification/change, all currently eligible (per the existing
  `ExecutionReadiness` verdict the queue evaluator already reads), same target workflow step,
  executor `agent`, same effective execution role (via `execution-policy-service.mjs`'s existing
  resolution), no incompatible suspension/blocking state on any member. Reuses the existing
  eligibility computation — it is not a second, parallel eligibility check.
- Grouping is **explicit and user-triggered only** (D5) — the batch-selection function is called
  against an owner/agent-supplied candidate task-id list, never invoked automatically by the
  queue evaluator on its own.
- No architectural batch-size limit (D6) — the selection function accepts any compatible set
  size ≥ 2 (a size-1 "batch" is just a single-task execution).
- A **durable reservation** record (extends the existing queue store —
  `.nevo-ai-local/task-queues/<changeSlug>.json` — with a `groupReservations` list:
  `{reservationId, taskIds, status: "reserved"|"released", createdAt}`) marks the exact grouped
  items as consumed by one pending/active `task-batch` execution. While reserved, none of the
  group's member items are offered as `nextRunnable` to any other candidate — but every
  non-member eligible item continues to be selected normally; a batch reservation never pauses
  the whole queue.
- Reservation lifecycle:
  - **Selection**: the batch-selection function validates compatibility.
  - **Reservation**: an atomic write (same critical-section convention the workspace-control lock
    already uses) claims the group before the batch session is created.
  - **Completion**: cleared when `batch-finish-operation` durably completes, or on explicit
    cancellation before any task mutation occurs.
  - **Crash recovery**: a reservation with no corresponding live/settled execution is reconciled
    via the same settlement-assessment pattern already established for the workspace-writer claim
    (`assessExecutionSettlement`) — never silently dropped, never force-cleared without proof of
    settlement.
- Provider/model/mode selection for the resulting batch session is the normal, explicit choice a
  single-task session already offers, reusing the existing role-based execution policy unchanged
  (D12) — this area does not special-case it.

## Constraints

- Ordinary single-item scheduling (the existing `nextRunnable` behavior for every non-reserved
  item) must be provably unaffected — same tests, same behavior.
- `tools/specs/workflow/queue/**` continues to import nothing from `tools/dashboard/**`.
- No concurrency: a reservation still yields exactly one eventual `task-batch` execution, never
  parallel dispatch of the group's members.

## Interfaces and boundaries

Exposes: the batch-selection function, the reservation read/write/release functions. Consumed
by: `dashboard-batch-review-ux` (offers compatible sets to the owner, calls reservation on
confirmation), `batch-finish-operation` (releases the reservation on durable completion).
Consumes: `execution-scope-model`'s `ExecutionScope` type (a reservation's `taskIds` becomes the
`task-batch` scope's `taskIds` when the session is created), the existing `ExecutionReadiness`/
role-resolution the queue evaluator already reads.

## Area-specific acceptance criteria

- Given three eligible `review`/`reviewer` tasks in the same change, the batch-selection function
  accepts them as compatible; given the same three plus one `implementation` task, it rejects the
  mixed set naming the incompatible member.
- While a group is reserved, `evaluateTaskQueue`'s `nextRunnable` never returns a reserved
  member, but does return an eligible non-member item unchanged.
- A crashed reservation (no live/settled execution) is reconciled via settlement assessment, never
  auto-cleared without it.
- Existing single-item queue tests (`deterministic-task-queue.test.mjs`) pass unmodified.

## Dependencies

`areas/execution-scope-model.md` (the `ExecutionScope` type a reservation's group becomes).

## Out of scope

Automatic/heuristic grouping (D5, deferred). Any concurrency of dispatch. The batch-finish
operation itself (`batch-finish-operation`) — this area only reserves the queue items, it does
not apply task mutations or dispatch continuations.
