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
    - specs/archive/nevo-documentation-architecture/reviews/spec.md
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
  - specs/archive/nevo-documentation-architecture/tasks/**
  - specs/archive/nevo-documentation-architecture/change.yaml
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
>
> Refined a third time 2026-08-04 (see D25) — the four preconditions are unchanged in
> substance but reordered into a nine-step sequence that front-loads every read-only/
> remote check before switching or fast-forwarding local `main`. "Stops without
> modifying anything" was inaccurate for a guard failing after the switch; the failure
> report now states precisely what, if anything, already happened.

## Goal

Reorder `finalize`'s merge sequence to verify before destructive cleanup (D9); add the
cheap post-merge check; implement the ordered, confirm-then-create repair-branch step
with truthful failure semantics (D23, corrected by D25); document the fingerprint-tier
migration for existing active changes (using `nevo-documentation-architecture`'s
`reviews/spec.md` as the concrete case study); document rollout order and the per-task
fallback guarantee.

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
- **Ordered, confirm-then-create repair branch with truthful failure semantics (D23,
  corrected by D25 in the third refinement pass).** After the failure report, present
  one explicit confirmation to create the repair branch. On confirmation, execute this
  nine-step sequence in order — every read-only/remote check runs before any local,
  state-changing operation:

  ```text
  1. verify the worktree is clean
  2. verify the repair branch does not exist locally
  3. git fetch origin
  4. verify the repair branch does not exist remotely
  5. verify origin/main still points to the recorded failing SHA
  6. switch to local main
  7. git pull --ff-only
  8. verify local main equals the recorded failing SHA
  9. create fix/<change>-post-merge
  ```

  A guard failing at step 1, 2, 4, or 5 (before the `main` switch at step 6): no repair
  branch is created, no local branch is switched, no destructive operation occurs — a
  read-only `fetch` (step 3) may already have run and is reported as having run. A guard
  failing at step 8 (after the switch/fast-forward at steps 6-7): no repair branch is
  created, no destructive operation occurs, but the report explicitly states that `main`
  was switched to and/or fast-forwarded — never report the repository as unchanged when
  it isn't. If every guard passes, create the branch and report it created. Never use
  `reset`, `clean`, force-checkout, or automatic stash at any step; never overwrite an
  existing local or remote repair branch; the fast-forward is always `git pull
  --ff-only`, never a merge or rebase; never fall back to a different branch name and
  never force past a conflict. The repair itself (editing files, running the targeted
  checks, opening the repair PR) remains manual beyond branch creation.
- No duplicate `dotnet build`/`dotnet test` in the post-merge check — only
  `specs.mjs check`/`docs.mjs check`.
- Do not modify `specs/archive/nevo-documentation-architecture/tasks/**` or its
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
5. The repair branch is created only after confirmation and only when the full
   nine-step guard sequence passes, in the documented order (automated, same suite)
   (D23, D25).
6. Each guard failure mode (local repair branch exists, remote repair branch exists,
   `origin/main` moved beyond the failing SHA, local `main` cannot fast-forward) stops
   without creating the branch, and names which guard failed (automated, same suite)
   (D25).
7. A guard failure occurring after the local `main` switch/fast-forward (step 8) reports
   that the switch/fast-forward already happened, rather than claiming the repository is
   unchanged; a guard failure before the switch (steps 1/2/4/5) reports at most a
   completed read-only `fetch` (automated, same suite) (D25).
8. No `reset`, `clean`, force-checkout, or automatic stash is ever executed by the
   repair-branch flow, under any guard-failure scenario (automated, same suite) (D25).

## Migration notes (D7/D9, AC4)

**No `change.yaml` structural migration is required.** The fingerprint-tier change (D7)
is computational, not schema — `change.yaml` gains no new required field for it (the
three small additive, optional fields task 01/06 already introduced —
`execution.suspension`, `context_exceptions`, `semantic_references` — are unrelated to
this migration and already backward-compatible on their own). An existing task file with
none of those blocks remains fully valid.

**What actually changed:** `node tools/specs.mjs fingerprint <change-id>` and
`handleApprove`'s staleness comparison now use `computeChangeFingerprint` (change scope:
`overview.md` + the task graph's shape) instead of the old `computeSpecFingerprint`
(a whole-file hash over `change.yaml`/`overview.md`/`owner-decisions.md`/every
`areas/*.md`/`tasks/*.md`). `computeSpecFingerprint` itself is untouched and still
exported (task 09's `allowed_paths` does not cover `tools/specs/service.mjs`, where it
lives) — simply no longer read by any command.

**One-time cost, concrete example:** every existing `reviews/spec.md` with the old
single `spec_fingerprint` becomes stale the moment this change ships, since it was
computed under the retired whole-file scheme. `specs/archive/nevo-documentation-architecture/reviews/spec.md`
is the concrete case study named in this task's context — its recorded
`spec_fingerprint: 3ab09624e4f09309c251bac9918ef4ab8492d70114e496997f777f562be43a87` was
computed via the old scheme; a fresh `node tools/specs.mjs fingerprint
nevo-documentation-architecture` after this change ships would print a different hash
under the new tier. That change is already archived (`verdict:
approved-for-implementation`, fully implemented), so this is moot for it in practice —
it illustrates the pattern, not a live blocker. For any *active* change with an existing
`reviews/spec.md` at the time this ships, the expected, one-time cost is exactly one
fresh `/nevo-ai:spec-review` pass before its next `/nevo-ai:spec-approve` — the same
"stale fingerprint, re-run the review" `REC-07` recovery path (area recovery-and-resume,
task 02) already surfaces this correctly once the comparison target changed; no new
recovery mechanism is needed.

## Rollout order and per-task fallback guarantee

Rollout order (unchanged in shape from the original draft — cross-checked against
`change.yaml`'s actual `depends_on` edges): `state-and-fingerprint-semantics` (01) →
`recovery-classification-and-machine-readable-errors` (02) →
`resume-and-continue-controller` (03) → `conversational-approval-ergonomics` (04) →
`context-completeness-and-routing-precedence` (05) → `scope-and-follow-up-mechanisms`
(06) → `mechanical-task-type` (07) → `batch-execution-and-gating-review` (08) → this
task (09) → `workflow-e2e-tests` (10) → `workflow-docs-and-adr-migration` (11).

Fallback guarantee (unchanged from the original draft): every earlier-landed task leaves
the workflow fully working on its own — `node tools/specs.mjs`/`tools/docs.mjs`'s
existing commands keep functioning after each task lands, independent of whether later
tasks in this rollout have shipped yet. No task in this list depends on a later task's
code to remain usable; each only adds to what already worked.

## Verification

```
node --test tools/tests/finalize.test.mjs
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Documentation impact

`spec-finalize.md` — reordered merge sequence, post-merge check section, and the
diagnostic-anchor/ordered-repair-branch-guard flow with its truthful failure semantics
(D23, D25). Migration notes recorded in this task file's own body plus `overview.md` §
"Compatibility and migration" (already present, no edit needed here).

## Out of scope

- Any modification to `specs/archive/nevo-documentation-architecture/**` beyond reading
  its `reviews/spec.md` as evidence.
- Writing the ADR or updating the shared vendor-neutral workflow doc broadly (task 11) —
  this task's documentation scope is `spec-finalize.md` only.
- Cross-mechanism end-to-end tests (task 10).
- Automating any part of the repair beyond branch creation — editing files, running the
  targeted checks, and opening the repair PR remain manual, owner-driven steps (D23).
