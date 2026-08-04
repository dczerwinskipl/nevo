# Area: Finalization and migration

> Refined 2026-08-04 — see `owner-decisions.md` D9. Post-merge verification now happens
> before branch deletion, not after a would-be follow-up write into an archived change.
> The former single wrap-up task is split into `workflow-e2e-tests` (task 10) and
> `workflow-docs-and-adr-migration` (task 11), per the refinement's finding that
> concentrating E2E tests, docs, ADR work, and index regeneration in one task creates a
> late integration sink.

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
   output, and the exact recovery command — and stop there. Do **not** write a follow-up
   entry into `follow-ups.md` for the now-merged/archived change (that would mutate an
   already-finalized artifact with no commit path — exactly the contradiction D9 exists
   to avoid) and do **not** delete the branch. The branch is the recovery anchor:
   whoever investigates the failure still has the full change's branch to work from.
3. A successful post-merge check proceeds to branch deletion and reports success exactly
   as `finalize` does today.

### Migration (task 09)

4. No `change.yaml` structural migration is required for the fingerprint tiers (D7) —
   computational, not schema, with two small additive fields (`execution.suspension`,
   `context_exceptions`).
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
    post-merge sequencing, derived batch state) alongside the original D1-D3 decisions.
13. Regenerate `docs/index.generated.*`/`specs/*.generated.*`/`docs/routing.generated.json`
    (task 05's artifact) as a direct consequence of this task's own doc edits.

## Constraints

- The post-merge check must stay cheap — no duplicate `dotnet build`/`dotnet test`.
- Branch deletion must never happen before the post-merge check's result is known (D9's
  core invariant — a test enforces this ordering directly, not just documents it).
- Task 11's documentation must not describe a mechanism that isn't actually implemented
  and tested by task 10 — task 10 exists specifically to prove the mechanisms work before
  task 11 describes them.

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

## Dependencies

`batch-execution-and-gating-review` (task 08) and `mechanical-task-type` (task 07) for
task 09; task 09 for task 10; task 10 for task 11.

## Out of scope

- Any new runtime mechanism beyond the reordered post-merge sequence.
- Writing the ADR's exact number (assigned at write time).
