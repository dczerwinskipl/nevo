---
id: nevo-ai-process-continuity-and-hardening.workflow-e2e-tests
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/overview.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/recovery-and-resume.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/batch-execution-and-gating-review.md
  optional:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/finalization-and-migration.md
allowed_paths:
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/**
  - .claude/commands/**
  - .claude/skills/**
  - AGENTS.md
  - CLAUDE.md
---

# Task: Cross-mechanism end-to-end workflow tests

> New task, split from the original combined wrap-up task per the refinement's finding 12
> (a late integration sink concentrating tests, docs, ADR work, and index regeneration in
> one task). This task exists specifically so integration inconsistencies surface **before**
> task 11 documents the mechanisms — the ordering is the fix, not just the test content.

## Goal

Implement and pass cross-mechanism end-to-end tests proving tasks 01-09's mechanisms work
together correctly — every regression scenario the refinement request enumerated — before
any documentation, ADR, or index-regeneration work (task 11) begins.

## Dependencies

`finalization-hardening-and-migration` — the last implementation task; this task tests
the fully-assembled system tasks 01-09 built.

## Implementation constraints

- Cover, at minimum, every scenario below (group headers match the refinement request's
  own grouping; extend an existing suite per mechanism rather than creating one giant
  file, unless a scenario genuinely spans more than two mechanisms):

  **Fingerprints** — changing a task's status preserves every fingerprint tier; adding an
  unrelated task doesn't invalidate an independent task's fingerprint; changing shared
  scope invalidates affected task fingerprints; changing a task's acceptance criteria
  invalidates that task's fingerprint; adding a mechanical resolver task doesn't
  invalidate unrelated task fingerprints; changing a referenced owner decision invalidates
  only affected fingerprints.

  **Recovery** — `REC-01` (wrong clean branch) can be confirmed, repaired, retried, and
  continued; `REC-02` (remote-only branch) recovers correctly; `REC-03` (stale generated
  file) repairs and the original validation retries; `REC-05` vs. `REC-06` (task-related
  vs. unrelated dirty files) produce different actions; `REC-08` (scope expansion)
  suspends execution and returns to the correct prior `status` after a decision; `REC-09`
  (ADR conflict) cannot be automatically recovered; a `partially_completed` `start`
  resumes from missing postconditions only; an interrupted combined approve+start does
  not repeat approval.

  **Batch** — batch progress reconstructs after interruption with no conflicting state
  file; a small low-risk code task uses self-check plus the gating batch review only; a
  risky task receives its own full `task-review` before batch continuation; a failed
  self-check stops the batch; a declared temporary inconsistency is allowed inside the
  batch and blocks the gating review until resolved; batch resume selects the correct
  next task via `deriveStage`.

  **Context and follow-ups** — missing inferred context produces a deterministic warning;
  a `context_exceptions` entry without a valid `decision` reference is rejected; a
  `blocking` follow-up blocks finalization; a resolved mechanical follow-up is visible in
  the gating batch review; a routing-table format violation is detected by
  `tools/docs.mjs validate`.

  **Finalization** — a successful post-merge check completes cleanup (branch deletion
  included); a failed post-merge check does not write into the archived change and
  preserves the branch; branch cleanup never occurs before the post-merge check's result
  is known.

- Do not touch `docs/**`, `.claude/commands/**`, `.claude/skills/**`, `AGENTS.md`, or
  `CLAUDE.md` in this task — those are task 11's exclusive scope, kept separate precisely
  so documentation can't quietly patch over a test gap this task should have caught.
- Every scenario above must actually exercise the real implementation from tasks 01-09
  (no test doubles standing in for the mechanism under test) — this is what makes the
  suite "integration," not a repeat of each task's own unit tests.

## Acceptance criteria

1. Every scenario listed above has a passing automated test.
2. `node --test tools/tests/` passes in full, with the new cross-mechanism scenarios
   clearly attributable to this task (via file name or a shared `describe` block).
3. No test in this task's added files touches `docs/**`/`.claude/**` as its subject —
   only `tools/`-level mechanisms are exercised (inspection).

## Verification

```
node --test tools/tests/
node tools/specs.mjs validate
```

## Documentation impact

None — this task is tests only. Consolidated documentation happens in task 11, after this
task's suite is green.

## Out of scope

- Any documentation, ADR, command/skill migration, or index regeneration (task 11).
- New implementation mechanisms — this task only tests what tasks 01-09 already built; a
  scenario that fails because a mechanism is genuinely missing is a defect in the
  relevant earlier task, not something to work around here.
