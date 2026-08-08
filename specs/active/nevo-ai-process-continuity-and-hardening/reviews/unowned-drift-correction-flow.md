---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: unowned-drift-correction-flow
generated: 2026-08-08
verdict: changes-required
unresolved_required_fixes: 2
unresolved_owner_decisions: 0
unresolved_needs_clarification: 1
---

# Review: nevo-ai-process-continuity-and-hardening/unowned-drift-correction-flow

Baseline read in full from `reviews/unowned-drift-correction-flow.md` (generated
2026-08-07) before this run overwrote it, per `references/review-policy.md` §
"Re-review: current file contents are the source of truth, not git status or memory."
This task's own scope (`allowed_paths`, its `tasks/19-...md` file, and
`tools/tests/unowned-drift.test.mjs`) carries **zero diff** against the commit this
baseline was written against — confirmed by `git diff HEAD` returning empty for every
one of this task's `allowed_paths` entries and for the task file itself, and by
`change.yaml`'s `unowned-drift-correction-flow` entry also being unchanged. The
uncommitted working-tree changes present elsewhere in the repository belong to sibling
tasks (14, 15, 17, 18) also in flight on this branch — none touch this task's own scope.
All three baseline findings are therefore re-verified against the exact same content
they were originally raised against.

## Verdict

`changes-required` — two unresolved `AUTO_FIX` findings (F1, F3) and one unresolved
`NEEDS_CLARIFICATION` finding (F2), all unchanged since the baseline review; scope,
tests, and the rest of the checklist resolve clean.

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
| F1 | AUTO_FIX | still-present | AC4 ("A `spec-audit`/`task-review` run whose scope includes a path with a recorded maintenance-correction entry names that entry explicitly...") is tagged `(automated)` | No automated test verifies `spec-audit.md`/`task-review.md`'s actual prose contains the unowned-drift wiring text. `tools/tests/unowned-drift.test.mjs` still covers only the three pure functions (`classifyUnownedDrift`, `UNOWNED_DRIFT_OPTIONS`, `validateMaintenanceCorrectionEntry`) — still no `readFileSync` of either command file, confirmed by re-reading the file in full this run (still 133 lines, byte-identical content to the baseline). | Re-read `tools/tests/unowned-drift.test.mjs` in full this run — no reference to `spec-audit.md`/`task-review.md`. `git diff HEAD -- tools/tests/unowned-drift.test.mjs` is empty. | `tools/tests/unowned-drift.test.mjs` |
| F2 | NEEDS_CLARIFICATION | still-present | AC5: "Both FU-006 incidents (the `git-workflow.md` edit, the `task-review.md` consequential-paths gap), reconstructed as fixtures, classify `unowned-drift` and route through this flow (automated)." | Owner decision `D40` (2026-08-07) already resolved *how* to fix this — correct AC5's wording in `tasks/19-unowned-drift-correction-flow.md` to state the `git-workflow.md` fixture classifies `forbidden`, matching AC2 and the passing test — but D40 itself records the task file as "not yet amended," and this run confirms that is still true: `tasks/19-...md` AC5 (read in full this run) is byte-identical to the wording D40 quoted as needing correction. The test's own description string (`tools/tests/unowned-drift.test.mjs:114`, "classifies unowned-drift") also still reads as D40 left it, unrevised, while its assertion (line 118) checks `'forbidden'`. D40 explicitly anticipated this exact outcome: "Finding F2 ... stays an open `NEEDS_CLARIFICATION` finding until this lands." It has not landed, so F2 stays open exactly as D40 predicted — this is not a new gap, it is D40's own condition not yet satisfied. | Read `tasks/19-unowned-drift-correction-flow.md` AC5 and `owner-decisions.md` D40 in full this run; re-ran `node --test tools/tests/unowned-drift.test.mjs` — 16/16 pass, including the git-workflow.md case (test title still says "classifies unowned-drift", assertion still checks `'forbidden'`) | `tasks/19-unowned-drift-correction-flow.md`, `owner-decisions.md` D40, `tools/tests/unowned-drift.test.mjs:114-118` |
| F3 | AUTO_FIX | still-present | `docs/ai/specification-workflow.md` describes the review/audit scope-check flow this task's diff changes | Still not mirrored: `docs/ai/specification-workflow.md` has zero matches for "unowned-drift", "maintenance-correction", or "classifyUnownedDrift" this run, same as the baseline. `.claude/commands/nevo-ai/spec-audit.md` and `.claude/commands/nevo-ai/task-review.md` both still carry their step-4 wiring sentence unchanged (`git diff HEAD` against both is empty). This same gap remains outside this task's own `allowed_paths` — same scope note as the baseline: a direct fix needs an unowned-drift correction of its own, an accepted exception, or attribution to a remaining task. | `grep -i "unowned-drift\|maintenance-correction\|classifyUnownedDrift" docs/ai/specification-workflow.md` this run — no match | `docs/ai/specification-workflow.md` |

A finding marked `resolved` is not repeated as an active blocker. None of F1-F3 resolved
this run — all three re-verified as `still-present` against current file content, per
`references/review-policy.md` § "Findings have a lifecycle."

## Scope compliance

`git diff HEAD` against every path in this task's own `allowed_paths` —
`tools/specs/lifecycle.mjs`, `tools/tests/unowned-drift.test.mjs`,
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`.claude/skills/nevo-ai-spec-workflow/references/decision-policy.md`,
`.claude/commands/nevo-ai/spec-audit.md`, `.claude/commands/nevo-ai/task-review.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` — plus the task's own
`change.yaml` entry, is empty for every one. No `consequential_paths` were touched. No
`forbidden_paths` entry (`src/**`, `tests/**`, `examples/**`, `docs/development/**`,
`docs/usage/**`, `docs/reference/**`, `specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was
touched. Scope: `compliant`, unchanged from the baseline — `classifyScopeFinding` is not
needed since nothing in this task's own diff changed at all this round.

## Verification

- `node --test tools/tests/unowned-drift.test.mjs` — passed (16/16 tests, 4 suites), this run
- `node --test tools/tests/*.test.mjs` — passed (840/840 tests, 167 suites), this run
- `node tools/specs.mjs validate` — passed ("Validated 6 changes — no errors."), this run
- `node tools/specs.mjs check` — passed ("Specs valid and indexes are current."), this run — non-gating, informational
- `node tools/docs.mjs validate` — passed ("Validated 60 documents — no errors."), this run
- `node tools/docs.mjs check` — passed ("Indexes are current."), this run — non-gating, informational

## Acceptance-criteria coverage

| AC | Result | Evidence |
|---|---|---|
| AC1 | Met | `classifyUnownedDrift` returns `unowned-drift` for an out-of-scope, non-forbidden, non-current-task path — `tools/tests/unowned-drift.test.mjs` describe block, 6 tests, re-run this run |
| AC2 | Met | `forbidden_paths`-matched path never classifies `unowned-drift`, wins even over current-task attribution — 2 dedicated tests |
| AC3 | Met | `validateMaintenanceCorrectionEntry` rejects a missing `paths`/`reason`/`confirmed_by`/`confirmed_at`/`revision`, and a glob in `paths` — 6 tests |
| AC4 | Not met as tagged | Wiring is present in both command files (unchanged, confirmed by empty `git diff`) but no automated test exercises it — see F1 |
| AC5 | Questionable as written | Test passes, but asserts a result contradicting the literal AC text for one of the two fixtures; D40 already decided to correct the wording but the correction has not landed — see F2 |
| AC6 | Met (inspection) | `follow-ups.yaml` FU-006 still carries `status: resolved` with a resolution naming task 19, unchanged this run |
| AC7 | Met | `validate`/`check` clean, both tools, this run |
| AC8 | Met | Full suite 840/840, this run (up from 826/826 at baseline — reflects sibling tasks' in-flight work; unowned-drift.test.mjs itself unchanged) |

## Architecture and documentation

`docs/development/` does not describe this behavior, so no drift against it.
`docs/decisions/ADR-0006-...md`'s "Formal unowned-drift correction flow (D34, D35)"
subsection is unchanged this run (confirmed: `git diff HEAD` for the file touches only
other sibling tasks' sections, not this one). `.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`'s
"Unowned-drift correction" section is likewise unchanged. `docs/ai/specification-workflow.md`
still does not reflect this task's flow at all (F3, unchanged).

## Tests

`tools/tests/unowned-drift.test.mjs` (16 tests, 4 describe blocks, byte-identical to the
baseline) directly exercises AC1, AC2, AC3, and AC5 (with the AC5 caveat in F2). AC4's
wiring is still not exercised by any automated test (F1).
