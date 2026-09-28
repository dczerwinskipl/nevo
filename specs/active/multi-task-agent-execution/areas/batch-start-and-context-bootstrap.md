# Area: Batch start and context bootstrap

## Responsibility

Provide the batch-scoped equivalent of `workflow step start`: activate every reserved member's
target step, resolve each member's authoritative deterministic `StepContext`, and build one
deduplicated `BatchContext` from those `StepContext`s — the operation that actually realizes "read
common context once, while preserving task attribution" (D14, D15). The reviewer session never
calls N independent single-task starts itself.

## Current state

- `workflow step start <change> <task>` (`tools/specs/workflow/cli.mjs` → `step-runner.mjs`)
  activates a single task's target step, establishes attempt identity, and returns the
  authoritative `StepContext` (`taskDefinition`, `requiredContext`, `relevantDocs`, `stepContract`,
  `previousTransition`, `expectedWork`, allowed/forbidden paths, `finishContract`, gates) — see
  `docs/development/workflow-engine.md`. This is single-task only; nothing today activates several
  tasks' steps as one operation.
- `tools/specs/context.mjs`'s `buildContextPacket(change, task)` is the **legacy** lifecycle's own
  context contract, not the deterministic engine's — it is explicitly not reused here (D15).
- No batch-start equivalent, and no `BatchContext` builder, exists anywhere in the repository
  today.

## Requirements

The batch-start operation (D14), conceptually `workflow batch start <change> --batch
<batchExecutionId>` (exact naming open):

1. Resolves the trusted current batch execution identity (the calling session's canonical batch
   session, matched against the reservation's `batchExecutionId` and `ExecutionScope` — same
   trust discipline as `batch-finish-operation`'s D23, applied here at start instead of finish).
2. Validates the request against the exact reserved `ExecutionScope` — no member outside the
   reservation, no missing member.
3. Re-verifies every member is still compatible and ready (re-running the same compatibility
   check `batch-queue-reservation` used at selection time — state may have changed between
   reservation and start).
4. Resolves the shared target step and authoritative incoming execution role/session for every
   member via `execution-scope-model`'s `resolveIncomingExecution` (D20) — never re-derived here.
5. Activates every member's target step, reusing the single-task step-activation mechanism per
   member (the same primitive `workflow step start` itself calls), **idempotently**: activating an
   already-activated member is a no-op keyed off that member's own durable step-activation record,
   never a second activation attempt.
6. Produces one authoritative deterministic `StepContext` per member (the same shape a single-task
   `workflow step start` would have produced for that member alone).
7. Builds one deduplicated `BatchContext` from those `StepContext`s (D15): dedupes
   `requiredContext` documents, `relevantDocs`, and shared files across members, each with
   `usedBy` attribution, while preserving per-member `taskDefinition`, `stepContract`,
   `finishContract`, `previousTransition`, and allowed/forbidden paths.
8. Returns the `BatchContext` to the reviewer session.

**Idempotency and crash recovery for partial activation (D14).** A crash between activating
member A and member B must not silently loop or re-attempt a non-resumable mutation. Resume reads
each member's own durable step-activation record and continues only with members not yet
activated; a member whose re-verification (step 3) fails on resume fails the whole bootstrap the
same way a fresh-request failure would (see below) — it does not leave the batch half-activated
indefinitely.

**Validate-all-before-activate-any.** If re-verification (step 3) fails for any member, the whole
bootstrap fails before any member is activated — the same "validate all before mutating any"
discipline `batch-finish-operation` applies at finish (D21) applies here at start.

**Read-only Git-provenance baseline (D22).** Records `baseRevision = HEAD` at the point activation
begins — the value `batch-finish-operation` later checks unchanged (`HEAD == baseRevision`) to
prove the reviewer made no commits of its own.

**Context-capacity preflight (D26).** Before returning `BatchContext`, checks whether it would
exceed the selected model/provider's actual context capacity. If it would, fails closed with a
distinct, explicit result (conceptually `BATCH_CONTEXT_TOO_LARGE`) rather than silently truncating
context or activating members whose context the reviewer can't actually use. This is a
capability-driven runtime check — it does not reintroduce or substitute for an architectural
task-count limit (D6 stands unchanged).

## Constraints

- No `tools/specs/workflow/**` module this area adds imports `tools/dashboard/**` (C2).
- Reuses the single-task step-activation primitive per member — does not reimplement step
  activation from scratch.
- Reuses `execution-scope-model`'s `resolveIncomingExecution` — does not re-derive transition
  matching.

## Interfaces and boundaries

Exposes: the batch-start operation, `BatchContext`, `baseRevision`. Consumes:
`execution-scope-model`'s `ExecutionScope`/`resolveIncomingExecution`, `batch-queue-reservation`'s
reservation/`batchExecutionId`/compatibility check, the existing single-task `StepContext`
resolution and step-activation primitives. Consumed by: `batch-context-and-report` (builds on
these resolved `StepContext`s rather than re-resolving them), `multi-task-review-skill` (receives
the returned `BatchContext`), `batch-finish-operation` (reads `baseRevision`).

## Area-specific acceptance criteria

- Given three reserved, compatible members, batch start activates all three and returns one
  `BatchContext` with `usedBy`-attributed shared docs/files and per-member specifics — proven
  directly.
- The reviewer session's own work requires zero independent `workflow step start` calls — batch
  start is the only activation path exercised.
- Simulating a crash after activating member A but before B, then resuming, activates exactly B
  (not re-activating A) and completes normally.
- A member that fails re-verification at step 3 causes the whole bootstrap to fail with zero
  members activated.
- A `BatchContext` engineered to exceed a fixture provider's context capacity fails with the
  distinct preflight result, not a silent truncation or a generic activation failure.
- `baseRevision` recorded at batch start matches `HEAD` at that exact point, provable directly.

## Dependencies

`areas/execution-scope-model.md` (`ExecutionScope`, `resolveIncomingExecution`),
`areas/batch-queue-reservation.md` (the reservation and `batchExecutionId` this operation
validates against).

## Out of scope

Building `BatchContext`'s final report-facing shape and cross-task-findings attribution
(`batch-context-and-report` — this area produces the resolved `StepContext`s and the deduplicated
raw `BatchContext`, `batch-context-and-report` owns the report/lineage layer on top). The
batch-finish operation itself. Continuation dispatch. Any UI.
