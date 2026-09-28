# Area: Batch completion orchestration

## Responsibility

Own the dashboard-orchestration side of the batch lifecycle that `batch-finish-operation`
explicitly does not (D16): batch-aware Hook1 terminal-settlement observation, detecting batch
completion from the durable finish record, then the exact terminal ordering D35 defines — release
the workspace-writer claim, clear the batch's `activeExecutions` entry, atomically release the
barrier/reservation (D31 — the reservation *is* the barrier; this area does not own a separate
barrier file), and only then dispatch every affected member's next action, including an immediate
fresh refiner for any member whose result requires one.

## Current state

- Single-task continuation (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`,
  `reconcileContinuation`, lines 392–485, triggered from `admission.mjs`'s Hook1 callback once a
  turn settles) dispatches one task's continuation immediately after that task's own transition —
  there is no batch-aware equivalent, and no concept of "hold dispatch until N tasks are all
  done" anywhere in this module today.
- `batch-finish-operation` (workflow-core, `tools/specs/workflow/**`) durably reaches `completed`
  but never imports or calls into `tools/dashboard/**` (D16) — this area is the only thing that
  observes that state from the dashboard-orchestration side.
- **Correction (D31):** an earlier draft of this area proposed owning a separate durable
  "batch-barrier" record/file. That record is removed — `batch-queue-reservation`'s own
  reservation *is* the canonical barrier state (D36: avoids a third independent membership copy),
  and the real enforcement (the four checks at `ExecutionReadiness`/`workflow step start`/
  `activateAndSubmitHumanStep`/queue dispatch) lives in that area, in workflow-core. This area's
  own job regarding the barrier is narrower than originally drafted: **release** it, in the
  correct order, once the batch is genuinely done — it does not define or enforce it.
- No workspace-writer claim currently has batch-aware release semantics — the existing release
  paths assume a single-task claim.

## Requirements

- **Batch-aware Hook1 observation.** When a batch reviewer session's turn settles, this area's
  own Hook1-equivalent path checks whether the settled turn belongs to a `task-batch`-scoped
  session and, if so, does **not** run ordinary single-task `reconcileContinuation` for any member
  — it instead checks the durable batch-finish record's state.
- **Exact terminal ordering (D35) — never reordered, never partially applied.** Once the provider
  turn is terminal, the batch-finish record reads `completed`, and scope-aware settlement is
  proven (the same discipline D19 already applies to reservation recovery, applied here to
  completion):
  1. **Release the batch workspace-writer claim.**
  2. **Clear the `activeExecutions` batch record** (`admission.mjs`).
  3. **Atomically release the barrier/reservation** (`batch-queue-reservation`'s own release
     function, D31) — for every member at once, never one at a time, to avoid a window where
     some members are unblocked and others aren't for no durable reason.
  4. **Only then** recompute and dispatch each affected member's next action, reusing the
     existing single-task continuation-dispatch function per task — the same function
     `reconcileContinuation` already calls for a single task, invoked once per member here, never
     a new dispatch mechanism. A member whose result requires a fresh refiner is admitted as part
     of this step, with `parentSessionId` set to the batch reviewer session's id (D8/D25) — and
     only *can* be admitted because step 1 already freed the workspace-writer slot.
  **Dispatch (step 4) never happens before claim release (step 1)** — a refiner's own admission
  needs the slot free, and dispatching while the claim is still held would either deadlock or
  require an unsafe workaround.
- **Queue reservation/barrier release.** This area calls `batch-queue-reservation`'s own release
  function as step 3 above — it does not reimplement release logic, and `batch-finish-operation`
  itself never touches the reservation (D16).
- **UI surfacing only, not enforcement.** This area (and/or `human-step/projection.mjs`) may
  additionally read `isTaskBarriered` to show barrier state in the dashboard — this is
  presentation, never the correctness boundary (D31 owns that, in workflow-core).

## Constraints

- This area lives in `tools/dashboard/server/ai/orchestration/**` (application layer) — it is the
  one place allowed to import both workflow-core's durable batch-finish record (read-only) and
  dashboard orchestration primitives; `batch-finish-operation` itself never imports this area or
  anything under `tools/dashboard/**` (C2).
- Never dispatches any member's continuation before all of steps 1–3 complete (D35) — partial
  application is not an intermediate state this area produces.
- Does not own a separate barrier record — releases `batch-queue-reservation`'s own reservation
  (D31/D36).
- Reuses the existing single-task continuation-dispatch function — does not reimplement
  continuation logic.

## Interfaces and boundaries

Exposes: the batch-aware Hook1 observation path, the ordered completion/release sequence.
Consumes: `batch-finish-operation`'s durable `completed` state (read-only observation, never a
call into workflow-core beyond reading its durable record), `batch-queue-reservation`'s
reservation-release function (D31). Consumed by: nothing downstream within this change — this is
the terminal step of the batch lifecycle.

## Area-specific acceptance criteria

- Once the batch-finish record reaches `completed`, the exact order — claim release,
  `activeExecutions` clear, atomic barrier/reservation release, dispatch — is observed in that
  order, every time, proven directly (not merely that all four eventually happen).
- Dispatch for any member never occurs while the batch workspace-writer claim is still held —
  proven by attempting to observe an admission attempt before release and confirming it cannot
  succeed.
- Given member B's result is failure, a fresh single-task refiner for B is admitted immediately
  after batch completion, with `parentSessionId` equal to the batch reviewer session's id, and no
  stale batch claim causes workspace contention for that admission.
- The barrier/reservation releases atomically for every member — no window where one member is
  unblocked while another sibling member is not.

## Dependencies

`areas/batch-finish-operation.md` (the durable `completed` state this area observes),
`areas/batch-queue-reservation.md` (the reservation/barrier this area releases, in the ordering
D35 defines).

## Out of scope

The batch-finish operation's own durable saga (`batch-finish-operation`) — this area never
performs a task's finish mutation itself, only observes its completion. Defining or enforcing the
barrier (`batch-queue-reservation`, D31) — this area only releases it, in the correct order.
Building `BatchContext` or the report. Any UI beyond optional barrier-state surfacing.
