---
id: nevo-ai-process-continuity-and-hardening.batch-execution-and-gating-review
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/batch-execution-and-gating-review.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/task-next.md
  optional:
    - .claude/commands/nevo-ai/spec-audit.md
    - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
  - tools/specs.mjs
  - tools/tests/batch.test.mjs
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/task-next.md
  - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
---

# Task: Batch execution and gating review

## Goal

Implement sequential batch execution of already-`approved` tasks (selection, dependency
ordering, single-active-task constraint, per-task self-check with a risk-based
`task-review` trigger, resumable active-batch state, declared temporary-inconsistency
pairs) and the one gating batch review that closes a batch — exactly as specified in
`areas/batch-execution-and-gating-review.md`.

## Dependencies

`conversational-approval-ergonomics` — batch execution reuses the inline-offer/
auto-continue mechanism that task already built the forward-compatible hook for.
`state-and-fingerprint-semantics` — needs correct dependency ordering.

## Implementation constraints

- Batch selection is always explicit at start (all-ready / named subset / until-checkpoint)
  — no default.
- Exactly one task `in-implementation` at a time; the batch controller calls the existing
  `start`/`complete` transitions unchanged — it does not introduce a new write path to
  `change.yaml`.
- A task is "risky" (requires its own full `task-review` before the batch can complete
  it) when it declares `consequential_paths`, touches `src/**`/`tests/**`, or has any
  `owner-decision:`-tagged acceptance criterion — implement this check by reading the
  task's own front matter/body, not a separate risk-declaration field.
- The active-batch record (requested task list, completed-so-far) is a small persisted
  file (e.g. `specs/active/<change-id>/.batch-state.json` or an equivalent — name it
  clearly as generated/operational state, excluded from the fingerprint per D1's
  precedent) enabling resume via `deriveStage` plus this record.
- A declared temporary-inconsistency pair names both tasks explicitly before the batch
  starts; `validate`/`check` is skipped between exactly that pair and enforced at every
  other boundary, including the batch's own end.
- The gating batch review writes `specs/active/<change-id>/reviews/batch-<n>.md` (or
  equivalent, distinct from `reviews/<task-id>.md` and `reviews/audit-<slug>.md`, per the
  existing "each review shape gets its own path" convention), with verdict
  `changes-recommended` \| `owner-decision-required` \| `no-findings` computed from an
  explicit table, never composed as prose.
- `task-review.md`'s batch-continuation offer (the forward-compatible check added in task
  04) now has a real active-batch record to check against — this task makes the offer
  actually appear when a batch is active.

## Acceptance criteria

1. A batch runs strictly in `depends_on` order and is rejected before any task starts if
   unsatisfiable (automated: `node --test tools/tests/batch.test.mjs`).
2. Exactly one task is ever `in-implementation` during a batch run (automated).
3. A risky task cannot be batch-completed without its own `task-review` having run
   (automated).
4. An interrupted batch resumes to the correct next task via `deriveStage` plus the
   active-batch record (automated).
5. A declared temporary-inconsistency pair does not fail `validate` mid-batch; an
   undeclared inconsistency between any other pair still does (automated).
6. The gating batch review's verdict is computed from an explicit table and matches the
   same derivation pattern as `spec-review`'s (inspection + automated verdict-table test).

## Verification

```
node --test tools/tests/batch.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`task-review.md`, `task-next.md`, `review-policy.md` (new "batch review" subsection,
distinct from the existing "change-wide audits" subsection), `templates/review-report.md`
(batch review shape, if it diverges from the existing table).

## Out of scope

- Parallel or concurrent task execution.
- Changing what `spec-review`/`spec-approve` require before a task can enter a batch —
  every batched task is already individually approved beforehand.
