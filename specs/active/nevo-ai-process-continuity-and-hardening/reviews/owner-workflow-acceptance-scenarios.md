---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: owner-workflow-acceptance-scenarios
generated: 2026-08-08
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 1
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/owner-workflow-acceptance-scenarios

Baseline: `reviews/owner-workflow-acceptance-scenarios.md` (2026-08-07, `changes-required`,
F1/F2/F3) was read in full before being overwritten. Re-review against current file
contents.

## Verdict

`changes-required` — verification still passes and scope is still compliant, but D38
(owner-decisions.md) required the flagged scenarios to be rewritten as real
command-turn-level tests; only Scenario 2 was touched, and its rewrite is still a bare
function-level call, so F1 stays substantively unresolved. F2 (Scenario 13's tautology)
is completely untouched.

## Checklist

- [ ] All acceptance criteria covered
  - Not every acceptance criterion is met, partially met, tested, or unquestionable. (F1)
  - An explicitly required automated test is missing — a passing verification command
    alone does not cover it. (F2)
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [ ] No unresolved blocking findings
  - 2 unresolved blocking finding(s) remain (F1, F2).
- [ ] No unresolved owner decision
  - 1 unresolved owner decision(s) remain (F1).

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | still-present | Task's "Implementation constraints": "a scenario that only calls an internal function directly does not satisfy this task's own acceptance criteria." `owner-decisions.md` D38 decided (option A) to rewrite the flagged scenarios as real command-turn-level tests, explicitly rejecting option B (relaxing the constraint), and states F1 "stays an open, unresolved `OWNER_DECISION` finding ... until a corrective task ... rewrites the flagged scenarios ... to drive real command-turn-level flows rather than calling `tools/specs/lifecycle.mjs` functions directly." | The diff since the baseline review touches exactly one scenario in this file: Scenario 2 (lines 76-104), which gained a second, more precise assertion but is still two bare calls — `computeTaskReviewChecklist(passingChecklistInput())` then `renderNormalPassingReportBody(result, {...})` — with no composed command-turn flow. This is the same abstraction level flagged originally, and it now duplicates `tools/tests/review-compaction.test.mjs`'s own `describe('renderNormalPassingReportBody ...')` block even more closely (that file gained a near-verbatim "none of the four internal-only gates ... renders as its own row" test in the same diff). Scenarios 3 (108-119), 5 (137-149), 6 (153-158), 7 (162-170), 9 (202-216), 10 (220-237), 11's first test (241-252), and 12 (261-268) are byte-for-byte unchanged from the baseline — still single bare calls to `renderCompactReviewChecklist`/`buildConsolidatedDecisionStage`/`selectSemanticIntegrationPairs`/`selectChangedTaskIds`+`resolveSpecReviewScope`+`scopedReviewBaselineValid`/`deriveStage`+`depsSatisfied`/`classifyUnownedDrift`+`validateMaintenanceCorrectionEntry`/`isScopeExceptionValid`+`classifyScopeFinding`, respectively. D38's decision (rewrite to command-turn-level) has not been carried out for any of these; the task's own "Implementation constraints" text is also unchanged (still forbids this pattern), so the diff does not even take option B. Unlike the baseline run, this is now a direct contradiction of a recorded owner decision (D38), not merely the task's own stated constraint — the corrective work D38 called for has not landed in this task's own scope. | `tools/tests/owner-workflow-acceptance.test.mjs` (Scenarios 3, 5, 6, 7, 9, 10, 11-first-test, 12 unchanged; Scenario 2 rewritten but still function-level) |
| F2 | AUTO_FIX | still-present | AC13 / area requirement 13: "Global HEAD advancement does not stale earlier evidence — a full sequential batch/multi-task run where `HEAD` advances after each task, asserting an earlier task's own evidence ... is never reported stale purely because `HEAD` moved." | Scenario 13's test (current lines 272-285) is byte-for-byte unchanged from the baseline: it still calls `loadChange('aw-s13', ...)` a second time against completely unmodified fixture state (no commit, no second task write, no field mutation between the two loads) and asserts `computeTaskFingerprint`/`computeChangeFingerprint` equal their own prior values. This remains a tautology (`x === x`) providing zero coverage of HEAD actually advancing or another task's evidence changing. | `tools/tests/owner-workflow-acceptance.test.mjs:272-285` |
| F3 | NON_BLOCKING | still-present | Area requirement 8: "a full, sequential two-task run against the same file, asserting each task's own `implementation.changed_paths`/fingerprint stays independently correct after the second task's edit." | Scenario 8's second (fixture-backed) test (current lines 186-197) is unchanged: it only calls `handleStart` on task `ta`; task `tb` is declared but never started or edited, so the fixture half still does not demonstrate "after the second task's edit." | `tools/tests/owner-workflow-acceptance.test.mjs:186-197` |

## Scope compliance

Diff touches exactly `tools/tests/owner-workflow-acceptance.test.mjs` and
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` — both listed verbatim in
the task's own `allowed_paths`; `classifyScopeFinding` is not needed, both are exact
`allowed_paths` entries, `compliant` by construction. No scope exception required.
`specs/index.generated.json`/`docs/index.generated.json`/`docs/index.generated.md`
(consequential paths) are current per `check` below (regenerated by other in-scope work
in this same working tree, not this task's own diff).

## Verification

- `node --test tools/tests/owner-workflow-acceptance.test.mjs` — passed (21/21)
- `node --test tools/tests/*.test.mjs` — passed (840/840)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | Scenario 1 unchanged — drives `handleStart` against a real fixture. |
| 2 | Not met as required | Scenario 2 rewritten with tighter assertions but still a bare two-function call — see F1. |
| 3, 6, 7 | Not met as required | Byte-for-byte unchanged bare single-function calls — see F1. |
| 4 | Met | Unchanged; genuinely a completeness check, not duplicated elsewhere. |
| 5, 9, 10, 12 | Not met as required | Byte-for-byte unchanged bare single-function calls — see F1. |
| 8 | Partially met | Bare-function half is duplicate coverage (F1); fixture half doesn't exercise the second task's edit (F3), both unchanged. |
| 11 | Partially met | First test duplicates sibling coverage (F1), unchanged; second test (`handleApplyProvenance` guard) remains genuine. |
| 13 | Not met | Vacuous test, unchanged — see F2. |
| 14 | Met | Unchanged; explicitly scoped as regression-only. |
| 15 | Met | Unchanged; genuine composition against a fixture. |
| 16 | Met | Unchanged; every fixture confirmed a `nevo-fixture-repo-*` temp directory. |
| 17, 18 | Met | See Verification above. |

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` was updated in this working
tree, but the portion attributable to this task (Context narrative, task list) is
consistent with the task file. The bulk of the ADR diff documents sibling tasks' own
corrective work (report minimization's 4-line shape, provenance fingerprint fix, scope
amendment, task-execution-policy reconciliation) — none of it relaxes or contradicts this
task's own constraint text, and it does not itself resolve F1/F2. No production code
changed (task remains test-only, matching `forbidden_paths`).

## Tests

`tools/tests/owner-workflow-acceptance.test.mjs` (16 `describe` blocks, 21 tests) still
covers all fifteen named scenarios plus AC16's real-repository guard. The working-tree
diff since the baseline review touches only Scenario 2 (tightened assertions, still
function-level) — it does not carry out D38's rewrite of the ~8 remaining flagged
scenarios (F1), and does not touch Scenario 13 at all (F2 unresolved).
