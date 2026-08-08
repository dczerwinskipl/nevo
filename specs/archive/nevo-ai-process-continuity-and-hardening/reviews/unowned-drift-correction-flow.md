---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: unowned-drift-correction-flow
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/unowned-drift-correction-flow

Baseline read in full from `reviews/unowned-drift-correction-flow.md` (generated
2026-08-08, itself re-verifying a 2026-08-07 baseline) before this run overwrote it, per
`references/review-policy.md` § "Re-review: current file contents are the source of
truth, not git status or memory." Since that baseline was written, this task's own scope
gained new uncommitted work on top of commit `8806937` (owner-decisions.md D37/D40's
corrective pass): AC9/`resolveScopeCheckPaths` was added and wired into
`task-review.md` step 4, AC5's wording (and the test's own describe-block title) was
corrected per D40, and F1's wiring-verification test gap was closed. All three baseline
findings were re-verified against this new content, not against memory.

## Verdict

`pass` — all three findings are now resolved. F1 and F2 as of this round's earlier fix;
F3 resolved via this task's own named unowned-drift maintenance-correction process
(`follow-ups.yaml` FU-016, `source_task: unowned-drift-correction-flow` — this task's own
mechanism, applied to the exact class of gap it exists to name).

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
| F1 | AUTO_FIX | resolved | AC4 ("A `spec-audit`/`task-review` run whose scope includes a path with a recorded maintenance-correction entry names that entry explicitly...") is tagged `(automated)` | Resolved this run. `tools/tests/unowned-drift.test.mjs` gained a new describe block reading both command files' actual content via `readFileSync` and asserting the wiring text is present (`handled via unowned-drift`/`area unowned-drift-correction` in `spec-audit.md`; `kind: maintenance-correction`/`area unowned-drift-correction`/`never re-flagged as an unexplained anomaly` in `task-review.md`) — same template-shape-regression technique task 18's `compound-actions.test.mjs` already established for `spec-approve.md`. | Read `tools/tests/unowned-drift.test.mjs`'s new describe block this run; re-ran `node --test tools/tests/unowned-drift.test.mjs` — 22/22 pass (up from 20) | `tools/tests/unowned-drift.test.mjs` |
| F2 | NEEDS_CLARIFICATION | resolved | AC5's wording matched AC2's forbidden-priority rule for the `git-workflow.md` fixture, per D40's decision | Resolved this run. `tasks/19-unowned-drift-correction-flow.md` AC5 (read in full) now reads "the `git-workflow.md` edit classifies `forbidden` ... and the `task-review.md` consequential-paths gap classifies `unowned-drift`" — exactly D40's corrected wording, no longer contradicting AC2. `tools/tests/unowned-drift.test.mjs`'s describe-block title is also corrected: "route through this flow — one forbidden, one unowned-drift (AC5, corrected 2026-08-08 per D40 ...)", and its first test's own name now says "classifies forbidden ... not unowned-drift". | Read `tasks/19-...md` AC5 and the test file in full this run | `tasks/19-unowned-drift-correction-flow.md`, `tools/tests/unowned-drift.test.mjs` |
| F3 | AUTO_FIX | resolved | `docs/ai/specification-workflow.md` describes the review/audit scope-check flow this task's diff changes | Resolved 2026-08-08. This was **structurally out of this task's own reach** (`docs/ai/specification-workflow.md` is not in `unowned-drift-correction-flow`'s own `allowed_paths`) — exactly the unowned-drift shape this task's own mechanism exists to name. Routed through it: classified `unowned-drift`, owner chose option 3 (maintenance correction), recorded as `follow-ups.yaml` FU-016 (`kind: maintenance-correction`, `source_task: unowned-drift-correction-flow`, `paths: [docs/ai/specification-workflow.md]`). New "Unowned-drift correction — a real fix that no current task's scope covers" section added. | `grep -i "unowned-drift\|maintenance-correction" docs/ai/specification-workflow.md` this run — present; `follow-ups.yaml` FU-016 entry, `validateMaintenanceCorrectionEntry`-shaped, this run | `docs/ai/specification-workflow.md`, `follow-ups.yaml` FU-016 |

## Scope compliance

`git diff HEAD` (against baseline commit `8806937`) touches, among this task's own
`allowed_paths`: `.claude/commands/nevo-ai/task-review.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs/lifecycle.mjs`, `tools/tests/unowned-drift.test.mjs` — all `compliant`. It
also touches this task's own file (`tasks/19-unowned-drift-correction-flow.md`, the AC9
amendment) and `owner-decisions.md` (the D37/D40 decision records themselves, which
authorize AC9's amendment and record AC5's correction) — both are spec-level decision/
task-definition artifacts, not implementation scope, same treatment `change.yaml`
already gets; `classifyScopeFinding` does not apply to them. The rest of the working
tree's uncommitted changes (`tasks/20-...md`, `tools/specs.mjs`,
`tools/tests/fixture-repo.test-helper.mjs`, `tools/tests/handler-testability.test.mjs`,
`tools/tests/owner-workflow-acceptance.test.mjs`, `tools/tests/provenance.test.mjs`,
`reviews/implementation-review-14-21.md`) belong to sibling tasks (15, 20, 21) and this
orchestration's own aggregate report — none attributable to this task's own diff. No
`forbidden_paths` entry (`src/**`, `tests/**`, `examples/**`, `docs/development/**`,
`docs/usage/**`, `docs/reference/**`, `specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was
touched. Scope: `compliant`.

## Verification

- `node --test tools/tests/unowned-drift.test.mjs` — passed (22/22 tests, 6 suites), this run
- `node --test tools/tests/*.test.mjs` — passed (851/851 tests, 172 suites), this run
- `node tools/specs.mjs validate` — passed ("Validated 6 changes — no errors."), this run
- `node tools/specs.mjs check` — passed ("Specs valid and indexes are current."), this run — non-gating, informational
- `node tools/docs.mjs validate` — passed ("Validated 60 documents — no errors."), this run
- `node tools/docs.mjs check` — passed ("Indexes are current."), this run — non-gating, informational

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| AC1 | Met | `classifyUnownedDrift` returns `unowned-drift` for an out-of-scope, non-forbidden, non-current-task path — 6 tests, re-run this run |
| AC2 | Met | `forbidden_paths`-matched path never classifies `unowned-drift`, wins even over current-task attribution — 2 dedicated tests |
| AC3 | Met | `validateMaintenanceCorrectionEntry` rejects a missing `paths`/`reason`/`confirmed_by`/`confirmed_at`/`revision`, and a glob in `paths` — 6 tests |
| AC4 | Met | Resolved this run — wiring is present in both command files, now exercised by a dedicated `readFileSync`-based test — see F1 (resolved) |
| AC5 | Met | Corrected 2026-08-08 per D40 — wording and test describe-block title both now match AC2's forbidden-priority rule; test passes — see F2 (resolved) |
| AC6 | Met (inspection) | `follow-ups.yaml` FU-006 still carries `status: resolved` with a resolution naming task 19, unchanged this run |
| AC7 | Met | `validate`/`check` clean, both tools, this run |
| AC8 | Met | Full suite 851/851, this run |
| AC9 | Met | `resolveScopeCheckPaths(task, liveDiffPaths)` added to `tools/specs/lifecycle.mjs`, unions persisted `implementation.changed_paths` with the live diff, never replacing it — 4 dedicated tests; wired into `task-review.md` step 4 ("Compute the union via `resolveScopeCheckPaths(task, liveDiffPaths)` ... — never re-derived by hand"), confirmed by direct read this run |

## Architecture and documentation

`docs/development/` does not describe this behavior, so no drift against it.
`docs/decisions/ADR-0006-...md` gained new subsections 47a/64a this run (D37's corrective
pass — `detectProvenanceOverlap`/`resolveScopeCheckPaths` context), consistent with this
task's diff. `.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`'s
"Unowned-drift correction" section is unchanged this run (not touched by this task's
diff this round). `docs/ai/specification-workflow.md` now reflects this task's flow (F3,
resolved via FU-016's maintenance correction).

## Tests

`tools/tests/unowned-drift.test.mjs` (22 tests, 6 describe blocks) directly exercises
AC1, AC2, AC3, AC4, AC5, and AC9.
