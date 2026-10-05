---
id: real-end-to-end-corrective-acceptance
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/specs/workflow/batch-finish/operation.mjs
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/specs/workflow/cli.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/tests/real-end-to-end-corrective-acceptance.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/batch-finish/**
  - tools/specs/context/batch-context.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
depends_on: [batch-finish-gate-correctness, production-batch-admission-generalization, durable-grouped-handover-dispatch]
---

# Task: Real, change-wide corrective acceptance — no simplified fixtures

## Goal

Corrective task from the post-implementation review (`overview.md` § "Post-implementation
review correction"). Task 07's own acceptance test proved its scoped acceptance criteria
using a workflow fixture with `exitGates: []` — correct and transparently documented for
that task's own scope, but it means the change-wide claim "a real brand-new implementation
batch finishes end-to-end" was never exercised against real gate infrastructure, a real
production admission route, or real multi-group handover. This task is the single,
dedicated, uncompromising proof that all of it holds together for real, after tasks
09-11 land. New test file only — no production code change; if this test reveals that
tasks 09-11 did not actually fix what they claimed, that is a finding to report (and a
reason to revisit 09-11), not something to silently work around here.

## Requirements

Using the real `.nevo-ai/workflows/standard.yaml` (or the closest production-complete
fixture that preserves its real `command`-type exit gates — do not strip `exitGates` to
make this task pass), write one comprehensive test suite proving, at minimum:

1. Brand-new, dependency-ordered implementation tasks can be selected and started
   through the real production admission route (`routes.mjs`, task 10) — not by calling
   `createGroupReservation`/`executeBatchStart` directly.
2. They run as one batch execution, in one session.
3. The real implementation step's exit gates are actually evaluated (both a passing and
   a genuinely failing command case — the failing case must block, per task 09).
4. A successful batch finish performs exactly one shared commit and one push.
5. A same-batch dependency (a member depending on another member of the same batch)
   does not block admission.
6. An external, unsatisfied dependency (outside the selected batch) does block
   admission.
7. A post-review/refinement handover that produces 2+ distinct execution-contract
   groups does not lose any group — every group is eventually admitted.
8. At most one group is actively admitted at once (the one-active-execution-per-spec
   invariant holds throughout).
9. Remaining groups survive as durable pending work (task 11) and are admitted
   sequentially, each only after the previous one settles.
10. No new session is created merely because execution moved from one member task to
    another inside the same batch (one session may resume with another turn).
11. Single-task execution still uses the same underlying primitives (task 08's own
    claim) without being fabricated into a batch-of-one — include this as a direct
    assertion, not an assumption, since it is itself a change-wide acceptance criterion.

Map each of these 11 points, and each of `overview.md`'s original "Change-wide
acceptance criteria", to a specific assertion in this test (or an explicit note that an
earlier task's own test already covers it and duplicating here would be redundant) —
same discipline task 07's own AC2 already established.

## Implementation constraints

- This task does not modify any production file — if the real end-to-end flow still
  doesn't work as tasks 09-11 individually claim, report the specific discrepancy
  (which task's acceptance criteria didn't actually compose) rather than patching
  production code under this task's own scope.
- Do not weaken the test to avoid a real gate, a real admission check, or real handover
  durability — the entire point of this task is that nothing is simplified away.

## Acceptance criteria

- The full sequence above passes as one coherent test run, using real gate
  infrastructure throughout.
  `automated: node --test tools/tests/real-end-to-end-corrective-acceptance.test.mjs`
- Every one of `overview.md`'s original change-wide acceptance criteria, and every one
  of the post-implementation review's five findings, is traceable to a specific passing
  assertion (here or in an explicitly-named earlier task's test).
  `inspection: each change-wide AC and each of the 5 review findings maps to a passing assertion`

## Verification

```bash
node --test tools/tests/real-end-to-end-corrective-acceptance.test.mjs
node --test tools/tests/
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Any new production code. Any change to tasks 09-11's own scope — if they are
insufficient, that is this task's finding to report, not fix.
