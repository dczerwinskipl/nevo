# Area: Batch completion orchestration

## Responsibility

Own the dashboard-orchestration side of the batch lifecycle that `batch-finish-operation`
explicitly does not: batch-aware Hook1 terminal-settlement observation, detecting batch
completion from the durable finish record, releasing the continuation barrier, and dispatching
every affected task's next action once released (D16). Also owns enforcing the barrier invariant
(D17) — no downstream action executes for any batch member while the batch is incomplete.

## Current state

- Single-task continuation (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`,
  `reconcileContinuation`, lines 392–485, triggered from `admission.mjs`'s Hook1 callback once a
  turn settles) dispatches one task's continuation immediately after that task's own transition —
  there is no batch-aware equivalent, and no concept of "hold dispatch until N tasks are all
  done" anywhere in this module today.
- `batch-finish-operation` (workflow-core, `tools/specs/workflow/**`) durably reaches `completed`
  but never imports or calls into `tools/dashboard/**` (D16) — this area is the only thing that
  observes that state from the dashboard-orchestration side.
- No durable "barrier" concept exists in readiness/action projection or reconciliation today —
  every projection assumes a task's own `workflow_progress` state is immediately actionable once
  written.

## Requirements

- **Batch-aware Hook1 observation.** When a batch reviewer session's turn settles, this area's
  own Hook1-equivalent path checks whether the settled turn belongs to a `task-batch`-scoped
  session and, if so, does **not** run ordinary single-task `reconcileContinuation` for any member
  — it instead checks the durable batch-finish record's state.
- **Barrier record.** An active batch-barrier record (keyed by `batchExecutionId`, naming its
  member `taskIds`) exists for the lifetime between reservation and the batch-finish record
  reaching `completed`. Readiness/action projection and reconciliation consult this record before
  executing any of the following for a task it still lists as barriered (D17): automatic agent
  continuation, sequential queue dispatch, human-interaction submission, or any other workflow
  start/continuation. A member's own `workflow_progress` state may still be *observable* once its
  individual finish mutation lands (D21 stage 4) — this area blocks *action*, not *visibility*.
- **Completion detection and barrier release.** This area polls/observes (via the same settlement
  hooks D16 references) the batch-finish record; once it reads `completed`, it releases the
  barrier record for every member atomically (not one member at a time, to avoid a window where
  some members are unblocked and others aren't for no durable reason).
- **Continuation dispatch.** Only after the barrier is released does this area recompute and
  dispatch each affected member's next action, reusing the existing single-task
  continuation-dispatch function per task — the same function `reconcileContinuation` already
  calls for a single task, invoked once per member here, never a new dispatch mechanism.
- **Queue reservation release.** This area releases `batch-queue-reservation`'s reservation once
  the barrier is released — `batch-finish-operation` itself never touches the reservation (D16).

## Constraints

- This area lives in `tools/dashboard/server/ai/orchestration/**` (application layer) — it is the
  one place allowed to import both workflow-core's durable batch-finish record and dashboard
  orchestration primitives; `batch-finish-operation` itself never imports this area or anything
  under `tools/dashboard/**` (C2).
- Never dispatches any member's continuation before the barrier is released for every member
  (D17) — partial dispatch is not an intermediate state this area produces.
- Reuses the existing single-task continuation-dispatch function — does not reimplement
  continuation logic.

## Interfaces and boundaries

Exposes: the barrier record (read by readiness/action projection, reconciliation, and the
human-interaction submission path), the batch-aware Hook1 observation path. Consumes:
`batch-finish-operation`'s durable `completed` state (read-only observation, never a call into
workflow-core beyond reading its durable record), `batch-queue-reservation`'s reservation
(released here). Consumed by: every existing dashboard-orchestration action path that must check
the barrier before acting on a batch member.

## Area-specific acceptance criteria

- While the barrier is active for members A/B/C, none of: automatic agent continuation, queue
  dispatch, or human-interaction submission executes for A, B, or C — proven for each path
  individually, not just queue dispatch.
- Once the batch-finish record reaches `completed`, the barrier releases for A/B/C atomically, and
  each of their own next actions dispatches exactly once.
- The queue reservation is released only as part of barrier release, never independently by
  `batch-finish-operation`.
- A member's own `workflow_progress` history entry is readable/observable before the barrier
  releases (proving the barrier blocks action, not visibility, per D17's precise invariant).

## Dependencies

`areas/batch-finish-operation.md` (the durable `completed` state this area observes),
`areas/batch-queue-reservation.md` (the reservation this area releases).

## Out of scope

The batch-finish operation's own durable saga (`batch-finish-operation`) — this area never
performs a task's finish mutation itself, only observes its completion. Building `BatchContext` or
the report. Any UI.
