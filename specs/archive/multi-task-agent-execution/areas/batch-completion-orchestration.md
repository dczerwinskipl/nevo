# Area: Batch completion orchestration

## Responsibility

Own the dashboard-orchestration side of the batch lifecycle that `batch-finish-operation`
explicitly does not (D16): batch-aware Hook1 terminal-settlement observation, detecting batch
completion from the durable finish record, then D35's terminal ordering implemented as D40's
durable, restart-safe settlement saga — release the workspace-writer claim, clear the batch's
`activeExecutions` entry, atomically release the barrier/reservation (D31), and only then
dispatch every affected member's next action. Partial progress between those stores is expected
and reconciled idempotently after a crash; it is never misrepresented as one atomic transaction.

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
- **Exact terminal ordering as a durable staged settlement (D35/D40).** Once provider turn
  terminality, durable batch-finish `completed`, and scope-aware settlement are proven, create
  or resume a settlement record keyed by `batchExecutionId` (e.g.
  `.nevo-ai-local/batch-completion/<change>/<batchExecutionId>.json`). Its ordered stages are:
  1. **claim-release** — release only the workspace-writer claim proven to belong to this batch;
  2. **active-execution-clear** — clear only this batch's `activeExecutions` entry;
  3. **reservation-release** — atomically release this batch's barrier/reservation for all members;
  4. **continuation-dispatch** — per member, reuse the existing single-task continuation/admission
     mechanism; a fresh refiner gets `parentSessionId = batch reviewer session id`;
  5. **completed**.
  Each stage is idempotent and is marked complete only after its authoritative effect is observed.
  On resume, derive current state before acting: if a prior effect landed before its marker, record
  it as satisfied; if a different owner/execution now occupies that slot, fail closed rather than
  clearing it. Dispatch is structurally illegal until authoritative checks prove stages 1–3 are
  satisfied. A crash after dispatch but before its marker reuses existing continuation/admission
  idempotency to observe the already-created continuation rather than duplicate it.
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
- Never dispatches any member continuation before claim release, this batch's active-execution
  clear, and reservation release are all authoritatively true (D35/D40). Partial settlement
  progress is a valid crash state and must be resumable, never treated as corruption merely
  because only some earlier release stages landed.
- Does not own a separate barrier record — releases `batch-queue-reservation`'s own reservation
  (D31/D36).
- Reuses the existing single-task continuation-dispatch function — does not reimplement
  continuation logic.

## Interfaces and boundaries

Exposes: the batch-aware Hook1 observation path and the durable staged completion settlement.
Consumes: `batch-finish-operation`'s durable `completed` state, the batch workspace claim/
admission state, and `batch-queue-reservation`'s reservation-release/read surface. The
settlement record is orchestration metadata only; it never becomes a second authority for claim,
active-execution, reservation, or continuation state. Consumed by: nothing downstream within this change — this is
the terminal step of the batch lifecycle.

## Area-specific acceptance criteria

- Once batch-finish reaches `completed`, the settlement observes claim release →
  `activeExecutions` clear → reservation release → dispatch in that order. Simulated crashes
  after each of the first three effects resume from authoritative current state without clearing
  a different owner, repeating a destructive effect, or dispatching early.
- Dispatch for any member never occurs while the batch workspace-writer claim is still held —
  proven by attempting to observe an admission attempt before release and confirming it cannot
  succeed.
- Given member B's result is failure, a fresh single-task refiner for B is admitted immediately
  after batch completion, with `parentSessionId` equal to the batch reviewer session's id, and no
  stale batch claim causes workspace contention for that admission.
- The barrier/reservation releases atomically for every member — no sibling is individually
  unblocked. A crash after that atomic release but before dispatch is recoverable and dispatch
  resumes idempotently without recreating an already-existing continuation.

## Dependencies

`areas/batch-finish-operation.md` (the durable `completed` state this area observes),
`areas/batch-queue-reservation.md` (the reservation/barrier this area releases, in the ordering
D35 defines).

## Out of scope

The batch-finish operation's own durable saga (`batch-finish-operation`) — this area never
performs a task's finish mutation itself, only observes its completion. Defining or enforcing the
barrier (`batch-queue-reservation`, D31) — this area only releases it, in the correct order.
Building `BatchContext` or the report. Any UI beyond optional barrier-state surfacing.
