---
id: batch-finish-phase-neutral-generalization
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/specs/workflow/batch-finish/preflight.mjs
    - tools/specs/workflow/batch-finish/operation.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/actions/commit-and-push.mjs
    - tools/specs/context/batch-context.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/specs/workflow/batch-finish/preflight.mjs
  - tools/specs/workflow/batch-finish/operation.mjs
  - tools/specs/context/batch-context.mjs
  - tools/tests/batch-finish-operation.test.mjs
  - tools/tests/batch-claim-release-ordering.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/batch-start/**
depends_on: [batch-admission-generalization]
---

# Task: Make `BatchFinish` genuinely phase-neutral

## Goal

Fix `discovery.md` Gaps 2 and 5: `prevalidateBatchFinish` requires a `result` field
for every member unconditionally, which an unconditional step's own `finishStep`
rejects as `UNEXPECTED_TRANSITION_RESULT`; `executeBatchFinish` always renders+commits
the review report and calls `finishStep` once per member, producing N independent
commits/pushes (and N independent `commit.title` contracts) instead of one shared
finalize. Fix both without reinventing `finishStep`'s own gate/transition logic —
reuse it, change only how commit/push and the result contract are assembled.

## Requirements

- `BatchContext` gains a `batchFinishContract`: for each member, its own canonical
  `finishContract.parameters` (via `buildFinishContract`, same as the single-task
  path) with the commit-action fields (`commit.title`, `commit.message`) **excluded**
  — those become one shared section of the same `batchFinishContract`, computed once
  (e.g. from the first member's `commit-and-push` schema — the action/schema is
  shared across members, only the per-member workflow fields differ).
- `prevalidateBatchFinish` (`preflight.mjs:234-407`): validate each member's supplied
  inputs against *that member's own* contract — `result` required only if that
  member's own target step is conditional (per `buildFinishContract`'s own
  `isConditional` check), never a blanket requirement.
- `prevalidateBatchFinish`'s provenance check (`preflight.mjs:327-358`): widen the
  excluded-path set from "only the canonical review report" to every member's own
  declared scope (`allowed_paths`/`consequential_paths`, unioned across members) —
  an implementation/refinement batch's real source-file changes must not trip
  `BATCH_PROVENANCE_VIOLATION`.
- `executeBatchFinish` (`operation.mjs`): Stage 1.5's review-report render/commit
  becomes conditional — only when the batch's phase is review (or more precisely,
  only when the caller actually supplies review results/findings for a report to
  render; do not infer phase from a separate new field if the existing inputs already
  distinguish this unambiguously — confirm during implementation which signal is
  already present rather than adding a redundant one).
- Stage 4: keep calling `finishStep` once per member to reuse its `verify-gates`/
  `update-task`/`transition` stages (these are not review-specific and don't need
  reinventing), but its `commit`/`push` stages must not execute per member. Collect
  every member's changed/committed files (gate+transition only, no actual git commit
  yet) and perform **one** shared `commit-and-push` covering every member's changes
  (plus the review report, when one was rendered) as a new, final stage — a single
  `commit.title`/`commit.message` from the shared `batchFinishContract` section, not
  threaded through N individual `finishStep` calls via new flags.
- Prefer extracting/reusing `finishStep`'s existing non-commit/push stage logic over
  adding `skipCommit`/`batchMode` parameters that thread through the single-task
  function — per the owner's explicit instruction.

## Implementation constraints

- Do not modify `finishStep`/`finish-operation.mjs` itself (forbidden path) — if the
  non-commit/push stages genuinely cannot be reused without a change there, stop and
  report back rather than editing it unreviewed; this task is scoped to the batch
  side only.
- Do not change `dependency-consumption.mjs`/`start-operation.mjs` in this task —
  task 04 owns materializing pending entries; this task only needs to not break
  whatever task 02 already allocated.

## Acceptance criteria

- A review-phase batch (members already individually ready, as today) behaves
  identically to current behavior: one review report rendered and committed, correct
  per-member transitions.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- An implementation-phase batch whose members modify real source files (within their
  own declared scope) passes provenance and finishes successfully.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- An implementation-phase batch's members (unconditional target step) are not
  required to supply a `result` field; supplying one that the step doesn't expect is
  still rejected with a clear error, not silently accepted.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Exactly one commit and one push land for a 3-member batch's finish, covering every
  member's own changes (plus the report, if rendered) — not three.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs tools/tests/batch-claim-release-ordering.test.mjs`
- Existing mixed pass/fail review-result handling (`batch-finish-operation.test.mjs`'s
  own `t1:pass,t2:pass,t3:fail` case) still produces correct, distinct per-member
  transitions.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/batch-finish-operation.test.mjs tools/tests/batch-claim-release-ordering.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Materializing pending intra-batch dependency-consumption entries (task 04), handover
partitioning (task 05).
