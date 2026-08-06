---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: recovery-classification-and-machine-readable-errors
generated: 2026-08-06
verdict: changes-required
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: tools/tests/start.test.mjs
    reason: A dedicated start-lifecycle test file is clearer than folding these cases into recovery.test.mjs.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "7274471291dfe03f28315edf0d7b70dd2eeccb80a5efd15e20d3fa51a067a2fc"
---

# Review: nevo-ai-process-continuity-and-hardening/recovery-classification-and-machine-readable-errors

Baseline read from the existing `reviews/recovery-classification-and-machine-readable-errors.md`
(generated 2026-08-05, verdict `blocked`) before this run overwrote it. Both of its
findings (F1, F2) were re-verified against current file contents, not memory.

## Verdict

`pass` — F1's scope exception is accepted by the owner (recorded below), and F2 is
resolved: the suspension-construction decision `handleStart` needed for AC4 was
extracted into a new pure function, `nextSuspensionForNotRetryable`
(`tools/specs/lifecycle.mjs`), directly unit-tested (`handleStart` itself still can't
be driven end-to-end — it reads the real repository's `ACTIVE_DIR`, same constraint
`startNeedsDirtyTreeCheck`'s own doc comment already documents).

## Checklist

- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
  - 1 owner-approved exception recorded (F1)
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

No findings.

Baseline findings, re-verified against current content this run:

| ID | Category | Lifecycle | Predicate | Evidence |
|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | Every file touched by this task's own commits is declared in `allowed_paths` | *(accepted — owner-approved exception, not an active blocker)* `tools/tests/start.test.mjs` (`8535b20`) is `outside-allowed`, never `forbidden`. Recorded in this file's `scope_exceptions` frontmatter. The implementation still exceeded its declared scope; this note states that every time the report is written, per D31. |
| F2 | AUTO_FIX | resolved | AC4 has a passing automated test | `nextSuspensionForNotRetryable(existingSuspension, now)` (`tools/specs/lifecycle.mjs`) now holds exactly the decision `handleStart:299-309` needed (reuse the stale suspension's `code`, always `previous_action: 'start'`, a fresh `created_at`, or `null` when there's nothing to replace) and `handleStart` calls it directly. Four new tests in `tools/tests/task-lifecycle.test.mjs` cover it: the reuse-code/fresh-timestamp shape, that `previous_action` is never copied from the stale suspension, the `null`/no-op case, and the default-`now` path. |
| F3 | NON_BLOCKING | still-present | Each blocking-class `REC-xx` scenario has a dedicated instantiation test | `REC-04` (`MECHANICAL_VALIDATION_FAILURE`) is still asserted only generically via the all-nine loop in `cli-errors.test.mjs`; `RecoveryError('REC-04', ...)` is still never called anywhere in production code, unlike `REC-05`/`07`/`08`/`09` which each get a dedicated instantiation test. Consistent with the task's own scope (concrete postcondition contracts for `start`+`approve` only) — a real coverage gap, not a functional defect. | `grep -rn "RecoveryError(" tools/ --include=*.mjs` (excluding tests) still shows only `REC-07` and dirty-tree `classification.code` calls in production code. | `tools/lib/cli-errors.mjs`; `tools/tests/cli-errors.test.mjs` |
| F4 | NON_BLOCKING | still-present | The task file's AC1 automated-check command actually covers what AC1 claims | AC1 still names `node --test tools/tests/recovery.test.mjs` as its own check, but the nine-scenario class/code assertions it describes still live in `cli-errors.test.mjs`. The task's overall "## Verification" section runs both, so nothing is actually unverified — only AC1's own narrower reference is imprecise. Outside this task's own `allowed_paths` to fix. | Read `tasks/02-...md` AC1 and `recovery.test.mjs` this run — still no `REC-01`..`REC-09` assertions in `recovery.test.mjs`. | `tasks/02-....md` |

## Scope compliance

Every file touched by this task's commits (`f194053`, `8535b20`) is either within
`allowed_paths` (`tools/lib/cli-errors.mjs`, `tools/lib/git.mjs`, `tools/specs.mjs`,
`tools/specs/lifecycle.mjs`, `tools/tests/git.test.mjs`,
`tools/tests/task-lifecycle.test.mjs`, `tools/tests/cli-errors.test.mjs`,
`tools/tests/recovery.test.mjs`) or the one owner-approved exception
(`tools/tests/start.test.mjs`, F1, `outside-allowed`, accepted — see `scope_exceptions`
above). No `forbidden_paths` entry is touched by either commit.

## Verification

- `node --test tools/tests/recovery.test.mjs` — passed (39/39)
- `node --test tools/tests/cli-errors.test.mjs` — passed (18/18)
- `node --test tools/tests/git.test.mjs` — passed (22/22)
- `node --test tools/tests/task-lifecycle.test.mjs` — passed (110/110)
- `node tools/specs.mjs validate` — passed

## Acceptance-criteria coverage

- [x] All 7 acceptance criteria covered

## Architecture and documentation

No conflict. `forbidden_paths` excludes `docs/**` for this task; documentation
consolidation is correctly deferred to task 11 (already `implemented` on this branch).

## Tests

Well covered — F2's gap is closed (`nextSuspensionForNotRetryable`, 4 new tests); F3
(narrower, non-blocking gap for `REC-04`'s scenario-specific payload) remains open, not
recorded as a follow-up this run. All designated verification commands pass in full;
`node tools/specs.mjs validate` is clean.
