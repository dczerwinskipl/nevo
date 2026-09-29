---
id: multi-task-agent-execution.batch-completion-orchestration
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-completion-orchestration.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/specs/workflow/human-step/projection.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - tools/tests/batch-claim-release-ordering.test.mjs
  - tools/tests/deterministic-status-corrective.test.mjs
forbidden_paths:
  - src/**
  - tools/specs/workflow/batch-finish/**
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/queue/**
depends_on: [ batch-finish-operation, batch-queue-reservation ]
semantic_references:
  decisions: [D8, D16, D17, D19, D31, D35, D40]
  constraints: [C1]
  dependency_contracts: [batch-finish-operation, batch-queue-reservation]
---

# Task: Batch completion orchestration

## Goal

Own the dashboard-orchestration side of the batch lifecycle `batch-finish-operation` explicitly
does not (D16): batch-aware Hook1 terminal-settlement observation, batch completion detection,
then D35's terminal ordering as D40's durable, idempotent settlement saga — claim release,
this batch's `activeExecutions` clear, atomic reservation/barrier release, then per-member
continuation dispatch. A process crash between stores is an expected resumable state, not an
impossible "partially applied" condition.

## Dependencies

`batch-finish-operation` (the durable `completed` state this task observes, read-only — never a
call into workflow-core beyond reading its durable record), `batch-queue-reservation` (the
reservation-release function this task calls, in the D35 ordering, never independently).

## Implementation constraints

- **No separate barrier record in this task (D31, corrects an earlier draft).** Do not introduce
  a `batch-barrier.mjs` file or equivalent — `batch-queue-reservation`'s own reservation is the
  canonical barrier; this task only calls its exposed release function, at the right point in the
  ordering below.
- **Durable staged settlement (D35/D40)**: add a small orchestration-owned settlement record
  keyed by `batchExecutionId` (module e.g. `batch-completion-settlement.mjs`) with ordered
  stages `claim-release`, `active-execution-clear`, `reservation-release`, per-member
  `continuation-dispatch`, `completed`.
  1. Confirm terminal provider turn + durable batch-finish `completed` + scope-aware settlement.
  2. Release only the workspace claim owned by this batch; observe absence/ownership before
     marking the stage.
  3. Clear only this batch's `activeExecutions` entry; an absent entry after restart satisfies
     the stage, while a different current execution is never cleared.
  4. Atomically release this reservation/barrier for all members; observe reservation state before
     marking the stage.
  5. Only when 2–4 are authoritatively satisfied, recompute/dispatch each member via the existing
     single-task continuation mechanism. Persist/derive per-member dispatch progress; if the
     process crashes after admission/dispatch but before the marker, retry must observe the
     already-existing continuation and not duplicate it.
  6. Mark settlement completed.
  This is intentionally a resumable saga, not a cross-store atomic transaction and not a promise
  that partial settlement can never exist after a crash.
- **Barrier scope covers every downstream action path (D17)** — the actual enforcement of this
  lives in `batch-queue-reservation` (D31: `ExecutionReadiness`, `workflow step start`,
  `activateAndSubmitHumanStep`); this task's own responsibility is only to call the *release* at
  the correct point in the ordering above, and it may additionally wire `human-step/projection.mjs`
  to surface barrier state for UI purposes (presentation only, never the correctness boundary).
- This task is the one place allowed to import both the workflow-core batch-finish record (read
  only) and dashboard orchestration primitives — `batch-finish-operation` itself must remain free
  of any `tools/dashboard/**` reference; this task does not weaken that boundary from its own side
  either (it reads the durable record file/API, it does not import `tools/specs/workflow/batch-finish/**`'s
  internals to bypass the public read surface).

## Acceptance criteria

- The exact order — settlement proof, claim release, this batch's `activeExecutions` clear,
  atomic reservation release, dispatch — is observed. Fixtures crash after claim release, after
  active-execution clear, and after reservation release; restart resumes safely from each point.
  `automated: node --test tools/tests/batch-claim-release-ordering.test.mjs`
- Dispatch for any member never occurs while the batch workspace-writer claim is still held —
  proven by attempting to trigger dispatch before release and confirming it cannot succeed.
  `automated: node --test tools/tests/batch-claim-release-ordering.test.mjs`
- Given member B's result is failure, a fresh single-task refiner for B is admitted immediately
  after batch completion, with `parentSessionId` equal to the batch reviewer session's id, and no
  stale batch claim causes workspace contention for that admission.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- The barrier/reservation releases atomically for every member — no sibling window. A crash after
  release but before dispatch resumes dispatch idempotently; a crash after a member dispatch but
  before its settlement marker observes the existing continuation rather than duplicating it.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A member's own `workflow_progress` history entry is readable before the barrier releases.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- Existing single-task continuation/reconciliation behavior is unaffected for non-batch tasks.
  `automated: node --test tools/tests/deterministic-status-corrective.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs tools/tests/batch-claim-release-ordering.test.mjs tools/tests/deterministic-status-corrective.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The batch-finish operation's own durable saga (`batch-finish-operation`). Defining or enforcing
the barrier (`batch-queue-reservation`, D31) — this task only releases it, in the correct order.
Building `BatchContext` or the report. Any UI beyond optional barrier-state surfacing.
