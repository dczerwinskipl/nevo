---
id: nevo-ai-process-continuity-and-hardening.finalization-hardening-and-migration
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/finalization-and-migration.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
    - tools/lib/github.mjs
    - .claude/commands/nevo-ai/spec-finalize.md
    - specs/active/nevo-documentation-architecture/reviews/spec.md
  optional:
    - docs/development/git-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs.mjs
  - tools/lib/github.mjs
  - tools/tests/finalize.test.mjs
  - .claude/commands/nevo-ai/spec-finalize.md
  - specs/active/nevo-ai-process-continuity-and-hardening/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - specs/active/nevo-documentation-architecture/tasks/**
  - specs/active/nevo-documentation-architecture/change.yaml
---

# Task: Finalization hardening and migration

> Refined 2026-08-04 (see `owner-decisions.md` D9) — the merge and branch-deletion steps
> are now split: `finalize` no longer deletes the branch in the same call as the
> squash-merge. It merges, updates local `main`, runs the post-merge check, and only then
> deletes the branch. A failed check preserves the branch as the recovery anchor and
> writes nothing into the archived change.
>
> Refined again 2026-08-04 (second pass, see D23) — the preserved branch is renamed
> **diagnostic anchor** (it doesn't itself repair `main`). On post-merge check failure,
> after the failure report, the tool now offers to auto-create the repair branch — one
> explicit owner confirmation, then four guards checked immediately before creation
> (clean worktree, `main` fast-forwarded, failing SHA re-confirmed, target branch name
> free both locally and on `origin`); a failed guard stops without modifying anything.
> The repair itself (editing files, running checks, opening the PR) stays manual beyond
> branch creation.

## Goal

Reorder `finalize`'s merge sequence to verify before destructive cleanup (D9); add the
cheap post-merge check; implement the guarded, confirm-then-create repair-branch step
(D23); document the fingerprint-tier migration for existing active changes (using
`nevo-documentation-architecture`'s `reviews/spec.md` as the concrete case study);
document rollout order and the per-task fallback guarantee.

## Dependencies

`batch-execution-and-gating-review`, `mechanical-task-type` — this task finalizes
behavior that must already exist.

## Implementation constraints

- Change the merge call from `gh pr merge --squash --delete-branch` to `gh pr merge
  --squash` (no `--delete-branch`) — see `tools/lib/github.mjs`. After the merge
  succeeds: update local `main` (fetch + fast-forward), run `node tools/specs.mjs check`
  and `node tools/docs.mjs check` against the post-merge tree, and only if both pass,
  delete the remote and local branch as a separate, explicit step.
- On a post-merge check failure: report the merged PR's SHA, the failed check's output,
  and the **diagnostic branch** name (D23, second refinement pass — renamed from
  "recovery anchor," since preserving the branch is diagnostically useful but does not
  itself repair `main`). Do **not** delete the branch. Do **not** write a follow-up
  entry into `follow-ups.yaml` for the now-merged/archived change.
- **Guarded, confirm-then-create repair branch (D23, second refinement pass).** After the
  failure report, present one explicit confirmation to create the repair branch. On
  confirmation, check these four preconditions, in order, immediately before creating the
  branch: (1) the working tree is clean; (2) `main` is checked out and fast-forwarded
  (`git switch main && git pull --ff-only`); (3) the post-merge-verified failing SHA is
  re-confirmed as `main`'s current SHA; (4) the target branch name
  (`fix/<change>-post-merge`) does not already exist locally or on `origin`. If every
  precondition holds, create the branch and report it created. If any precondition fails,
  stop without creating the branch or modifying anything else, and report which
  precondition failed and why — never fall back to a different name and never force past
  the conflict. The repair itself (editing files, running the targeted checks, opening
  the repair PR) remains manual beyond branch creation.
- No duplicate `dotnet build`/`dotnet test` in the post-merge check — only
  `specs.mjs check`/`docs.mjs check`.
- Do not modify `specs/active/nevo-documentation-architecture/tasks/**` or its
  `change.yaml` — read-only case-study evidence; only its `reviews/spec.md` is relevant,
  and only as something this task's migration notes point to.
- Migration notes state explicitly: no `change.yaml` structural migration is needed for
  the fingerprint tiers (D7) — update `validateApproval`'s stale-fingerprint comparison
  to use the correct tier (`change_fingerprint` for a spec review, `task_fingerprint` for
  a task review) instead of the old single `spec_fingerprint`; any existing review's
  fingerprint becomes stale and needs exactly one re-review under the new tier.
- Document rollout order (01 → 02-04 → 05-07 → 08 → 09-10-11) and the per-task fallback
  guarantee, cross-checked against the actual `depends_on` graph in `change.yaml`.

## Acceptance criteria

1. `finalize` does not call branch deletion until after the post-merge check has run and
   passed (automated: `node --test tools/tests/finalize.test.mjs`).
2. A failed post-merge check leaves the branch intact, reports the merged SHA/failed
   check/diagnostic branch name, and writes no entry into `follow-ups.yaml` (automated,
   same suite).
3. A successful post-merge check proceeds to delete the branch and reports success
   exactly as `finalize` does today (automated, same suite).
4. Migration notes correctly identify that no `change.yaml` schema change is needed and
   that exactly one re-review per stale fingerprint tier is the expected one-time cost
   (inspection, cross-checked against `nevo-documentation-architecture/reviews/spec.md`).
5. The repair branch is created only after confirmation and only when all four
   preconditions hold (automated, same suite) (D23).
6. Each of the four precondition failures (dirty worktree, `main` not fast-forwardable,
   SHA mismatch, branch name collision) stops without creating the branch or modifying
   anything else, and names which precondition failed (automated, same suite) (D23).

## Verification

```
node --test tools/tests/finalize.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`spec-finalize.md` — reordered merge sequence, post-merge check section, and the
diagnostic-anchor/guarded-repair-branch flow (D23). Migration notes recorded in this
task file's own body plus `overview.md` § "Compatibility and migration" (already
present, no edit needed here).

## Out of scope

- Any modification to `specs/active/nevo-documentation-architecture/**` beyond reading
  its `reviews/spec.md` as evidence.
- Writing the ADR or updating the shared vendor-neutral workflow doc broadly (task 11) —
  this task's documentation scope is `spec-finalize.md` only.
- Cross-mechanism end-to-end tests (task 10).
- Automating any part of the repair beyond branch creation — editing files, running the
  targeted checks, and opening the repair PR remain manual, owner-driven steps (D23).
