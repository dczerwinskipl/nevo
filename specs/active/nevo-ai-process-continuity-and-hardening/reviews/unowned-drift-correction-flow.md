---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: unowned-drift-correction-flow
generated: 2026-08-07
verdict: changes-required
unresolved_required_fixes: 2
unresolved_owner_decisions: 0
unresolved_needs_clarification: 1
---

# Review: nevo-ai-process-continuity-and-hardening/unowned-drift-correction-flow

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — two unresolved `AUTO_FIX` findings (F1, F3) and one unresolved
`NEEDS_CLARIFICATION` finding (F2); scope, tests, and the rest of the checklist resolve
clean.

## Checklist

Computed by `computeTaskReviewChecklist` (verified against the real function, not
composed by hand).

```
- [ ] All acceptance criteria covered
  - AC4: not met as tagged — see F1
  - AC5: questionable as literally written — see F2
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [ ] Architecture and documentation remain consistent
  - docs/ai/specification-workflow.md not updated — see F3
- [ ] No unresolved blocking findings
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | AC4 ("A `spec-audit`/`task-review` run whose scope includes a path with a recorded maintenance-correction entry names that entry explicitly...") is tagged `(automated)` | No automated test verifies `spec-audit.md`/`task-review.md`'s actual prose contains the unowned-drift wiring text added by this diff. `tools/tests/unowned-drift.test.mjs` (the task's only new test file) covers only the three pure functions (`classifyUnownedDrift`, `UNOWNED_DRIFT_OPTIONS`, `validateMaintenanceCorrectionEntry`) — it never reads either command file's content. This repository has an established pattern for exactly this kind of "(automated)" wiring criterion — a template-shape regression test reading the command file's current wording and asserting against it (`tools/tests/compound-actions.test.mjs`'s own header: "these are template-shape regression tests over its actual current wording, the same technique task 13's own `review-compaction.test.mjs` already uses") — not followed here. Per `references/review-policy.md` § "Gating versus non-gating checks": "whether an explicitly required automated test is missing (always `AUTO_FIX`-blocking, independent of AC coverage — a passing verification command alone never counts as coverage for a scenario the tests don't actually exercise)." Smallest valid resolution: add a describe block to `tools/tests/unowned-drift.test.mjs` reading `spec-audit.md`/`task-review.md`'s content and asserting the "handled via unowned-drift correction" wiring text is present, mirroring `compound-actions.test.mjs`'s technique. | `grep -rn "maintenance-correction" tools/tests/` this run — only `owner-workflow-acceptance.test.mjs` (task 21, also function-level only) and `unowned-drift.test.mjs` itself match; neither reads a command `.md` file. Confirmed by reading `tools/tests/unowned-drift.test.mjs` in full (133 lines) — no `readFileSync` of either command file. | `tools/tests/unowned-drift.test.mjs` |
| F2 | NEEDS_CLARIFICATION | first-review | AC5: "Both FU-006 incidents (the `git-workflow.md` edit, the `task-review.md` consequential-paths gap), reconstructed as fixtures, classify `unowned-drift` and route through this flow (automated)." | Not met as literally written for the `git-workflow.md` incident. Per AC2/requirement 5's own hard rule ("a `forbidden_paths` path returns a distinct... result, never `unowned-drift`"), and confirmed by the task's own test, `docs/development/git-workflow.md` classifies `forbidden` — not `unowned-drift` — because `docs/development/**` is already on every task's `forbidden_paths` (`areas/unowned-drift-correction.md`'s own "Current state": "every task's `forbidden_paths` excludes `docs/development/**`"). The implementation's behavior is correct and internally consistent (forbidden must win over unowned-drift, per AC2) — but AC5's literal text asserts the opposite outcome for this fixture. The test itself is transparent about this (its own comment explains the discrepancy) but its *title* still reads "classifies unowned-drift" while its assertion checks `'forbidden'` (`tools/tests/unowned-drift.test.mjs:114-118`), which is misleading on a second read. Owner needs to confirm whether AC5's wording in `tasks/19-unowned-drift-correction-flow.md` should be corrected (e.g. "one incident classifies `forbidden`, the other `unowned-drift`; both are correctly handled by this flow") — a task-file text edit outside this diff's own scope to make unilaterally. Also note: AC6 ("`follow-ups.yaml`'s FU-006 entry is updated to `status: resolved`... only after AC1-AC5 pass") was applied before this discrepancy was caught. | Read `tasks/19-unowned-drift-correction-flow.md` AC2/AC5 and `areas/unowned-drift-correction.md`'s "Current state" this run; ran `node --test tools/tests/unowned-drift.test.mjs` this run — all 16 tests pass, including the git-workflow.md case, which asserts `'forbidden'` under a test titled "...classifies unowned-drift" | `tasks/19-unowned-drift-correction-flow.md`, `tools/tests/unowned-drift.test.mjs:114` |
| F3 | AUTO_FIX | first-review | `docs/ai/specification-workflow.md` — the vendor-neutral doc `CLAUDE.md` names as the source the Claude-specific skill/commands mirror — describes the review/audit scope-check flow this task's diff changes | This task's diff adds unowned-drift visibility wiring to `.claude/commands/nevo-ai/spec-audit.md` (step 4: name a matching `kind: maintenance-correction` entry explicitly) and `.claude/commands/nevo-ai/task-review.md` (step 4: same), plus the full "Unowned-drift correction" classification/menu/record section to `references/review-policy.md`. None of it is mirrored into `docs/ai/specification-workflow.md`: zero matches for "unowned-drift", "maintenance-correction", or "classifyUnownedDrift" anywhere in the file. Same gap independently found by three sibling reviews on this same branch against this same file (`review-report-minimization`, `scoped-and-incremental-spec-review`, `compound-actions-and-dependency-aware-status`) — this file is not in this task's own `allowed_paths` either, so a direct fix needs a scope note (an accepted exception, attribution to a remaining task, or its own unowned-drift correction — fittingly, this exact gap is itself an instance of the process this task just built: outside every declared task's `allowed_paths`/`consequential_paths`, not touched by this diff, not `forbidden_paths`-matched). Smallest valid resolution: mirror a short "Unowned-drift correction" paragraph into the doc's "Review artifacts and handoff" section (near "Compact, exception-oriented reports and owner-approved scope exceptions (D31)", ¶858), naming the classification/menu/record shape. | `grep -n "unowned-drift\|maintenance-correction\|classifyUnownedDrift" docs/ai/specification-workflow.md` this run — no match | `docs/ai/specification-workflow.md` |

## Scope compliance

This task's own persisted `implementation.changed_paths` (`change.yaml`, task 15's
provenance mechanism) lists exactly: `.claude/commands/nevo-ai/spec-audit.md`,
`.claude/commands/nevo-ai/task-review.md`,
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs/lifecycle.mjs`, `tools/tests/unowned-drift.test.mjs` — every one is inside
this task's own `allowed_paths`; all `compliant`, `classifyScopeFinding` not needed. No
`consequential_paths` were touched. No `forbidden_paths` entry (`src/**`, `tests/**`,
`examples/**`, `docs/development/**`, `docs/usage/**`, `docs/reference/**`,
`specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was touched. `tools/specs/lifecycle.mjs`,
`references/review-policy.md`, `.claude/commands/nevo-ai/task-review.md`, and
`docs/decisions/ADR-0006-...md` are shared with several sibling tasks (14/16/17/18) also
in flight on this branch — the diff against each contains other tasks' own additions
(`renderNormalPassingReportBody`, `selectSemanticIntegrationPairs`,
`resolveSpecReviewScope`, `deriveStage` dependency-gating, etc.); this task's own portion
is exactly `classifyUnownedDrift`/`UNOWNED_DRIFT_OPTIONS`/`validateMaintenanceCorrectionEntry`
in `lifecycle.mjs`, the "Unowned-drift correction" section in `review-policy.md`, the
step-4 wiring sentence in each command file, and the "Formal unowned-drift correction
flow (D34, D35)" subsection in the ADR.

## Verification

- `node --test tools/tests/unowned-drift.test.mjs` — passed (16/16 tests, 4 suites)
- `node --test tools/tests/*.test.mjs` — passed (826/826 tests, 166 suites)
- `node tools/specs.mjs validate` — passed ("Validated 6 changes — no errors.")
- `node tools/specs.mjs check` — passed ("Specs valid and indexes are current.") — non-gating, informational
- `node tools/docs.mjs validate` — passed ("Validated 60 documents — no errors.")
- `node tools/docs.mjs check` — passed ("Indexes are current.") — non-gating, informational

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| AC1 | Met | `classifyUnownedDrift` returns `unowned-drift` for an out-of-scope, non-forbidden, non-current-task path — `tools/tests/unowned-drift.test.mjs` describe block, 6 tests |
| AC2 | Met | `forbidden_paths`-matched path never classifies `unowned-drift`, wins even over current-task attribution — 2 dedicated tests |
| AC3 | Met | `validateMaintenanceCorrectionEntry` rejects a missing `paths`/`reason`/`confirmed_by`/`confirmed_at`/`revision`, and a glob in `paths` — 6 tests |
| AC4 | Not met as tagged | Wiring is present in both command files (confirmed by reading the diff) but no automated test exercises it — see F1 |
| AC5 | Questionable as written | Test passes, but asserts a result contradicting the literal AC text for one of the two fixtures — see F2 |
| AC6 | Met (inspection) | `follow-ups.yaml` FU-006 carries `status: resolved` with a resolution naming task 19, `classifyUnownedDrift`, `validateMaintenanceCorrectionEntry`, and the test file |
| AC7 | Met | `validate`/`check` clean, both tools, this run |
| AC8 | Met | Full suite 826/826, this run |

## Architecture and documentation

`docs/development/` does not describe this behavior, so no drift against it.
`docs/decisions/ADR-0006-...md` gains a correctly-worded "Formal unowned-drift
correction flow (D34, D35)" subsection (items 61-64) and names task 19 in its "Context"
narrative, satisfying the task's own documentation-impact list.
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` gains the full
"Unowned-drift correction" section (classification table, owner menu, record schema,
visibility rule) — matches `areas/unowned-drift-correction.md` requirement-for-requirement.
`docs/ai/specification-workflow.md`, the canonical vendor-neutral doc `CLAUDE.md` names
as the source of truth the Claude-specific skill mirrors, was not updated and does not
reflect this task's new flow at all (F3) — the same situation already found on this
branch against `review-report-minimization`, `scoped-and-incremental-spec-review`, and
`compound-actions-and-dependency-aware-status`.

## Tests

`tools/tests/unowned-drift.test.mjs` (16 tests, 4 describe blocks) directly exercises
AC1, AC2, AC3, and AC5 (with the AC5 caveat in F2). AC4's wiring is not exercised by any
automated test (F1) — confirmed correct only by reading the diff, which the review
policy explicitly does not treat as equivalent to required automated coverage.
