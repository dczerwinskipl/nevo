---
id: acceptance-initial-implementation-batch
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/specs/workflow/batch-start/operation.mjs
    - tools/specs/workflow/batch-finish/operation.mjs
    - tools/specs/workflow/batch-finish/preflight.mjs
    - tools/specs/context/batch-context.mjs
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/tests/acceptance-initial-implementation-batch.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/batch-start/operation.mjs
  - tools/specs/workflow/batch-finish/**
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
depends_on: [batch-admission-generalization, batch-finish-phase-neutral-generalization, intra-batch-dependency-consumption-materialization, batch-completion-handover-partitioning]
---

# Task: End-to-end acceptance — a real initial implementation batch

## Goal

Tasks 02-05 each verify their own slice in isolation. This task is the single,
dedicated end-to-end proof that the whole change-wide acceptance criteria in
`overview.md` actually hold together, on the real sequence the original discovery
was about: three brand-new, dependency-ordered tasks, started as one implementation
batch, finishing with one commit, and handing over correctly. New test file only —
no production code change; if this test reveals a gap between tasks 02-05's
individual behavior and the combined end-to-end flow, that is a finding to report,
not something to silently patch under this task's own scope.

## Requirements

Write one comprehensive test (or a small, tightly-scoped suite) that:
1. Sets up a change with 3 brand-new tasks, `T1`, `T2 depends_on T1`,
   `T3 depends_on T1`, all targeting the same `implementation` step, no
   `workflow_progress` on any of them.
2. Reserves and starts a batch covering all 3 — asserts admission succeeds (Gap 1).
3. Simulates the agent implementing `T1` first (dirty files within `T1`'s own scope),
   then `T2`/`T3`.
4. Finishes the batch — asserts: exactly one commit, one push (Gap 2/5); `T2`/`T3`'s
   dependency-consumption on `T1` is recorded with `T1`'s real release epoch, using
   each member's own pre-allocated `consumptionSequence` (Gap 6); every member's own
   workflow transition is correctly applied.
5. Asserts the resulting handover dispatch matches what Gap 6's partitioning would
   produce for this batch's actual resulting contracts (e.g. all three to one review
   batch, if that's what the real transitions resolve to).

## Implementation constraints

- This task does not modify any production file — if the end-to-end flow doesn't
  work as tasks 02-05 individually claimed, report the specific discrepancy (which
  task's acceptance criteria didn't actually compose) rather than patching production
  code under this task's scope.

## Acceptance criteria

- The full sequence above passes as one coherent test run.
  `automated: node --test tools/tests/acceptance-initial-implementation-batch.test.mjs`
- Change-wide acceptance criteria from `overview.md` are each traceable to a specific
  assertion in this test (or explicitly noted as covered by a different task's own
  test instead, if duplicating here would be redundant).
  `inspection: each overview.md change-wide acceptance criterion maps to an assertion`

## Verification

```bash
node --test tools/tests/acceptance-initial-implementation-batch.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any new production code — pure acceptance verification of tasks 02-05's combined
behavior.
