---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: scoped-and-incremental-spec-review
generated: 2026-08-08
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/scoped-and-incremental-spec-review

Baseline: `reviews/scoped-and-incremental-spec-review.md` (generated 2026-08-07, read in
full before being overwritten). Re-review against the current working-tree contents
(uncommitted corrective work on top of `80e8209`, matching this task's own
`review_revision`).

## Verdict

`changes-required` — F1 (`AUTO_FIX`, documentation consistency) is still present;
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
- [ ] No unresolved blocking findings
  - 1 unresolved blocking finding(s) remain.
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | still-present | `docs/ai/specification-workflow.md` — the vendor-neutral doc `CLAUDE.md` names as the source the Claude-specific skill/commands mirror — describes `/nevo-ai:spec-review`'s current behavior, including its verdict decision table, and names every distinct review shape this workflow defines | This task's `--all`/`--changed`/`--tasks` capability, the `task_fingerprints`-based `--changed` selection, `scopedReviewBaselineValid`'s rows-4/5 verdict guard, and the "potentially impacted, not re-reviewed" reporting path are still not described anywhere in this file. Re-verified this run (not carried from the baseline): `grep -n "\-\-changed\|\-\-tasks\|scoped\|task_fingerprints\|scopedReviewBaselineValid\|potentially impacted" docs/ai/specification-workflow.md` — the only hits are unrelated (`review-scope --tasks`, `bulk-transition --tasks`, the multi-task `implementation-review --tasks`, a discovery-scope "genuinely unscoped" phrase); zero mentions of `spec-review`'s own `--changed`/`--tasks` mode. Lines 638-717 ("A review's verdict is derived from a table") still state the unqualified five-row table with no scoped-run caveat comparable to `references/review-policy.md` § "Rows 4-5 for a scoped run." Same gap the baseline review recorded; unresolved by the corrective work applied elsewhere on this branch (that work touched `spec-review.md`, `review-policy.md`, `lifecycle.mjs`, ADR-0006, and the test file — all inside this task's own `allowed_paths` — but not this file, which sits outside them). Smallest valid resolution unchanged: add a short subsection (and the scoped-verdict-guard caveat to the existing table) describing `--all`/`--changed`/`--tasks`; this file is not in this task's own `allowed_paths`, so landing the fix needs a small scope note (an accepted exception, or attribution to whichever remaining task's scope can reach it). | Read `docs/ai/specification-workflow.md` lines 638-717 and grepped the file, this run | `docs/ai/specification-workflow.md` |
| F2 | NON_BLOCKING | resolved | AC1/AC4/AC7's `(automated)` tag overstates what a dedicated test literally exercises for three guarantees (no-flag argument parsing, the literal no-mutation guarantee for context-reads, and a byte-for-byte `--all` report diff) | Already recorded as `FU-010` in `follow-ups.yaml` (`source_task: scoped-and-incremental-spec-review`, `status: open`) — not a fresh finding this run, and not re-recorded a second time. `tools/tests/scoped-spec-review.test.mjs` still rests on `spec-review.md`'s own prose/structural guarantees for these three, same as the baseline found. | `follow-ups.yaml` (FU-010); `tools/tests/scoped-spec-review.test.mjs` | — |

## Scope compliance

This task's own persisted `implementation.changed_paths` (`change.yaml`) lists exactly:
`.claude/commands/nevo-ai/spec-review.md`,
`.claude/skills/nevo-ai-spec-workflow/references/context-policy.md`,
`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`tools/specs/lifecycle.mjs`, `tools/tests/scoped-spec-review.test.mjs` — every one inside
this task's own `allowed_paths`. The current uncommitted working-tree diff against
`HEAD` (`80e8209`, this task's own `review_revision`) touches exactly the same five files
(`spec-review.md`, `review-policy.md`, `ADR-0006...md`, `lifecycle.mjs`,
`scoped-spec-review.test.mjs`; `context-policy.md` unchanged this pass) — all
`compliant`, `classifyScopeFinding` not needed. `specs/index.generated.json` (a declared
`consequential_path`) also changed, consistent with `node tools/specs.mjs generate`
having run (confirmed clean by `specs.mjs check` below). No `forbidden_paths` entry
(`src/**`, `tests/**`, `examples/**`, `docs/development/**`, `docs/usage/**`,
`docs/reference/**`, `specs/archive/**`, `AGENTS.md`, `CLAUDE.md`) was touched.

## Verification

- `node --test tools/tests/scoped-spec-review.test.mjs` — passed (21/21)
- `node --test tools/tests/*.test.mjs` — passed (840/840, 167 suites)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered (see F2 for a test-rigor caveat on AC1/AC4/AC7,
  already tracked as `FU-010`, that does not rise to a coverage gap)

AC2/AC3/AC5/AC5a/AC6/AC7 (first half) are each directly exercised by
`tools/tests/scoped-spec-review.test.mjs`'s describe blocks — including the corrected
`findPotentiallyImpactedOutOfScopeTasks` (now signature `(outOfScopeTaskIds,
priorTaskFingerprints, currentTaskFingerprints)`, delegating to
`scopedReviewBaselineValid`'s own `invalidTaskIds`, with the AC5a regression test
rewritten to prove a dependency reference alone never flags the older task). AC2
additionally confirmed by inspection — `resolveSpecReviewScope` calls the same
`parseTaskOrderSpec` task 12's own `resolveReviewScope` already uses, not a second
parser. AC8/AC9 confirmed by the verification commands above.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` still carries a
correctly-worded "Scoped and incremental spec-review (D34, D35)" subsection (item 55,
now corrected to describe the fingerprint-only impact signal) and names task 17 in its
"Context" narrative. `.claude/skills/nevo-ai-spec-workflow/references/review-policy.md`
still carries the "Rows 4-5 for a scoped run" caveat on the existing decision table,
unchanged in substance by this pass's corrections. `docs/ai/specification-workflow.md` —
the canonical vendor-neutral doc — remains not updated and does not reflect this task's
`--changed`/`--tasks` capability at all (F1, still-present).

## Tests

`tools/tests/scoped-spec-review.test.mjs` (21 tests) directly exercises
`resolveSpecReviewScope` (AC1/AC2), `selectChangedTaskIds` (AC3),
`findPotentiallyImpactedOutOfScopeTasks` (AC5/AC5a, rewritten this pass for the
corrected fingerprint-only direction), `scopedReviewBaselineValid` (AC6), and
`renderScopedSpecReviewBody` (AC7). See F2/FU-010 for the narrower gap between the
`(automated)` tag on AC1/AC4/AC7 and what a dedicated test literally exercises versus
what rests on `spec-review.md`'s own prose and structural guarantees.
