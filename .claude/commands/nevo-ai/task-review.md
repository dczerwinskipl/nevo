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
4. Verify the diff stays within `allowed_paths` and does not touch `forbidden_paths`. A
   write inside the task's own `consequential_paths` is **not** a scope violation at this
   step — it is a direct, mechanical, generated-or-reference-only consequence of the
   task's primary scope, still shown in the diff and still reviewed (steps 5-6), just
   never classified or counted as a scope finding. A genuine violation (outside both
   `allowed_paths` and `consequential_paths`) can never be silently waived — it prevents
   `pass` while unresolved — but it may be resolved through an explicit owner decision
   recorded in the review artifact (D31): **no unresolved or unrecorded scope exception
   may pass**, never "no scope exception may ever pass." Classify every touched path
   outside the task's own `allowed_paths`/`consequential_paths` with
   `classifyScopeFinding(path, { allowedPaths, forbiddenPaths })`
   (`tools/specs/lifecycle.mjs`) — `compliant` / `outside-allowed` / `forbidden` — per
   `references/review-policy.md` § "Owner-approved scope exceptions." A path this task
   didn't touch but that carries a matching `kind: maintenance-correction` entry in
   `follow-ups.yaml` (D34/D35, area unowned-drift-correction) is named explicitly if it
   surfaces during review — never re-flagged as an unexplained anomaly.
4a. **Resolve every `outside-allowed`/`forbidden` finding from step 4**, one at a time
    (or once per collected group, if several share the same resolution path):
    ```
    1. Accept the listed scope exception
    2. Require the implementation to return to the declared scope
    3. Leave unresolved
    ```
    Option 1 is offered only for an `outside-allowed` finding — **never** for
    `forbidden` (that classification is categorically excluded from lightweight
    acceptance; only reverting/re-attributing the change, or a specification scope
    amendment, resolves it). On 1 → record the `scope_exceptions` frontmatter entry
    (exact path, finding ID, reason, `decision: accepted`, `confirmed_by: owner`,
    `confirmed_at`, `task_fingerprint` — `node tools/specs.mjs fingerprint <change-id>
    --task <task-id>`, never estimated) and set the finding's lifecycle to `accepted`.
    On 2 → the finding stays an unresolved `OWNER_DECISION`/`AUTO_FIX` finding pending
    the implementation change. On 3 → the finding stays an unresolved `OWNER_DECISION`
    finding, `pass` unreachable, same as before D31.
4b. **Re-review: validate every existing `scope_exceptions` entry before treating it as
    still `accepted`.** Run `isScopeExceptionValid(exception, { path, taskFingerprint })`
    (`taskFingerprint` from `node tools/specs.mjs fingerprint <change-id> --task
    <task-id>`, current) for each baseline entry — a mismatch invalidates it outright.
    Separately, inspect whether the out-of-scope change has *materially expanded* beyond
    what the exception covers (the deterministic check cannot decide this) — if so, treat
    the exception as invalid and re-open the finding for a fresh owner decision (step 4a)
    even though the deterministic check alone would have passed.
5. Compare the implementation to: the task's acceptance criteria, its area's
   requirements (if any), change-wide constraints, applicable ADRs, and architecture
   documentation.
6. Check behavior, tests, documentation impact, breaking changes, unrelated edits,
   generated artifacts (`*.generated.*` should only change via `tools/docs.mjs generate` / `tools/specs.mjs generate`), and verification evidence (build/test
   output — ask for it if not shown, do not assume it passed).
7. Classify every current finding per `references/review-policy.md` § "Findings must be
   actor-classified". For a task review, `AUTO_FIX` means "the agent may make this code
   fix without further deliberation once told to proceed" — this command never applies
   code fixes itself; that always needs an explicit, separate go-ahead (see Rules). If
   step 2 found a baseline, verify each of its findings' **exact literal predicate**
   against the diff/code just inspected (not memory of what it probably still says),
   and assign a lifecycle status (`resolved` / `still-present` / `changed` /
   `cannot-verify` / `accepted` — the last per step 4a) per `references/review-policy.md`
   § "Findings have a lifecycle, on top of their actor category." Compute the verdict
   with `computeTaskReviewChecklist` (`tools/specs/lifecycle.mjs`) — never composed as
   prose — from the seven checklist inputs: AC coverage complete, whether an explicitly
   required automated test is missing (always `AUTO_FIX`-blocking, independent of AC
   coverage — a passing verification command alone never counts as coverage for a
   scenario the tests don't exercise), verification passed, scope status (`compliant` /
   `accepted-exception` / `unresolved`, from steps 4/4a/4b), forbidden-path-clean,
   docs-consistent, unresolved blocking finding count, unresolved owner-decision count.
   `pass` only when every item resolves clean; any single failure yields
   `changes-required`. `blocked` is reserved for a more fundamental stop this checklist
   doesn't itself model — e.g. verification evidence cannot be produced at all — and is
   set directly, not through this function, when that happens.
7a. **Record as follow-up (D15/D22, area context-and-validation-hardening, task 06).**
    For each `NON_BLOCKING` finding from step 7, ask (closed choice, one per finding or
    batched if several) whether to record it in `specs/active/<change-id>/follow-ups.yaml`
    instead of letting it live only in this run's report:
    ```
    1. Record as a follow-up (severity: <blocking|non-blocking> — your call, default
       non-blocking unless the finding itself says otherwise)
    2. Leave it in the report only
    ```
    On 1 → run `node tools/specs.mjs follow-up-add <change-id> <id> --source-task <task-id> --kind <short-kind> --severity <blocking|non-blocking> --reason <finding summary>`. This does not change how `AUTO_FIX`/`OWNER_DECISION`/
    `NEEDS_CLARIFICATION` findings are categorized or handled — this action exists only
    for `NON_BLOCKING` findings, and it never fires without this explicit answer.
8. Write the full report to `specs/active/<change-id>/reviews/<task-id>.md` using
   `templates/review-report.md`'s compact, exception-oriented shape (D31 — the
   seven-item `Checklist`, `Findings` restricted to actionable/exception content only,
   the compact `Verification` and acceptance-criteria sections, the `scope_exceptions`
   frontmatter when an exception is active), including each finding's predicate,
   lifecycle, and evidence — overwriting the file read in step 2, which is expected;
   it's the one file this command writes. **A normal passing report (step 7's verdict is
   `pass`, no unresolved finding, at most an already-accepted scope exception) has at
   most 10 non-empty lines (D34/D35, task 14) — call
   `renderNormalPassingReportBody(checklistResult, { title, scopeExceptionCount })`
   (`tools/specs/lifecycle.mjs`) for the body instead of composing it as prose; it is
   exactly the title line plus the seven checklist items (via
   `renderCompactReviewChecklist`), nothing else.** A report with any unresolved
   finding, owner decision, or a scope exception still pending a decision keeps the
   expanded shape (findings, AC-coverage detail, verification lines) task 13 already
   defines — it must never grow merely because a task has many satisfied acceptance
   criteria, and it must never shrink below what a real defect, decision, or exception
   requires stating.
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
    08).** Immediately after a status change in step 9 (option 1 or 2), run `node tools/specs.mjs batch-status <change-id>`. If `active` is `false`, or `<task-id>`
    isn't among `intent.orderedTasks`, this task isn't part of an active batch — skip
    the rest of this step entirely (never fires outside an active batch). Otherwise:
    - If `hardStop` is non-null for the new `progress.current` — impossible immediately
      after a passing review, but if this task's own self-check regresses between this
      review and the next invocation, it will show up here — do not offer continuation;
      report the hard stop and stop (D24: a full review is never a substitute for it).
    - If `progress.checkpointReached` is `true` (D20 `until-checkpoint` mode): do **not**
      offer to continue into `progress.current` — that would silently behave like
      `all-approved-reachable`, exactly what this checkpoint exists to prevent. Report
      that checkpoint `progress.checkpointTask` was reached, and ask, as a closed choice,
      whether to cross it:
      ```
      Checkpoint `<progress.checkpointTask>` reached. Batch intent stays active either way.
      1. Continue past the checkpoint now (next: `<progress.current>`)
      2. Stop here for now
      ```
      On 1 → proceed exactly as `/nevo-ai:task-start <change-id> <progress.current>`
      would, in this same turn (the checkpoint bounds this one offer, not the batch's
      remaining selection — `orderedTasks` is unchanged). On 2 → make no changes; the
      batch intent is untouched and resumable later via
      `node tools/specs.mjs batch-status <change-id>`.
    - Else, if `progress.current` names another task: ask, as a closed choice, whether to
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
