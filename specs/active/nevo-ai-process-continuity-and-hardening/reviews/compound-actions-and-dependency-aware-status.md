---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: compound-actions-and-dependency-aware-status
generated: 2026-08-07
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/compound-actions-and-dependency-aware-status

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
| F1 | AUTO_FIX | first-review | `docs/ai/specification-workflow.md` — the vendor-neutral doc `CLAUDE.md` names as the source the Claude-specific skill/commands mirror — describes `spec-approve`'s "approve and start" outcome and `deriveStage`'s stage/next-action model | This task changes both: (1) after `start` succeeds, "approve and start" now continues directly into implementation in the same turn (closes FU-002) — but the doc's own "A favorable verdict still isn't a status change" section (¶729-744) still describes "approve and start" as running `approve`→`start` "both in sequence" with no mention of continuing into implementation, and the general "an owner-facing compound action completes the operation its own label promises" rule this task also adds to `spec-approve.md`'s own Rules section is absent from this doc entirely (repo-wide grep, this run — zero matches for "completes the operation" / "own label"). (2) `deriveStage`'s `ready-to-start` stage now checks `depsSatisfied` and a new `blocked-on-dependencies` stage exists (closes FU-004) — but the doc's "Terminology" and "Derived versus persisted state" sections (¶377-417), which are exactly where `deriveStage`/`nextCommand`/"Recommended action" are defined, name no stage values at all and make no mention of the dependency-aware invariant ("status never contradicts what start would do") this task establishes. Same pattern as `review-report-minimization`'s own F2 finding and `scoped-and-incremental-spec-review`'s own F1 finding against this same file, on this same branch. Smallest valid resolution: add a short paragraph to the "approve and start" section noting the post-`start` continuation and the general compound-action rule, and a sentence to the derived-state/terminology material noting `ready-to-start` is dependency-gated and that a `blocked-on-dependencies` stage exists; note this file is not in this task's own `allowed_paths`, so fixing it needs a small scope note (an accepted exception, or attribution to whichever remaining task's scope can reach it). | `grep -n "approve and start\|completes the operation\|own label\|ready-to-start\|blocked-on-dependencies\|depsSatisfied" docs/ai/specification-workflow.md` this run — no match for the new behavior; read ¶295-417 (state/terminology sections) and ¶729-744 ("approve and start" section) this run | `docs/ai/specification-workflow.md` |
| F2 | NON_BLOCKING | first-review | AC6 ("status's reported next action is consistent with what start would actually accept for that same task at that same moment, verified across a representative set of deriveStage stages, not only ready-to-start") is tagged `(automated)` | `tools/tests/status-dependency-aware.test.mjs`'s AC6 test iterates three dependency-status scenarios (`verified`/`draft`/`in-implementation`), but its assertion only fires inside the `if (r.stage === 'ready-to-start')` branch — for the `draft`/`in-implementation` scenarios (which resolve to `needs-approval`/`in-progress` before the ready-to-start check is even reached) nothing is actually asserted about the invariant. The invariant genuinely holds (confirmed by inspection of `deriveStage`'s control flow — a task is never reported `ready-to-start` unless `depsSatisfied` returned true, by construction), but the `(automated)` tag implies a dedicated regression test exercises the contrapositive (a non-ready-to-start stage correctly reflects that `start` would reject it) across those other stages too, which this specific test does not literally do. Does not rise to a coverage gap — the invariant is real and the checked branch does verify it correctly for every scenario that does reach `ready-to-start`. | Read `tools/tests/status-dependency-aware.test.mjs` (full file) and `deriveStage`'s control flow (`tools/specs/lifecycle.mjs`) this run | `tools/tests/status-dependency-aware.test.mjs` |

## Scope compliance

This task's own persisted `implementation.changed_paths` (`change.yaml`, task 15's
provenance mechanism) lists exactly: `.claude/commands/nevo-ai/spec-approve.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs/lifecycle.mjs`, `tools/tests/compound-actions.test.mjs`,
`tools/tests/status-dependency-aware.test.mjs` — every one is inside this task's own
`allowed_paths`; all `compliant`, `classifyScopeFinding` not needed.
`tools/specs/lifecycle.mjs` is shared with several sibling tasks (14/15/16/17/19) also
in flight on this branch — the diff against it contains other tasks' own additions
(`selectSemanticIntegrationPairs`, `resolveSpecReviewScope`, `classifyUnownedDrift`,
etc.); this task's own portion is exactly the `deriveStage` dependency-gating change
inspected above. No `consequential_paths` were touched by this task's own scope. No
`forbidden_paths` entry (`src/**`, `tests/**`, `examples/**`, `docs/development/**`,
`docs/usage/**`, `docs/reference/**`, `specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was
touched.

## Verification

- `node --test tools/tests/compound-actions.test.mjs` — passed (13/13 tests, 4 suites)
- `node --test tools/tests/status-dependency-aware.test.mjs` — passed (6/6 tests)
- `node --test tools/tests/*.test.mjs` — passed (826/826 tests, 166 suites)
- `node tools/specs.mjs validate` — passed ("Validated 6 changes — no errors.")
- `node tools/specs.mjs check` — passed ("Specs valid and indexes are current.") — non-gating, informational
- `node tools/docs.mjs validate` — passed ("Validated 60 documents — no errors.")
- `node tools/docs.mjs check` — passed ("Indexes are current.") — non-gating, informational

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered (see F2 for a test-rigor caveat on AC6 that does
  not rise to a coverage gap)

AC1-AC3 are directly exercised by `tools/tests/compound-actions.test.mjs`'s describe
blocks (template-shape assertions against `spec-approve.md`'s actual current wording).
AC4-AC6 are directly exercised by `tools/tests/status-dependency-aware.test.mjs`'s
describe block. AC7 (follow-ups.yaml FU-002/FU-004 marked `resolved` with a resolution
referencing task 18) confirmed by inspection — both entries carry
`status: resolved`/a resolution naming task 18 and the relevant test file, and AC1-AC6
were confirmed passing before this update, consistent with the task's own "only after
AC1-AC6 pass" constraint. AC8/AC9 confirmed by the verification commands above.

## Architecture and documentation

`docs/development/` does not describe this behavior (no matches for the relevant
terms), so no drift against it. `docs/decisions/ADR-0006-...md` gains a correctly-worded
new "Complete owner-facing compound actions and dependency-aware status (D34, D35)"
subsection (511-535) and names task 18 in its "Context" narrative (106-112), satisfying
the task's own documentation-impact list, with no internal self-contradiction elsewhere
in the file (checked: no other stale "Implement, then"/"ready-to-start" mentions).
`docs/ai/specification-workflow.md`, the canonical vendor-neutral doc this repository's
`CLAUDE.md` names as the source of truth the Claude-specific skill mirrors, was not
updated and does not reflect either of this task's two behavior changes (F1) — a real
documentation-consistency gap even though the task's own "Documentation impact" list
didn't name this file, matching the same situation already found on this branch against
`review-report-minimization` and `scoped-and-incremental-spec-review`.

## Tests

`tools/tests/compound-actions.test.mjs` (13 tests, 4 describe blocks) and
`tools/tests/status-dependency-aware.test.mjs` (6 tests, 1 describe block) are both new,
directly exercising AC1-AC6. See F2 for a narrow test-rigor caveat on AC6 that does not
rise to a coverage gap.
