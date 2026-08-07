# Area: Implementation provenance and attribution

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35 —
> closes the scope D33 explicitly deferred ("a narrower, correct revision-based check
> … as a genuinely new predicate … not built now … explicitly named as future work for
> the planned deterministic implementation-provenance task, not silently dropped").
> This area does not reopen D33's own decision (`self_check.revision` still never
> compared against global `HEAD` for evidence staleness) — it builds the separate,
> narrower mechanism D33 named: a persisted, per-task record of *which revision and
> which changed paths this task's own implementation actually is*, independent of
> whatever `HEAD` is at review time.

## Responsibility

Own a deterministic, persisted implementation-provenance record per task —
`implementation.baseline_revision`/`review_revision`/`changed_paths`/
`worktree_patch_fingerprint` — so that task ownership of a change is a stored fact, not
something re-inferred from `git diff`, commit messages, or `allowed_paths` matching every
time it's needed. Also owns the one owner-confirmed migration flow that backfills this
record for a task that reached a terminal status before this area existed.

## Current state

No task in `change.yaml` persists which revision its own implementation started from or
which paths it actually touched. `computeImplementationFingerprint(change, taskId, {
revision, evidence })` is already defined (`tools/specs/service.mjs`) but its own doc
comment states plainly that populating real revision/evidence data is "later tasks' job"
— it is exercised only by a unit test, never called from `tools/specs.mjs`,
`tools/specs/lifecycle.mjs`, `task-review.md`, or `implementation-review.md`. Task
ownership of a changed file is determined today only by `attributeTouchedPaths`
(`tools/specs/lifecycle.mjs`, task 08/12) matching a changed path against a task's
declared `allowed_paths`/`consequential_paths` patterns — a *pattern* match, not a
record of which task's own work actually produced that change. When two sequential
tasks in the same batch/branch both touch the same file (a real, common case this
change's own history hit — e.g. `follow-ups.yaml` was edited by both task 06 and later
reconciliation work), nothing distinguishes "task A's own committed work" from "task B's
later edit to the same file" beyond re-reading commit messages by hand. D33 confirmed
`self_check.revision` is written but never read back for staleness, and explicitly
deferred building "a narrower, correct revision-based check … as a genuinely new
predicate" to this area.

## Requirements

1. **Persisted per-task provenance schema**, optional, present once a task has started:

   ```yaml
   # inside a task's entry in change.yaml
   implementation:
     baseline_revision: <git SHA the task's implementation started from>
     review_revision: <git SHA/working-tree marker at the most recent task-review or self-check>
     changed_paths:
       - <path actually attributed to this task's own committed and task-related uncommitted work>
     worktree_patch_fingerprint: <hash of the task's own uncommitted diff, or null if none>
   ```

   A task with no `implementation` block has simply not started yet, or started before
   this area shipped (requirement 8's migration flow) — the same absence-is-valid
   convention `execution.suspension`/`self_check`/`semantic_references` already use.
2. **The model must not infer task ownership from ambient `git diff`, commit messages,
   or `allowed_paths` alone.** `allowed_paths`/`consequential_paths` remain the
   *declared, allowed* scope (unchanged, task 01/13); `implementation.changed_paths` is
   the *actual, attributed* scope for this specific task's own work, computed once and
   persisted, not re-derived by pattern-matching every time a reviewer or later task
   needs to know what task X actually touched. Commit-message matching may *suggest* a
   boundary during the migration flow (requirement 8) but is never treated as
   authoritative for a task that already has a persisted `implementation` block.
3. **`baseline_revision` is recorded on the task's first successful `start`, never
   overwritten by an idempotent retry.** `handleStart`'s postcondition model (task 02)
   already distinguishes `completed`/`safe_to_retry` from a fresh attempt; writing
   `baseline_revision` is one more effect gated the same way `status: in-implementation`
   already is — a `safe_to_retry`/already-`completed` re-run of `start` must not
   re-stamp a new baseline over an existing one.
4. **`changed_paths` captures both committed and task-related uncommitted changes** —
   not only `git diff <baseline>..HEAD --name-only`, but also the task's own dirty
   working-tree files at the moment of a self-check/task-review, using the same
   dirty-worktree classification (`classifyDirtyWorktree`, task 02) already used to
   distinguish task-related from unrelated dirty files.
5. **Provenance is included in the implementation fingerprint, excluded from every
   semantic tier.** `computeImplementationFingerprint` (already defined, `service.mjs`)
   is wired to actually consume `implementation.baseline_revision`/`changed_paths` as
   its `revision`/`evidence` inputs — closing the gap its own doc comment names.
   `computeChangeFingerprint`/`computeTaskFingerprint` (D7/D18) never read the
   `implementation` block, exactly like `status`/`execution.suspension`/`self_check` —
   it is operational evidence, not semantic task content.
6. **Scope checking (`task-review`, the gating batch review, `implementation-review`)
   checks only attributable task evidence** — a finding about "files this task touched"
   is computed from `implementation.changed_paths` once it exists for that task, not
   from a fresh `attributeTouchedPaths` pattern-match that would incorrectly credit a
   later task's edit to an earlier task just because the same file matches both tasks'
   declared patterns.
7. **Attribution survives a later task changing the same file.** When task B (later in
   `depends_on` order, or later in a batch) edits a file task A already attributed to
   itself, task A's own `implementation.changed_paths`/`worktree_patch_fingerprint`
   entry for that file is unchanged — it still reflects task A's own contribution as of
   task A's own `review_revision`. Task B's review/self-check inspects *current* repo
   state (not solely its own diff) to detect whether task B's edit introduced a
   regression against task A's already-reviewed evidence — this is a real inspection
   step, not assumed away by attribution alone.
8. **Owner-confirmed migration flow for existing tasks without provenance.** Tasks
   01-13 (all `verified` before this area exists) have no `implementation` block. A new,
   explicit, read-only-until-confirmed flow inspects git history (commit messages,
   branch history, `allowed_paths` overlap) to *suggest* a `baseline_revision`/
   `changed_paths` reconstruction for a named task, presents it to the owner as a
   proposal (never silently applied), and only writes the `implementation` block after
   an explicit owner confirmation — mirroring D32's precedent that a new completeness
   mechanism is not silently enforced backward against already-terminal work. This flow
   is available on request; task 15 does not run it unattended against tasks 01-13 as
   part of shipping.
9. **Never compares evidence freshness by global `HEAD` equality** — same rule D33
   already established for `self_check.revision`/`staleEvidenceTasks`, restated here so
   this area's own new mechanism does not reproduce the exact over-invalidation D33
   rejected. `review_revision`/`changed_paths` are compared against what actually
   changed (attributed touched files, semantic fingerprint), never against "does
   `HEAD` still equal the revision recorded at review time" — `HEAD` legitimately
   advances after every task in a sequential batch (D20/D24) without invalidating an
   earlier task's own evidence.

## Constraints

- Never treat commit-message matching as authoritative once a persisted
  `implementation` block exists for a task — it is a migration-flow *suggestion*
  mechanism only (requirement 8), never a runtime substitute for the persisted record.
- Never overwrite `baseline_revision` on an idempotent `start` retry (requirement 3).
- Never let `implementation` block contents affect `computeChangeFingerprint`/
  `computeTaskFingerprint` (requirement 5) — operational, not semantic.
- Never compare `review_revision`/any provenance field against global `HEAD` equality
  for staleness (requirement 9, D33).
- Never silently backfill `implementation` blocks for tasks 01-13 without an explicit
  owner confirmation per task (requirement 8).

## Interfaces and boundaries

Exposes: the `implementation` schema (requirement 1), the baseline-recording hook into
`start`'s postcondition model (requirement 3, consumed by task 02/03's controller), the
wired `computeImplementationFingerprint` (requirement 5, consumed by task 16's per-task
structured data and any future review artifact that records an implementation
fingerprint), and the owner-confirmed migration flow (requirement 8, a new read-only
`tools/specs.mjs` inspection subcommand plus a confirm-then-write step).

Consumes: `handleStart`'s postcondition/suspension model (task 02) for
requirement 3's gating; `classifyDirtyWorktree` (task 02) for requirement 4's
committed-vs-uncommitted attribution; `attributeTouchedPaths`
(`batch-execution-and-gating-review`, task 08) as the *pattern-based* fallback this area
supersedes with attributed, persisted evidence once a task has a real
`implementation` block; `computeChangeFingerprint`/`computeTaskFingerprint` (task 01,
D7/D18) as the tiers this area's schema is explicitly excluded from.

## Area-specific acceptance criteria

- A test proves `start`'s first successful run records `baseline_revision`, and a
  subsequent `safe_to_retry`/already-`completed` `start` never overwrites it.
- A test proves two sequential tasks modifying the same file each retain independent,
  correct `implementation.changed_paths` attribution — task A's entry is unchanged by
  task B's later edit to the same file.
- A test proves `implementation.changed_paths` includes a task-related uncommitted file
  (via `classifyDirtyWorktree`) in addition to committed changes since
  `baseline_revision`.
- A test proves `computeChangeFingerprint`/`computeTaskFingerprint` output is unchanged
  by any edit to a task's `implementation` block (mirrors the existing `self_check`
  exclusion test pattern).
- A test proves `computeImplementationFingerprint` now actually consumes
  `implementation.baseline_revision`/`changed_paths` rather than requiring them to be
  passed in from an untested call site.
- A test proves the migration flow only ever writes an `implementation` block after an
  explicit confirmation fixture, never unattended, and that its git-history suggestion
  is clearly marked as a suggestion, not an already-applied fact.
- A test proves no freshness computation in this area compares any provenance field
  against global `HEAD` equality (inspection + a regression test mirroring the one
  already added for `describeSelfCheck`/`staleEvidenceTasks`, D33).

## Dependencies

`state-and-fingerprint-semantics` (task 01) — the fingerprint-tier functions
(`computeChangeFingerprint`/`computeTaskFingerprint`) this area's schema must stay
excluded from, and the `change.yaml` structural-update helpers the new `implementation`
block is written through. `recovery-classification-and-machine-readable-errors` (task
02) — `handleStart`'s postcondition/suspension contract (requirement 3's gating point)
and `classifyDirtyWorktree` (requirement 4). `batch-execution-and-gating-review` (task
08) — `attributeTouchedPaths` and the `self_check` evidence model this area's
provenance record complements without duplicating.

## Out of scope

- Reopening D33's own decision — `self_check.revision`/`staleEvidenceTasks` still never
  compares against global `HEAD` equality; this area adds a separate, narrower
  mechanism, not a reversal.
- Parallel or concurrent task implementation — provenance is recorded per task
  sequentially, same single-active-task constraint (C5) as everywhere else in this
  change.
- Unattended, automatic backfill of `implementation` blocks for tasks 01-13 (requirement
  8) — owner-confirmed, per task, on request only.
- Replacing `allowed_paths`/`consequential_paths`/`forbidden_paths` as the *declared*
  scope contract — `implementation.changed_paths` is the *actual, attributed* record,
  a complement, not a replacement.
