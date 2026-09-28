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
  - tools/specs/workflow/cli.mjs
  - tools/tests/batch-start-and-context-bootstrap.test.mjs
  - tools/tests/workflow-step-runner.test.mjs
  - tools/tests/workflow-step-context.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - src/**
depends_on: [ execution-scope-model, batch-queue-reservation ]
semantic_references:
  decisions: [D14, D15, D22, D26]
  constraints: [C1, C2, C5]
  dependency_contracts: [execution-scope-model, batch-queue-reservation]
---

# Task: Batch start and context bootstrap

## Goal

Implement the batch-scoped equivalent of `workflow step start` (D14): activate every reserved
member's target step, resolve each member's authoritative deterministic `StepContext`, and build
one deduplicated `BatchContext` from those `StepContext`s (D15) — so the reviewer session never
calls N independent single-task starts itself.

## Dependencies

`execution-scope-model` (`ExecutionScope`, `resolveIncomingExecution`), `batch-queue-reservation`
(the reservation and `batchExecutionId` this operation validates against).

## Implementation constraints

- Reuse the single-task step-activation primitive per member (the same one `workflow step start`
  itself calls) — do not reimplement step activation from scratch.
- Reuse `execution-scope-model`'s `resolveIncomingExecution` for target-step/role/session
  resolution — do not re-derive transition matching here.
- **Trusted identity at start (D14, mirroring D23 at finish)**: verify the calling session against
  the reservation's `batchExecutionId`/`ExecutionScope` before activating anything.
- **Validate all before activating any**: re-verify every member's compatibility/readiness; if any
  member fails re-verification, fail the whole bootstrap before any member is activated.
- **Idempotent partial-activation recovery**: activating an already-activated member (per that
  member's own durable step-activation record) is a no-op on resume — never a second activation
  attempt, never a silent loop over a non-resumable mutation.
- Record `baseRevision = HEAD` at the point activation begins (D22) — `batch-finish-operation`
  later checks this value unchanged.
- **Context-capacity preflight (D26)**: before returning `BatchContext`, check whether it would
  exceed the selected model/provider's actual context capacity; fail closed with a distinct,
  explicit result (`BATCH_CONTEXT_TOO_LARGE`) rather than silently truncating context or
  activating members whose context the reviewer can't use. This is a capability-driven runtime
  check — it must not become, or be confused with, an architectural task-count limit (D6 stands
  unchanged).
- `BatchContext`'s shared/task-specific dedup logic operates on the resolved `StepContext`s
  (`requiredContext`, `relevantDocs`, shared files) — this task owns building the raw
  `BatchContext` shape; `batch-context-and-report` (a later task) extends it with cross-task
  overlap findings and lineage, it does not rebuild it.
- This neighborhood (`step-runner.mjs`, `cli.mjs`) is active ground (C5) — re-verify current file
  contents before editing.

## Acceptance criteria

- Given three reserved, compatible members, batch start activates all three and returns one
  `BatchContext` with `usedBy`-attributed shared docs/files and per-member specifics.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- The reviewer's own work requires zero independent `workflow step start` calls — proven by a
  fixture that fails the test if more than one activation call site is exercised.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- Simulating a crash after activating member A but before B, then resuming, activates exactly B
  and completes normally, without re-activating A.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- A member that fails re-verification causes the whole bootstrap to fail with zero members
  activated. `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- A `BatchContext` engineered to exceed a fixture provider's context capacity fails with
  `BATCH_CONTEXT_TOO_LARGE`, not a silent truncation. `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- `baseRevision` recorded at batch start matches `HEAD` at that exact point.
  `automated: node --test tools/tests/batch-start-and-context-bootstrap.test.mjs`
- Existing single-task `workflow step start` behavior is unchanged.
  `automated: node --test tools/tests/workflow-step-runner.test.mjs tools/tests/workflow-step-context.test.mjs`

## Verification

```bash
node --test tools/tests/batch-start-and-context-bootstrap.test.mjs tools/tests/workflow-step-runner.test.mjs tools/tests/workflow-step-context.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/workflow-engine.md` to describe the batch-start operation alongside
`workflow step start`, in the same branch.

## Out of scope

Building the report or cross-task findings (`batch-context-and-report`). The batch-finish
operation. Continuation dispatch. Any UI.
