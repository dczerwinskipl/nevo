---
review-of: implementation-review
change: nevo-ai-process-continuity-and-hardening
scope: 14-21
reviewed-tasks: [review-report-minimization, deterministic-implementation-provenance, semantic-cross-task-integration-and-consolidated-decisions, scoped-and-incremental-spec-review, compound-actions-and-dependency-aware-status, unowned-drift-correction-flow, repository-bound-handler-testability, owner-workflow-acceptance-scenarios]
eligible-for-verification: [repository-bound-handler-testability]
must-remain-unchanged: [review-report-minimization, deterministic-implementation-provenance, semantic-cross-task-integration-and-consolidated-decisions, scoped-and-incremental-spec-review, compound-actions-and-dependency-aware-status, unowned-drift-correction-flow, owner-workflow-acceptance-scenarios]
generated: 2026-08-08
verdict: owner-decision-required
unresolved_required_fixes: 8
unresolved_owner_decisions: 4
unresolved_needs_clarification: 1
---

# Review: nevo-ai-process-continuity-and-hardening (tasks 14-21)

Baseline found: `reviews/implementation-review-14-21.md` (generated 2026-08-07). Read in
full before this run overwrote it; every finding below was re-verified against current
file contents, not carried forward from memory.

## What changed since the baseline

Uncommitted corrective work landed on top of `80e8209` (the commit the 2026-08-07 review
covered) — visible in the working tree, not yet committed. It closes some of that
review's gaps but leaves most of D36-D40's decided resolution paths unexecuted, and
reopens one previously-accepted scope exception.

## Verdict

`owner-decision-required` — computed by `computeMultiTaskReviewVerdict`: gating
validation passed (`node tools/specs.mjs validate` / `node tools/docs.mjs validate`,
both clean; non-gating `check` also clean for both), no per-task verdict is `blocked`,
but 6 unresolved `OWNER_DECISION`/`NEEDS_CLARIFICATION` findings exist across the
per-task and cross-task-integration levels (row 3 of the decision table) — this alone
determines the verdict regardless of the 8 unresolved `AUTO_FIX` findings that would
otherwise put it at `changes-required`. (Frontmatter's `unresolved_owner_decisions: 5`
excludes the 1 `NEEDS_CLARIFICATION` finding, counted separately per convention;
`computeMultiTaskReviewVerdict`'s own `ownerDecisionFindings` input merges both kinds,
per policy.)

`validateAggregateAgainstCanonicalReviews` confirmed every row below matches its own
canonical `reviews/<task-id>.md` frontmatter — `{"ok":true}` (re-checked after D41 was
recorded, against the updated per-task counts).

## Task summary

| Task | Verdict | AC | Scope | Findings |
|---|---|---|---|---|
| review-report-minimization | changes-required | 9/9 | compliant | 2 |
| deterministic-implementation-provenance | changes-required | 10/13 | 1 owner-approved exception(s) | 2 |
| semantic-cross-task-integration-and-consolidated-decisions | changes-required | 7/9 | compliant | 1 |
| scoped-and-incremental-spec-review | changes-required | 9/9 | compliant | 1 |
| compound-actions-and-dependency-aware-status | changes-required | 9/9 | compliant | 1 |
| unowned-drift-correction-flow | changes-required | 6/8 | compliant | 3 |
| repository-bound-handler-testability | pass | 9/9 | compliant | 0 |
| owner-workflow-acceptance-scenarios | changes-required | 7/18 | compliant | 2 |

Full detail for every task: its own `reviews/<task-id>.md` (linked below). Only
unresolved/notable findings are expanded here, per the compact aggregate shape.

## Per-task unresolved findings

### review-report-minimization (`reviews/review-report-minimization.md`)

Unchanged from the 2026-08-07 baseline — both findings `still-present`:

- F1 `AUTO_FIX` — ADR-0006 still states a pre-task-14 line-count figure that contradicts
  this task's own "Report minimization" subsection.
- F2 `AUTO_FIX` — `docs/ai/specification-workflow.md` still not updated to mirror the
  new ≤10-line ceiling.

### deterministic-implementation-provenance (`reviews/deterministic-implementation-provenance.md`)

- **F1 `OWNER_DECISION` (scope, `outside-allowed`) — reopened, then re-accepted (D41).**
  D36's accepted scope exception for `tools/lib/git.mjs` (`getWorktreeDiff`/
  `findCommitsMentioning`) was found **invalid** this run: `isScopeExceptionValid` fails
  because task 15's semantic fingerprint changed
  (`7013dbba4965bbd8387de72f3d0f6a964b71ea06c0c75ac28324026fee1d56d0` at acceptance →
  `bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15` now), caused by this
  round's own edits to the task file's AC list (AC5/AC5a/AC8a wording), not by `git.mjs`
  itself changing further — its diff is identical to what D36 already covered. At the
  consolidated decision stage the owner re-accepted the exception against the current
  fingerprint (`owner-decisions.md` D41). F1's lifecycle is now `accepted`, excluded from
  task 15's unresolved-blocking count.
- F2 `OWNER_DECISION` — AC6 (task-review.md step 4 reading a task's persisted
  `implementation.changed_paths`) still unmet — `still-present`. D37 already decided to
  close this via a new corrective task; none has been created. Not a fresh decision —
  D37's chosen resolution path simply hasn't executed yet.
- F3 `OWNER_DECISION` — AC7/AC9 (regression detection for a later task silently
  re-attributing a shared file on a `handleSelfCheck` re-run) still unmet —
  `still-present`, same D37 status as F2.
- New this round: AC5a and AC8a (added to the task file since baseline) are now
  genuinely implemented and tested — `computeImplementationFingerprintFromProvenance` no
  longer folds `baseline_revision`/`review_revision` with `||` and now includes
  `worktree_patch_fingerprint`; `apply-provenance --mappings` confirms several legacy
  provenance mappings under one `--confirm`. AC coverage rose from 8/11 to 10/13 (2 ACs
  added, both met; F2/F3's underlying ACs still not).
- F4/F5 (`NON_BLOCKING`) unchanged — already recorded as `FU-008`/`FU-009`.

### semantic-cross-task-integration-and-consolidated-decisions (`reviews/semantic-cross-task-integration-and-consolidated-decisions.md`)

Unchanged from baseline — F1 `AUTO_FIX` `still-present` (AC1/AC2's `(automated)` tag
overstates what the tests literally exercise for semantic-conflict detection, which is
inherently a model-review judgment). This task's own mechanism code
(`selectSemanticIntegrationPairs`, `PER_TASK_REVIEW_FIELDS`,
`buildConsolidatedDecisionStage`) is byte-identical to `HEAD` — none of this round's
corrective work touched it.

### scoped-and-incremental-spec-review (`reviews/scoped-and-incremental-spec-review.md`)

Unchanged from baseline — F1 `AUTO_FIX` `still-present` (`docs/ai/specification-workflow.md`
still has zero mentions of `--changed`/`--tasks`/`task_fingerprints`/
`scopedReviewBaselineValid`, and its verdict-table section still states the unqualified
five-row table with no scoped-run caveat).

### compound-actions-and-dependency-aware-status (`reviews/compound-actions-and-dependency-aware-status.md`)

Unchanged from baseline — F1 `AUTO_FIX` `still-present` (`docs/ai/specification-workflow.md`
not updated to mirror FU-002's/FU-004's fix; confirmed untouched since commit `4699f34`,
predating this task).

### unowned-drift-correction-flow (`reviews/unowned-drift-correction-flow.md`)

Unchanged from baseline — this task's own `git diff HEAD` is empty for every one of its
declared paths; all three findings `still-present`:

- F1 `AUTO_FIX` — still no test reads `spec-audit.md`/`task-review.md` to verify the
  unowned-drift wiring text landed.
- F2 `NEEDS_CLARIFICATION` — AC5's wording still contradicts AC2/the passing test for the
  `git-workflow.md` fixture. D40 already decided to correct the wording; per D40's own
  text this was "not yet amended" and remains so — expected continuation, not a new gap.
- F3 `AUTO_FIX` — `docs/ai/specification-workflow.md` still not updated for the
  unowned-drift wiring.

### repository-bound-handler-testability (`reviews/repository-bound-handler-testability.md`)

`pass` — zero unresolved findings at this task's own level. Its own declared scope
(`allowed_paths`/`consequential_paths`) is untouched by this round's diff; the two prior
non-blocking observations remain tracked as `FU-012`/`FU-013` (both `open`), not
re-recorded.

**Cross-task finding X1 (below) names this task but does not affect its own verdict** —
D39's decision to extend this task's `gitRoot` parameterization pattern to
`handleSelfCheck` falls outside this task's own declared `allowed_paths`/"Out of scope"
text, confirmed unamended. It stays a cross-task/aggregate-level finding.

### owner-workflow-acceptance-scenarios (`reviews/owner-workflow-acceptance-scenarios.md`)

- **F1 `OWNER_DECISION` — still-present, D38's decision not executed.** The working-tree
  diff to `tools/tests/owner-workflow-acceptance.test.mjs` touches only Scenario 2 (a
  tightened function-level assertion, still calling `computeTaskReviewChecklist`/
  `renderNormalPassingReportBody` directly — not a command-turn-level rewrite). The
  other ~8 scenarios D38 named are byte-for-byte unchanged, still calling
  `tools/specs/lifecycle.mjs` functions directly, contradicting the task's own
  "Implementation constraints" text. **Zero of the ~10 flagged scenarios are now
  genuinely command-turn-level.**
- F2 `AUTO_FIX` — Scenario 13's tautological test (`loadChange` twice against unmodified
  fixture state) is unchanged — `still-present`.
- F3 (`NON_BLOCKING`) unchanged — already recorded as `FU-014`.

## Cross-task integration

**File-overlap detection** (`attributeTouchedPaths`/`detectBatchIntegrationFindings`,
real diff since the shared baseline `c0009050db04b7e8773196af23a83bf09bf1ff74`, computed
directly via `tools/lib/git.mjs#getChangedFiles` against the current working tree,
uncommitted changes included): every pair of these 8 tasks still shares at least one
touched path — almost entirely the declared consequential path
`specs/index.generated.json`/`docs/index.generated.*` (mechanical, regenerated, not a
defect) and `docs/decisions/ADR-0006-process-continuity-and-hardening.md` (each task's
own subsection, inspected via each per-task subreview — no new contradiction beyond
review-report-minimization's own F1, already listed above) and, for six of the eight
tasks, `tools/specs/lifecycle.mjs` (each task's own distinct exports; the
`semantic-cross-task-integration-and-consolidated-decisions` subreview directly confirmed
no naming/logic collision). One file outside every task's own declared scope was
touched: `tools/lib/git.mjs` — this is exactly task 15's own F1 (reopened scope
exception), not a new cross-task finding. Full test suite: 840/840, confirmed both by
every per-task subreview and independently at this orchestrating level. No finding from
file-overlap alone beyond the per-task findings already listed.

**Bounded semantic integration pass** (`selectSemanticIntegrationPairs`; every task
declares an empty `semantic_references` block, so pair selection reduces to the 28
file-overlap pairs above — the full C(8,2) set, unchanged from baseline): one real
finding, unresolved, unchanged from the 2026-08-07 baseline.

- **X1 `OWNER_DECISION` — still-present.** `handleSelfCheck` (`tools/specs.mjs`,
  currently lines 438-477) is still `handleSelfCheck(changeSlug, taskId)` with no
  `gitRoot`/options parameter — confirmed by direct re-read this run; all three
  `git.getCurrentRevision`/`getChangedFiles`/`getWorktreeDiff` calls still pass the
  hardcoded module-level `ROOT`. D39 already decided to extend task 20's `gitRoot`
  pattern to `handleSelfCheck` and to reopen whether `follow-ups.yaml`'s `FU-007` should
  still read `resolved` — neither has happened: task 20's own file (`allowed_paths`,
  acceptance criteria, "Out of scope" text) is unamended, and `FU-007` still reads
  `status: resolved` with resolution text naming only the original three handlers. Not a
  fresh decision — D39's chosen path simply hasn't executed.

Open `blocking`-severity `follow-ups.yaml` entries with `source_task` in this scope:
none (`FU-001` through `FU-014` are all `severity: non-blocking`; `FU-007`'s `resolved`
status stays in tension with X1, named here, not re-litigated).

## Eligibility

- **Eligible for verification:** `repository-bound-handler-testability` — `pass`, zero
  unresolved findings at either the per-task or cross-task-integration level. Already
  `verified` in `change.yaml` — the bulk-transition confirmation below is a no-op for
  this task regardless of which outcome is chosen.
- **Must remain unchanged:** every other reviewed task — each carries at least one
  unresolved finding (own verdict `changes-required`), so none is eligible regardless of
  which bulk-confirmation option is chosen.

## Follow-up candidates

None new this round — every `NON_BLOCKING` finding collected from the per-task
subreviews (task 15's F4/F5, task 17's F2, task 18's F2, task 21's F3) already has a
matching open entry in `follow-ups.yaml` (`FU-008`/`FU-009`/`FU-010`/`FU-011`/`FU-014`),
confirmed by direct comparison of each finding's summary against the recorded `reason`
text. Nothing to record.

## Consolidated decision stage (2026-08-08)

**Scope decision (F1, task 15):** owner chose "re-accept the exception." Recorded as
`owner-decisions.md` D41 and as this task's own `scope_exceptions` frontmatter entry
(`reviews/deterministic-implementation-provenance.md`), against the current task
fingerprint `bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15`. F1's
lifecycle is now `accepted`.

**D37, D38, D39, D40 status — not fresh decisions, already made on 2026-08-07.** The
remaining open findings in this review (task 15 F2/F3, task 19 F2, task 21 F1, cross-task
X1) each already have a recorded owner decision naming their resolution path. None was
re-asked; this review only reports that the decided corrective work has not yet landed
for any of the four.

**Follow-up choices:** none — zero new follow-up candidates this round (see above).

**Bulk-transition confirmation:** owner chose "run bulk-transition anyway." Ran
`node tools/specs.mjs bulk-transition nevo-ai-process-continuity-and-hardening --tasks
repository-bound-handler-testability --outcome verified` — result: "No task needed a
status change (every selected task was already at or past the target)," confirming the
predicted no-op. No other task was included (every other selected task carries at least
one unresolved blocking finding, per the hard eligibility rule).
