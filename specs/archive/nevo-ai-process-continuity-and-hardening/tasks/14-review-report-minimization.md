---
id: nevo-ai-process-continuity-and-hardening.review-report-minimization
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - review-report-compaction-and-scope-exceptions
semantic_references:
  decisions: [D31, D34, D35]
  constraints: [C1, C2]
  dependency_contracts:
    - review-report-compaction-and-scope-exceptions
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/review-report-compaction-and-scope-exceptions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/implementation-review.md
    - tools/specs/lifecycle.mjs
  optional:
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/review-compaction.test.mjs
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/implementation-review.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
  - docs/decisions/ADR-0006-process-continuity-and-hardening.md
consequential_paths:
  - docs/index.generated.md
  - docs/index.generated.json
  - specs/active.generated.md
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - specs/archive/**
  - AGENTS.md
  - CLAUDE.md
---

# Task: Review report minimization

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Requested after task 13 reached `verified`. Tightens task 13's own "15-30 line" target
> (`areas/review-report-compaction-and-scope-exceptions.md` requirement 7) into a
> deterministically enforced ten-line ceiling for a normal passing report — this task
> extends task 13's area (§E) rather than reopening or rewriting task 13's own body.

## Goal

Closes D34 properties 3 (minimal human-facing output), 4 (detailed text only for
failures/decisions/exceptions), and 7 (deterministic evidence and lifecycle writes).
**Corrected in the final pre-approval review pass:** a normal passing
`task-review`/`implementation-review` per-task body is normally exactly 4 non-empty
lines — a title, then three rows (acceptance-criteria coverage, scope, findings) —
computed by a real function (`renderNormalPassingReportBody`,
`tools/specs/lifecycle.mjs`) rather than composed as prose — exactly
`areas/review-report-compaction-and-scope-exceptions.md` §E's requirements 21-26, as
corrected. `computeTaskReviewChecklist`'s seven internal gates and verdict semantics
(task 13) are unchanged; four of the seven (verification, forbidden-path, docs, owner
decision) simply stop rendering their own positive row once they pass — a failure among
them surfaces through the relevant failed result or finding instead, never a resurrected
checklist row. The same owner-facing minimization principle — remove redundant positive
narration, never weaken a check or verdict — extends to `spec-review` (both `--all` and
scoped), `spec-audit`, and the gating batch review's own passing/no-findings report
bodies (§E requirements 27-28); the original draft of this task explicitly excluded
those four report shapes, which the final pre-approval review found contradicted the
minimization intent this task exists to serve.

## Dependencies

`review-report-compaction-and-scope-exceptions` (task 13) — this task renders the same
seven checklist inputs `computeTaskReviewChecklist` already computes; it cannot exist
before that function does, and it must never diverge from what that function already
treats as a resolved vs. unresolved item.

## Implementation constraints

- `renderCompactReviewChecklist(checklistResult)` (`tools/specs/lifecycle.mjs`, task 13)
  keeps rendering the full seven-item expanded shape — unchanged, used only for the
  failing/exception-pending case.
- `renderNormalPassingReportBody(checklistResult, { title, totalAcceptanceCriteria,
  scopeExceptionCount })` renders the corrected normal-passing body: a title line, then
  exactly three rows — `Acceptance criteria: <covered>/<total>`, `Scope: compliant` (or
  `resolved` plus one nested owner-approved-exception line), `Findings: none unresolved`
  — never the seven-item checklist. `task-review.md`/`implementation-review.md` call
  this function for the passing case instead of composing the body as free text, and
  instead of the function's own pre-correction behavior (which rendered all seven
  checklist items even when passing).
- A failing or exception-pending report is unchanged from task 13's own shape (expand
  only the failed ACs, scope issues, or active findings via `renderCompactReviewChecklist`)
  — the minimal shape applies only to the fully-passing case (area requirement 21,
  corrected).
- Add a deterministic structural check (not prompt wording) confirming AC coverage,
  scope, and findings each appear exactly once in a rendered report (area requirement
  22) — `checkReportSectionUniqueness`, updated to recognize the corrected inline
  wording (`Acceptance criteria: N/M`, `Scope: compliant|resolved`, `Findings: none
  unresolved|N`) alongside the original expanded-shape headings.
- `implementation-review.md`'s aggregate table drops its `Tests` column (`Task | Verdict
  | AC | Scope | Findings`) — a passing `Verdict` already implies verification passed;
  restating it was redundant positive narration (area requirement 17, corrected).
- Extend the same minimization principle to `spec-review` (`--all` and scoped alike, via
  `renderScopedSpecReviewBody`, task 17 — its own verdict computation is unaffected),
  `spec-audit`, and the gating batch review's own passing/no-findings report bodies:
  remove a synthetic `INFORMATIONAL` row recording that a check merely passed (area
  requirement 27) — never weaken any of their own checks, gates, or verdict tables (area
  requirement 28).
- Do not change `computeTaskReviewChecklist`'s own verdict semantics (task 13,
  unchanged) — this task only adds a renderer/validator layer on top of it.
- Do not add a fourth per-task verdict value, change the finding-lifecycle vocabulary,
  or touch the scope-exception schema — all unchanged from task 13.
- Do not change any verdict decision table (`task-review`, `spec-review`, `spec-audit`,
  the gating batch review, `implementation-review`) — only remove redundant positive
  rendering from each shape's own passing/no-findings case.

## Acceptance criteria

1. A synthetic fully-passing report (full AC coverage, `Scope: compliant`, zero
   findings) rendered by `renderNormalPassingReportBody` is exactly 4 non-empty lines —
   title, `Acceptance criteria: N/N`, `Scope: compliant`, `Findings: none unresolved`
   (`automated: node --test tools/tests/review-compaction.test.mjs`).
2. A synthetic fully-passing report with one accepted scope exception rendered by
   `renderNormalPassingReportBody` is exactly 5 non-empty lines (the exception's one
   nested note added under `Scope: resolved`) (automated).
2a. None of the four internal-only gates (required automated verification, no
   forbidden-path violation, architecture/documentation consistency, no unresolved
   owner decision) renders as its own positive row in a passing body — proven by
   asserting their label text is absent from the rendered output (automated).
3. AC coverage, scope, and findings each appear exactly once in a rendered report — a
   test asserts no duplicated heading/section for any of the three, using
   `checkReportSectionUniqueness`'s corrected markers for the inline wording (automated).
4. A normal passing body contains none of: pass-rationale prose, a separate verdict
   explanation, a full successful-verification-command listing beyond one line per
   command, a test-count restatement, a separate architecture/documentation-consistency
   paragraph, a repeated AC-coverage restatement, a compliant-path list, Git history
   narration, or a synthetic `INFORMATIONAL` finding (automated, via the same fixture
   used for AC1).
5. A failing report (at least one unmet AC, one unresolved finding, or one unresolved
   scope issue) is unaffected by this task's minimization — it still expands exactly the
   failed items via `renderCompactReviewChecklist`, per task 13's own unchanged shape
   (automated).
6. `pass` remains unreachable with incomplete AC coverage, missing required automated
   coverage, unresolved scope, a blocking finding, or an unresolved owner decision —
   `renderNormalPassingReportBody` throws rather than renders for a non-passing checklist
   result (`automated`, extends task 13's existing `computeTaskReviewChecklist` test
   suite).
7. `implementation-review`'s aggregate report uses the same
   `renderNormalPassingReportBody` output for each passing task's expanded detail (when
   any is shown) — no second, divergent minimal-report renderer is introduced — and its
   own compact table drops the `Tests` column (`Task | Verdict | AC | Scope | Findings`)
   (inspection + automated where the fixture is deterministic).
7a. A fully-passing `spec-review --all` run and a fully-passing scoped `spec-review` run
   render byte-for-byte identical bodies for an otherwise-identical fixture, both via
   `renderScopedSpecReviewBody` — the artificial "`--all` is exempt" restriction from
   this task's original draft is removed; `spec-review`'s verdict computation for either
   mode is unaffected (automated).
7b. A `spec-audit`/gating-batch-review `no-findings` result never carries a synthetic
   `INFORMATIONAL` row confirming a check merely passed — verified by inspection of
   `references/review-policy.md` § "Gating versus non-gating checks" and
   `templates/review-report.md` § "Findings," both corrected to state the universal rule
   (inspection — these two commands compose their report bodies as agent-authored prose
   following documented rules, not through a dedicated pure renderer, so this AC is
   inspection-based, not automated, unlike AC1-AC7a).
8. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's doc edits (automated).
9. `node --test tools/tests/*.test.mjs` (full suite, including this task's additions to
   `review-compaction.test.mjs`) passes (automated).

## Verification

```
node --test tools/tests/review-compaction.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` (the corrected
4-line normal-passing shape alongside task 13's existing compaction rules; § "Gating
versus non-gating checks" corrected to drop the passing-case `INFORMATIONAL` row),
`.claude/skills/nevo-ai-spec-workflow/templates/review-report.md` (the `## Checklist`
and `## Findings` sections, extended to state the universal rule),
`.claude/commands/nevo-ai/task-review.md`, `.claude/commands/nevo-ai/implementation-review.md`
(aggregate table `Tests` column removed), `.claude/commands/nevo-ai/spec-review.md`
(fully-passing `--all` reuses `renderScopedSpecReviewBody`),
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (corrected subsection
after D31's, covering D34/D35's tightened, corrected shape and its extension to every
review shape; "Context" paragraph names task 14 alongside tasks 01-13).

## Out of scope

- Any change to `computeTaskReviewChecklist`'s verdict semantics, the finding-lifecycle
  vocabulary, or the `scope_exceptions` schema — all owned by task 13, unchanged here.
- Any change to `spec-review`'s five-value verdict vocabulary, `spec-audit`'s or the
  gating batch review's three-value verdict table, or any of their underlying checks —
  this task only removes redundant positive rendering from their own passing/no-findings
  case (**corrected**: the original draft excluded these four report shapes entirely,
  from this task's scope; the final pre-approval review found that exclusion itself
  contradicted the minimization intent D34/D35 require, and it is removed here — see
  Goal and Implementation constraints above).
- Retroactively rewriting any already-written `reviews/*.md` file from tasks 01-13 — the
  tighter shape applies going forward, on the next `task-review`/`implementation-review`
  run.
