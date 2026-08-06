---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: recovery-classification-and-machine-readable-errors
generated: 2026-08-05
verdict: blocked
implementation_allowed: true
unresolved_required_fixes: 2
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/recovery-classification-and-machine-readable-errors

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`blocked` — a new file (`tools/tests/start.test.mjs`) was created outside this task's
declared `allowed_paths` (F1), which `/nevo-ai:task-review`'s own flow (step 7) names as
the canonical example of `blocked` rather than `changes-required`; a second, independent
blocking gap (F2, missing automated coverage for acceptance criterion 4) also exists.
Both are mechanical/`AUTO_FIX` in nature — nothing here needs an owner decision — but
per `references/review-policy.md` § "Verify the diff stays within allowed_paths ... a
violation here is always a blocking finding, no exceptions," neither can be waved
through by this review itself.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | Every file touched by this task's own functional area is declared in `allowed_paths` (task front matter) | `tools/tests/start.test.mjs` is a new file (commit `8535b20`) testing `startNeedsDirtyTreeCheck`/`setTaskSuspension`/`clearTaskSuspension` — all functions this task introduced in `tools/specs.mjs` — but is not listed in the task's `allowed_paths` (`tools/lib/cli-errors.mjs`, `tools/lib/git.mjs`, `tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/tests/git.test.mjs`, `tools/tests/task-lifecycle.test.mjs`, `tools/tests/cli-errors.test.mjs`, `tools/tests/recovery.test.mjs`). A repo-wide search confirms no task in this change declares `start.test.mjs` in its `allowed_paths` either. | `git log --all --oneline -- tools/tests/start.test.mjs` returns exactly one commit, `8535b20`, whose own message describes it as fixing `handleStart`'s dirty-tree-check ordering and `setTaskSuspension`'s sibling-field handling — both task 02 concerns; the task file's `allowed_paths` list (read directly) does not contain `tools/tests/start.test.mjs`. | `tools/tests/start.test.mjs`; `specs/active/nevo-ai-process-continuity-and-hardening/tasks/02-recovery-classification-and-machine-readable-errors.md` (`allowed_paths`) |
| F2 | AUTO_FIX | first-review | AC4 ("A `not_retryable` case produces a new suspension rather than repeating the stale `previous_action`") has a passing automated test, per the task file's own `(automated)` tag | No test exercises the specific code path that implements AC4: `tools/specs.mjs` `handleStart`, the `if (task.execution?.suspension) { setTaskSuspension(...) }` branch (creating a new `owner-decision`-kind suspension from a stale one when `inspection.result === 'not_retryable'`). This logic is inline in `handleStart` and, unlike its sibling `startNeedsDirtyTreeCheck` (extracted specifically because `handleStart` itself can't be driven end-to-end in a unit test), was never extracted into a separately testable function. | Read `tools/specs.mjs` lines 299-310 (the branch in question) and searched every test file in this task's `allowed_paths` plus `tools/tests/start.test.mjs` for any reference to this behavior (`execution?.suspension`, "stale suspension", "new situation", "resuming a prior suspension") — only generic suspension-write mechanics (`recovery.test.mjs`, `start.test.mjs`) are covered, none constructs a task with a *pre-existing* suspension and asserts the *new* one it produces. | `tools/specs.mjs:299-310` |
| F3 | NON_BLOCKING | first-review | Each blocking-class `REC-xx` scenario has a dedicated test instantiating a `RecoveryError`/persisted suspension for it | `REC-04` (`MECHANICAL_VALIDATION_FAILURE`) has correct `class`/`code`/description asserted only generically, via the all-nine loop in `cli-errors.test.mjs` — it is never triggered by any handler in the codebase (no `RecoveryError('REC-04', ...)` call anywhere) and has no scenario-specific instantiation test the way `REC-05`/`REC-07`/`REC-08`/`REC-09` each get. Reasonable given the task's own constraint scoped concrete postcondition contracts to `start`+`approve` only (not `validate`, where `REC-04` would naturally attach) — not a functional defect, but a real coverage gap worth a follow-up. | `grep -rn "RecoveryError("` across `tools/` shows only `REC-07` and `classification.code` (`REC-05`/`REC-06`) are ever thrown in production code; `cli-errors.test.mjs`'s per-scenario `RecoveryError` instantiation tests use codes `REC-05`, `REC-07`, `REC-08`, `REC-09` only. | `tools/lib/cli-errors.mjs`; `tools/tests/cli-errors.test.mjs` |
| F4 | NON_BLOCKING | first-review | The task file's AC1 automated-check command actually covers what AC1 claims | AC1 names `node --test tools/tests/recovery.test.mjs` as its own check, but the nine-scenario class/code assertions it describes live in `tools/tests/cli-errors.test.mjs`, a different file — the task's overall "## Verification" section does run both, so nothing is actually unverified, but AC1's own narrower reference is imprecise. Outside this task's own `allowed_paths` to fix (the task file itself isn't in scope) — noted for a future spec correction. | Read `tasks/02-...md` AC1 and compared against `recovery.test.mjs`'s actual contents (no `REC-01`..`REC-09` assertions present there). | `specs/active/nevo-ai-process-continuity-and-hardening/tasks/02-recovery-classification-and-machine-readable-errors.md` |
| F5 | INFORMATIONAL | — | — | Gating validation: `node tools/specs.mjs validate` — passed (`Validated 6 changes — no errors.`), this run. | Command output, this run. | — |
| F6 | INFORMATIONAL | — | — | All four of this task's own designated test suites pass, this run: `recovery.test.mjs` (39/39), `cli-errors.test.mjs` (18/18), `git.test.mjs` (22/22), `task-lifecycle.test.mjs` (106/106). | Command output, this run (`node --test` for each file, `# pass N / # fail 0` for all four). | — |
| F7 | INFORMATIONAL | — | — | Non-gating repository check: `node tools/specs.mjs check` reports `stale: specs/index.generated.json` — not self-caused by this task's diff (task 02's `allowed_paths` contains no `specs/**` files); attributable to other in-flight work on this branch (task 12 is `in-implementation`, and an untracked `reviews/state-and-fingerprint-semantics.md` exists). Does not affect this task's verdict. `node tools/docs.mjs validate` passed (60 documents, no errors) — informational, since this task's `forbidden_paths` excludes `docs/**` entirely. | Command output, this run. | — |

## Scope compliance

Not fully compliant — see F1. Every file this task's own commits touch other than
`tools/tests/start.test.mjs` is within `allowed_paths`
(`tools/lib/cli-errors.mjs`, `tools/lib/git.mjs`, `tools/specs.mjs`,
`tools/specs/lifecycle.mjs`, `tools/tests/git.test.mjs`,
`tools/tests/task-lifecycle.test.mjs`, `tools/tests/cli-errors.test.mjs`,
`tools/tests/recovery.test.mjs`), confirmed by reading `git show f194053 --stat` (the
primary task-02 implementation commit) and `git show 8535b20 --stat` (the later
review-driven fix commit that introduced the out-of-scope file). No `forbidden_paths`
entry (`src/**`, `tests/**`, `examples/**`, `docs/**`, `.claude/commands/**`,
`.claude/skills/**`) is touched by any commit attributable to this task.

## Acceptance-criteria coverage

1. Met, with a caveat (F3/F4) — all nine `REC-xx` scenarios have their `class`/`code`
   asserted (`cli-errors.test.mjs`, looping over all nine), but the "(for blocking
   classes) the correct `execution.suspension` payload" clause is only exercised for six
   of the six blocking-class scenarios in a *generic* sense (`REC-05`/`06`/`07`/`08`/`09`
   have at least one dedicated example; `REC-04` does not — see F3).
2. Met — `tools/tests/git.test.mjs`'s `checkoutTrackingBranch (REC-02)` test and the
   `hasUpstream`/stale-ref tests directly prove the remote-only branch is checked out
   rather than re-created.
3. Met — `inspectStartPostconditions`'s `partially_completed` case
   (`recovery.test.mjs`) plus `startNeedsDirtyTreeCheck('partially_completed', true) ===
   false` (`start.test.mjs`) together prove only the status write happens, never a
   re-created branch.
4. Not met as an automated criterion — see F2. The behavior is plausible by code
   inspection (`tools/specs.mjs:299-310`) but has no test.
5. Met — `recovery.test.mjs`'s `setTaskSuspension`/`clearTaskSuspension` tests prove an
   `owner-decision` (`REC-06`) and `unsafe-manual` (`REC-09`) suspension persist with
   `status: approved` unchanged in the raw YAML.
6. Met — `guardAgainstUnsafeManual` tests (`recovery.test.mjs`) prove it throws and never
   mutates the task; `resolveAfterConfirmedRepair`'s `unsafe_manual` passthrough test
   (`task-lifecycle.test.mjs`) proves it is never silently converted to a different
   suspension kind.
7. Met — `recovery.test.mjs`'s "the resumable recovery handle" test and
   `task-lifecycle.test.mjs`'s "D17 end-to-end" test both prove re-inspection after a
   repair reports only the still-missing postconditions, never re-reporting an
   already-satisfied one.

## Architecture and documentation

No conflict found. `docs/development/` was searched for `REC-0`/`execution.suspension`/
"recovery scenario" and returns no matches — no architecture doc describes the old,
unclassified-exception behavior this task replaces, so there is nothing for this task to
have left stale. The task's own "Documentation impact: None in this task" claim is
accurate and consistent with `forbidden_paths` excluding `docs/**` — documentation
consolidation is correctly deferred to task 11, which has already shipped on this branch
(`status: implemented`) and does reference `REC-0`/`execution.suspension` content
(`docs/decisions/ADR-0006-...md`, `docs/ai/specification-workflow.md`).

## Tests

Behavior changes are well covered overall (see "Acceptance-criteria coverage" above),
with two gaps: F2 (a real, missing test for AC4's own code path) and F3 (a narrower,
non-blocking gap for `REC-04`'s scenario-specific payload). All four designated
verification commands pass in full (F6); `node tools/specs.mjs validate` is clean (F5).
