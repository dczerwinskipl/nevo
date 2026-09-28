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
  compatible review batch:
  1. **Same change**: all member tasks belong to the same specification/change (`spec_id` / `slug`);
  2. **Same target step**: all member tasks are currently targeting the exact same workflow step (e.g. `review`);
  3. **Same authoritative incoming-transition role**: resolved via `execution-scope-model`'s
     shared `resolveIncomingExecution` (D20), never re-derived inline here — the step defines
     `executor: agent`, and every member's authoritative incoming transition resolves the same
     role (e.g. `reviewer`) and `session: fresh`. Role/session belong to the transition, never
     the step.
  4. **Individually eligible**: all member tasks are individually eligible and runnable for that step per `ExecutionReadiness` (no pending prerequisites, unsatisfied dependencies, or gate suspensions);
  5. **Fresh session semantics**: in v1, all member tasks require `session: fresh` semantics for the batch session. A batch review execution always executes in a fresh, dedicated session and never attaches to an existing single-task session.
- Grouping is **explicit and user-triggered only** (D5) — the batch-selection function is called
  against an owner/agent-supplied candidate task-id list, never invoked automatically by the
  queue evaluator on its own.
- No architectural batch-size limit (D6) — the selection function accepts any compatible set
  size ≥ 2 (a size-1 "batch" is just a single-task execution).
- **Canonical `batchExecutionId` (D18).** Generated exactly once, here, when a compatible group is
  reserved — this is the one correlation identity carried through every other durable record this
  change introduces (batch session, `BatchContext`, report path, batch-start operation,
  batch-finish record, barrier record). `ExecutionScope` remains the separate, canonical
  *membership* source (D2); `batchExecutionId` never doubles as a second scope authority.
- A **durable reservation** record (extends the existing queue store —
  `.nevo-ai-local/task-queues/<changeSlug>.json` — with a `groupReservations` list:
  `{batchExecutionId, taskIds, status: "reserved"|"released", createdAt}` — the identity field is
  `batchExecutionId`, not a separate `reservationId`) marks the exact grouped items as consumed by
  one pending/active `task-batch` execution. While reserved, none of the group's member items are
  offered as `nextRunnable` to any other candidate — but every non-member eligible item continues
  to be selected normally; a batch reservation never pauses the whole queue.
- Reservation lifecycle:
  - **Selection**: the batch-selection function validates compatibility.
  - **Reservation**: an atomic write (same critical-section convention the workspace-control lock
    already uses) claims the group and generates `batchExecutionId` before the batch session is
    created.
  - **Synchronous rollback (D19)**: if reservation succeeds but admission/session creation then
    fails, the reservation is released synchronously, in the same call — never left for boot-time
    recovery to discover later.
  - **Completion**: cleared when `batch-finish-operation` durably completes, or on explicit
    cancellation before any task mutation occurs.
  - **Scope-aware crash recovery (D19)**: a reservation with no corresponding live/settled
    execution is reconciled via a **scope-aware** settlement check — conceptually
    `assessExecutionSettlement({ executionScope, batchExecutionId, ... })` or a dedicated batch
    checker, verifying the durable batch session/finish state as a whole — never by checking one
    arbitrary member task as a representative (the existing `assessExecutionSettlement({ taskId })`
    is singular and must not be reused as-is for a batch). Never silently dropped, never
    force-cleared without proof of settlement.
- **Execution policy resolution for the batch (D12)**:
  - Provider and mode are selected once for the entire batch execution, not per task.
  - If individual member tasks have conflicting task-level overrides in `executionPolicy`:
    - The system must detect and surface the override conflict;
    - The user must explicitly choose the execution configuration for the batch (or specify a one-off override), rather than silently inheriting the first task's override.
  - If all grouped tasks share the same resolved policy or fall back to the same role/default policy, that configuration is preselected as the baseline.

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
Consumes: `execution-scope-model`'s `ExecutionScope` type and shared `resolveIncomingExecution`
resolver (a reservation's `taskIds` becomes the `task-batch` scope's `taskIds` when the session is
created), the existing `ExecutionReadiness` the queue evaluator already reads.

## Area-specific acceptance criteria

- Given three eligible `review`/`reviewer` tasks in the same change, the batch-selection function
  accepts them as compatible; given the same three plus one `implementation` task, it rejects the
  mixed set naming the incompatible member.
- While a group is reserved, `evaluateTaskQueue`'s `nextRunnable` never returns a reserved
  member, but does return an eligible non-member item unchanged.
- A crashed reservation (no live/settled execution) is reconciled via the scope-aware settlement
  check, never by inspecting one representative member, and never auto-cleared without proof.
- If admission/session creation fails right after a successful reservation, the reservation is
  released synchronously in that same call — proven directly, not inferred from later boot
  recovery.
- Every member of a reserved group shares one `batchExecutionId`, generated exactly once at
  reservation time.
- Existing single-item queue tests (`deterministic-task-queue.test.mjs`) pass unmodified.

## Dependencies

`areas/execution-scope-model.md` (the `ExecutionScope` type a reservation's group becomes, and
the shared `resolveIncomingExecution` resolver this area's compatibility check reuses).

## Out of scope

Automatic/heuristic grouping (D5, deferred). Any concurrency of dispatch. Activating member steps
or resolving `StepContext` (`batch-start-and-context-bootstrap`). The batch-finish operation
itself (`batch-finish-operation`) — this area only reserves the queue items, it does not apply
task mutations. Continuation dispatch (`batch-completion-orchestration`).
