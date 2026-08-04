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

> Refined 2026-08-04 (see `owner-decisions.md` D10, D11) — batch progress is now derived
> entirely from `change.yaml`/`execution.suspension`, with no second progress file to
> reconcile; the risk trigger for a full task-review is now evidence-based, not
> path-touch-based, so a small low-risk code task can actually use the lightweight path
> batch mode is supposed to offer.

## Goal

Implement sequential batch execution of already-`approved` tasks (selection, dependency
ordering, single-active-task constraint, evidence-based risk trigger for full review,
derived progress, resumable intent state, declared temporary-inconsistency pairs) and the
one gating batch review that closes a batch — exactly as specified in
`areas/batch-execution-and-gating-review.md`.

## Dependencies

`conversational-approval-ergonomics` — batch execution reuses the inline-offer/
auto-continue mechanism that task already built the forward-compatible hook for.
`state-and-fingerprint-semantics` — needs correct dependency ordering and the
`execution.suspension` schema batch progress derivation reads.

## Implementation constraints

- Batch selection is always explicit at start (all-ready / named subset / until-checkpoint)
  — no default.
- Exactly one task `in-implementation` at a time; the batch controller calls the existing
  `start`/`complete` transitions unchanged — it does not introduce a new write path to
  `change.yaml`.
- **The persisted batch file holds intent only** — `change`, `requestedTasks`,
  `orderedTasks`, `startRevision`, `reviewMode`, `checkpointPolicy`,
  `temporaryInconsistencies`. It must contain **no** `completed`/`current`/`next`/
  `failed` field. Completed/current/next/failed are computed, every time they're needed,
  by reading each `orderedTasks` entry's `status` and `execution.suspension` directly —
  implement this as one pure function (`deriveBatchProgress(change, intent)`), not
  inlined ad hoc at each call site.
- A task requires its own full `task-review` before the batch can complete it when, and
  only when, at least one evidence-based signal holds (see
  `areas/batch-execution-and-gating-review.md` requirement 5 for the full list —
  declared `review: required`, public-API/compat impact, security/data-safety impact,
  migration/destructive-persistence behavior, an `owner-decision:`-tagged criterion,
  scope expansion, a failed/unresolved self-check, missing automated verification,
  unexpected files, implementation divergence, or an owner-flagged high-risk task).
  Touching `src/**`/`tests/**`/`consequential_paths` alone is **not** on this list.
- The gating batch review writes `specs/active/<change-id>/reviews/batch-<n>.md` (or
  equivalent, distinct from `reviews/<task-id>.md` and `reviews/audit-<slug>.md`), with
  verdict `changes-recommended` \| `owner-decision-required` \| `no-findings` computed
  from an explicit table. It never re-evaluates any individual batched task's own
  acceptance criteria — it checks the whole-batch diff since `startRevision`, cross-task
  integration, and open blocking follow-up entries only.
- A declared temporary-inconsistency pair names both tasks explicitly before the batch
  starts; `validate`/`check` is skipped between exactly that pair and enforced at every
  other boundary, including the batch's own end.
- `task-review.md`'s batch-continuation offer (the forward-compatible check added in task
  04) now has a real active-batch intent file to check against — this task makes the
  offer actually appear when a batch is active.

## Acceptance criteria

1. A batch runs strictly in `depends_on` order and is rejected before any task starts if
   unsatisfiable (automated: `node --test tools/tests/batch.test.mjs`).
2. Exactly one task is ever `in-implementation` during a batch run (automated).
3. The persisted batch file contains no progress fields; `deriveBatchProgress` correctly
   reconstructs completed/current/next/failed from `change.yaml` alone after a simulated
   interruption between writes (automated).
4. A task meeting no evidence-based risk signal completes via self-check plus the gating
   batch review only (automated).
5. A task meeting at least one risk signal cannot be batch-completed without its own
   `task-review` (automated).
6. A declared temporary-inconsistency pair does not fail `validate` mid-batch; an
   undeclared inconsistency between any other pair still does (automated).
7. The gating batch review's verdict is computed from an explicit table and never
   contains a re-evaluation of an individual task's own acceptance criteria (inspection +
   automated verdict-table test).

## Verification

```
node --test tools/tests/batch.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`task-review.md`, `task-next.md`, `review-policy.md` (new "batch review" subsection),
`templates/review-report.md` (batch review shape, if it diverges from the existing
table).

## Out of scope

- Parallel or concurrent task execution.
- Changing what `spec-review`/`spec-approve` require before a task can enter a batch.
- Any second persisted copy of task progress (explicitly rejected by D10).
