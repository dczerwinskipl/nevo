---
id: nevo-ai-process-continuity-and-hardening.unowned-drift-correction-flow
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - scope-and-follow-up-mechanisms
  - review-report-compaction-and-scope-exceptions
semantic_references:
  decisions: [D13, D15, D22, D31, D34, D35]
  constraints: [C1, C2, C4]
  dependency_contracts:
    - scope-and-follow-up-mechanisms
    - review-report-compaction-and-scope-exceptions
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/unowned-drift-correction.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/decision-policy.md
    - tools/specs/lifecycle.mjs
  optional:
    - .claude/commands/nevo-ai/spec-audit.md
    - .claude/commands/nevo-ai/task-review.md
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/unowned-drift.test.mjs
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/decision-policy.md
  - .claude/commands/nevo-ai/spec-audit.md
  - .claude/commands/nevo-ai/task-review.md
  - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
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

# Task: Formal unowned-drift correction flow

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Closes `follow-ups.yaml` FU-006 (`status: open`).

## Goal

Closes D34 property 7 (deterministic evidence and lifecycle writes) and property 1 (one
owner request per logical operation — a named flow instead of an ad hoc detour). Adds a
named, classified **unowned-drift** correction process exactly as specified in
`areas/unowned-drift-correction.md`: classification, a three-option owner menu, a
structured persisted record for the maintenance-correction option, and visibility in
review/audit — never a silent ad hoc edit again.

## Dependencies

`scope-and-follow-up-mechanisms` (task 06) — `follow-ups.yaml`'s schema/validation
machinery, reused as the maintenance-correction record's likely persisted home.

`review-report-compaction-and-scope-exceptions` (task 13) — the existing
`forbidden_paths`-exclusion rule and three-option owner-decision menu shape this task's
own menu deliberately mirrors.

## Implementation constraints

- Add `classifyUnownedDrift(path, { change, currentTaskId })` to
  `tools/specs/lifecycle.mjs`: returns `unowned-drift` only when the path is outside
  every task's `allowed_paths`/`consequential_paths`, not attributable to the task
  currently under review/implementation's own diff, and not inside any task's
  `forbidden_paths` (a `forbidden_paths` path returns a distinct
  `forbidden-outside-scope` result, never `unowned-drift`, per area requirement 5).
- Present the three-option menu (area requirement 2) per
  `references/decision-policy.md`'s existing closed-choice presentation pattern —
  reused, not reinvented.
- Add a `kind: maintenance-correction` entry shape to `follow-ups.yaml`'s existing
  schema (`scope-and-follow-up-mechanisms`, task 06) carrying: `paths` (exact list, no
  globs), `reason`, `confirmed_by: owner`, `confirmed_at`, and a `revision` field
  (commit SHA that performed the correction) — validated the same way every other
  `follow-ups.yaml` entry already is.
- Wire visibility: `spec-audit.md` and `task-review.md`'s scope-check step both
  recognize a path with a matching `kind: maintenance-correction` follow-up entry and
  report it by name ("handled via unowned-drift correction, see `<entry id>`") rather
  than surfacing it as an unexplained anomaly.
- Do not allow `classifyUnownedDrift`/the menu to offer option 3 for any path matching
  a `forbidden_paths` pattern on any active task (area requirement 5, hard rule).

## Acceptance criteria

1. A path outside every task's `allowed_paths`/`consequential_paths`, not attributable
   to the current task's diff, and not `forbidden_paths`-matched, classifies as
   `unowned-drift` (`automated: node --test tools/tests/unowned-drift.test.mjs`).
2. A path matching any task's `forbidden_paths` never classifies as `unowned-drift` and
   is never offered option 3 (automated).
3. A completed option-3 maintenance correction persists `paths`, `reason`,
   `confirmed_by`, `confirmed_at`, and `revision`; `validate` rejects an entry missing
   any of these fields (automated).
4. A `spec-audit`/`task-review` run whose scope includes a path with a recorded
   maintenance-correction entry names that entry explicitly rather than reporting an
   unexplained anomaly (automated).
5. Both FU-006 incidents (the `git-workflow.md` edit, the `task-review.md`
   consequential-paths gap), reconstructed as fixtures, classify `unowned-drift` and
   route through this flow (automated).
6. `follow-ups.yaml`'s FU-006 entry is updated to `status: resolved` with a
   `resolution` field referencing this task, only after AC1-AC5 pass (`inspection`).
7. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's changes (automated).
8. `node --test tools/tests/*.test.mjs` (full suite, including the new
   `unowned-drift.test.mjs`) passes (automated).

## Verification

```
node --test tools/tests/unowned-drift.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` (the unowned-drift
classification and three-option flow), `docs/decisions/ADR-0006-process-continuity-and-hardening.md`
(new subsection covering why unowned-drift needed a named process instead of remaining
an ad hoc edit path; "Context" paragraph names task 19 alongside tasks 01-18).

## Out of scope

- Automatically classifying every out-of-scope edit as unowned-drift without the
  classification step — a task's own legitimate scope exception (task 13) is a
  different, already-existing mechanism.
- Bypassing `forbidden_paths` through any option.
- Retroactively re-recording the two incidents FU-006 already describes as
  already-applied unowned-drift corrections.
