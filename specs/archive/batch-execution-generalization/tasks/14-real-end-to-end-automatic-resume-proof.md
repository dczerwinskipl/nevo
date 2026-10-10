---
id: real-end-to-end-automatic-resume-proof
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/batch-finish/**
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
depends_on: [durable-grouped-handover-resume-generalization]
---

# Task: Prove real, automatic pending-group resume — not a manually forced re-invocation

## Goal

Second-round corrective task from `overview.md` § "Second-round review correction".
Task 12's Test D (acceptance point 9, "remaining groups survive as durable pending work
and are admitted sequentially") manually calls `clearActiveAgentExecution(specId)` and
then manually re-invokes the parent `executeBatchCompletionSettlement()` directly. That
proves the pending record survives and *can* be resumed when re-invoked — it does not
prove the actual change-wide claim, which is that settling the first execution
*automatically* triggers the resume, with nobody manually freeing the slot or manually
calling back into the settlement saga. Task 11's own dedicated test proves real automatic
resume, but only for one ordering (a batch group dispatched first, a singleton second);
task 13 adds the reverse ordering (singleton first) at the orchestration-layer test level.
This task re-proves both orderings at the same real, end-to-end level Test A-C already
operate at — through the real production admission route and real settlement, with
nothing manually forced.

> **Third-round scope clarification (2026-10-06, task 15):** a third review round found
> that the landed Test D/D2 do not literally settle the first dispatch unit via real
> `executeBatchStart`/`executeBatchFinish` as the bullet below originally required —
> they advance `workflow_progress` and save a batch-finish record directly (for D) or
> drive `admission.mjs`'s own `releaseAdmittedExecution` (for D2), then call the real
> `executeBatchCompletionSettlement`. This is the same settlement-level fidelity task
> 11's and 13's own dedicated tests already use, and it is sufficient to prove the
> *resume* mechanism specifically (D/D2's actual job). Real `BatchStart`/`BatchFinish`
> execution for a brand-new batch is a separate claim, already proven exhaustively by
> Test A (this task's own sibling) and tasks 09/10/12. This note reconciles the bullet
> below with what D/D2 actually — and sufficiently — exercise; it does not reopen task
> 14's recorded status or verification history. See `overview.md` § "Third-round review
> correction", finding 3.

## Requirements

- Rewrite Test D in `real-end-to-end-corrective-acceptance.test.mjs` so the resume is
  driven by a real settlement reaching its own natural slot-freeing point — not by a
  manual `clearActiveAgentExecution` call followed by a manual re-invocation of the
  parent settlement. Use the same real production primitives Tests A-C already use
  (the real admission route from task 10, real `executeBatchStart`/`executeBatchFinish`,
  real `executeBatchCompletionSettlement`) to actually settle the first dispatch unit and
  observe the second, previously-pending unit become admitted as a natural side effect.
  **(See the third-round scope clarification above — in practice, settling the first
  dispatch unit at the same settlement-level fidelity task 11/13 already use is
  sufficient; re-running full `BatchStart`/`BatchFinish` for the first unit is not
  required, since that is proven separately by Test A and tasks 09/10/12.)**
- Add a second scenario covering the reverse ordering the second review round
  specifically asked for: a singleton dispatched first, a multi-member group left durably
  pending second, the singleton settles for real (through `admission.mjs`'s own turn-
  terminal handling — task 13), and the pending group is admitted automatically with no
  manual intervention.
- Keep every other test in this file (A, B, C, E) unchanged unless task 13's own
  production changes require a fixture adjustment to keep them passing — if so, apply
  only the minimal adjustment and note why.
- Do not weaken real gate infrastructure, real admission, or real handover durability —
  same standing constraint as task 12's original scope.

## Implementation constraints

- This task does not modify any production file. If task 13's fix does not actually
  compose with the real end-to-end flow, report the specific discrepancy rather than
  patching production code under this task's own scope.
- Do not revert or weaken Test D's original intent (proving durability of the pending
  record) — add the automatic-resume proof alongside it, or replace it only if the
  durability claim remains covered elsewhere in the same test.

## Acceptance criteria

- Test D (or its replacement) proves automatic resume end-to-end for the batch-first
  ordering without any manual `clearActiveAgentExecution` call or manual re-invocation of
  the parent settlement standing in for the real trigger.
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`
- A new test proves automatic resume end-to-end for the singleton-first ordering
  (singleton dispatched first, grouped batch pending second, singleton settles for real,
  batch starts automatically).
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`
- The full acceptance suite from task 12 (Tests A, B, C, E, and every one of
  `overview.md`'s change-wide acceptance criteria and the five original review findings)
  still passes.
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
node --test tools/tests/
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Any new production code. Any change to task 13's own scope — if it is insufficient, that
is this task's finding to report, not fix.
