---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: recovery-classification-and-machine-readable-errors
generated: 2026-08-06
verdict: changes-required
implementation_allowed: true
unresolved_required_fixes: 1
unresolved_owner_decisions: 1
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/recovery-classification-and-machine-readable-errors

Baseline read from the existing `reviews/recovery-classification-and-machine-readable-errors.md`
(generated 2026-08-05, verdict `blocked`) before this run overwrote it. Both of its
findings (F1, F2) were re-verified against current file contents, not memory.

## Verdict

`changes-required` — under the current policy (D31), an unresolved `outside-allowed`
scope violation (F1) is no longer an automatic `blocked`; it is an unresolved
`OWNER_DECISION` that keeps `pass` unreachable via the checklist's "Scope check
resolved" item. A second, independent gap (F2, missing automated coverage for
acceptance criterion 4) keeps "All acceptance criteria covered" unresolved too.
Verification evidence was fully producible (all four commands ran and passed, `validate`
clean), so `blocked` — reserved for a more fundamental stop such as evidence that
cannot be produced at all — does not apply.

## Checklist

- [ ] All acceptance criteria covered
  - AC4 ("A `not_retryable` case produces a new suspension rather than repeating the
    stale `previous_action`") has no automated test — see F2
- [x] Required automated verification passed
- [ ] Scope check resolved
  - F1: `tools/tests/start.test.mjs` is outside `allowed_paths`, no recorded
    `scope_exceptions` entry
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [ ] No unresolved owner decision
  - F1 (scope) is an unresolved `OWNER_DECISION`

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | still-present | Every file touched by this task's own commits is declared in `allowed_paths` | `tools/tests/start.test.mjs` (added in commit `8535b20`, testing `startNeedsDirtyTreeCheck`/`setTaskSuspension`/`clearTaskSuspension`) is still not listed in the task's `allowed_paths`; no `scope_exceptions` entry exists in the baseline this run overwrote. `classifyScopeFinding('tools/tests/start.test.mjs', {allowedPaths, forbiddenPaths})` → `outside-allowed` (not `forbidden` — `tools/tests/**` matches no `forbidden_paths` pattern), so it is resolvable via the D31 exception menu, but only by an explicit owner decision this review cannot make on its own. | `git log --oneline --all -- tools/tests/start.test.mjs` returns exactly one commit, `8535b20`; task file's `allowed_paths` (read directly, just now) does not contain it; `node -e` run of `classifyScopeFinding` this run returned `outside-allowed`. | `tools/tests/start.test.mjs`; `tasks/02-....md` (`allowed_paths`) |
| F2 | AUTO_FIX | still-present | AC4 has a passing automated test, per the task file's own `(automated)` tag | Still no test exercises `handleStart`'s `if (task.execution?.suspension) { setTaskSuspension(...) }` branch (`tools/specs.mjs:299-309`) — the code that turns a stale suspension into a *new* one when `not_retryable` fires. Tests exist for `inspectStartPostconditions` returning `not_retryable` generically (`e2e-workflow.test.mjs`) and for `setTaskSuspension` in isolation (`start.test.mjs`, `recovery.test.mjs`), but none constructs a task with a pre-existing suspension and drives it through this specific branch. | Read `tools/specs.mjs:299-309` this run; grepped every test file in `allowed_paths` plus `start.test.mjs`/`e2e-workflow.test.mjs` for `execution?.suspension` / a scenario combining a pre-existing suspension with a fresh `not_retryable` `start` — none found. | `tools/specs.mjs:299-309` |
| F3 | NON_BLOCKING | still-present | Each blocking-class `REC-xx` scenario has a dedicated instantiation test | `REC-04` (`MECHANICAL_VALIDATION_FAILURE`) is still asserted only generically via the all-nine loop in `cli-errors.test.mjs`; `RecoveryError('REC-04', ...)` is still never called anywhere in production code, unlike `REC-05`/`07`/`08`/`09` which each get a dedicated instantiation test. Consistent with the task's own scope (concrete postcondition contracts for `start`+`approve` only) — a real coverage gap, not a functional defect. | `grep -rn "RecoveryError(" tools/ --include=*.mjs` (excluding tests) still shows only `REC-07` and dirty-tree `classification.code` calls in production code. | `tools/lib/cli-errors.mjs`; `tools/tests/cli-errors.test.mjs` |
| F4 | NON_BLOCKING | still-present | The task file's AC1 automated-check command actually covers what AC1 claims | AC1 still names `node --test tools/tests/recovery.test.mjs` as its own check, but the nine-scenario class/code assertions it describes still live in `cli-errors.test.mjs`. The task's overall "## Verification" section runs both, so nothing is actually unverified — only AC1's own narrower reference is imprecise. Outside this task's own `allowed_paths` to fix. | Read `tasks/02-...md` AC1 and `recovery.test.mjs` this run — still no `REC-01`..`REC-09` assertions in `recovery.test.mjs`. | `tasks/02-....md` |

## Scope compliance

Not fully compliant — see F1. Every other file touched by this task's commits
(`f194053`, `8535b20`) is within `allowed_paths` (`tools/lib/cli-errors.mjs`,
`tools/lib/git.mjs`, `tools/specs.mjs`, `tools/specs/lifecycle.mjs`,
`tools/tests/git.test.mjs`, `tools/tests/task-lifecycle.test.mjs`,
`tools/tests/cli-errors.test.mjs`, `tools/tests/recovery.test.mjs`). No `forbidden_paths`
entry is touched by either commit. `tools/tests/start.test.mjs` classifies
`outside-allowed`, not `forbidden` — per the D31 menu it is resolvable (revert, relocate
its cases into `recovery.test.mjs`, attribute to another task, amend the task's declared
scope, or accept as an owner-approved `scope_exceptions` entry), but this run does not
have the standing to pick one; it stays an unresolved `OWNER_DECISION`.

## Verification

- `node --test tools/tests/recovery.test.mjs` — passed (39/39)
- `node --test tools/tests/cli-errors.test.mjs` — passed (18/18)
- `node --test tools/tests/git.test.mjs` — passed (22/22)
- `node --test tools/tests/task-lifecycle.test.mjs` — passed (106/106)
- `node tools/specs.mjs validate` — passed (`Validated 6 changes — no errors.`)

## Acceptance-criteria coverage

- AC1, AC2, AC3, AC5, AC6, AC7: met (unchanged from baseline analysis; re-spot-checked
  this run against current `recovery.test.mjs`/`cli-errors.test.mjs`/`git.test.mjs`/
  `task-lifecycle.test.mjs` contents).
- AC4: not met as an automated criterion — see F2. The behavior is plausible by code
  inspection (`tools/specs.mjs:299-309`, unchanged since baseline) but still has no test.

## Architecture and documentation

No conflict. `forbidden_paths` excludes `docs/**` for this task; documentation
consolidation is correctly deferred to task 11 (already `implemented` on this branch).
No new drift since the baseline review — the code touched by this task's commits has not
changed again since 2026-08-05.

## Tests

Unchanged since baseline: well covered overall, with two gaps — F2 (missing test for
AC4's own code path, blocking) and F3 (narrower, non-blocking gap for `REC-04`'s
scenario-specific payload). All four designated verification commands pass in full;
`node tools/specs.mjs validate` is clean.
