---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: scoped-and-incremental-spec-review
generated: 2026-08-07
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/scoped-and-incremental-spec-review

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — one unresolved `AUTO_FIX` documentation-consistency finding (F1);
every other checklist item resolves clean.

## Checklist

Computed by `computeTaskReviewChecklist` (verified with the real function, not composed
by hand).

```
- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [ ] Architecture and documentation remain consistent
  - Architecture/documentation is not consistent with the change.
- [x] No unresolved blocking findings
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | `docs/ai/specification-workflow.md` — the vendor-neutral doc `CLAUDE.md` names as the source the Claude-specific skill/commands mirror — describes `/nevo-ai:spec-review`'s current behavior, including its verdict decision table | This task adds a whole new capability (`--all`/`--changed`/`--tasks`, `resolveSpecReviewScope`/`selectChangedTaskIds`/`scopedReviewBaselineValid`/`findPotentiallyImpactedOutOfScopeTasks`) and a new row-4/5 guard on the verdict table (`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` § "Spec-review verdicts are derived, never chosen narratively" → "Rows 4-5 for a scoped run"), but `docs/ai/specification-workflow.md` has zero mentions of `--changed`/`--tasks`/`task_fingerprints`/`scopedReviewBaselineValid`/"potentially impacted" anywhere (repo-wide grep, this run). Its own "A review's verdict is derived from a table" section (lines 646-652) still states the unqualified five-row table with no scoped-run caveat, and the doc has no new subsection comparable to "Change-wide audits are a third, distinct review shape" (772) or "Multi-task implementation review orchestration is a fifth, distinct review shape" (805) for this new, comparably significant review shape. Same pattern as `review-report-minimization`'s own F2 finding against this same file, on this same branch. Smallest valid resolution: add a short subsection (and the scoped-verdict-guard caveat to the existing table) describing `--all`/`--changed`/`--tasks`; note this file is not in this task's own `allowed_paths`, so fixing it needs a small scope note (an accepted exception, or attribution to whichever remaining task's scope can reach it). | `grep -n "spec-review\|--all\|--changed\|--tasks\|scoped\|task_fingerprints" docs/ai/specification-workflow.md` this run — no match for the new capability; read lines 638-717 (verdict table + freshness sections) and 772/805/858 (existing per-shape subsections) this run | `docs/ai/specification-workflow.md` |
| F2 | NON_BLOCKING | first-review | AC1 ("no flag behaves identically to today's full review"), AC4 ("reading an older task's file for context... does not alter that task's `task_fingerprints` entry, verdict, or status"), and the second half of AC7 ("`--all`'s existing report shape is byte-for-byte unchanged") are each tagged `(automated)` | `tools/tests/scoped-spec-review.test.mjs` (20 tests) exercises every pure function (`resolveSpecReviewScope`, `selectChangedTaskIds`, `findPotentiallyImpactedOutOfScopeTasks`, `scopedReviewBaselineValid`, `renderScopedSpecReviewBody`) directly, and `owner-workflow-acceptance.test.mjs` Scenario 9 covers `--changed` excluding old tasks — but no test exercises "no flag" argument parsing (a `spec-review.md` prompt-level default, not code), the literal no-mutation guarantee for a context-read of an out-of-scope task, or a byte-for-byte diff of `--all`'s rendered report against a fixture. These three guarantees rest on `spec-review.md`'s own explicit prose (step 0/3's context-vs-review-scope boundary, "`--all`'s own report shape is unchanged") and the structural fact that no code path writes `task_fingerprints` for a task outside the resolved scope — real assurance, but not literally the dedicated regression test the `(automated)` tag implies. | Read `tools/tests/scoped-spec-review.test.mjs` (full file) and `tools/tests/owner-workflow-acceptance.test.mjs` lines 180-196, this run | `tools/tests/scoped-spec-review.test.mjs` |

## Scope compliance

This task's own persisted `implementation.changed_paths` (`change.yaml`, task 15's
provenance mechanism, authoritative per `references/context-policy.md`'s new
"Attributed changed paths take priority over pattern matching" rule) lists exactly:
`.claude/commands/nevo-ai/spec-review.md`,
`.claude/skills/nevo-ai-spec-workflow/references/context-policy.md`,
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`tools/specs/lifecycle.mjs`, `tools/tests/scoped-spec-review.test.mjs` — every one is
inside this task's own `allowed_paths`; all `compliant`, `classifyScopeFinding` not
needed. `specs/index.generated.json` (a declared `consequential_path`) also changed,
via `node tools/specs.mjs generate` (confirmed clean by `specs.mjs check` below); the
other three declared `consequential_paths` are unchanged (not needed by this diff). No
`forbidden_paths` entry (`src/**`, `tests/**`, `examples/**`, `docs/development/**`,
`docs/usage/**`, `docs/reference/**`, `specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was
touched.

## Verification

- `node --test tools/tests/scoped-spec-review.test.mjs` — passed (20/20)
- `node --test tools/tests/*.test.mjs` — passed (826/826, 166 suites)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered (see F2 for a test-rigor caveat on AC1/AC4/AC7
  that does not rise to a coverage gap)

AC2/AC3/AC5/AC6/AC7 (first half) are each directly exercised by
`tools/tests/scoped-spec-review.test.mjs`'s describe blocks; AC2 additionally confirmed
by inspection — `resolveSpecReviewScope` calls the same `parseTaskOrderSpec` task 12's
own `resolveReviewScope` already uses, not a second parser. AC8/AC9 confirmed by the
verification commands above.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` gains a correctly-worded
"Scoped and incremental spec-review (D34, D35)" subsection (items 53-57) and names task
17 in its "Context" narrative, alongside tasks 01-16, per this task's own documentation
impact list — no mismatch there.
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` correctly gains the
"Rows 4-5 for a scoped run" caveat on the existing decision table. `docs/ai/specification-workflow.md`
— the canonical vendor-neutral doc — was not updated and does not reflect this task's
new capability at all (F1); a real documentation-consistency gap even though this
task's own "Documentation impact" list didn't name this file (same situation task 14's
own F2 finding already established on this branch).

## Tests

`tools/tests/scoped-spec-review.test.mjs` (20 tests, 5 describe blocks) directly
exercises `resolveSpecReviewScope` (AC1/AC2), `selectChangedTaskIds` (AC3),
`findPotentiallyImpactedOutOfScopeTasks` (AC5), `scopedReviewBaselineValid` (AC6), and
`renderScopedSpecReviewBody` (AC7). See F2 for the narrower gap between the `(automated)`
tag on AC1/AC4/AC7 and what a dedicated test literally exercises versus what rests on
`spec-review.md`'s own prose and structural guarantees.
