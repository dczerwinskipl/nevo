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
3. **Re-verify every member's underlying workflow readiness (D37)** — after trusted identity
   has already proven this batch owns the reservation, use the base readiness evaluation from
   `batch-queue-reservation`/`readiness-policy`: workflow position, dependencies, suspensions,
   executor, prior-operation and worktree preconditions all still apply, but this batch's own
   reservation is not treated as an external blocker. Ordinary barrier-aware readiness remains
   false for these members. Re-run `resolveIncomingExecution` as part of compatibility; if any
   underlying condition changed, fail before activation.
4. **Non-mutating context-capacity preflight (D34/D38)** — never trust a model-authored capacity
   argument. Read the immutable `executionConfigSnapshot.contextCapacity` from the reservation
   after identity validation. Statically derive the canonical prospective **text** batch-bootstrap
   payload from already-approved task state/workflow inputs, with deterministic ordering and LF
   normalization, without calling the mutating activation primitive.
   - For `status: "known"`, calculate
     `estimatedContextTokensUpperBound = UTF8 byteLength(canonicalPayload)` as Nevo's
     deliberately conservative v1 text estimate and compare it with the frozen
     `maxContextTokens`. If the estimate exceeds the limit, fail with
     `BATCH_CONTEXT_TOO_LARGE` **before any member activation**.
   - For `status: "unknown"`, do not invent a limit and do not reject solely for missing
     metadata. Record/return `capacityStatus: "unknown"` and continue; the dashboard surfaces
     the warning.
   Passing the known-capacity preflight is a safety filter, not a guarantee against later
   provider/system-overhead rejection.
5. **Persist the durable batch-start operation record (D28/D38)** — only after steps 2–4 all
   succeed (or step 4 explicitly records unknown capacity), before the first member is activated:
   `.nevo-ai-local/batch-start/<changeSlug>/<batchExecutionId>.json` (exact path open), freezing
   at minimum: `batchExecutionId`, `executionScope`, canonical session id, the reservation's
   immutable `executionConfigSnapshot`, the preflight estimate/status, each member's target step
   and attempt identity, reconciliation inputs, and a per-member activation-stage field.
6. **Activate every member's target step, sequentially, idempotently (D37)** — the reservation
   remains barriered; batch start does not clear or pretend away the barrier. Because trusted
   batch ownership and base readiness were already proven, call the same internal single-task
   `ensureStepActivated` primitive per exact reservation member, reconciling/persisting each
   stage as it completes. Never invoke raw `workflow step start` N times and never expose a
   generic barrier-bypass option. Where a member's own step *does* declare
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
9. **Record the complete post-bootstrap workspace baseline (D29/D39)** — after all activation
   completes, freeze `baseRevision = HEAD` plus a deterministic path-sorted workspace-delta
   fingerprint relative to that revision. It covers every repository-visible path outside
   `.nevo-ai-local/**` whose index/worktree state differs from HEAD, including staged/unstaged
   tracked changes/deletions and untracked files; each entry records status/mode and a content
   hash when content exists. This captures Nevo's legitimate bootstrap dirt such as
   `change.yaml` *and* makes unrelated later reviewer changes detectable. Finish recomputes the
   same fingerprint excluding only the canonical report path.
10. **Return the final `BatchContext`** to the reviewer session.

**Idempotency and crash recovery for partial activation (D28).** Resume derives, per member,
whether activation *definitely happened*, *definitely did not happen*, or is
*ambiguous/recovery-required*, by combining the durable batch-start record with authoritative
current workflow state — never by assuming a `start-operation.mjs` record exists, and never by
silently looping a non-resumable mutation. A member whose own re-verification (step 3) fails
resumes into the same whole-bootstrap failure a fresh request would hit — it does not leave the
batch half-activated indefinitely.

## Constraints

- No `tools/specs/workflow/**` module this area adds imports `tools/dashboard/**` (C2).
  Capacity is consumed only through the provider-neutral frozen reservation snapshot (D38), never
  a catalog import or model-supplied argument.
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

Exposes: the batch-start operation, the final `BatchContext`, `baseRevision` and the complete
post-bootstrap workspace-delta fingerprint. Consumes: `execution-scope-model`'s
`ExecutionScope`/`resolveIncomingExecution`, `batch-queue-reservation`'s reservation,
`batchExecutionId`, frozen `executionConfigSnapshot`, base-readiness helper and barrier, plus
the existing single-task `StepContext` resolution and internal step-activation primitive. Consumed by: `batch-report` (renders the final
`BatchContext` into the report file — builds nothing), `multi-task-review-skill` (receives the
returned `BatchContext`), `batch-finish-operation` (reads `baseRevision`/baseline).

## Area-specific acceptance criteria

- Given three reserved, compatible members targeting `review` (which does **not** declare
  `consumesDependencies`), a simulated crash after activating member A but before B, followed by
  resume, activates exactly B and C (not re-activating A) using the batch-start operation
  record's own state — never `start-operation.mjs`, which doesn't exist for this step — and one
  batch-start operation record reaches `completed`.
- With a frozen **known** capacity, a canonical prospective payload whose conservative estimate
  exceeds `maxContextTokens` fails with `BATCH_CONTEXT_TOO_LARGE` before any activation stage.
  With frozen `capacityStatus: unknown`, no limit is fabricated: bootstrap proceeds and returns
  the explicit warning/status. A caller/model-supplied larger number cannot override either
  snapshot.
- The reviewer session's own work requires zero independent `workflow step start` calls.
- A member that fails **base** re-verification at step 3 causes the whole bootstrap to fail with
  zero members activated. A member that is otherwise ready but ordinary-readiness-blocked only by
  this batch's own reservation remains eligible for this authenticated bootstrap. A different
  batch id or an out-of-scope task is rejected before mutation.
- The final `BatchContext` returned to the reviewer already contains `crossTask` overlap findings
  and per-member `predecessorSession` lineage — no separate task call is needed to complete it.
- `baseRevision` and the complete workspace-delta fingerprint recorded after activation match
  the real post-bootstrap state. A later mutation to any unrelated tracked file **or creation of
  an untracked repository-visible source/doc file** changes that fingerprint; unchanged bootstrap
  `change.yaml` does not.
- Existing single-task `workflow step start` behavior, and `start-operation.mjs`'s own
  `consumesDependencies`-gated behavior, are unchanged.

## Dependencies

`areas/execution-scope-model.md` (`ExecutionScope`, `resolveIncomingExecution`),
`areas/batch-queue-reservation.md` (the reservation, `batchExecutionId`, and barrier this
operation validates against and operates inside).

## Out of scope

Rendering the report file (`batch-report`) — this area builds the final `BatchContext`, it does
not write Markdown. The batch-finish operation. Continuation dispatch. Any UI.
