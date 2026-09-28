---
id: multi-task-agent-execution.batch-start-and-context-bootstrap
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-start-and-context-bootstrap.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/batch-start/**
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/batch-start-and-context-bootstrap.test.mjs
  - tools/tests/batch-start-crash-recovery.test.mjs
  - tools/tests/batch-context-capacity-preflight.test.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - tools/tests/workflow-step-context.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - tools/specs/workflow/start-operation.mjs
  - src/**
depends_on: [ execution-scope-model, batch-queue-reservation ]
semantic_references:
  decisions: [D8, D11, D14, D15, D20, D22, D25, D26, D28, D29, D32, D33, D34]
  constraints: [C1, C2, C5]
  dependency_contracts: [execution-scope-model, batch-queue-reservation]
---

# Task: Batch start and context bootstrap

## Goal

Implement the batch-scoped equivalent of `workflow step start`, invoked by the reviewer agent as
its own first required action after admission (D33) — never triggered by admission itself.
Persist a durable batch-start operation record before any activation, since `start-operation.mjs`
does not apply to a non-`consumesDependencies` step like `review` (D28). Run a non-mutating
context-capacity preflight **before** any member is activated (D34). Activate every member,
resolve each member's authoritative `StepContext`, and own the **complete, final** `BatchContext`
— dedup, cross-task overlap, and lineage all included (D32), not a raw version some other task
extends. Record the post-bootstrap Git baseline `batch-finish-operation` later checks (D29).

## Dependencies

`execution-scope-model` (`ExecutionScope`, `resolveIncomingExecution`), `batch-queue-reservation`
(the reservation, `batchExecutionId`, and barrier this operation validates against and operates
inside).

## Implementation constraints

- Reuse the single-task step-activation primitive per member (the same one `workflow step start`
  itself calls) — do not reimplement step activation from scratch.
- Reuse `execution-scope-model`'s `resolveIncomingExecution` for target-step/role/session
  resolution and for lineage resolution (D25) — do not re-derive transition matching here.
- **Trusted identity at start (D33, mirroring D23 at finish)**: verify the calling session against
  the reservation's `batchExecutionId`/`ExecutionScope` before doing anything else. The
  `batchExecutionId` the bootstrap prompt carried is protocol context only — this task always
  re-derives/validates scope from the durable reservation/session, never trusts the prompt text.
- **Validate all before activating any**: re-verify every member's compatibility/readiness via
  `resolveIncomingExecution`; if any member fails re-verification, fail the whole bootstrap before
  any member is activated.
- **Context-capacity preflight runs before activation, not after (D34) — do not build this in the
  order "activate members, then discover context is too large."** Statically derive each member's
  prospective document/file set from already-approved task state and the workflow definition (the
  same inputs `StepContext` resolution would use) without calling the mutating activation
  primitive. Compare the prospective `BatchContext` size against a capacity figure the caller
  supplies as a plain integer (never import the model catalog or any dashboard AI module here —
  `dashboard-batch-review-ux`, a later task, resolves `traits.maxContextTokens` and passes the
  number in). On excess, fail with `BATCH_CONTEXT_TOO_LARGE` — zero members activated.
- **Durable batch-start operation record, not `start-operation.mjs` (D28).** After validation and
  the capacity preflight both succeed, and before the first member is activated, persist
  `.nevo-ai-local/batch-start/<changeSlug>/<batchExecutionId>.json` (exact path/name may be
  adjusted, keep the module boundary) freezing: `batchExecutionId`, `executionScope`, the
  canonical session id, each member's target step, each member's attempt identity, whatever
  pre-activation state reconciliation needs, and a per-member activation-stage field. This module
  is new and independent of `start-operation.mjs` — **do not import or extend
  `start-operation.mjs`** (see `forbidden_paths`); where a member's own step *does* declare
  `consumesDependencies: true`, compose with that member's existing record by reference, never by
  duplicating its fields.
- **Idempotent partial-activation recovery**: activate members sequentially, reconciling/
  persisting each member's stage into the durable batch-start record as it completes. Resume
  derives, per member, whether activation *definitely happened*, *definitely did not happen*, or
  is *ambiguous/recovery-required*, from this record plus authoritative current workflow state —
  never a second activation attempt, never a silent loop over a non-resumable mutation.
- **Own the complete `BatchContext` — no partial hand-off (D32).** After activation, resolve each
  member's `StepContext`, then build the *entire* `BatchContext` in this task: dedup
  `requiredContext`/`relevantDocs`/shared files with `usedBy` attribution; cross-task overlap
  attribution reusing `attributeTouchedPaths`/`detectBatchIntegrationFindings`
  (`tools/specs/batch/operation.mjs`, read-only import, that legacy module itself untouched); and
  per-member `predecessorSession` lineage via `resolveIncomingExecution`, fail-closed to `null` on
  ambiguity (D25) — never guessing. `batch-report` (a later task) only renders this; it builds
  nothing.
- **Persist lineage onto the `AgentSession` itself (D8)**: write `predecessorSessions:
  {taskId, sessionId | null}[]` (one entry per member) via `binding-service.mjs`, and leave
  `parentSessionId: null` on the batch session — this task, not a later one, is where that field
  is set, since lineage resolution happens here (D32). Cross-task findings carry explicit
  `affectedTaskIds: string[]` (D11).
- **Post-bootstrap Git baseline (D29)** — after activation completes (which has already, and
  legitimately, dirtied tracked `change.yaml`), record `baseRevision = HEAD` and a deterministic
  post-bootstrap tracked-state baseline (e.g. per-file content hashes) proving what the tree looks
  like right after bootstrap. Do **not** record `baseRevision` before activation — that ordering
  is exactly what made the original D22 provenance check impossible to satisfy.
- This neighborhood (`step-runner.mjs`, `cli.mjs`, `start-operation.mjs`) is active ground (C5) —
  re-verify current file contents before editing.

## Acceptance criteria

- Given three reserved members targeting `review` (which does **not** declare
  `consumesDependencies`), a simulated crash after activating member A but before B, followed by
  restart, activates exactly B and C (never re-activating A), using only the durable batch-start
  operation record — proven that no read/write of `start-operation.mjs`'s own record family
  occurs for this fixture — and one batch-start operation record reaches `completed`.
  `automated: node --test tools/tests/batch-start-crash-recovery.test.mjs`
- A `BatchContext` engineered to exceed a fixture capacity figure fails with
  `BATCH_CONTEXT_TOO_LARGE` with **zero members showing any activation stage** in the durable
  record — proven directly, not merely that an error was returned.
  `automated: node --test tools/tests/batch-context-capacity-preflight.test.mjs`
- The returned `BatchContext` already contains `crossTask` overlap findings and per-member
  `predecessorSession` lineage — no further call is needed to complete it.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- The batch session's `AgentSession` record has `parentSessionId: null` and a
  `predecessorSessions` entry per member, resolved without any literal role-name check (proven
  against a fixture using non-`implementer`/`reviewer`/`refiner` role names).
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- The reviewer's own work requires zero independent `workflow step start` calls — proven by a
  fixture that fails the test if more than one activation call site is exercised.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- A member that fails re-verification causes the whole bootstrap to fail with zero members
  activated. `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- `baseRevision` and the post-bootstrap tracked-state baseline are recorded **after** activation
  completes, matching the tree's real state at that point — proven directly, not merely that some
  baseline exists. `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- A batch-start call whose trusted identity doesn't match the reservation's
  `batchExecutionId`/`ExecutionScope` is rejected before any member is touched.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- Existing single-task `workflow step start` behavior, and `start-operation.mjs`'s own
  `consumesDependencies`-gated behavior, are unchanged.
  `automated: node --test tools/tests/workflow-step-runner.test.mjs tools/tests/workflow-step-context.test.mjs`

## Verification

```bash
node --test tools/tests/batch-start-and-context-bootstrap.test.mjs tools/tests/batch-start-crash-recovery.test.mjs tools/tests/batch-context-capacity-preflight.test.mjs tools/tests/workflow-step-runner.test.mjs tools/tests/workflow-step-context.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/workflow-engine.md` to describe the batch-start operation alongside
`workflow step start` — including that it maintains its own durable operation record independent
of `start-operation.mjs` — in the same branch.

## Out of scope

Rendering the report (`batch-report` — this task builds `BatchContext`, it does not write
Markdown). The batch-finish operation. Continuation dispatch. Any UI, including resolving
`traits.maxContextTokens` itself (this task only receives the resulting number).
