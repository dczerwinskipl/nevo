---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: repository-bound-handler-testability
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/repository-bound-handler-testability

Baseline: `reviews/repository-bound-handler-testability.md` as generated 2026-08-07 (read in
full before this run overwrote it). This is a re-review: the working tree carries
uncommitted changes on top of `80e8209` from other in-flight corrective work (tasks 15/21
and workflow-tooling files), so every finding below was re-verified against current file
content, not memory of the prior pass.

## Verdict

`pass` — all nine acceptance criteria are still met, the diff attributable to this task
stays within `allowed_paths`, required verification passes, and the same two
non-blocking findings as the baseline remain (tracked as FU-012/FU-013; they do not gate
the verdict).

## Checklist

- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | still-present | The comment above `handleStart`'s `not_retryable` branch explains why `nextSuspensionForNotRetryable` is unit-tested separately rather than through `handleStart` | Comment is still stale: "handleStart itself reads the real repository and can't be driven end-to-end in a fixture test" remains false, unchanged since the baseline review — already recorded as `follow-ups.yaml` FU-012 (`status: open`) | `tools/specs.mjs` lines 308-314, re-read this run | `tools/specs.mjs` |
| F2 | NON_BLOCKING | still-present | AC1/area doc name all five `handleStart` postcondition outcomes (`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`/`unsafe_manual`) as the coverage target | Still only 2 of 5 (`completed`, `not_retryable`) are exercised through the fixture harness in `handler-testability.test.mjs` — unchanged since the baseline review; already recorded as `follow-ups.yaml` FU-013 (`status: open`) | `tools/tests/handler-testability.test.mjs`, re-read this run | `tools/tests/handler-testability.test.mjs` |

Neither finding required a fresh follow-up-recording decision this run — both were
already persisted as ledger entries (FU-012, FU-013) by the prior review and remain
`status: open` unchanged; re-recording them would duplicate the ledger.

### Cross-task finding X1 (D39) — confirmed out of this task's own scope, not resolved

`reviews/implementation-review-14-21.md`'s cross-task finding X1 and `owner-decisions.md`
D39 name `handleSelfCheck` (`tools/specs.mjs`) as still hardcoding the real `ROOT` for
`git.getCurrentRevision`/`git.getChangedFiles`/`git.getWorktreeDiff`. Verified directly
against current `tools/specs.mjs` (lines 438-477): `handleSelfCheck`'s signature is still
`handleSelfCheck(changeSlug, taskId)` with no `gitRoot`/options parameter, and all three
named `git.*` calls still pass the module-level `ROOT` constant — **X1 is not resolved**.
This is not a finding against this task, though: this task's own file
(`tasks/20-repository-bound-handler-testability.md`) was not amended for D39 — its
`allowed_paths`/acceptance criteria/"Out of scope" section (which explicitly excludes
"Parameterizing any handler beyond `handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes`")
are unchanged from the baseline review, and D39's own "Consequences" text says so
directly: the fix is "a new corrective task, not yet created" — not an amendment to this
task. `follow-ups.yaml`'s FU-007 entry is likewise unchanged: still `status: resolved`,
same resolution text naming only task 20's original three handlers, with no amendment and
no fresh follow-up recorded for the `handleSelfCheck` gap — D39's own note that FU-007
"reopens whether \[it\] should still read `resolved`" has not yet been acted on by
anything in the current working tree. Because none of this touches this task's own
declared scope, it does not change this task's own verdict; it remains visible here so a
reader of this file sees the current, accurate state rather than the baseline's silence
on it.

## Scope compliance

This task's own attributed `implementation.changed_paths` (from `change.yaml`, frozen at
this task's own self-check boundary, baseline_revision `c0009050`, review_revision
`80e8209`) is unchanged from the baseline review: `docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs.mjs`, `tools/specs/service.mjs`, `tools/tests/fixture-repo.test-helper.mjs`,
`tools/tests/handler-testability.test.mjs` — every one of these is listed verbatim in the
task's own `allowed_paths`; none matches `forbidden_paths`. `classifyScopeFinding` is not
needed for any path — all six are exact `allowed_paths` entries, `compliant` by
construction.

The current working tree additionally shows uncommitted changes to `tools/specs.mjs`,
`tools/specs/service.mjs`, `tools/specs/lifecycle.mjs`, and
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` beyond this task's own
frozen provenance. Inspected directly (`git diff HEAD`): these edits are
`apply-provenance`/`computeImplementationFingerprintFromProvenance` multi-mapping and
hash-correction changes (task 15's own corrective scope) and ADR narrative corrections for
tasks 14/15/17/18 — none touch `handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes` or
any other content attributable to this task. `tools/specs/lifecycle.mjs` is not in this
task's own `allowed_paths` and is untouched by this task's own frozen diff — its current
edits belong to other tasks' own scope, not a violation here. No scope exception required
for this task.

## Verification

- `node --test tools/tests/handler-testability.test.mjs` — passed (8/8)
- `node --test tools/tests/*.test.mjs` — passed (840/840)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered

Re-verified against current content: AC1-AC5 exercised by
`tools/tests/handler-testability.test.mjs`'s five `describe` blocks (unchanged, still
8/8 passing; see F2 for the same non-blocking coverage-breadth note as the baseline). AC6
re-confirmed by direct inspection — no new module-level mutable `let`/`var` in either
touched production file. AC7 re-confirmed: `follow-ups.yaml`'s FU-007 entry is still
`status: resolved` with a `resolution` naming this task (see the X1/D39 discussion above
for why this remains accurate to this task's own scope even though a related, separate
gap remains open elsewhere). AC8/AC9 confirmed by the verification run above.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` still carries the
"Repository-bound handler testability (D34, D35)" subsection this task added, unchanged
in substance; surrounding items were edited by other tasks' own corrective work (see
Scope compliance) without altering this task's own subsection. Production call sites
(`tools/specs.mjs`'s `start`/`generate`/`check`/`validate` commands, `handleBatchStart`)
still invoke `handleStart`/`buildSpecsIndexes`/`checkSpecsIndexes`/`writeSpecsIndexes`
with no extra arguments — re-confirmed by direct inspection — so production defaults
remain unchanged (requirement 2). See F1 for the one still-stale inline comment.

## Tests

`tools/tests/fixture-repo.test-helper.mjs` and `tools/tests/handler-testability.test.mjs`
are unchanged since the baseline review (`git diff HEAD` shows no edits to either file);
the full suite (840/840, up from 826/826 at baseline — the increase is other tasks'
own new tests, not this task's) still passes with no writes into the real repository's
own `specs/`/`docs/` trees during the run.
