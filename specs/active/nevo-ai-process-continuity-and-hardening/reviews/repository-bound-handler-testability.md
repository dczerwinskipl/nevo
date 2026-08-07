---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: repository-bound-handler-testability
generated: 2026-08-07
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/repository-bound-handler-testability

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — all nine acceptance criteria are met, the diff stays within `allowed_paths`,
required verification passes, and one non-blocking finding remains (does not gate the
verdict).

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
| F1 | NON_BLOCKING | first-review | The comment above `handleStart`'s `not_retryable` branch explains why `nextSuspensionForNotRetryable` is unit-tested separately rather than through `handleStart` | Comment is now stale: it says "handleStart itself reads the real repository and can't be driven end-to-end in a fixture test," which this very task makes false — `handleStart` is now parameterized and AC3's fixture test drives exactly this `not_retryable` branch end-to-end | `tools/specs.mjs` lines ~308-314 (`// ... since handleStart itself reads the real repository and can't be driven end-to-end in a fixture test.`) | `tools/specs.mjs` |
| F2 | NON_BLOCKING | first-review | AC1 requires `handleStart` driven against a fixture to produce "the same postcondition/suspension outcomes as the equivalent real-repo scenario"; the area doc names all five (`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`/`unsafe_manual`) | Only 2 of 5 named postcondition outcomes are exercised through the new fixture harness (`completed`/idempotent-retry via AC1's own two tests, `not_retryable` via AC3) — `safe_to_retry`, `partially_completed`, and `unsafe_manual` have no fixture-driven test in `handler-testability.test.mjs`. Existing coverage of those states is unit-level (task 02) or against the real repo (`e2e-workflow.test.mjs`), not fixture-driven. AC1's own wording is satisfied on a reasonable reading (it names no specific outcome set), so this is not blocking, but it is a real coverage gap against the area doc's fuller description | `tools/tests/handler-testability.test.mjs` | `tools/tests/handler-testability.test.mjs` |

## Scope compliance

Task's own attributed `implementation.changed_paths` (from `change.yaml`, recorded by
the prior `self-check`): `docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs.mjs`, `tools/specs/service.mjs`,
`tools/tests/fixture-repo.test-helper.mjs`, `tools/tests/handler-testability.test.mjs`
— every one of these is listed verbatim in the task's own `allowed_paths`; none matches
`forbidden_paths`. `classifyScopeFinding` is not needed for any path — all six are exact
`allowed_paths` entries, `compliant` by construction. No scope exception required.

## Verification

- `node --test tools/tests/handler-testability.test.mjs` — passed (8/8)
- `node --test tools/tests/*.test.mjs` — passed (826/826)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered

AC1-AC5 are exercised by `tools/tests/handler-testability.test.mjs`'s five `describe`
blocks (see F2 for a non-blocking coverage-breadth note on AC1). AC6 (no new
module-level mutable global/singleton) confirmed by direct inspection — no new
module-level `let`/`var` in either touched production file. AC7 confirmed: `follow-ups.yaml`'s
FU-007 entry is `status: resolved` with a `resolution` field naming this task. AC8/AC9
confirmed by the verification run above.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` gained the "Repository-bound
handler testability (D34, D35)" subsection (items 65-67) naming the parameterized
signatures, the no-service-locator constraint, and `createFixtureRepo`; the "Context"
narrative paragraph names the twentieth task alongside 14-21, as required. Production
call sites (`tools/specs.mjs`'s `start`/`generate`/`check`/`validate` commands,
`handleBatchStart`) all invoke `handleStart`/`buildSpecsIndexes`/`checkSpecsIndexes`/
`writeSpecsIndexes` with no extra arguments — confirmed by direct inspection of every
call site — so production defaults are unchanged (requirement 2). See F1 for one stale
inline comment this task's own change made inaccurate.

## Tests

`tools/tests/fixture-repo.test-helper.mjs` (new, not itself a test file) builds a
throwaway git repository plus a minimal `specs/active/<change>/` tree and tears it down
via `after()`; `tools/tests/handler-testability.test.mjs` (new) drives `handleStart`,
`checkSpecsIndexes`/`buildSpecsIndexes`, and `deriveStage`/`depsSatisfied` against it —
confirmed no writes into the real repository's own `specs/`/`docs/` trees during the
run. `writeSpecsIndexes` was additionally parameterized (not one of the three explicitly
named handlers, but required for AC2's fixture-only REC-03 reproduction and within this
task's own `allowed_paths`) — not classified as a scope or constraint issue.
