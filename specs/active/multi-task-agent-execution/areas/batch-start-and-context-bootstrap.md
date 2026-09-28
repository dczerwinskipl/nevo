# Area: Batch start and context bootstrap

## Responsibility

Provide the batch-scoped equivalent of `workflow step start`, invoked by the reviewer agent
itself as its own first required action after admission (D33, never triggered by admission):
persist a durable batch-start operation record before any activation (D28), run a non-mutating
context-capacity preflight before any member is activated (D34), activate every reserved
member's target step, resolve each member's authoritative deterministic `StepContext`, and own
the **full, final** `BatchContext` — dedup, cross-task overlap attribution, and per-member
lineage all included (D32) — so the reviewer session never calls N independent single-task
starts itself, and never receives a half-built intermediate context from an unwired later task.

## Current state

- `workflow step start <change> <task>` (`tools/specs/workflow/cli.mjs` → `step-runner.mjs`)
  activates a single task's target step, establishes attempt identity, and returns the
  authoritative `StepContext` (`taskDefinition`, `requiredContext`, `relevantDocs`, `stepContract`,
  `previousTransition`, `expectedWork`, allowed/forbidden paths, `finishContract`, gates) — see
  `docs/development/workflow-engine.md`. This is single-task only; nothing today activates several
  tasks' steps as one operation.
- **Correction (D28):** `start-operation.mjs`'s durable per-task record is created by the
  single-task CLI path only when the target step declares `consumesDependencies: true`. In
  `standard-v1.yaml`, `implementation` declares it, `review` does not — so the v1 batch case
  (members entering `review`) has no such record to recover from. An earlier draft of this area
  wrongly assumed it could rely on "each member's own durable step-activation record"; that
  record frequently does not exist for the batch case this spec targets.
- `tools/specs/context.mjs`'s `buildContextPacket(change, task)` is the **legacy** lifecycle's own
  context contract, not the deterministic engine's — it is explicitly not reused here (D15).
- No batch-start equivalent, and no `BatchContext` builder, exists anywhere in the repository
  today.
- The model catalog already exposes `traits.maxContextTokens` per provider/model — but that
  lives in dashboard AI code, not workflow-core; this area must receive a capacity figure as a
  plain number rather than importing it (D34).

## Requirements

The batch-start operation (D33's canonical sequence: reservation → barrier active →
`admitAgentExecution` → session/bindings created → provider turn started → batch bootstrap
prompt injected → **the agent's own first tool call is this operation**):

1. **Trusted identity at start (D33, mirroring D23 at finish)**: verify the calling session
   against the reservation's `batchExecutionId`/`ExecutionScope` before doing anything else. The
   `batchExecutionId` the bootstrap prompt carried is protocol context the agent echoes back, not
   authority — this operation re-derives/validates scope from the durable reservation/session,
   never from the prompt text alone.
2. **Validate the request** against the exact reserved `ExecutionScope` — no member outside the
   reservation, no missing member.
3. **Re-verify every member is still compatible and ready** (re-running the same compatibility
   check `batch-queue-reservation` used at selection time via `resolveIncomingExecution`, D20 —
   state may have changed between reservation and start).
4. **Non-mutating context-capacity preflight (D34)** — before any member's activation stage
   begins: statically derive each member's prospective document/file set from already-approved
   task state and the workflow definition (the same inputs `StepContext` resolution would use),
   without calling the mutating step-activation primitive. Compute the prospective `BatchContext`
   size and compare it against a capacity figure supplied by the caller as a plain integer (the
   dashboard layer resolves `traits.maxContextTokens` for the selected provider/model and passes
   it in — this operation never imports the model catalog or any dashboard AI module). If the
   prospective size would exceed that figure, fail the whole operation with
   `BATCH_CONTEXT_TOO_LARGE` here — **zero members are activated in this outcome**.
5. **Persist the durable batch-start operation record (D28)** — only after steps 2–4 all
   succeed, before the first member is activated:
   `.nevo-ai-local/batch-start/<changeSlug>/<batchExecutionId>.json` (exact path open), freezing
   at minimum: `batchExecutionId`, `executionScope`, the canonical session id, each member's
   target step, each member's attempt identity, whatever pre-activation state reconciliation
   needs, and a per-member activation-stage field.
6. **Activate every member's target step, sequentially, idempotently** — reusing the single-task
   step-activation primitive per member, reconciling/persisting each member's stage into the
   record above as it completes. Where a member's own step *does* declare
   `consumesDependencies: true`, this composes with (never replaces or duplicates) that member's
   own `start-operation.mjs` semantics.
7. **Resolve each member's authoritative deterministic `StepContext`** — the same shape a
   single-task `workflow step start` would produce for that member alone.
8. **Build the full, final `BatchContext`** (D32 — this area owns the whole thing, not a raw
   version some other task extends): dedupes `requiredContext` documents, `relevantDocs`, and
   shared files across members with `usedBy` attribution; attributes cross-task overlapping
   changed paths (reusing `attributeTouchedPaths`/`detectBatchIntegrationFindings` from
   `tools/specs/batch/operation.mjs`, read-only import, legacy module itself untouched); resolves
   each member's role-name-agnostic `predecessorSession` lineage (D25) via
   `execution-scope-model`'s `resolveIncomingExecution` — fail-closed to `null` on ambiguity,
   never guessing.
9. **Record the post-bootstrap Git baseline (D29)** — after all activation (which already
   mutated tracked `change.yaml`) completes, record `baseRevision = HEAD` and a deterministic
   post-bootstrap tracked-state baseline (e.g. content hashes of every tracked file the bootstrap
   touched) proving what the tree legitimately looks like right after bootstrap, before the
   reviewer does anything. `batch-finish-operation` later checks against this, not against a
   pre-activation assumption.
10. **Return the final `BatchContext`** to the reviewer session.

**Idempotency and crash recovery for partial activation (D28).** Resume derives, per member,
whether activation *definitely happened*, *definitely did not happen*, or is
*ambiguous/recovery-required*, by combining the durable batch-start record with authoritative
current workflow state — never by assuming a `start-operation.mjs` record exists, and never by
silently looping a non-resumable mutation. A member whose own re-verification (step 3) fails
resumes into the same whole-bootstrap failure a fresh request would hit — it does not leave the
batch half-activated indefinitely.

## Constraints

- No `tools/specs/workflow/**` module this area adds imports `tools/dashboard/**` (C2) — the
  capacity figure (D34) arrives as a plain number, never a catalog import.
- Reuses the single-task step-activation primitive per member — does not reimplement step
  activation from scratch.
- Reuses `execution-scope-model`'s `resolveIncomingExecution` — does not re-derive transition
  matching.
- Owns the *entire* `BatchContext` — no later task extends or completes it (D32); `batch-report`
  (the renamed, narrowed former `batch-context-and-report`) only renders what this area already
  finished building.
- This neighborhood (`step-runner.mjs`, `cli.mjs`, `start-operation.mjs`) is active ground (C5) —
  re-verify current file contents before editing.

## Interfaces and boundaries

Exposes: the batch-start operation, the final `BatchContext`, `baseRevision` and the
post-bootstrap tracked-state baseline. Consumes: `execution-scope-model`'s `ExecutionScope`/
`resolveIncomingExecution`, `batch-queue-reservation`'s reservation/`batchExecutionId`/
compatibility check/barrier, the existing single-task `StepContext` resolution and step-activation
primitives, a caller-supplied capacity figure. Consumed by: `batch-report` (renders the final
`BatchContext` into the report file — builds nothing), `multi-task-review-skill` (receives the
returned `BatchContext`), `batch-finish-operation` (reads `baseRevision`/baseline).

## Area-specific acceptance criteria

- Given three reserved, compatible members targeting `review` (which does **not** declare
  `consumesDependencies`), a simulated crash after activating member A but before B, followed by
  resume, activates exactly B and C (not re-activating A) using the batch-start operation
  record's own state — never `start-operation.mjs`, which doesn't exist for this step — and one
  batch-start operation record reaches `completed`.
- A `BatchContext` engineered to exceed a fixture provider's capacity figure fails with
  `BATCH_CONTEXT_TOO_LARGE` **before any member shows an activation stage in the durable
  record** — proven directly (zero members activated), not merely a returned error after the
  fact.
- The reviewer session's own work requires zero independent `workflow step start` calls.
- A member that fails re-verification at step 3 causes the whole bootstrap to fail with zero
  members activated.
- The final `BatchContext` returned to the reviewer already contains `crossTask` overlap findings
  and per-member `predecessorSession` lineage — no separate task call is needed to complete it.
- `baseRevision` and the post-bootstrap baseline recorded after activation match the tree's real
  post-bootstrap state, provable directly — and are recorded *after*, not before, `change.yaml`'s
  bootstrap mutation.
- Existing single-task `workflow step start` behavior, and `start-operation.mjs`'s own
  `consumesDependencies`-gated behavior, are unchanged.

## Dependencies

`areas/execution-scope-model.md` (`ExecutionScope`, `resolveIncomingExecution`),
`areas/batch-queue-reservation.md` (the reservation, `batchExecutionId`, and barrier this
operation validates against and operates inside).

## Out of scope

Rendering the report file (`batch-report`) — this area builds the final `BatchContext`, it does
not write Markdown. The batch-finish operation. Continuation dispatch. Any UI.
