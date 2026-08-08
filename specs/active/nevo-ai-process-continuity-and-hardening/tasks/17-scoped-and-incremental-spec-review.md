---
id: nevo-ai-process-continuity-and-hardening.scoped-and-incremental-spec-review
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - state-and-fingerprint-semantics
  - implementation-review-orchestration
  - review-report-minimization
semantic_references:
  decisions: [D7, D18, D26, D29, D31, D34, D35]
  constraints: [C1, C2, C4]
  dependency_contracts:
    - state-and-fingerprint-semantics
    - implementation-review-orchestration
    - review-report-minimization
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/scoped-spec-review.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/commands/nevo-ai/spec-review.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/context-policy.md
    - tools/specs/lifecycle.mjs
  optional:
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/scoped-spec-review.test.mjs
  - .claude/commands/nevo-ai/spec-review.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/context-policy.md
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

# Task: Scoped and incremental spec-review

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.

## Goal

Closes D34 property 2 (bounded model context) and property 6 (no repeated review of
unchanged work). Adds `/nevo-ai:spec-review <change-id> --all|--changed|--tasks <spec>`
exactly as specified in `areas/scoped-spec-review.md`, keeping `--all` (full review) as
the default for compatibility, and drawing a hard boundary between reading an older task
as context and reviewing it.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — `computeTaskFingerprint`/
`computeChangeFingerprint`, the baseline for `--changed` selection and the scoped
verdict's out-of-scope-baseline check.

`implementation-review-orchestration` (task 12) — the `--tasks <range-or-list>` grammar
and resolver this task reuses for `spec-review`'s own `--tasks` flag rather than
reimplementing.

`review-report-minimization` (task 14) — `renderCompactReviewChecklist`, adapted for
the scoped review's own compact report shape.

## Implementation constraints

- Add `--all`/`--changed`/`--tasks <spec>` parsing to `spec-review.md`; no flag given
  behaves exactly as `--all` today (area requirement 1) — every existing invocation and
  doc reference to `/nevo-ai:spec-review <change-id>` continues to work unchanged.
- Reuse task 12's existing order-range/order-list resolver for `--tasks` rather than
  writing a second parser.
- Add a `selectChangedTasks(change, priorReview)` function to `tools/specs/lifecycle.mjs`
  comparing each task's current `computeTaskFingerprint` against
  `reviews/spec.md`'s `task_fingerprints` map — a task with no recorded entry (new) or a
  mismatched one (changed) is selected; a task with a matching entry is not.
- State explicitly, in `spec-review.md`'s flow, that reading an already-reviewed task's
  file for background context during a scoped run never writes to that task's own
  `task_fingerprints` entry, verdict, or `status` (area requirement 2) — this is a
  process rule for the reviewing agent, backed by the fact that only the deterministic
  write path (the review artifact write step) ever persists those fields, and that step
  only runs for tasks in the resolved scope.
- Add the "potentially impacted, not re-reviewed" reporting path (area requirement 4):
  an out-of-scope task is named and offered for scope expansion when *its own* current
  `computeTaskFingerprint` no longer matches its recorded `task_fingerprints` baseline —
  the same `invalidTaskIds` the scoped-verdict guard (below) already computes. A selected
  task's `semantic_references.dependency_contracts` naming an out-of-scope task is never,
  by itself, evidence of impact — reading an older task as a dependency is context, not a
  re-review trigger. Do not auto-expand scope in either case.
- Add the scoped-verdict guard (area requirement 5) to the existing derived-verdict
  table (`references/review-policy.md`): `ready-for-approval`/
  `approved-for-implementation` requires every out-of-scope task's fingerprint to still
  match its recorded baseline; otherwise report which task(s) need scope expansion.
- Wire `renderCompactReviewChecklist` (task 14) into the scoped-review report path,
  adapted to `spec-review`'s own five-value verdict vocabulary (area requirement 6). As
  originally shipped, `spec-review --all`'s existing report shape was left unchanged;
  **corrected by task 14/D34/D35's final pre-approval pass** — a fully-passing `--all`
  run now renders through the same compact shape (`renderScopedSpecReviewBody`), since
  the owner-facing minimization principle was found to apply to every review shape, not
  only the new scoped modes. `--all`'s *behavior* (which tasks are evaluated, the verdict
  computation itself) is unchanged either way — only the fully-passing body's rendering.

## Acceptance criteria

1. `/nevo-ai:spec-review <change-id>` (no flag) behaves identically to today's
   full review (`automated: node --test tools/tests/scoped-spec-review.test.mjs`).
2. `--tasks 14-17` and `--tasks 14,16,18` resolve to the correct, deduplicated task id
   list via the reused order-range/order-list resolver (automated).
3. `--changed` selects exactly the tasks whose current `computeTaskFingerprint` differs
   from (or is absent from) the prior review's `task_fingerprints` map (automated).
4. Reading an older, out-of-scope task's file for context during a scoped run does not
   alter that task's `task_fingerprints` entry, verdict, or `status` (automated).
5. An out-of-scope task whose own current fingerprint no longer matches its recorded
   `task_fingerprints` baseline produces an explicit "potentially impacted, not
   re-reviewed" report entry for that task, never a silent re-review or a silent
   omission (automated).
5a. A new or changed selected task naming an out-of-scope task in
   `semantic_references.dependency_contracts` does **not**, by itself, produce a
   "potentially impacted" entry for that out-of-scope task when its fingerprint is
   unchanged — reading it as context is not evidence of impact (automated, the required
   new-task-depends-on-old-task regression: task B depends on task A, A's fingerprint is
   unchanged, a scoped review of B uses A as context, A is not reported as potentially
   impacted and no scope expansion is requested).
6. A scoped review cannot report `ready-for-approval`/`approved-for-implementation`
   while any out-of-scope task's fingerprint baseline is invalid; it can when every
   out-of-scope task's baseline is valid (automated).
7. A fully-passing scoped review renders the same compact checklist shape as task 14's
   output, adapted to `spec-review`'s own verdict vocabulary. As originally shipped,
   `--all`'s report shape was asserted byte-for-byte unchanged for an otherwise-identical
   fixture; **corrected by task 14/D34/D35's final pre-approval pass** — a fully-passing
   `--all` fixture now renders through the same compact shape as a fully-passing scoped
   run, byte-for-byte identical between the two (automated). `--all`'s verdict/finding
   computation for a non-passing fixture is unaffected either way.
8. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's doc edits (automated).
9. `node --test tools/tests/*.test.mjs` (full suite, including the new
   `scoped-spec-review.test.mjs`) passes (automated).

## Verification

```
node --test tools/tests/scoped-spec-review.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`.claude/commands/nevo-ai/spec-review.md`, `.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`
(the scoped-verdict guard, added to the existing derived-verdict table),
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection covering
why `spec-review` gains a scoped mode and why context-reading is kept structurally
separate from review-scope selection; "Context" paragraph names task 17 alongside tasks
01-16).

## Out of scope

- Changing `spec-review --all`'s existing *behavior* (verdict computation, task
  evaluation) — the fully-passing *body shape* is extended to match the scoped compact
  shape by task 14/D34/D35's own correction, not by reopening this task's own scope.
- Changing `task-review`, `spec-audit`, `implementation-review`, or the gating batch
  review's own scope/report model — task 14/D34/D35's own correction touches their
  passing/no-findings report shapes; this task does not.
- A repository-wide, cross-change review scope.
- Automatically expanding scope on a detected potential impact — always named and
  offered, never silently applied.
