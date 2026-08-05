---
description: Review the current working tree against one approved NEvo task.
argument-hint: <change-id> <task-id>
disable-model-invocation: true
---

Read `references/review-policy.md` from the shared skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> <task-id>`.

## Flow

1. Run `node tools/specs.mjs context <change-id> <task-id>` to resolve the task's
   context, `allowed_paths`, and `forbidden_paths`.
2. Check whether `specs/active/<change-id>/reviews/<task-id>.md` already exists. If it
   does, **read its full current content now, before anything else touches it** — this
   is the baseline for this run, per `references/review-policy.md` § "Re-review:
   current file contents are the source of truth, not git status or memory." If it
   doesn't exist, there is no baseline; the final response must include, verbatim, "No
   reliable previous-file baseline is available. Performing a fresh review of the
   current task implementation." (Note: adapted for task scope — this command reviews
   an implementation diff, not a specification; do not say "specification" here.) The
   absence of this file, or a clean `git status` on it, is never itself evidence that a
   prior review's findings are still accurate.
3. Inspect `git diff` / `git status` for the code changes under review — this *is* the
   right tool for seeing what the implementation changed (unlike using git status as a
   proxy for whether the *review itself* is stale, which step 2 already covers
   separately).
4. Verify the diff stays within `allowed_paths` and does not touch `forbidden_paths` —
   a violation here is always a blocking finding, no exceptions.
5. Compare the implementation to: the task's acceptance criteria, its area's
   requirements (if any), change-wide constraints, applicable ADRs, and architecture
   documentation.
6. Check behavior, tests, documentation impact, breaking changes, unrelated edits,
   generated artifacts (`*.generated.*` should only change via `tools/docs.mjs
   generate` / `tools/specs.mjs generate`), and verification evidence (build/test
   output — ask for it if not shown, do not assume it passed).
7. Classify every current finding per `references/review-policy.md` § "Findings must be
   actor-classified". For a task review, `AUTO_FIX` means "the agent may make this code
   fix without further deliberation once told to proceed" — this command never applies
   code fixes itself; that always needs an explicit, separate go-ahead (see Rules). If
   step 2 found a baseline, verify each of its findings' **exact literal predicate**
   against the diff/code just inspected (not memory of what it probably still says),
   and assign a lifecycle status (`resolved` / `still-present` / `changed` /
   `cannot-verify`) per `references/review-policy.md` § "Findings have a lifecycle, on
   top of their actor category." Verdict is `pass` (no unresolved blocking findings,
   computed from this run only), `changes-required` (fixable findings exist), or
   `blocked` (something more fundamental — e.g. scope violation outside
   `allowed_paths`, or verification evidence can't be produced at all).
7a. **Record as follow-up (D15/D22, area context-and-validation-hardening, task 06).**
    For each `NON_BLOCKING` finding from step 7, ask (closed choice, one per finding or
    batched if several) whether to record it in `specs/active/<change-id>/follow-ups.yaml`
    instead of letting it live only in this run's report:
    ```
    1. Record as a follow-up (severity: <blocking|non-blocking> — your call, default
       non-blocking unless the finding itself says otherwise)
    2. Leave it in the report only
    ```
    On 1 → run `node tools/specs.mjs follow-up-add <change-id> <id> --source-task
    <task-id> --kind <short-kind> --severity <blocking|non-blocking> --reason
    <finding summary>`. This does not change how `AUTO_FIX`/`OWNER_DECISION`/
    `NEEDS_CLARIFICATION` findings are categorized or handled — this action exists only
    for `NON_BLOCKING` findings, and it never fires without this explicit answer.
8. Write the full report to `specs/active/<change-id>/reviews/<task-id>.md` using
   `templates/review-report.md`'s shape (create `reviews/` if needed), including each
   finding's predicate, lifecycle, and evidence — overwriting the file read in step 2,
   which is expected; it's the one file this command writes.
9. If the verdict is `pass`, don't just print the CLI command and stop — ask, using a
   closed menu (same principle as `/nevo-ai:spec-approve`: a known transition should be
   confirmed and applied in the same turn, not left as an instruction to type):

   ```
   Task `<task-id>` passed review.

   Mark it as:
   1. Implemented (self-verified)
   2. Verified (you've reviewed it yourself)
   3. Leave as-is for now
   ```

   On 1 → run `node tools/specs.mjs complete <change-id> <task-id>`. On 2 → run
   `node tools/specs.mjs verify <change-id> <task-id>`. On 3 → make no changes. **No
   status is changed without this explicit answer.** For `blocked` or
   `changes-required`, skip this step — there's nothing to confirm yet.
9a0. **Batch-continuation offer (D2/D3, area batch-execution-and-gating-review, task
    08).** Immediately after a status change in step 9 (option 1 or 2), run `node
    tools/specs.mjs batch-status <change-id>`. If `active` is `false`, or `<task-id>`
    isn't among `intent.orderedTasks`, this task isn't part of an active batch — skip
    the rest of this step entirely (never fires outside an active batch). Otherwise:
    - If `hardStop` is non-null for the new `progress.current` — impossible immediately
      after a passing review, but if this task's own self-check regresses between this
      review and the next invocation, it will show up here — do not offer continuation;
      report the hard stop and stop (D24: a full review is never a substitute for it).
    - If `progress.current` names another task: ask, as a closed choice, whether to
      continue to it now (`/nevo-ai:task-next` already knows how to resolve it — this
      offer is "keep going in this same batch," not a second, separate command
      invocation):
      ```
      Batch continues with `<progress.current>` next.
      1. Continue now
      2. Stop here for now
      ```
      On 1 → proceed exactly as `/nevo-ai:task-start <change-id> <progress.current>`
      would, in this same turn. On 2 → make no changes; the batch intent is untouched and
      resumable later via `node tools/specs.mjs batch-status <change-id>`.
    - If `progress.current` is `null` (every batched task is now terminal): ask whether
      to run the gating batch review now:
      ```
      Every task in this batch is now terminal.
      1. Run the gating batch review now
      2. Not yet
      ```
      On 1 → run `node tools/specs.mjs batch-review <change-id>` and relay its verdict
      and report path verbatim (this also clears the batch intent on success — do not
      re-run `batch-status` afterward and act on stale intent). On 2 → make no changes.
    - `validationBlocksContinuation` in the `batch-status` output governs whether a
      `validate`/`check` failure blocks continuing to `progress.next` — it is already
      `false` when that exact boundary is a declared temporary-inconsistency pair (AC6);
      do not re-derive this by hand.
9a. If option 1 or 2 was chosen, run `node tools/specs.mjs status <change-id>`. This
    command is never asked to *decide* anything here — it's read-only, and its job is to
    say correctly whether the rest of the change is done or whether a PR/review/merge
    story is still pending. Do **not** ask about or run `node tools/specs.mjs archive`
    directly from this step — archiving a change before its PR is pushed, reviewed, and
    merged is exactly the mistake `spec-status`/`spec-finalize` exist to prevent (see
    `docs/ai/workflow-overview.md`), and this command has no way to know on its own
    whether a bare local archive is actually safe. Its `stage` becomes this response's
    `Next command` in step 10 below, verbatim, whatever it is (`ready-to-start` /
    `in-progress` if other tasks in the change aren't terminal yet — same as today;
    `cannot-verify-pr` / `needs-pr` / `pr-draft` / `needs-comment-resolution` /
    `needs-verification-fixes` / `ready-to-finalize` / `done` once every task is
    terminal). Report it, do not act on
    it — same rule `/nevo-ai:spec-status` itself follows.
10. End with `references/review-policy.md` § "Chat output shape" → "`/nevo-ai:task-review`
    — adapted shape". `Verdict` is the value from step 7 (`pass` stays `pass`
    regardless of which menu option was chosen — the status-transition outcome goes in
    a bullet, e.g. "Status change: marked implemented" / "marked verified" / "left
    as-is"); bullets give blocking/non-blocking finding counts; `Report` is the path
    from step 8; `Next command` is:
    - `blocked` → the specific manual fix needed,
    - `changes-required` → what to fix, then re-run
      `/nevo-ai:task-review <change-id> <task-id>`,
    - `pass` + option 1 or 2 → step 9a's `node tools/specs.mjs status <change-id>`
      result, verbatim: its `nextCommand` (e.g. `/nevo-ai:task-next`, the
      `nevo-ai-github` skill's "Create a PR" flow, "resolve N review threads",
      `/nevo-ai:spec-finalize <change-id>`, or "None"
      when `done`),
    - `pass` + option 3 → `No further action required.`

## Rules

- Status changes only happen after the explicit menu answer in step 9 — never before
  it, and never inferred from the verdict alone.
- The archive offer in step 9a fires only immediately after this run's own status
  transition made `<change-id>` fully terminal — never for an already-terminal change
  found incidentally, and never without the explicit menu answer.
- The batch-continuation offer in step 9a0 fires only when `batch-status` reports an
  active batch that actually includes `<task-id>` — never inferred, never offered
  speculatively when no batch is active.
- Do not fix the code yourself as part of this command, even for an `AUTO_FIX`-tagged
  finding — review stays read-only with respect to the code under review; writing its
  own `reviews/<task-id>.md` (step 8) and applying the status transition the owner just
  chose (step 9) are the two exceptions.
- Do not commit.
