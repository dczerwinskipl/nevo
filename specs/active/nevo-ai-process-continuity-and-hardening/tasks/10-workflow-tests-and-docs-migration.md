---
id: nevo-ai-process-continuity-and-hardening.workflow-tests-and-docs-migration
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/overview.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - docs/ai/specification-workflow.md
    - AGENTS.md
    - CLAUDE.md
  optional:
    - docs/decisions/ADR-0002-lightweight-markdown-workflow.md
    - docs/decisions/ADR-0003-technical-decision-triage-and-option-analysis.md
    - docs/decisions/ADR-0004-review-artifacts-and-handoff.md
    - docs/decisions/ADR-0005-deterministic-approval-and-hardened-guard.md
allowed_paths:
  - docs/ai/specification-workflow.md
  - AGENTS.md
  - CLAUDE.md
  - docs/decisions/*.md
  - .claude/commands/nevo-ai/*.md
  - .claude/skills/nevo-ai-spec-workflow/**
  - tools/tests/**
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
  - specs/active/nevo-documentation-architecture/**
---

# Task: Workflow tests, doc migration, and consistency sweep

## Goal

Fix the `docs/ai/specification-workflow.md:61` classification-rule contradiction; bring
every touched doc/command/skill file into agreement with what tasks 01-09 actually built;
write the recommended ADR; and add the end-to-end automated coverage this change's own
acceptance criteria require (fingerprint exclusion, `depsSatisfied` with `abandoned`, a
recovery class end-to-end, the approve+start combined path including its failure case,
batch ordering and the single-active-task constraint, and the mechanical task type's
auto-approval conditions including a correctly-denied case) to the extent not already
covered by each individual task's own verification.

## Dependencies

`finalization-hardening-and-migration` — last task; documents and tests the finished
system.

## Implementation constraints

- Remove the contradiction at `docs/ai/specification-workflow.md:61` in favor of the
  signal-based classification table beneath it — state explicitly that ambiguity routes
  to **E** (discovery first), not a blanket "prefer the smaller class."
- Update only the docs/commands/skill files that describe a mechanism this change
  actually built in an earlier task — do not describe anything not yet implemented by
  the time this task runs (it is last in the rollout specifically so its docs are
  accurate).
- Write the new ADR under `docs/decisions/` with the next available number after
  ADR-0005, covering: why fingerprints exclude status (D1), why approve+start gained a
  combined-confirmation exception (D3), and why batch execution is sequential-only
  (constraints in `overview.md`).
- `AGENTS.md`/`CLAUDE.md` updates stay pointer-level, consistent with their existing
  "portable entry point" / "Claude-specific configuration only" scope — do not duplicate
  `docs/ai/specification-workflow.md` content into them.
- New end-to-end tests may live alongside each task's own test file (already added in
  tasks 01-09) or in a new `tools/tests/workflow-continuity.test.mjs` covering
  cross-mechanism scenarios (e.g. a full batch run that also exercises a recovery and an
  inline approve+start) — prefer extending existing suites over creating a new file
  unless a scenario genuinely spans multiple mechanisms.
- Regenerating `docs/index.generated.*`/`specs/*.generated.*` after doc/spec edits is a
  direct, mechanical consequence of this task's own edits — hence declared in
  `consequential_paths` rather than `allowed_paths`, per this change's own new
  convention (task 06/07). Run `node tools/docs.mjs generate` / `node tools/specs.mjs
  generate` and commit the regenerated output as part of this task, not as a follow-up.

## Acceptance criteria

1. `docs/ai/specification-workflow.md` no longer contains the line-61 contradiction
   (inspection — re-read the passage and the signal table together).
2. Every `.claude/commands/nevo-ai/*.md` file touched by an earlier task in this change
   has its "Ending"/behavior description updated to match (inspection, cross-checked
   against tasks 04, 06, 08, 09's actual changes).
3. A new ADR exists under `docs/decisions/` covering D1, D3, and the batch
   sequential-only constraint (inspection).
4. `node --test tools/tests/` passes and collectively covers every item in this change's
   `overview.md` § "Change-wide acceptance criteria" #10 (automated, full suite run).
5. `node tools/specs.mjs check` and `node tools/docs.mjs check` report generated indexes
   as current after this task's edits (automated).

## Verification

```
node --test tools/tests/
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/ai/specification-workflow.md`, `AGENTS.md`, `CLAUDE.md`,
`.claude/commands/nevo-ai/*.md`, `.claude/skills/nevo-ai-spec-workflow/**`, a new
`docs/decisions/ADR-0006-*.md` (or next available number).

## Out of scope

- Any change to `nevo-documentation-architecture`'s own artifacts.
- New runtime mechanisms — this task is documentation, ADR, generated-index
  regeneration, and cross-mechanism test coverage only.
