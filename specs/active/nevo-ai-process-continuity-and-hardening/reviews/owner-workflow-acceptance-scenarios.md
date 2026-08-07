---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: owner-workflow-acceptance-scenarios
generated: 2026-08-07
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 1
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/owner-workflow-acceptance-scenarios

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — verification passes and scope is compliant, but AC coverage is not
complete: a majority of the fifteen scenarios violate the task's own explicitly stated
testing-depth constraint (F1), and one scenario's test is vacuous against its own
acceptance criterion (F2).

## Checklist

- [ ] All acceptance criteria covered
  - Not every acceptance criterion is met, partially met, tested, or unquestionable. (F1)
  - An explicitly required automated test is missing — a passing verification command
    alone does not cover it. (F2)
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | first-review | The task's own "Implementation constraints" section states: "Each scenario exercises a full command turn ... not only the internal function the corresponding task already unit-tests — a scenario that only calls an internal function directly does not satisfy this task's own acceptance criteria, even if it exercises the same code path." The area doc (`areas/owner-workflow-acceptance.md`) states the identical constraint under "Constraints." | A majority of the fifteen scenarios call exactly one `tools/specs/lifecycle.mjs` function with assertions that duplicate — closely or near-verbatim — a test already present in the sibling task's own test file, rather than composing multiple mechanisms into a real command-turn-level scenario. Concretely: Scenario 5 (lines 117-129, `buildConsolidatedDecisionStage` over three records) is the same shape of test as `semantic-integration.test.mjs:87-111`; Scenario 10 (lines 200-217, the `deriveStage`/`depsSatisfied` invariant) duplicates `status-dependency-aware.test.mjs:79-93`'s own identically-worded invariant test; Scenario 9 (lines 182-196) duplicates `scoped-spec-review.test.mjs`'s coverage of `resolveSpecReviewScope`/`selectChangedTaskIds`/`scopedReviewBaselineValid`; Scenario 11's first test (lines 222-232) duplicates `unowned-drift.test.mjs`'s coverage of `classifyUnownedDrift`/`UNOWNED_DRIFT_OPTIONS`/`validateMaintenanceCorrectionEntry`; Scenario 12 (lines 241-248) duplicates `review-compaction.test.mjs`'s coverage of `classifyScopeFinding`/`isScopeExceptionValid`; Scenario 8's first test (lines 154-164) duplicates `provenance.test.mjs`'s own shared-file independent-attribution case; Scenarios 2, 3, 6, 7 are likewise single bare calls to `computeTaskReviewChecklist`/`renderNormalPassingReportBody`/`renderCompactReviewChecklist`/`selectSemanticIntegrationPairs`, each already covered the same way in `review-compaction.test.mjs`/`semantic-integration.test.mjs`. This undermines the task's own stated purpose (D34: prove the *composition* holds, not re-prove each owning task's mechanism in isolation) for roughly two-thirds of the required scenarios. Resolution requires an owner call: either accept the current unit-level scenarios as the practical ceiling (command files are prose, not executable code, and no other task in this refinement pass tests any differently — Scenario 1/8-second-test/15's own use of `handleStart` against a real fixture shows a higher bar is achievable for handler-backed mechanisms), or require genuine multi-step composition for the scenarios that can support it (5, 9, 10 in particular chain handler output into further computation and could be rebuilt end-to-end against `createFixtureRepo`, similar to Scenario 15). | `tools/tests/owner-workflow-acceptance.test.mjs` (Scenarios 2, 3, 5, 6, 7, 8-first-test, 9, 10, 11-first-test, 12) |
| F2 | AUTO_FIX | first-review | AC13 / area requirement 13: "Global HEAD advancement does not stale earlier evidence — a full sequential batch/multi-task run where `HEAD` advances after each task, asserting an earlier task's own evidence ... is never reported stale purely because `HEAD` moved." | Scenario 13's test (lines 252-265) does not simulate `HEAD` advancing or any other task's `self_check`/`implementation` fields changing — it calls `loadChange` twice against completely unmodified fixture state and asserts the fingerprint equals itself. The test's own inline comment claims "Simulate HEAD having advanced (a later task committing)," but no commit, no second task, and no field mutation occurs between the two `loadChange` calls — the assertion is a tautology (`x === x`) and provides zero coverage of the described scenario. Fix: actually record a second task's `self_check`/`implementation` write (or perform a real `git commit` advancing `HEAD`) between the two fingerprint computations, then assert task `t1`'s own fingerprint is unchanged. | `tools/tests/owner-workflow-acceptance.test.mjs:252-265` |
| F3 | NON_BLOCKING | first-review | Area requirement 8: "a full, sequential two-task run against the same file, asserting each task's own `implementation.changed_paths`/fingerprint stays independently correct after the second task's edit." | Scenario 8's second (fixture-backed) test only calls `handleStart` on task `ta`; task `tb` is declared in the fixture but never started or edited, so the fixture-backed half of the scenario does not actually demonstrate the "after the second task's edit" case the requirement describes — that proof rests entirely on the bare-function first test (itself flagged under F1). | `tools/tests/owner-workflow-acceptance.test.mjs:166-177` |

## Scope compliance

Task's own attributed `implementation.changed_paths` (from `change.yaml`, recorded by
the prior `self-check`): `docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`tools/tests/owner-workflow-acceptance.test.mjs` — both listed verbatim in the task's own
`allowed_paths`; neither matches `forbidden_paths`. `classifyScopeFinding` is not needed
for either path — both are exact `allowed_paths` entries, `compliant` by construction. No
scope exception required. `specs/index.generated.json` (consequential path) was
regenerated as part of this diff and `node tools/specs.mjs check`/`node tools/docs.mjs
check` both confirm every generated index is current.

## Verification

- `node --test tools/tests/owner-workflow-acceptance.test.mjs` — passed (20/20)
- `node --test tools/tests/*.test.mjs` — passed (826/826)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | Scenario 1 drives `handleStart` against a real fixture (`handleApprove` is not fixture-parameterized by task 20, so the pre-`start` half of the compound action is out of this task's own reach without touching production code or the real repo; the "no further ask" prompt behavior is independently covered by `compound-actions.test.mjs`'s template-shape assertions). |
| 2, 3, 6, 7 | Not met as required | Bare single-function calls duplicating sibling coverage — see F1. |
| 4 | Met | `validatePerTaskReviewRecord` plus an explicit field-shape assertion — genuinely a completeness check, not duplicated elsewhere in this shape. |
| 5, 9, 10, 12 | Not met as required | Bare single-function calls duplicating sibling coverage — see F1. |
| 8 | Partially met | The bare-function half is duplicate coverage (F1); the fixture half doesn't exercise the second task's edit (F3). |
| 11 | Partially met | First test duplicates sibling coverage (F1); second test (`handleApplyProvenance` guard) is a genuine, non-duplicated command-level check. |
| 13 | Not met | Vacuous test — see F2. |
| 14 | Met | Explicitly scoped by the task itself as regression-only coverage over the already-shipped `validateAggregateAgainstCanonicalReviews`; not subject to the "full command turn" constraint the same way the other fourteen scenarios are. |
| 15 | Met | Composite scenario drives two real `handleStart` calls against a fixture, then `buildConsolidatedDecisionStage`, and asserts the eligible set — genuine composition. |
| 16 | Met | Every fixture's `root` is confirmed to be a `nevo-fixture-repo-*` temp directory. |
| 17, 18 | Met | See Verification above. |

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` gained the "Owner-workflow
acceptance scenarios (D34, D35)" subsection (items 68-69); the "Context" narrative
paragraph names the twenty-first, final task alongside 14-20 and the original 01-13, as
required. No production code changed (task is test-only, matching its own
`forbidden_paths`).

## Tests

`tools/tests/owner-workflow-acceptance.test.mjs` (new, 16 `describe` blocks, 20 tests)
covers all fifteen named scenarios plus AC16's real-repository guard, built on task 20's
`createFixtureRepo`. Confirmed no writes into the real repository's own `specs/`/`docs/`
trees during the run. See Findings for depth/correctness gaps against the task's own
stated testing-depth bar (F1) and one vacuous scenario (F2).
