# Area: Review report compaction and owner-approved scope exceptions

> New area, added 2026-08-06 (sixth refinement pass) per owner decision D31 — requested
> after task 12 (`implementation-review-orchestration`) reached `status: in-implementation`.
> This area does not reopen or weaken task 12 or any of tasks 01-11; it changes how
> `/nevo-ai:task-review` and `/nevo-ai:implementation-review` write their reports and how
> a scope violation may be resolved, reusing task 12's own report/decision model rather
> than defining a second one.

## Responsibility

Own two related changes to the same two review shapes:

1. **Report compaction.** `/nevo-ai:task-review` and `/nevo-ai:implementation-review`
   reports become concise and exception-oriented by default: a short, deterministic
   checklist replaces verbose positive-proof prose, `Findings` contains only actionable
   or exception content (never a synthetic `INFORMATIONAL` entry recording that a check
   passed), and a normal passing task report targets roughly 15-30 lines. `spec-review`,
   `spec-audit`, and the gating batch review are unchanged.
2. **Owner-approved scope exceptions.** A scope violation is never silently waived, but
   it is no longer an unconditional block either — the owner may explicitly accept a
   legitimate, narrow violation of `allowed_paths` (never `forbidden_paths`) as a
   recorded, structured, machine-readable exception, after which the task may reach
   `pass` while the exception stays visible for every future re-review and audit.

## Current state

`task-review.md` step 4 currently reads "a violation here is always a blocking finding,
no exceptions" — a scope violation has no path to `pass` short of reverting it or
rewriting the task's `allowed_paths` through a full spec amendment, even when the owner
would clearly accept it as-is. Every review report (`templates/review-report.md`)
narrates full AC-by-AC coverage and lists `INFORMATIONAL` findings for passing checks —
correct, but expensive: a task with 11/11 satisfied acceptance criteria repeats all 11 in
prose, and `/nevo-ai:implementation-review`'s aggregate report (task 12) risks
concatenating several such reports rather than summarizing them, exactly the failure mode
this area exists to prevent before task 12's own reports become the normal case.

## Requirements

### A. Compact, exception-oriented reports

1. **Compact checklist replaces verbose positive-proof prose**, added to
   `templates/review-report.md` for `task-review`/`implementation-review` reports only:

   ```
   - [x] All acceptance criteria covered
   - [x] Required automated verification passed
   - [x] Scope check resolved
   - [x] No forbidden-path violation remains unresolved
   - [x] Architecture and documentation remain consistent
   - [x] No unresolved blocking findings
   - [x] No unresolved owner decision
   ```

   A checked item carries no further prose. A failed item (`[ ]`) names the specific
   acceptance criterion, finding, or scope issue directly under it — never a bare
   unchecked box with no explanation. Exact wording may be refined; the seven-item shape
   and its determinism (computed, not composed) may not.
2. **`Findings` contains only actionable or exception content** — actual defects, missing
   AC coverage, unresolved risks, scope violations, required fixes, owner decisions, and
   explicit follow-up candidates. Never a synthetic `INFORMATIONAL` finding recording that
   a test passed, a validation command succeeded, `allowed_paths` was respected, a
   forbidden path was absent, the implementation matched expected structure, or docs
   stayed consistent — those facts are already represented by a checked checklist item
   (requirement 1) and restating them as findings is exactly the redundancy this area
   removes. `No findings.` is the correct, literal rendering when nothing actionable
   remains — same convention `templates/review-report.md` already uses for "no baseline."
3. **Compact verification section** — one line per command plus pass/fail, never full
   command output unless the command failed or the output is itself required evidence:

   ```
   ## Verification

   - `node --test tools/tests/example.test.mjs` — passed
   - `node tools/specs.mjs validate` — passed
   - `node tools/docs.mjs validate` — passed
   ```
4. **Compact AC-coverage rendering.** A passing report may use one checklist-style line
   (`[x] All 11 acceptance criteria covered`) instead of repeating every satisfied
   criterion; only criteria that are not met, partially met, untested, or otherwise
   questionable are expanded, optionally as a compact `AC | Result | Evidence` table when
   several need individual treatment. Full AC-by-AC evidence for every criterion,
   satisfied or not, is available only under `--verbose` (requirement 9).
5. **Deterministic verdict-consistency guards**, computed (not composed as prose) by a
   new `tools/specs/lifecycle.mjs` function, reusing the checklist items above as its
   inputs:
   - `pass` is impossible while any acceptance criterion is not met, partially met,
     untested, or missing an explicitly required automated test.
   - `pass` is impossible while any of the seven checklist items is unresolved.
   - a missing explicitly required automated test is `AUTO_FIX`-blocking, never a
     `NON_BLOCKING` observation.
   - a passing verification command never counts as AC coverage for a required scenario
     the tests don't actually exercise.
6. **Evidence preserved for re-review**, unchanged in kind from the existing rule
   (`references/review-policy.md` § "Re-review"), restated for the compact shape: the
   reviewed revision/range, task fingerprint, executed verification commands and results,
   finding IDs/locations/lifecycle, and recorded scope exceptions. The reviewer's full
   positive reasoning is not preserved when a short evidence reference already suffices —
   that is precisely what requirements 1-4 remove.
7. **Size is a consequence, not a target enforced by truncation.** A normal passing task
   report lands around 15-30 lines because nothing else needs saying; a report with
   defects, owner decisions, or exceptions grows to fit them. Report size must never grow
   merely because a task happens to carry many satisfied acceptance criteria.

### B. Explicit owner-approved scope exceptions

8. **Revised scope-violation policy**, replacing `task-review.md` step 4's current
   wording: *"A scope violation can never be silently waived. It prevents a `pass`
   verdict while unresolved, but it may be resolved through an explicit owner decision
   recorded in the review artifact."* Concretely: `No unresolved or unrecorded scope
   exceptions may pass` — never `No scope exception may ever pass`.
9. **Every scope violation still starts as a blocking finding**, classified through the
   existing `AUTO_FIX`/`OWNER_DECISION` taxonomy (`references/review-policy.md` §
   "Findings must be actor-classified") like any other finding — never a special,
   unconditional category outside it. The reviewer distinguishes, and states which
   applies: a change outside `allowed_paths`, a change matching `forbidden_paths`, work
   attributable to another task, or unnecessary unrelated work — and names the smallest
   valid resolution (revert, relocate into an already-allowed file, attribute to another
   task, amend the task's declared scope, or accept it as an owner-approved exception).
   A violation is never classified as automatically resolved merely because the changed
   file looks reasonable.
10. **`forbidden_paths` is categorically excluded from lightweight acceptance.** A
    `forbidden_paths` violation may be resolved only by reverting/re-attributing the
    change, or by an explicit owner-approved scope amendment that edits the task's own
    `forbidden_paths`/`allowed_paths` (a specification change, invalidating that task's
    fingerprint and review baseline — requirement 14, not a review-artifact-only
    exception). A review-level `scope_exceptions` entry must never reference a path that
    matches `forbidden_paths` — this is a hard rule the reviewer checks, not a judgment
    call.
11. **The owner's decision menu**, presented once per violation (or once per collected
    group of violations under requirement 17):

    ```
    1. Accept the listed scope exception
    2. Require the implementation to return to the declared scope
    3. Leave unresolved
    ```

    Option 1 is available only for a violation classified `outside-allowed` (requirement
    9) — never for a `forbidden_paths` violation (requirement 10). Option 3 leaves the
    finding as an unresolved `OWNER_DECISION`, which keeps `pass` unreachable exactly as
    today.
12. **Structured, narrow, machine-readable exception schema**, persisted in the review
    artifact's frontmatter, never a blanket glob:

    ```yaml
    scope_exceptions:
      - finding: F1
        path: tools/tests/start.test.mjs
        reason: Dedicated start lifecycle tests are clearer than adding unrelated cases to recovery.test.mjs.
        decision: accepted
        confirmed_by: owner
        confirmed_at: 2026-08-05
        task_fingerprint: "<fingerprint>"
    ```

    Each entry names one concrete path, one finding ID, a reason, and the task fingerprint
    at the time of acceptance — never a pattern like `tools/**`. Exact field names may be
    refined; the requirement that every entry resolve to exactly one concrete path and one
    finding, and never a glob, may not.
13. **After acceptance**, the finding's lifecycle (`references/review-policy.md` §
    "Findings have a lifecycle") becomes `accepted` — a new value alongside the existing
    `resolved`/`still-present`/`changed`/`cannot-verify` set, meaning "not unresolved, but
    not because the underlying predicate stopped being true" (unlike `resolved`, where the
    violation itself no longer exists). An `accepted` finding does not count as an
    unresolved blocking finding for verdict purposes (requirement 5), but the finding
    itself, its `Findings` row, and the checklist's "Scope check resolved" item must still
    state — every time the report is written or re-written — that the implementation
    exceeded the declared scope. The finding is never deleted.
14. **The checklist distinguishes full compliance from an accepted exception** —
    requirement 1's "Scope check resolved" item, checked, carries one of two states:

    ```
    - [x] Scope check resolved
    ```
    with no further note when every path is inside `allowed_paths`, or
    ```
    - [x] Scope check resolved
      - 1 owner-approved exception recorded
    ```
    when an exception is active. The checklist must never read `[x] Implementation stays
    within allowed_paths` while an accepted exception exists — that phrasing asserts
    something false.
15. **Exception validity across re-review** — a new `tools/specs/lifecycle.mjs` function
    (`isScopeExceptionValid` or equivalent) checks, deterministically, whether a
    previously accepted exception still applies: the same concrete path is still
    involved, the task identity is unchanged, and the task's current semantic fingerprint
    (D18) matches the fingerprint recorded on the exception at acceptance time (a proxy
    for "the relevant implementation and review baseline remain compatible"). A changed
    task fingerprint invalidates the exception outright — this is a deterministic,
    testable check. Whether the *nature* of the out-of-scope change has "materially
    expanded" beyond that (e.g. the same file grew a large, unrelated new function) is a
    model-inspection step performed at re-review time, not something the deterministic
    check alone can decide; a re-review that finds material expansion treats the
    exception as invalid and re-opens the finding for a fresh owner decision, even if the
    deterministic fingerprint check alone would have passed.
16. **Amending `allowed_paths`/`forbidden_paths`/task attribution is a specification
    scope amendment, not a review-level exception.** It is recorded as an owner decision,
    edits the task file directly, invalidates that task's semantic fingerprint and review
    baseline (D18's existing mechanism — no new invalidation logic needed), and requires a
    fresh `/nevo-ai:task-review` pass. It does not, by itself, force any other lifecycle
    transition on the task's current implementation status. This path already exists
    (`/nevo-ai:spec-refine`, `/nevo-ai:spec-review`) — this area only documents that a
    scope amendment is the correct escalation when requirement 10/11 rule out a
    lightweight exception.

### C. Aggregate implementation review

17. **Same compact shape applies to `/nevo-ai:implementation-review`'s aggregate
    report** (task 12) — one compact row per task, never several concatenated full
    per-task reports:

    ```
    | Task | Verdict | AC | Tests | Scope | Findings |
    |---|---|---|---|---|---|
    | state-and-fingerprint-semantics | pass | 11/11 | passed | compliant | 0 |
    | recovery-classification-and-machine-readable-errors | changes-required | 7/7 | passed | exception pending | 1 |
    ```

    `Verdict` uses `task-review`'s own three-value set (`pass`/`changes-required`/
    `blocked`, unchanged — see "Options and trade-offs" note below); `Scope` is one of
    `compliant` / `exception pending` / `N owner-approved exception(s)` / `forbidden-path
    violation`. Details are expanded only for: failing tasks, unresolved scope exceptions,
    accepted scope exceptions, cross-task findings, and owner decisions — every other task
    gets exactly its one summary row.
18. **Scope decisions are collected into one owner-facing confirmation** when several
    selected tasks carry a scope violation eligible for the requirement 11 menu — the
    owner is not forced to confirm each task's exception separately unless the decisions
    are materially different (e.g. one is `outside-allowed`, eligible for acceptance, and
    another is `forbidden_paths`, not eligible at all — those two are shown together but
    resolved through different paths, never silently merged into one accept-all answer).
19. **After owner decisions are collected**, applied atomically, in the same shape task
    12 already established for its own bulk transition: finding lifecycle updated once
    per resolved finding, the aggregate and per-task review artifacts updated together,
    eligible task status transitions applied through the one existing
    `bulk-transition` CLI operation (task 12) — never a second, parallel write path — and
    a task with any still-unresolved finding is never touched, regardless of the outcome
    chosen for other tasks in the same batch.

### D. Verbose mode (optional interface, narrow scope)

20. **`--verbose` is an additive interface, not a required implementation.** If added,
    `/nevo-ai:task-review <change-id> <task-id> --verbose` restores full AC-by-AC prose
    (every criterion, satisfied or not) and the previous, fuller `Findings`/evidence
    narration — but only if it can be added without complicating the default (compact)
    flow described above. The default output shape (requirements 1-7) is this area's
    actual requirement; `--verbose` is a nice-to-have this task may ship without, per
    requirement 36 of the owner's original request.

### E. Deterministic line-budget enforcement (task 14, D34/D35, seventh refinement pass)

> Extends requirement 7 above rather than replacing it. Requirement 7 established that
> size is "a consequence, not a target enforced by truncation," landing "around 15-30
> lines" for a normal passing report — true, but the 15-30 figure was itself only prose
> guidance (`templates/review-report.md`), never a deterministic renderer/validator
> (confirmed: no line-count-enforcing function existed anywhere in
> `tools/specs/lifecycle.mjs` as of the sixth refinement pass). Task 14 tightens the
> actual number and makes it a real, checkable guarantee.

21. **A normal passing body has at most 10 non-empty lines.** "Normal passing" means:
    full AC coverage, `Scope: compliant` (or an already-`accepted` exception carried
    forward with no new decision needed this run), and zero unresolved findings. The
    ten-line ceiling covers exactly: a title line, the seven checklist items
    (requirement 1), and up to two lines for the accepted-exception note (requirement
    14) when one applies — nothing else. This is stricter than requirement 7's "15-30
    lines" language; requirement 7's own guarantee ("must never grow merely because a
    task happens to carry many satisfied acceptance criteria") is unchanged, only the
    upper bound for the normal case is now a fixed, enforced number instead of a range.
22. **AC coverage appears exactly once, scope appears exactly once, findings appear
    exactly once** — no report may restate any of the three under a second heading or
    inside a different section for emphasis (a literal, checkable structural rule, not
    a style preference).
23. **A normal passing body excludes, unconditionally:** prose explaining why the
    report passed; a separate verdict-explanation paragraph; a full listing of
    successful verification commands beyond the one-line-per-command shape requirement
    3 already established; test counts beyond what a single verification line already
    states; a separate architecture/documentation-consistency confirmation paragraph
    (the checklist's "Architecture and documentation remain consistent" item, checked,
    is the entire statement); a repeated AC-coverage restatement; a list of
    scope-compliant paths; Git history narration; and any synthetic
    `INFORMATIONAL` finding (already excluded by requirement 2 — restated here because
    the ten-line ceiling makes a single reintroduced item measurably break the budget).
24. **`pass` remains impossible** (unchanged from requirement 5, restated for emphasis
    against the new ceiling) with incomplete AC coverage, missing required automated
    coverage, unresolved scope, a blocking finding, or an unresolved owner decision —
    the ten-line ceiling applies only to a report that has actually earned `pass`
    through requirement 5's existing guards; it is never achieved by omitting content a
    non-`pass` report is required to show.
25. **Deterministic rendering, not prompt wording alone.** A new
    `tools/specs/lifecycle.mjs` function (`renderCompactReviewChecklist` or equivalent)
    takes the same seven checklist inputs `computeTaskReviewChecklist` (task 13)
    already computes and renders the exact ten-or-fewer-line body for the normal-pass
    case; `task-review.md`/`implementation-review.md` call it instead of composing the
    passing-case body as free text. A failing/exception-bearing report still expands
    only the failed ACs, scope issues, or active findings (unchanged from task 13) —
    the ten-line ceiling applies only to the fully-passing case.
26. **The same minimal per-task format is used inside `implementation-review`'s
    aggregate report** (task 12/13's own compact table, requirement 17) — a passing
    task's row plus zero expanded lines already satisfies the ten-line-per-task budget
    trivially; this requirement exists to state explicitly that task 14 does not
    introduce a second, divergent minimal-report shape for the aggregate case.

## Constraints

- Never remove `Findings`, `Verdict`, or the required machine-readable frontmatter
  (review target, change, task, generated date, verdict, unresolved counts, fingerprints)
  from any report — compaction removes redundant prose and synthetic `INFORMATIONAL`
  entries, not the fields lifecycle tooling and re-review depend on.
- Never let a `forbidden_paths` violation reach `pass` through the `scope_exceptions`
  mechanism (requirement 10) — this is a hard rule, not a per-run judgment call.
- Never invent a fourth per-task verdict value for `task-review`/`implementation-review`'s
  per-task pass — `pass`/`changes-required`/`blocked` stays the complete set (see
  "Options and trade-offs" below).
- Never accept a blanket or glob-shaped scope exception (requirement 12) — one path, one
  finding, one task fingerprint, every time.
- Never apply an accepted exception to a future, different file — acceptance is
  per-path, per-finding, per-task-fingerprint, and re-checked (requirement 15), not
  inherited.
- `spec-review`, `spec-audit`, and the gating batch review's own report shapes are
  unchanged by this area (requirement 17's scope is `task-review`/`implementation-review`
  only).

## Interfaces and boundaries

Exposes: the compact checklist/verdict shape (requirements 1-7) and the scope-exception
schema/decision flow (requirements 8-16), both consumed by `task-review.md` and, through
its per-task reuse of `task-review`'s own flow, `implementation-review.md`; the aggregate
compact table and collected-decision flow (requirements 17-19), consumed by
`implementation-review.md` alone. New deterministic `tools/specs/lifecycle.mjs` functions
(checklist-driven verdict computation, scope-finding classification, exception-validity
checking) are exposed to both command files exactly as task 12's own `computeMultiTaskReviewVerdict`/`selectEligibleForVerification`/`computeBulkTransitionTarget` already are.

Consumes: `task-review.md`'s existing flow (steps 1-8), which this area edits in place
rather than replacing; `implementation-review.md`'s existing flow and its reuse of
`task-review`'s own depth (task 12, unchanged); `pathMatchesAllowedPattern`
(`tools/specs/lifecycle.mjs`, already used by `classifyDirtyWorktree`) for scope-finding
classification; `computeTaskFingerprint` (D18) for exception-validity checking
(requirement 15); `bulk-transition` (task 12) as the one write path for collected
decisions (requirement 19).

## Area-specific acceptance criteria

- A test proves a synthetic `INFORMATIONAL` finding is never generated for a passing
  test, a successful validation command, a compliant `allowed_paths` check, an absent
  forbidden path, expected implementation structure, or documentation consistency.
- A test proves the checklist-driven verdict function returns `pass` only when all seven
  checklist items resolve true, and returns something other than `pass` for each item
  individually false, one at a time.
- A test proves a missing explicitly required automated test is classified `AUTO_FIX`
  and blocks `pass`, never merely `NON_BLOCKING`.
- A test proves scope-finding classification distinguishes `compliant` /
  `outside-allowed` / `forbidden` correctly for a representative set of paths against a
  task's `allowed_paths`/`forbidden_paths`.
- A test proves an `outside-allowed` finding with a recorded, matching `scope_exceptions`
  entry no longer counts as unresolved for verdict purposes, while a `forbidden` finding
  with the same shape of entry still does (requirement 10's hard exclusion).
- A test proves exception validity: the same path/task-fingerprint pair is valid; a
  changed task fingerprint invalidates it; a different path never matches an existing
  entry.
- A test proves the aggregate table's `Scope` column distinguishes `compliant` from
  `exception pending` from an accepted-exception count, and that the checklist never
  renders the false-compliance wording ("stays within `allowed_paths`") while an
  exception is active.
- A test proves a re-review preserves a finding's `accepted` lifecycle without repeating
  it as an active blocker, while still surfacing it in the report's evidence trail.
- A test proves a synthetic fully-passing report (full AC coverage, compliant scope,
  zero findings) renders at most 10 non-empty lines (requirement 21), and that AC
  coverage, scope, and findings each appear exactly once (requirement 22).
- A test proves `renderCompactReviewChecklist` (requirement 25), not prompt wording
  alone, is what a passing report's body is generated from — a snapshot test comparing
  the function's deterministic output against the actual rendered report body.

## Dependencies

`implementation-review-orchestration` (task 12) — both this area's report compaction and
its scope-exception model apply to `implementation-review.md`'s aggregate report on top
of task 12's own flow, verdict table, and `bulk-transition` write path; this area extends
that same report/decision model rather than building a second one, so it cannot start
before task 12's own CLI surface and command file exist. `state-and-fingerprint-semantics`
(task 01) — `computeTaskFingerprint` (D18), read by the exception-validity check
(requirement 15). Task 14 (§E) additionally depends on this same area's own task 13
output — `computeTaskReviewChecklist` and the seven-item checklist shape — since
`renderCompactReviewChecklist` (requirement 25) renders exactly those seven inputs;
task 14 is recorded as a separate task (not folded into task 13) because it was
requested after task 13 reached `verified`, per the same "new task, not a reopened one"
convention D30/D31 already established.

## Out of scope

- Changing `/nevo-ai:spec-review`, `/nevo-ai:spec-audit`, or the gating batch review's own
  report shape or verdict vocabulary (requirement 17's explicit scope).
- A fourth per-task verdict value for `task-review`/`implementation-review` (see
  "Options and trade-offs" note above) — an unresolved scope-exception decision is an
  unresolved `OWNER_DECISION` finding under the existing three-value set.
- Resolving a `forbidden_paths` violation through any review-level mechanism (requirement
  10) — only a specification scope amendment (requirement 16) or reverting the change.
- A `--verbose` mode's full implementation beyond the interface itself
  (`/nevo-ai:task-review <change-id> <task-id> --verbose`) — added only if it does not
  complicate the default (compact) flow; the default output shape is this area's actual
  requirement.
- Retroactively rewriting any already-written `reviews/*.md` file from tasks 01-12 — the
  new shape applies going forward, on the next `task-review`/`implementation-review` run.
