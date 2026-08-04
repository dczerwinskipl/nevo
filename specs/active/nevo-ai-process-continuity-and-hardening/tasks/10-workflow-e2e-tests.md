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
>
> Refined again 2026-08-04 (second pass) — this task's scenario list gains the second
> refinement request's own "Required regression tests" section (lifecycle-status
> removal, combined-transition repair-and-retry, `semantic_references`, evidence
> freshness, four-mode batch selection, `follow-ups.yaml`, and the guarded post-merge
> repair branch), covering D16-D23. Most of these scenarios are already required as
> area-specific acceptance criteria on tasks 01-04, 06, 08-09; this task's job is proving
> them together, end-to-end, against the assembled system — not re-deriving them.
>
> Refined a third time 2026-08-04 — adds the third refinement request's regression
> scenarios for D24 (batch hard stop) and D25 (repair-branch guard order/failure
> semantics), covering everything `node --test` can exercise automatically. D26's
> `semantic_references` **completeness** check is a model-review procedure implemented
> by task 11, not a code mechanism — it has no automated test here; this task's own D26
> coverage is limited to the deterministic *integrity* checks task 01 already validates
> (unresolvable/invalid reference IDs, superseded-decision detection, fingerprint
> invalidation), exercised end-to-end alongside the other mechanisms.

## Goal

Implement and pass cross-mechanism end-to-end tests proving tasks 01-09's mechanisms work
together correctly — every automatable regression scenario the first, second, and third
refinement requests enumerated — before any documentation, ADR, or index-regeneration
work (task 11) begins.

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

  **Second refinement pass — lifecycle status removal (D16)** — manually setting a
  task's or the change's `status` to `blocked` fails `validate` with the fixed migration
  message; the `needs-decision` case does too; entering and clearing a suspension leaves
  the task's stable `status` unchanged (proves suspension remains the only supported
  temporary-blocker model end-to-end, not just at the schema level).

  **Second refinement pass — combined-transition repair-and-retry (D17)** — an
  authorized combined `approve`→`start` where `approve` succeeds and `start` hits a
  `confirm-required` recovery resumes and completes after one confirmation, without a
  second `/nevo-ai:task-start` invocation and without repeating `approve`; a combined
  flow where `start` becomes `not_retryable` leaves `approve` persisted and the workflow
  stopped with a clear reason; an `unsafe_manual` result inside a combined flow stops
  without ever presenting a confirmation prompt for it.

  **Second refinement pass — deterministic fingerprint references (D18)** — a task
  referencing a decision via `semantic_references.decisions` has its fingerprint change
  when that decision's content changes, and only that task's; a
  `dependency_contracts` entry not present in the task's own `depends_on` fails
  `validate`; an unresolvable `semantic_references.decisions`/`constraints` entry fails
  `validate`; a task referencing a decision explicitly marked superseded by a later one
  fails `validate` naming the superseding decision.

  **Second refinement pass — batch evidence freshness (D19)** — a later batched task
  changing a file an earlier task's inspection evidence referenced invalidates that
  evidence and blocks the gating batch review until refreshed; a later batched task
  changing a subsystem an earlier task's automated verification covered triggers a
  rerun before the gating review proceeds; an unrelated later task's change does not
  stale an earlier task's evidence; the gating batch review fails/stops when stale
  evidence cannot be refreshed.

  **Second refinement pass — batch selection modes (D20)** — `currently-ready` selects
  only the current frontier of a multi-task dependency graph; `all-approved-reachable`
  walks a full linear approved dependency chain that `currently-ready` alone could not
  express; a `named-subset` selection missing a required prerequisite is reported, not
  silently resolved; `until-checkpoint` stops exactly at the requested checkpoint.

  **Second refinement pass — structured follow-ups (D22)** — malformed `follow-ups.yaml`
  (invalid YAML, missing required field, unrecognized `status`/`severity`) fails
  `validate`; a `blocking`-severity open follow-up blocks the declared workflow boundary
  (finalization); a `resolved` follow-up entry without a `resolution` fails validation of
  the resolved-state requirement.

  **Second refinement pass — post-merge repair (D23, superseded in detail by D25 —
  see below)** — a post-merge failure report correctly identifies the diagnostic branch;
  the repair branch is created only after confirmation; a successful post-merge
  verification proceeds to cleanup exactly as before.

  **Third refinement pass — batch hard stop (D24)** — a failed self-check stops the
  batch immediately without ever routing to a full `task-review`; a full `task-review`
  cannot mark a hard-stopped task complete while its self-check still fails; correcting
  the implementation and rerunning the self-check resumes the batch; a task whose
  self-check now passes but that meets an independent risk signal still requires a full
  `task-review`; a passing low-risk task with no hard stop and no risk signal proceeds to
  the gating batch review without a full `task-review`.

  **Third refinement pass — post-merge repair-branch guard order (D25)** — the guard
  sequence runs in the documented nine-step order (worktree clean → local repair branch
  absent → fetch → remote repair branch absent → `origin/main` SHA match → switch to
  `main` → `pull --ff-only` → local `main` SHA match → create branch); each guard-failure
  mode (local repair branch exists, remote repair branch exists, `origin/main` moved,
  local `main` cannot fast-forward) stops without creating the branch and names the
  failed guard; a guard failure occurring after the local `main` switch/fast-forward
  reports that the switch/fast-forward already happened rather than claiming no
  modification occurred; a guard failure before the switch reports at most a completed
  read-only fetch; no `reset`/`clean`/force-checkout/automatic-stash occurs under any
  guard-failure scenario; branch creation succeeds only once every guard passes.

  **Third refinement pass — semantic-reference integrity end-to-end (D26, integrity
  only — completeness is a task-11 model-review procedure with no automated test)** — an
  invalid decision ID in `semantic_references.decisions` fails `validate`; an invalid
  constraint ID fails `validate`; an invalid `dependency_contracts` entry fails
  `validate`; a `semantic_references.decisions` entry naming a decision explicitly
  marked superseded is rejected, naming the superseding decision; changing
  `semantic_references` changes the task's fingerprint; an operational status change
  alone does not change it.

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
