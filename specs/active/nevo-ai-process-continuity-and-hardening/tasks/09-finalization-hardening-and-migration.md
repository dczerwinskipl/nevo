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

## Goal

Reorder `finalize`'s merge sequence to verify before destructive cleanup (D9); add the
cheap post-merge check; document the fingerprint-tier migration for existing active
changes (using `nevo-documentation-architecture`'s `reviews/spec.md` as the concrete case
study); document rollout order and the per-task fallback guarantee.

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
  and the exact recovery command. Do **not** delete the branch. Do **not** write a
  follow-up entry into `follow-ups.md` for the now-merged/archived change — the branch
  itself is the recovery anchor.
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
   check/recovery command, and writes no entry into `follow-ups.md` (automated, same
   suite).
3. A successful post-merge check proceeds to delete the branch and reports success
   exactly as `finalize` does today (automated, same suite).
4. Migration notes correctly identify that no `change.yaml` schema change is needed and
   that exactly one re-review per stale fingerprint tier is the expected one-time cost
   (inspection, cross-checked against `nevo-documentation-architecture/reviews/spec.md`).

## Verification

```
node --test tools/tests/finalize.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`spec-finalize.md` — reordered merge sequence and post-merge check section. Migration
notes recorded in this task file's own body plus `overview.md` § "Compatibility and
migration" (already present, no edit needed here).

## Out of scope

- Any modification to `specs/active/nevo-documentation-architecture/**` beyond reading
  its `reviews/spec.md` as evidence.
- Writing the ADR or updating the shared vendor-neutral workflow doc broadly (task 11) —
  this task's documentation scope is `spec-finalize.md` only.
- Cross-mechanism end-to-end tests (task 10).
