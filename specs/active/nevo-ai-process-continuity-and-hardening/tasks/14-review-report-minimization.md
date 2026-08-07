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
failures/decisions/exceptions), and 7 (deterministic evidence and lifecycle writes). A
normal passing `task-review`/`implementation-review` per-task body must render at most
10 non-empty lines, computed by a real function
(`renderCompactReviewChecklist`/`computeTaskReviewChecklist`, `tools/specs/lifecycle.mjs`)
rather than composed as prose — exactly `areas/review-report-compaction-and-scope-exceptions.md`
§E's requirements 21-26.

## Dependencies

`review-report-compaction-and-scope-exceptions` (task 13) — this task renders the same
seven checklist inputs `computeTaskReviewChecklist` already computes; it cannot exist
before that function does, and it must never diverge from what that function already
treats as a resolved vs. unresolved item.

## Implementation constraints

- Add `renderCompactReviewChecklist(checklistResult)` to `tools/specs/lifecycle.mjs`,
  taking `computeTaskReviewChecklist`'s output and rendering the exact normal-passing
  body: a title line, the seven checklist items (checked, no further prose per item),
  and — only when an accepted scope exception applies — up to two lines for the
  exception note. `task-review.md`/`implementation-review.md` call this function for
  the passing case instead of composing the body as free text.
- A failing or exception-pending report is unchanged from task 13's own shape (expand
  only the failed ACs, scope issues, or active findings) — the ten-line ceiling applies
  only to the fully-passing case (area requirement 21).
- Add a deterministic structural check (not prompt wording) confirming AC coverage,
  scope, and findings each appear exactly once in a rendered report (area requirement
  22) — either as part of `renderCompactReviewChecklist`'s own contract or as a small,
  separate validator function; either shape is acceptable as long as it is a real,
  tested function, not a review-time judgment call.
- Do not change `computeTaskReviewChecklist`'s own verdict semantics (task 13,
  unchanged) — this task only adds a renderer/validator layer on top of it.
- Do not add a fourth per-task verdict value, change the finding-lifecycle vocabulary,
  or touch the scope-exception schema — all unchanged from task 13.

## Acceptance criteria

1. A synthetic fully-passing report (full AC coverage, `Scope: compliant`, zero
   findings) rendered by `renderCompactReviewChecklist` has at most 10 non-empty lines
   (`automated: node --test tools/tests/review-compaction.test.mjs`).
2. A synthetic fully-passing report with one accepted scope exception rendered by
   `renderCompactReviewChecklist` still has at most 10 non-empty lines (automated).
3. AC coverage, scope, and findings each appear exactly once in a rendered report — a
   test asserts no duplicated heading/section for any of the three (automated).
4. A normal passing body contains none of: pass-rationale prose, a separate verdict
   explanation, a full successful-verification-command listing beyond one line per
   command, a test-count restatement, a separate architecture/documentation-consistency
   paragraph, a repeated AC-coverage restatement, a compliant-path list, Git history
   narration, or a synthetic `INFORMATIONAL` finding (automated, via the same fixture
   used for AC1).
5. A failing report (at least one unmet AC, one unresolved finding, or one unresolved
   scope issue) is unaffected by the ten-line ceiling — it still expands exactly the
   failed items, per task 13's own unchanged shape (automated).
6. `pass` remains unreachable with incomplete AC coverage, missing required automated
   coverage, unresolved scope, a blocking finding, or an unresolved owner decision —
   the ten-line renderer is never invoked for a non-passing checklist result
   (`automated`, extends task 13's existing `computeTaskReviewChecklist` test suite).
7. `implementation-review`'s aggregate report uses the same
   `renderCompactReviewChecklist` output for each passing task's expanded detail (when
   any is shown) — no second, divergent minimal-report renderer is introduced
   (inspection + automated where the fixture is deterministic).
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

`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` (state the ten-line
ceiling alongside task 13's existing compaction rules),
`.claude/skills/nevo-ai-spec-workflow/templates/review-report.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection after D31's,
covering D34/D35's tightened line budget; "Context" paragraph names task 14 alongside
tasks 01-13).

## Out of scope

- Any change to `computeTaskReviewChecklist`'s verdict semantics, the finding-lifecycle
  vocabulary, or the `scope_exceptions` schema — all owned by task 13, unchanged here.
- Changing `/nevo-ai:spec-review`, `/nevo-ai:spec-audit`, or the gating batch review's
  own report shape — unchanged, same exclusion task 13 already established.
- Retroactively rewriting any already-written `reviews/*.md` file from tasks 01-13 — the
  tighter shape applies going forward, on the next `task-review`/`implementation-review`
  run.
