---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: owner-workflow-acceptance-scenarios
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/owner-workflow-acceptance-scenarios

Baseline: `reviews/owner-workflow-acceptance-scenarios.md` (2026-08-08, `changes-required`,
F1 resolved/F2/F3) was read in full before being overwritten. Re-review against current
file contents.

## Verdict

`pass` — D38's rewrite genuinely landed (F1, already resolved as of the prior pass), and
Scenario 13's tautology (F2) is now fixed: it drives a real, second fixture task through
`handleStart`+`f.commitFile`+`handleSelfCheck`, genuinely advancing `HEAD` and giving that
task real `self_check`/`implementation` fields, then proves the first task's own
fingerprint is unaffected. All 18 acceptance criteria covered, full verification suite
passes, zero unresolved blocking findings or owner decisions. F3 (`NON_BLOCKING`,
unchanged) keeps this report in the expanded shape rather than the fully compact 3-row
form.

## Checklist

Computed by `computeTaskReviewChecklist` (verified against the real function).

```
- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | resolved | `owner-decisions.md` D38 required the flagged scenarios (2, 3, 5, 6, 7, 9, 10, 11, 12) to be rewritten as real command-turn-level tests. | *(resolved — not an active finding)* Every named scenario now derives its inputs from real fixture/handler state: Scenario 2/3 — `scopeStatus`/`verificationPassed` from a real `handleStart`+`f.commitFile`+`handleSelfCheck` fixture run, through `resolveScopeCheckPaths`/`classifyScopeFinding` against the real attributed paths (`docsConsistent: false` in Scenario 3 is the one legitimately hand-given input, per D38's own scope). Scenario 5 — `t2`'s `pendingScopeDecisions` path/classification and `t4`'s `pendingOwnerDecisions` summary both come from a real out-of-scope `commitFile` plus a real `detectProvenanceOverlap` call, not literal placeholder strings. Scenarios 6/7 — the file-overlap pair passed into `selectSemanticIntegrationPairs` is `findings.map(f => f.tasks)` from a real `attributeTouchedPaths`/`detectBatchIntegrationFindings` call over an actual two-task fixture commit (via `getChangedFiles(f.root, startRevision)`), not `[['a','b']]`. Scenario 9 — all three fingerprints are real `computeTaskFingerprint(change, id)` calls against one real fixture-loaded change, not `'fp1'`/`'fp2'`/`'fp3'`. Scenario 10 — each graph is loaded via `loadChange('aw-s10', f.activeDir)` against a real fixture `change.yaml`, not an inline JS object literal. Scenario 11 (first test) — `classifyUnownedDrift`'s `taskPaths` argument is built from `buildContextPacket(change, t)` over a real fixture change's own tasks, not a hand-typed literal. Scenario 12 — `task_fingerprint` is a real `computeTaskFingerprint` result, and a real `appendFileSync` amendment to the fixture task file followed by a second `computeTaskFingerprint` call proves the drift genuinely invalidates the exception (`assert.notEqual`, then `isScopeExceptionValid(...) === false`). Verified against the diff line-by-line (not by trusting names alone) and confirmed by running `node --test tools/tests/owner-workflow-acceptance.test.mjs` — 20/20 pass, ~15s wall time, consistent with real fixture git operations rather than a vacuously-true shortcut. | `tools/tests/owner-workflow-acceptance.test.mjs` |
| F2 | AUTO_FIX | resolved | AC13 / area requirement 13: "Global HEAD advancement does not stale earlier evidence — a full sequential batch/multi-task run where `HEAD` advances after each task, asserting an earlier task's own evidence ... is never reported stale purely because `HEAD` moved." | Resolved this run. Scenario 13's test now adds a second task (`t2`), captures the fixture's revision before and after driving `t2` through a real `handleStart` + `f.commitFile` + `handleSelfCheck`, and asserts (`assert.notEqual`) that the revision genuinely changed and that `t2` gained real `self_check.status === 'passed'` and non-empty `implementation.changed_paths` — then confirms `t1`'s own `computeTaskFingerprint`/`computeChangeFingerprint` are unaffected. No longer a same-state tautology. | Read `tools/tests/owner-workflow-acceptance.test.mjs`'s current Scenario 13 block in full this run; re-ran `node --test tools/tests/owner-workflow-acceptance.test.mjs` — 20/20 pass | `tools/tests/owner-workflow-acceptance.test.mjs` |
| F3 | NON_BLOCKING | still-present | Area requirement 8: "a full, sequential two-task run against the same file, asserting each task's own `implementation.changed_paths`/fingerprint stays independently correct after the second task's edit." | Scenario 8's second (fixture-backed) test (current lines 328-339) is unchanged: it only calls `handleStart` on task `ta`; task `tb` is declared but never started or edited, so the fixture half still does not demonstrate "after the second task's edit." | `tools/tests/owner-workflow-acceptance.test.mjs:328-339` |

## Scope compliance

Diff attributable to this task touches exactly `tools/tests/owner-workflow-acceptance.test.mjs`
and `docs/decisions/ADR-0006-process-continuity-and-hardening.md` — both listed verbatim
in the task's own `allowed_paths`, matching `implementation.changed_paths` exactly.
`classifyScopeFinding` is not needed; both are exact `allowed_paths` entries, `compliant`
by construction. The shared working tree also carries uncommitted changes to files
outside this task's scope (`.claude/commands/nevo-ai/task-review.md`, `tools/specs.mjs`,
`tools/specs/lifecycle.mjs`, `follow-ups.yaml`, `owner-decisions.md`,
`tasks/19-...md`, `tasks/20-...md`, `tools/tests/fixture-repo.test-helper.mjs`,
`tools/tests/handler-testability.test.mjs`, `tools/tests/provenance.test.mjs`,
`tools/tests/unowned-drift.test.mjs`, `reviews/implementation-review-14-21.md`) — none of
these are attributed to this task; they belong to sibling tasks (15, 19, 20) in this same
`--tasks 14-21` orchestration and are reviewed under their own task IDs, not here. No
scope exception required for this task.

## Verification

- `node --test tools/tests/owner-workflow-acceptance.test.mjs` — passed (20/20)
- `node --test tools/tests/*.test.mjs` — passed (851/851)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | Scenario 1 — genuine `handleStart` fixture run. |
| 2 | Met | Scenario 2, first test — real `handleStart`+`handleSelfCheck` fixture composition; see F1 (resolved). |
| 3 | Met | Scenario 3 — real fixture-derived scope/verification, one deliberate failure isolated. |
| 4 | Met | Scenario 4 — correctly left as record-shape validation (no more "real" form exists). |
| 5 | Met | Scenario 5 — real out-of-scope touch plus real provenance overlap, one consolidated stage. |
| 6 | Met | Scenario 6 — real fixture diff drives file-overlap pair selection. |
| 7 | Met | Scenario 7 — real fixture diff; selection carries no verdict/classification field. |
| 8 | Partially met | First (pure-function) test is genuine; second (fixture) test still doesn't exercise `tb`'s own edit — F3, non-blocking. |
| 9 | Met | Scenario 9 — real fingerprints from one real fixture-loaded change. |
| 10 | Met | Scenario 10 — real `loadChange` per fixture graph, not inline objects. |
| 11 | Met | Scenario 11 — real `buildContextPacket`-derived `taskPaths`; second test (apply-provenance guard) unchanged and already genuine. |
| 12 | Met | Scenario 12 — real fingerprint plus a real fixture-file amendment proving drift invalidates the exception. |
| 13 | Met | Scenario 13 now genuinely drives HEAD advancement via a real second task; see F2 (resolved). |
| 14 | Met | Unchanged; explicitly scoped as regression-only, correctly left calling the subject function directly. |
| 15 | Met | Unchanged; genuine composition against a fixture. |
| 16 | Met | Unchanged; every fixture confirmed a `nevo-fixture-repo-*` temp directory. |
| 17, 18 | Met | See Verification above. |

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` gained item 70a in this
working tree, documenting this task's own corrective pass (D38): it accurately states
"every flagged scenario now derives its inputs from a real fixture ... rather than a
hand-built object standing in for what a real handler chain would have produced," which
this review independently confirmed line-by-line. Items 47a/64a/67a in the same diff
belong to sibling tasks 15/19/20 in this shared working tree — consistent with their own
scope, not this task's, and not contradicting this task's own constraint text. No
production code changed (task remains test-only, matching `forbidden_paths`).

## Tests

`tools/tests/owner-workflow-acceptance.test.mjs` (16 `describe` blocks, 20 tests) covers
all fifteen named scenarios plus AC16's real-repository guard. Scenarios 2 (first test),
3, 5, 6, 7, 9, 10, 11 (first test), 12, and (this round) 13 all genuinely compose real
fixture/handler state instead of hand-typed stand-ins — D38 fully carried out, plus the
separate, pre-existing Scenario 13 tautology closed. Scenario 8's second test (F3) still
doesn't exercise the second task's own edit — the sole remaining, non-blocking gap.
