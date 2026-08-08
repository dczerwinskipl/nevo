# Area: Finalization and migration

> Refined 2026-08-04 — see `owner-decisions.md` D9. Post-merge verification now happens
> before branch deletion, not after a would-be follow-up write into an archived change.
> The former single wrap-up task is split into `workflow-e2e-tests` (task 10) and
> `workflow-docs-and-adr-migration` (task 11), per the refinement's finding that
> concentrating E2E tests, docs, ADR work, and index regeneration in one task creates a
> late integration sink.
>
> Refined again 2026-08-04 (second pass) — see D23. The preserved merged branch is
> renamed **diagnostic anchor** (it doesn't itself repair `main`, unlike what "recovery
> anchor" implied). On post-merge verification failure, the tool now auto-creates the
> repair branch after one explicit owner confirmation, gated on four preconditions
> (clean worktree, `main` fast-forwarded, failing SHA re-confirmed, target branch name
> free both locally and on `origin`) — the repair itself (editing files, running checks,
> opening the PR) remains manual beyond that point.
>
> Refined a third time 2026-08-04 — see D25. The four preconditions are unchanged in
> substance but reordered into a nine-step sequence that checks every read-only/remote
> fact before switching or fast-forwarding local `main`, and the failure wording no
> longer claims "stops without modifying anything" — it reports any read-only fetch or
> authorized branch switch/fast-forward that already occurred before a later guard
> failed, since Git provides no atomic rollback across those steps.

## Responsibility

Own the verify-before-destructive-cleanup post-merge sequence for `spec-finalize`, the
migration path from the old whole-file fingerprint scheme to the tiered one, the
classification-rule doc-contradiction fix, integrated cross-mechanism E2E tests, and
rolling every other area's changes into the docs/commands that describe the workflow.

## Current state

`validateFinalize`'s gate (`lifecycle.mjs:131-191`) is entirely pre-merge; nothing
re-checks `main`'s state after the squash-merge, and the squash-merge itself already
deletes the branch in the same call (`gh pr merge --squash --delete-branch`,
`tools/lib/github.mjs`), so there is currently no point at which a post-merge failure
could even be caught before the recovery anchor (the branch) is gone.
`docs/ai/specification-workflow.md:61` ("prefer the smaller class when uncertain")
contradicts the signal-based classification table beneath it. The in-flight
`nevo-documentation-architecture` change's `reviews/spec.md` carries a `spec_fingerprint`
computed under the current whole-file scheme.

## Requirements

### Post-merge check with verify-before-destructive-cleanup (task 09, D9)

1. Split `finalize`'s merge step: `gh pr merge --squash` **without** `--delete-branch`,
   then update local `main`, then run the post-merge check (`node tools/specs.mjs check`
   and `node tools/docs.mjs check` against the post-merge tree — no duplicate `dotnet
   build`/`dotnet test`, matching the token-efficiency constraint), then — **only if that
   check passes** — delete the branch and finish cleanup (archive commit already pushed
   earlier in the existing flow, per `docs/development/git-workflow.md`).
2. On post-merge check failure: report the merged PR's SHA, the failed check and its
   output, and the **diagnostic branch** name (D23, second refinement pass — renamed
   from "recovery anchor," since preserving the branch is diagnostically useful but does
   not itself repair `main`). Do **not** write a follow-up entry into `follow-ups.yaml`
   for the now-merged/archived change (that would mutate an already-finalized artifact
   with no commit path — exactly the contradiction D9 exists to avoid) and do **not**
   delete the branch or perform any other cleanup before the failure report above is
   complete.
2a. **Guarded, confirm-then-create repair branch, ordered to minimize state mutation
   before remote-state guards pass (D23, corrected by D25 in the third refinement
   pass).** After the failure report (requirement 2), present one explicit confirmation
   to create the repair branch. On confirmation, execute this nine-step sequence in
   order:

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

   **Failure semantics are precise, not blanket:** a guard failing at step 1, 2, 4, or 5
   (before the `main` switch at step 6) means no repair branch is created, no local
   branch is switched, no destructive operation occurs — a read-only `fetch` (step 3) may
   already have happened and is reported as such. A guard failing at step 8 (after the
   switch/fast-forward at steps 6-7) means no repair branch is created and no destructive
   operation occurs, but the report explicitly states that the local branch was switched
   to `main` and/or fast-forwarded — never claim the repository is unchanged when it
   isn't. Never use `reset`, `clean`, force-checkout, or automatic stash at any step;
   never overwrite an existing local or remote repair branch; the fast-forward is always
   `git pull --ff-only`, never a merge or rebase. The repair itself (editing files,
   running the targeted checks, opening the repair PR) remains a manual, owner-driven
   step beyond branch creation — this requirement does not extend automation past
   creating the starting point for that work.
3. A successful post-merge check proceeds to branch deletion and reports success exactly
   as `finalize` does today.

### Migration (task 09)

4. No `change.yaml` structural migration is required for the fingerprint tiers (D7) —
   computational, not schema, with three small additive, optional fields
   (`execution.suspension`, `context_exceptions`, and — D18, second refinement pass —
   `semantic_references`). An existing task file with no `semantic_references` block is
   fully valid; it simply doesn't benefit from `semantic_references`' granular
   invalidation until reviewed and annotated — recommend, not require, that follow-up
   review pass for other active changes once this change ships.
5. Every existing `reviews/*.md` with the old single `spec_fingerprint` becomes stale the
   first time this change ships. Confirm `validateApproval`'s existing "stale
   fingerprint, re-run the review" error message already surfaces this correctly once
   updated to compare against the correct tier (change-level for a spec review,
   task-level for a task review) — a small code change, not a new mechanism — and
   document it as a one-time, expected re-review requirement using
   `nevo-documentation-architecture`'s `reviews/spec.md` as the concrete example.
6. Rollout order: `state-and-fingerprint-semantics` (01) → `recovery-and-resume`/
   `resume-and-continue-controller` (02-03) → `conversational-approval-ergonomics` (04)
   → `context-and-validation-hardening` (05-07) → `batch-execution-and-gating-review`
   (08) → this area's own tasks (09, 10, 11) — unchanged in shape from the original
   draft, only the final step now spans three tasks instead of one.
7. Fallback behavior: unchanged — every earlier-landed task leaves the workflow fully
   working on its own; no task depends on a later task's code.

### Integrated E2E tests before documentation (task 10, new — split from the original
single wrap-up task per finding 12)

8. Implement cross-mechanism end-to-end tests covering the "Required regression
   scenarios" enumerated in the refinement request (fingerprints, recovery, batch,
   context/follow-ups, finalization) — see task 10 for the exact list.
9. Make every scenario pass against the actual implementation from tasks 01-09 before
   any documentation work in task 11 begins — the ordering itself is the fix for finding
   12 (a late integration sink where inconsistencies surface only after all
   implementation, including docs, is done).

### Documentation, ADR, and consistency sweep (task 11, new — split from the original
single wrap-up task)

10. Fix `docs/ai/specification-workflow.md:61`'s contradiction with the signal table.
11. Update `docs/ai/specification-workflow.md`, `AGENTS.md`, `CLAUDE.md` (pointer only),
    `.claude/commands/nevo-ai/*.md`, and `.claude/skills/nevo-ai-spec-workflow/**` to
    describe every mechanism this change adds, using the terminology table from
    `overview.md`'s refinement (lifecycle status vs. execution suspension vs. owner
    decision vs. review status vs. batch state — one term per concept, never two).
12. Write the recommended ADR capturing D7-D10 (fingerprint tiers, execution suspension,
    post-merge sequencing, derived batch state), D16-D23 (second refinement pass:
    status vocabulary removal, repair-and-retry semantics, deterministic
    `semantic_references`, evidence freshness, batch selection modes, the task-06
    dependency, structured `follow-ups.yaml`, the diagnostic-anchor repair model), and
    D24-D26 (third refinement pass: hard-stop/risk-signal split for batch self-check,
    ordered/truthful repair-branch guards, semantic-reference completeness review)
    alongside the original D1-D3 decisions.
13. Regenerate `docs/index.generated.*`/`specs/*.generated.*`/`docs/routing.generated.json`
    (task 05's artifact) as a direct consequence of this task's own doc edits.

## Constraints

- The post-merge check must stay cheap — no duplicate `dotnet build`/`dotnet test`.
- Branch deletion must never happen before the post-merge check's result is known (D9's
  core invariant — a test enforces this ordering directly, not just documents it).
- Task 11's documentation must not describe a mechanism that isn't actually implemented
  and tested by task 10 — task 10 exists specifically to prove the mechanisms work before
  task 11 describes them.
- The repair-branch creation (requirement 2a, D25) must run the nine-step guard sequence
  immediately before creating the branch, not at report time — state can change in the
  gap between the failure report and the owner's confirmation.
- Repair-branch creation stops on the first failing guard — it never proceeds partially
  or attempts a different branch name/location on its own initiative.
- The specification must never claim an operation "stops without modifying anything"
  when a preceding step in the same sequence already performed a read-only fetch or an
  authorized local mutation (D25) — the failure report always states precisely what, if
  anything, already happened.

## Interfaces and boundaries

Exposes: the reordered `finalize` sequence, the migration notes, the corrected
classification-rule text, the E2E test suite, the updated docs/commands/skill files, the
new ADR.

Consumes: the finished, tested behavior of every other area.

## Area-specific acceptance criteria

- A test proves `finalize` does not delete the branch until the post-merge check has run
  and passed.
- A test proves a failed post-merge check leaves the branch intact and writes no
  follow-up entry into the archived change.
- `docs/ai/specification-workflow.md` no longer contains the line-61/signal-table
  contradiction.
- Every `.claude/commands/nevo-ai/*.md` file touched by an earlier task has its behavior
  description updated to match, using one consistent term per concept.
- A test proves the repair branch is created only after confirmation and only when the
  full nine-step guard sequence passes (D23, D25).
- A test proves each guard failure mode (local repair branch exists, remote repair
  branch exists, `origin/main` moved beyond the failing SHA, local `main` cannot
  fast-forward) stops without creating the branch, and names which guard failed (D25).
- A test proves branch creation succeeds only after all guards pass, in the documented
  order (D25).
- A test proves a guard failure's report correctly identifies any local state change
  that already occurred (e.g. a completed `fetch`, or a completed switch/fast-forward to
  `main`) rather than claiming nothing was modified (D25).
- A test proves no `reset`, `clean`, force-checkout, or automatic stash is ever executed
  by the repair-branch flow (D25).

## Dependencies

`batch-execution-and-gating-review` (task 08) and `mechanical-task-type` (task 07) for
task 09; task 09 for task 10; task 10 for task 11.

## Out of scope

- Any new runtime mechanism beyond the reordered post-merge sequence.
- Writing the ADR's exact number (assigned at write time).
