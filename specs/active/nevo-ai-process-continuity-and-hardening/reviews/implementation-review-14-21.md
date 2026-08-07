---
review-of: implementation-review
change: nevo-ai-process-continuity-and-hardening
scope: 14-21
reviewed-tasks: [review-report-minimization, deterministic-implementation-provenance, semantic-cross-task-integration-and-consolidated-decisions, scoped-and-incremental-spec-review, compound-actions-and-dependency-aware-status, unowned-drift-correction-flow, repository-bound-handler-testability, owner-workflow-acceptance-scenarios]
eligible-for-verification: [repository-bound-handler-testability]
must-remain-unchanged: [review-report-minimization, deterministic-implementation-provenance, semantic-cross-task-integration-and-consolidated-decisions, scoped-and-incremental-spec-review, compound-actions-and-dependency-aware-status, unowned-drift-correction-flow, owner-workflow-acceptance-scenarios]
generated: 2026-08-07
verdict: owner-decision-required
unresolved_required_fixes: 8
unresolved_owner_decisions: 4
unresolved_needs_clarification: 1
---

# Review: nevo-ai-process-continuity-and-hardening (tasks 14-21)

No reliable previous-file baseline is available. Performing a fresh review of the
current scope.

## Verdict

`owner-decision-required` — computed by `computeMultiTaskReviewVerdict`: gating
validation passed (`node tools/specs.mjs validate` / `node tools/docs.mjs validate`,
both clean), no per-task verdict is `blocked`, but 4 unresolved `OWNER_DECISION`
findings and 1 unresolved `NEEDS_CLARIFICATION` finding exist across the per-task and
cross-task-integration levels (row 3 of the decision table) — this alone determines the
verdict regardless of the 8 unresolved `AUTO_FIX` findings that would otherwise put it
at `changes-required`.

`validateAggregateAgainstCanonicalReviews` confirmed every row below matches its own
canonical `reviews/<task-id>.md` frontmatter — `{"ok":true}`.

## Task summary

| Task | Verdict | AC | Tests | Scope | Findings |
|---|---|---|---|---|---|
| review-report-minimization | changes-required | 9/9 | passed | compliant | 2 |
| deterministic-implementation-provenance | changes-required | 8/11 | passed | 1 owner-approved exception(s) | 5 |
| semantic-cross-task-integration-and-consolidated-decisions | changes-required | 7/9 | passed | compliant | 1 |
| scoped-and-incremental-spec-review | changes-required | 9/9 | passed | compliant | 2 |
| compound-actions-and-dependency-aware-status | changes-required | 9/9 | passed | compliant | 2 |
| unowned-drift-correction-flow | changes-required | 6/8 | passed | compliant | 3 |
| repository-bound-handler-testability | pass | 9/9 | passed | compliant | 2 |
| owner-workflow-acceptance-scenarios | changes-required | 7/18 | passed | compliant | 3 |

**Status: `repository-bound-handler-testability` was transitioned `implemented` →
`verified` (owner-confirmed) after this review; every other task above remains
unchanged pending its own unresolved findings.**

Full detail for every task: its own `reviews/<task-id>.md` (linked below). Only
unresolved/notable findings are expanded here, per the compact aggregate shape.

## Per-task unresolved findings

### review-report-minimization (`reviews/review-report-minimization.md`)

- F1 `AUTO_FIX` — `docs/decisions/ADR-0006-...md:655` still states the pre-task-14
  ("~15-30 lines") figure, contradicting this task's own new "Report minimization"
  subsection two hundred lines earlier in the same file.
- F2 `AUTO_FIX` — `docs/ai/specification-workflow.md` (the vendor-neutral canonical doc)
  was not updated to mirror the new ≤10-line ceiling; same file flagged again by three
  sibling tasks below.

### deterministic-implementation-provenance (`reviews/deterministic-implementation-provenance.md`)

- F1 `OWNER_DECISION` (scope, `outside-allowed`) — new exports (`getWorktreeDiff`,
  `findCommitsMentioning`) landed in `tools/lib/git.mjs`, outside this task's own
  `allowed_paths`/`consequential_paths`.
- F2 `OWNER_DECISION` — AC6 not fully implemented: `task-review.md` step 4's scope
  check never reads `implementation.changed_paths`; this task is forbidden from
  touching `.claude/commands/**`, and task 16 explicitly excludes changing
  `task-review`'s own flow, so no task in this scope currently closes it.
- F3 `OWNER_DECISION` — AC7/AC9 unimplemented: no regression-detection mechanism
  exists for a later task's edit silently being re-attributed to an earlier task on a
  `handleSelfCheck` re-run.

### semantic-cross-task-integration-and-consolidated-decisions (`reviews/semantic-cross-task-integration-and-consolidated-decisions.md`)

- F1 `AUTO_FIX` — AC1/AC2 claim `(automated)` test coverage for "a real broken
  contract produces exactly one finding" / "a clean pair produces zero findings," but
  the actual tests only exercise the deterministic pair-*selection* half
  (`selectSemanticIntegrationPairs`) — semantic-conflict detection is a model-review
  judgment with no code representation, by design, so no test proves the literal claim.

### scoped-and-incremental-spec-review (`reviews/scoped-and-incremental-spec-review.md`)

- F1 `AUTO_FIX` — `docs/ai/specification-workflow.md` was not updated to describe the
  new `--changed`/`--tasks` capability or the scoped-verdict-guard caveat; no mention
  anywhere in that file.

### compound-actions-and-dependency-aware-status (`reviews/compound-actions-and-dependency-aware-status.md`)

- F1 `AUTO_FIX` — `docs/ai/specification-workflow.md` was not updated to mirror
  FU-002's/FU-004's fix (same gap as the other three sibling tasks above).

### unowned-drift-correction-flow (`reviews/unowned-drift-correction-flow.md`)

- F1 `AUTO_FIX` — AC4 is tagged `(automated)` but no test reads `spec-audit.md`/
  `task-review.md` to verify the unowned-drift wiring text actually landed (this repo
  has an established pattern for exactly this, `tools/tests/compound-actions.test.mjs`,
  not followed here).
- F2 `NEEDS_CLARIFICATION` — AC5 literally claims both FU-006 incident fixtures
  classify `unowned-drift`, but per AC2's own forbidden-priority rule the
  `git-workflow.md` fixture correctly classifies `forbidden` instead (the passing
  test's own title is misleadingly still "classifies unowned-drift"). The
  implementation is correct; the task file's own wording needs an owner call.
- F3 `AUTO_FIX` — `docs/ai/specification-workflow.md` was not updated to mirror the
  new unowned-drift wiring in `spec-audit.md`/`task-review.md` (same gap again).

### repository-bound-handler-testability (`reviews/repository-bound-handler-testability.md`)

`pass` — zero unresolved findings. Two non-blocking observations were collected as
follow-up candidates (below), not asked about per-task per this orchestration's
suppressed step 7a.

### owner-workflow-acceptance-scenarios (`reviews/owner-workflow-acceptance-scenarios.md`)

- F1 `OWNER_DECISION` — roughly two-thirds of the 15 required scenarios only call a
  single sibling-task-already-tested `tools/specs/lifecycle.mjs` function directly,
  rather than composing a real command-turn-level integration scenario — contradicting
  this task's own explicit "Implementation constraints" text (and the area doc's
  identical wording) that a scenario calling an internal function directly does not
  satisfy this task's own acceptance criteria.
- F2 `AUTO_FIX` — Scenario 13's test doesn't simulate anything: it calls `loadChange`
  twice against unmodified fixture state and asserts the fingerprint equals itself — a
  tautology providing zero real coverage of AC13.

## Cross-task integration

**File-overlap detection** (`attributeTouchedPaths`/`detectBatchIntegrationFindings`,
real diff since the shared baseline `c0009050db04b7e8773196af23a83bf09bf1ff74`):
every pair of these 8 tasks shares at least one touched path — almost entirely the
declared `consequential_path` `specs/index.generated.json` (mechanical, regenerated,
not a defect) and `docs/decisions/ADR-0006-process-continuity-and-hardening.md` (each
task adds its own distinct, non-overlapping subsection — inspected directly, no
contradiction found beyond review-report-minimization's own F1, already listed above).
Six of the eight tasks (14-19) also add distinct new functions to the shared
`tools/specs/lifecycle.mjs` — inspected directly (naming, signatures, and logic of
every new export); no collision or contradiction found, consistent with the full test
suite (826/826) passing with all six tasks' changes present together. No finding from
file-overlap alone beyond the per-task findings already listed.

**Bounded semantic integration pass** (`selectSemanticIntegrationPairs`, all 28
in-scope pairs selected — the file-overlap above already touches every pair): one real
finding.

- **X1 `OWNER_DECISION`** — `handleSelfCheck` (`tools/specs.mjs`) still hardcodes
  `ROOT` for `git.getCurrentRevision`/`git.getChangedFiles`/`git.getWorktreeDiff`.
  Task 20 (`repository-bound-handler-testability`) parameterized `handleStart`/
  `checkSpecsIndexes`/`buildSpecsIndexes` with `activeDir`/`gitRoot`, but not
  `handleSelfCheck` — even though `follow-ups.yaml`'s own FU-007 reason text named
  "handleStart, index checks, **and similar handlers**" as the intended scope, and
  FU-007 was marked `resolved` by task 20 anyway. Task 15
  (`deterministic-implementation-provenance`) added new repo-root-dependent
  provenance-refresh logic to exactly this unparameterized function
  (`tools/specs.mjs:438-469`) in this same change, so that new logic remains
  untestable via a fixture repo without touching the real repository — the concrete
  root cause behind task 15's own F3 gap (no regression test for later-task
  re-attribution). Neither task's own declared scope covers fixing this; it needs an
  owner call on how to close it (extend task 20's parameterization pattern to
  `handleSelfCheck`, reopen/amend a task, or a new corrective task).

Open `blocking`-severity `follow-ups.yaml` entries with `source_task` in this scope:
none (`FU-002`/`FU-004`/`FU-006`/`FU-007` are all `severity: non-blocking` and already
marked `resolved`; `FU-007`'s "resolved" status is itself in tension with finding X1
above — named there, not re-litigated here).

## Eligibility

- **Eligible for verification:** `repository-bound-handler-testability` — `pass`, zero
  unresolved findings at either the per-task or cross-task-integration level.
- **Must remain unchanged:** every other reviewed task — each carries at least one
  unresolved finding (own verdict `changes-required`), so none is eligible regardless
  of which bulk-confirmation option is chosen.

## Follow-up candidates (recorded)

Collected from every task's own suppressed step 7a offer, presented once at the
consolidated stage instead of per task. Owner chose to record all 7 in
`follow-ups.yaml`:

| Task | Finding | Follow-up ID | Summary | Severity |
|---|---|---|---|---|
| deterministic-implementation-provenance | F4 | FU-008 | `computeTaskAttributedChangedPaths` diverges from the task's own stated design (behaviorally equivalent, undocumented substitution). | non-blocking |
| deterministic-implementation-provenance | F5 | FU-009 | AC4's "tested for each of the four fields independently" only partially met. | non-blocking |
| scoped-and-incremental-spec-review | F2 | FU-010 | AC1/AC4/AC7's `(automated)` tag overstates what a dedicated test literally exercises for three guarantees. | non-blocking |
| compound-actions-and-dependency-aware-status | F2 | FU-011 | AC6's automated test only asserts `depsSatisfied` inside the `ready-to-start` branch, not the other `deriveStage` stages it also runs scenarios for. | non-blocking |
| repository-bound-handler-testability | F1 | FU-012 | Stale comment near `handleStart`'s `not_retryable` branch still claims it can't be driven end-to-end in a fixture test. | non-blocking |
| repository-bound-handler-testability | F2 | FU-013 | `handler-testability.test.mjs` exercises only 2 of 5 named `handleStart` outcomes via the fixture harness. | non-blocking |
| owner-workflow-acceptance-scenarios | F3 | FU-014 | Scenario 8's fixture-backed test only starts one of its two declared tasks. | non-blocking |

## Owner decisions from the consolidated stage (2026-08-07)

Full text in `owner-decisions.md`:

- **D36** — `deterministic-implementation-provenance` F1 (scope, `outside-allowed`,
  `tools/lib/git.mjs`): accepted as an owner-approved exception. Applied; see that
  task's own `reviews/deterministic-implementation-provenance.md` frontmatter.
- **D37** — `deterministic-implementation-provenance` F2/F3 (AC6, AC7/AC9): create a
  corrective task. Not yet created — findings stay open.
- **D38** — `owner-workflow-acceptance-scenarios` F1 (under-composed scenarios):
  rewrite the flagged scenarios as real command-turn-level tests. Not yet done —
  finding stays open.
- **D39** — cross-task X1 (`handleSelfCheck` hardcodes `ROOT`): extend task 20's
  `gitRoot` parameterization pattern to `handleSelfCheck`; also reopens whether FU-007
  should still read `resolved`. Not yet done — finding stays open.
- **D40** — `unowned-drift-correction-flow` F2 (AC5 wording): correct AC5's text in
  `tasks/19-unowned-drift-correction-flow.md` to match the implementation (a
  specification scope amendment via `/nevo-ai:spec-refine`, not performed by this
  review command). Not yet done — finding stays open.

None of D37-D40 change any task's own verdict in this report — each decided the
*resolution path*, not the resolution itself. A fresh `/nevo-ai:task-review` (or a
follow-up `/nevo-ai:implementation-review` pass) is required once the corrective work
actually lands.
