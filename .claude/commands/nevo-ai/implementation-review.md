---
description: Orchestrate task-review's own per-task depth across an owner-selected range or list of already-implemented tasks, plus one cross-task integration pass and one bulk status transition.
argument-hint: <change-id> --all|--tasks <range-or-list>
disable-model-invocation: true
---

Read `references/review-policy.md` § "Multi-task implementation review" from the shared
skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> --all` or `<change-id> --tasks <spec>`, where
`<spec>` is a dash-separated order range (`01-03`) or a comma-separated order list
(`01,03,07`) — the same numbering already visible in every `tasks/NN-*.md` filename.
Exactly one of `--all`/`--tasks` is required; if neither or both are given, stop and ask
which was intended.

Use this command whenever the owner wants a range or list of already-implemented tasks
reviewed together with one aggregate verdict and one bulk status decision — never for a
single task (`/nevo-ai:task-review`) or a single named thematic lens across the whole
change (`/nevo-ai:spec-audit`, non-gating, never applies a status transition).

## Flow

1. **Resolve scope.** Run `node tools/specs.mjs review-scope <change-id> --all` or
   `--tasks <spec>`. If it fails (bad spec, an order number that doesn't resolve, a task
   whose status isn't `in-implementation`/`implemented`/`verified`/`archived`), relay the
   exact error and stop — do not guess at what the owner meant.
2. **Derive `<scope>`.** `all` for `--all`; for `--tasks`, the resolved orders, sorted,
   dash-joined (e.g. `01-03-07`). Check whether
   `specs/active/<change-id>/reviews/implementation-review-<scope>.md` already exists. If
   it does, **read its full current content now, before anything else touches it** — this
   is the baseline for this run, same rule as `/nevo-ai:task-review`/`/nevo-ai:spec-audit`
   § "Re-review: current file contents are the source of truth, not git status or
   memory." If it doesn't exist, there is no baseline; the final response must include,
   verbatim, "No reliable previous-file baseline is available. Performing a fresh review
   of the current scope." A baseline at a *different* `<scope>` string does not count —
   say the same sentence in that case too.
3. **Per-task review, sequential, bounded context.** For each task in the resolved scope,
   in order: delegate that task's review to a fresh subagent invocation running exactly
   `/nevo-ai:task-review <change-id> <task-id>`'s own flow steps 1-8 (context resolution,
   its own baseline read, diff inspection, `allowed_paths`/`forbidden_paths` check,
   acceptance-criteria/area/constraint/ADR/architecture-doc comparison, finding
   classification with lifecycle status, the step 7a follow-up-recording offer, and
   writing `reviews/<task-id>.md`) — **never** step 9 onward (the per-task status-decision
   menu, the batch-continuation offer). The subagent returns only: this task's own verdict
   (`pass`/`changes-required`/`blocked`), blocking-finding count, non-blocking-finding
   count, and blocking finding IDs — its full diff/file reads must not remain in this
   command's own context once the subagent returns. Do not ask a status question between
   tasks; that happens exactly once, at the very end (step 9), after step 8's separate
   scope-exception collection.
4. **Cross-task integration pass**, once every per-task review in scope is complete.
   Compute the real diff across the resolved scope, attribute every changed file to every
   in-scope task whose `allowed_paths`/`consequential_paths` match it, and detect a
   structured finding for every pair of in-scope tasks whose attributed touched paths
   actually overlap — reusing the gating batch review's own mechanism
   (`attributeTouchedPaths`/`detectBatchIntegrationFindings`, area
   `batch-execution-and-gating-review`), not a second implementation of the same idea.
   Also check `follow-ups.yaml` for any open, `blocking`-severity entry whose
   `source_task` falls inside the resolved scope. Never re-evaluate any individual task's
   own acceptance criteria here — that was already done in step 3, per task.
5. **Compute the overall verdict** from `references/review-policy.md` § "Multi-task
   implementation review" → "Overall verdict — an explicit table, never composed as
   prose." Count unresolved `OWNER_DECISION`/`NEEDS_CLARIFICATION` findings and unresolved
   `AUTO_FIX` findings separately, across both the per-task and cross-task-integration
   levels, before evaluating the table. Before writing the per-task `Verdict` column
   (step 7), run `validateAggregateAgainstCanonicalReviews` (`tools/specs/lifecycle.mjs`)
   against each selected task's own `reviews/<task-id>.md` frontmatter (`verdict`,
   `unresolved_required_fixes`, `unresolved_owner_decisions`,
   `unresolved_needs_clarification`) and the row you are about to write — this is what
   catches an aggregate silently drifting from its own per-task artifacts (found by
   hand once, 2026-08-06: a per-task review's frontmatter still said
   `changes-required` after its body/counts had been updated to `pass`). If it returns
   `{ ok: false, reason }`, stop and fix the named canonical review file first — never
   write an aggregate row that contradicts it.
6. **Determine eligibility.** A task is eligible for the bulk-verification offer only when
   its own verdict is `pass` **and** it carries zero unresolved blocking findings at
   either level (per `references/review-policy.md` § "Eligibility and the one bulk
   confirmation"). Every other selected task is "must remain unchanged." This is a hard
   rule — never overridden by which bulk-confirmation option the owner picks in step 9,
   though step 8's scope-exception decisions may change *which* tasks are eligible before
   this is recomputed for step 9.
7. **Write the aggregate report** to
   `specs/active/<change-id>/reviews/implementation-review-<scope>.md` (create `reviews/`
   if needed) using the compact table shape (D31, area review-report-compaction-and-scope-exceptions requirement 17) — overall verdict; one compact row per selected task:

   ```
   | Task | Verdict | AC | Tests | Scope | Findings |
   |---|---|---|---|---|---|
   | state-and-fingerprint-semantics | pass | 11/11 | passed | compliant | 0 |
   | recovery-classification-and-machine-readable-errors | changes-required | 7/7 | passed | exception pending | 1 |
   ```

   `Scope` is one of `compliant` / `exception pending` / `N owner-approved exception(s)` /
   `forbidden-path violation`. Never several concatenated full per-task reports — details
   are expanded only for: failing tasks, unresolved scope exceptions, accepted scope
   exceptions, cross-task findings, and owner decisions (a reference to that task's own
   `reviews/<task-id>.md` plus its unresolved findings by ID/category/one-line summary,
   never the full per-task report re-embedded); every other task gets exactly its one
   row. Also include: the cross-task integration findings, the eligible-for-verification
   list, the must-remain-unchanged list and why. This overwrites the file read in step 2,
   which is expected.
8. **Collect every selected task's pending scope-exception decision into the same turn**
   (D31 requirement 18), *before* the step 9 status confirmation — never one accept-all
   answer across every kind of violation. Group by resolution path:
   - `outside-allowed` findings (eligible for the requirement-11 menu — accept /
     return-to-scope / leave-unresolved), presented together for however many tasks carry
     one;
   - `forbidden` findings (never eligible for acceptance — only revert/re-attribute or a
     specification scope amendment), presented separately, never folded into the same
     accept-all answer as the `outside-allowed` group.

   If zero tasks carry a pending scope-exception decision, skip this step entirely and say
   so. Apply the collected decisions atomically (D31 requirement 19): update each
   resolved finding's lifecycle once, update the aggregate and per-task review artifacts
   together, and record any newly `accepted` exception's `scope_exceptions` entry — before
   step 9's status confirmation runs, so step 9's eligibility computation (step 6) already
   reflects the just-resolved findings. A task with any *other* still-unresolved finding
   (not itself a scope exception) is never touched by this step's decisions alone — it
   still needs its own fix before it can become eligible.
9. **One closed confirmation, asked once, only when step 6 found at least one eligible
   task (recomputed after step 8's decisions) — never per task:**

   ```
   1. Mark every passing selected task as verified
   2. Mark every passing selected task as implemented/self-verified
   3. Leave all statuses unchanged
   ```

   If zero tasks are eligible, skip this prompt entirely and say so in the chat summary —
   there is nothing to confirm. On 1 → run `node tools/specs.mjs bulk-transition
   <change-id> --tasks <eligible-id,...> --outcome verified`. On 2 → run the same command
   with `--outcome self-verified`. On 3 → make no changes. **No status is changed without
   this explicit answer**, and the command only ever targets the eligible subset from step
   6 — a task listed as "must remain unchanged" is never included in `--tasks` here, even
   under the same invocation. This is the one existing `bulk-transition` write path —
   step 8's collected scope decisions are never applied through a second, parallel write
   path, and a task with any still-unresolved finding is never included here regardless
   of which scope decision it received in step 8. If the CLI call fails (a computed
   transition became invalid between step 6 and this step — e.g. a hard-stopped
   self-check), relay its exact error; do not retry or override it.
10. End with `references/review-policy.md` § "Multi-task implementation review" → "Chat
    output shape". `Verdict` is the value from step 5; bullets list the reviewed task ids,
    the eligible-for-verification list, the must-remain-unchanged list, and the cross-task
    integration finding count; `Report` is the path from step 7; `Next command` is:
    - `blocked` → the specific manual fix needed,
    - `owner-decision-required` → the exact decision(s) needed, one per finding ID
      (including any still-unresolved `forbidden`-classified scope finding, which step 8
      never resolves),
    - `changes-required` → what to fix per task, then re-run this same command,
    - `pass` and step 9 applied a transition → `node tools/specs.mjs status <change-id>`,
      run now, relayed verbatim (read-only — report it, never act on it, same rule
      `/nevo-ai:task-review` follows),
    - `pass` and step 9 was skipped or answered "leave unchanged" →
      `No further action required.`

## Rules

- Status changes only ever happen after the explicit menu answer in step 9, and only ever
  through the single `bulk-transition` CLI call — never a per-task `complete`/`verify`
  call, never before the confirmation.
- Scope-exception decisions (step 8) are collected before, and applied atomically ahead
  of, step 9's status confirmation — never merged into one accept-all answer across
  `outside-allowed` and `forbidden` findings, and never applied through any write path
  other than the finding-lifecycle update (step 8) plus the one `bulk-transition` call
  (step 9).
- Never apply a status transition to a task carrying an unresolved blocking finding,
  regardless of which bulk-confirmation option is chosen (step 6's eligibility rule is
  absolute, recomputed after step 8).
- Never re-evaluate an individual task's own acceptance criteria inside the cross-task
  integration pass (step 4) — that boundary is as firm here as it already is for the
  gating batch review and for `spec-audit`.
- Never replace or weaken `/nevo-ai:task-review` or `/nevo-ai:spec-audit` — this command
  orchestrates the former's own depth across a range, it does not fold it in or duplicate
  the latter's thematic, non-gating shape.
- Do not fix code yourself as part of this command — review stays read-only with respect
  to the code under review; writing `reviews/implementation-review-<scope>.md` (step 7),
  recording collected scope-exception decisions (step 8), and applying the status
  transition the owner just chose (step 9) are the exceptions, same principle as
  `/nevo-ai:task-review`.
- Do not commit.
