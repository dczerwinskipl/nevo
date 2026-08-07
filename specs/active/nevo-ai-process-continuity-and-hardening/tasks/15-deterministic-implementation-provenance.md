---
id: nevo-ai-process-continuity-and-hardening.deterministic-implementation-provenance
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - state-and-fingerprint-semantics
  - recovery-classification-and-machine-readable-errors
  - batch-execution-and-gating-review
semantic_references:
  decisions: [D7, D8, D18, D28, D33, D34, D35]
  constraints: [C1, C5, C7]
  dependency_contracts:
    - state-and-fingerprint-semantics
    - recovery-classification-and-machine-readable-errors
    - batch-execution-and-gating-review
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/implementation-provenance-and-attribution.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs/service.mjs
    - tools/specs.mjs
  optional:
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
  - tools/specs.mjs
  - tools/tests/provenance.test.mjs
  - .claude/skills/nevo-ai-spec-workflow/references/context-policy.md
  - docs/decisions/ADR-0006-process-continuity-and-hardening.md
consequential_paths:
  - docs/index.generated.md
  - docs/index.generated.json
  - specs/active.generated.md
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - specs/archive/**
  - AGENTS.md
  - CLAUDE.md
  - .claude/commands/**
---

# Task: Deterministic implementation provenance per task

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Closes the scope D33 explicitly deferred: "a narrower, correct revision-based check …
> as a genuinely new predicate … not built now … explicitly named as future work for the
> planned deterministic implementation-provenance task." Does not reopen D33's own
> decision (`self_check.revision` still never compared against global `HEAD`).

## Goal

Closes D34 property 8 (reliable task attribution when many tasks share one branch and
modify shared files) and property 7 (deterministic evidence and lifecycle writes). Persist
a reliable, per-task implementation boundary — `implementation.baseline_revision`/
`review_revision`/`changed_paths`/`worktree_patch_fingerprint` — exactly as specified in
`areas/implementation-provenance-and-attribution.md`, so task ownership is a stored fact,
never re-inferred from ambient `git diff`, commit messages, or `allowed_paths` alone.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — the fingerprint-tier functions this
task's new schema must stay excluded from, and the `change.yaml` structural-update
helpers the schema is written through.

`recovery-classification-and-machine-readable-errors` (task 02) — `handleStart`'s
postcondition/suspension contract, the gating point for recording `baseline_revision`
only on a genuinely first successful `start`; `classifyDirtyWorktree`, reused for
attributing task-related uncommitted changes.

`batch-execution-and-gating-review` (task 08) — `attributeTouchedPaths` and the
`self_check` evidence model this task's provenance record complements, and the existing
`describeSelfCheck`/`staleEvidenceTasks` D33 precedent this task's own freshness logic
must not reproduce the rejected over-invalidation of.

## Implementation constraints

- Add the `implementation` schema block (area requirement 1) to the task-entry shape
  `tools/specs/lifecycle.mjs`/`tools/specs/service.mjs` already validate/parse for
  `execution.suspension`/`self_check`/`semantic_references` — same optional,
  absent-by-default convention.
- Wire `baseline_revision` recording into `handleStart`'s postcondition-inspection path
  (task 02) so it is written exactly once, on the first `completed`/newly-successful
  `start`, and never rewritten by a `safe_to_retry`/idempotent re-run (area requirement
  3).
- Add a `computeChangedPaths(task, { baseline, worktree })`-shaped function combining
  `git diff <baseline>..HEAD --name-only` with `classifyDirtyWorktree`'s task-related
  uncommitted files (area requirement 4) — never unrelated dirty files.
- Wire `computeImplementationFingerprint` (`tools/specs/service.mjs`, already defined
  but never populated with real data) to actually consume
  `implementation.baseline_revision`/`changed_paths` as its `revision`/`evidence`
  inputs (area requirement 5) — do not change the function's existing signature/
  contract, only its call sites and the data it now actually receives.
- Confirm (and add a regression test proving) `computeChangeFingerprint`/
  `computeTaskFingerprint` output is unaffected by any `implementation` field (area
  requirement 5's exclusion half).
- Add a read-only `tools/specs.mjs` subcommand that inspects git history for a named
  task without a persisted `implementation` block and proposes a
  `baseline_revision`/`changed_paths` reconstruction (commit-message matching,
  `allowed_paths` overlap) — never writes anything until a separate, explicit
  confirmation step is invoked (area requirement 8). This flow is available on request;
  do not run it against tasks 01-13 as part of this task's own shipping.
- Do not compare any provenance field against global `HEAD` equality anywhere in this
  task's own new code (area requirement 9, D33) — reuse the existing fingerprint-based
  staleness comparison pattern D28/D33 already established.
- Do not modify `describeSelfCheck`/`staleEvidenceTasks`'s own D33-settled behavior.

## Acceptance criteria

1. `start`'s first successful run records `implementation.baseline_revision`; a
   subsequent `safe_to_retry`/already-`completed` `start` on the same task never
   overwrites it (`automated: node --test tools/tests/provenance.test.mjs`).
2. Two sequential tasks modifying the same file each retain independent, correct
   `implementation.changed_paths` attribution — task A's entry is unchanged after task
   B's later edit to the same file (automated, the required two-sequential-tasks
   regression scenario).
3. `implementation.changed_paths` includes at least one task-related uncommitted file
   (via `classifyDirtyWorktree`) alongside committed changes since `baseline_revision`
   (automated).
4. `computeChangeFingerprint`/`computeTaskFingerprint` output is unchanged by any edit
   to a task's `implementation` block, tested for each of the four fields independently
   (automated).
5. `computeImplementationFingerprint` consumes real `implementation.baseline_revision`/
   `changed_paths` data from a task's persisted state rather than requiring an
   external caller to supply it (automated).
6. Scope-check evidence (task 16's structured per-task data, and any `task-review`
   scope check for a task with a persisted `implementation` block) reads
   `implementation.changed_paths`, not a fresh `attributeTouchedPaths` pattern match,
   once the block exists (automated + inspection).
7. A later task's review/self-check inspects current repository state for a regression
   against an earlier task's already-attributed evidence when both touch the same file
   (automated, extends AC2's fixture).
8. The migration-flow subcommand only ever writes an `implementation` block after an
   explicit confirmation fixture — never unattended — and its git-history
   reconstruction is presented as a labeled suggestion, never as an already-applied
   fact (automated + inspection).
9. No freshness computation added by this task compares any `implementation` field
   against global `HEAD` equality; a regression test mirrors the one already covering
   `describeSelfCheck`/`staleEvidenceTasks` (D33) for the new provenance fields
   (automated).
10. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
    report clean after this task's schema/doc changes (automated).
11. `node --test tools/tests/*.test.mjs` (full suite, including the new
    `provenance.test.mjs`) passes (automated).

## Verification

```
node --test tools/tests/provenance.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection covering
why implementation provenance is a separate, persisted mechanism from `self_check`'s
D33-settled freshness model; "Context" paragraph names task 15 alongside tasks 01-14),
`.claude/skills/nevo-ai-spec-workflow/references/context-policy.md` (note that a task's
`implementation` block, once present, is the authoritative attribution source over
pattern-matched `allowed_paths`).

## Out of scope

- Reopening or reversing D33 — `self_check.revision`/`staleEvidenceTasks` are unchanged.
- Parallel or concurrent task implementation (C5, unchanged).
- Unattended, automatic backfill of `implementation` blocks for tasks 01-13 — the
  migration flow is owner-confirmed, per task, on request only, and is not run as part
  of this task's own shipping.
- Replacing `allowed_paths`/`consequential_paths`/`forbidden_paths` as the declared
  scope contract — `implementation.changed_paths` is a complement, not a replacement.
- Any change to `task-review.md`/`implementation-review.md`'s own report shape or
  command flow — reading the new provenance data into those flows is task 16's scope.
