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
  decisions: [D8, D16, D17, D19, D31, D35]
  constraints: [C1]
  dependency_contracts: [batch-finish-operation, batch-queue-reservation]
---

# Task: Batch completion orchestration

## Goal

Own the dashboard-orchestration side of the batch lifecycle `batch-finish-operation` explicitly
does not (D16): batch-aware Hook1 terminal-settlement observation, batch completion detection,
then the exact terminal ordering D35 defines — release the workspace-writer claim, clear the
batch's `activeExecutions` entry, atomically release the barrier/reservation
(`batch-queue-reservation`'s own reservation, D31 — no separate barrier record owned here), and
only then dispatch every affected member's next action, including an immediate fresh refiner for
a failing member.

## Dependencies

`batch-finish-operation` (the durable `completed` state this task observes, read-only — never a
call into workflow-core beyond reading its durable record), `batch-queue-reservation` (the
reservation-release function this task calls, in the D35 ordering, never independently).

## Implementation constraints

- **No separate barrier record in this task (D31, corrects an earlier draft).** Do not introduce
  a `batch-barrier.mjs` file or equivalent — `batch-queue-reservation`'s own reservation is the
  canonical barrier; this task only calls its exposed release function, at the right point in the
  ordering below.
- **Exact terminal ordering (D35) — implement as one sequenced function, never reordered, never
  partially applied:**
  1. Confirm the provider turn is terminal, the batch-finish record reads `completed`, and
     scope-aware settlement is proven (reuse D19's settlement-check discipline, applied at
     completion rather than reservation-recovery time).
  2. **Release the batch workspace-writer claim.**
  3. **Clear the `activeExecutions` batch record** (`admission.mjs`).
  4. **Atomically release the barrier/reservation** — for every member at once, never one at a
     time.
  5. **Only then** recompute and dispatch each affected member's next action, reusing the
     existing single-task continuation-dispatch function per task — invoked once per member, never
     a new dispatch mechanism. A member whose result requires a fresh refiner is admitted here,
     with `parentSessionId` set to the batch reviewer session's id (D8) — this admission can only
     succeed because step 2 already freed the workspace-writer slot.
  **Step 5 must be structurally incapable of running before step 2** — e.g. by having the
  dispatch function itself require the already-released-claim state as an input it cannot
  fabricate, not merely by code-review discipline.
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

- The exact order — settlement proof, claim release, `activeExecutions` clear, atomic barrier/
  reservation release, dispatch — is observed in that order, every time, proven directly (not
  merely that all steps eventually happen).
  `automated: node --test tools/tests/batch-claim-release-ordering.test.mjs`
- Dispatch for any member never occurs while the batch workspace-writer claim is still held —
  proven by attempting to trigger dispatch before release and confirming it cannot succeed.
  `automated: node --test tools/tests/batch-claim-release-ordering.test.mjs`
- Given member B's result is failure, a fresh single-task refiner for B is admitted immediately
  after batch completion, with `parentSessionId` equal to the batch reviewer session's id, and no
  stale batch claim causes workspace contention for that admission.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- The barrier/reservation releases atomically for every member — no window where one member is
  unblocked while a sibling is not.
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
