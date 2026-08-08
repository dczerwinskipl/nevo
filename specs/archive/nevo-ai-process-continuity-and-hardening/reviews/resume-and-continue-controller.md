---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: resume-and-continue-controller
generated: 2026-08-05
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/resume-and-continue-controller

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — all 7 acceptance criteria are met with automated test evidence and direct
inspection; the diff stays fully inside `allowed_paths`; both gating checks
(`validate`, the task's own test suite) are clean. Two non-blocking observations and
several informational facts are recorded below; none change the verdict.

## Scope compliance

The task's own implementation commit (`5eb775b feat(specs): resume-and-continue
controller — authorized-scope boundary, D17 resume-in-place (task 03)`) touches exactly
two files: `tools/specs/lifecycle.mjs` (+108 lines, pure additions after
`classifyDirtyWorktree`) and `tools/tests/task-lifecycle.test.mjs` (+254 lines). Both are
inside `allowed_paths` (`tools/specs/lifecycle.mjs`, `tools/specs.mjs`,
`tools/tests/task-lifecycle.test.mjs`). None of `forbidden_paths` (`src/**`, `tests/**`,
`examples/**`, `docs/**`, `.claude/commands/**`, `.claude/skills/**`) is touched. The
task's own status-transition commit (`e877bd1`) only touches `change.yaml` and
`specs/index.generated.json`, as expected. **No scope violation.**

## Acceptance-criteria coverage

| AC | Status | Evidence |
|---|---|---|
| 1. `deriveStage` (or its wrapper) called from exactly one place per command | Met | `tools/specs.mjs:1033`, inside `handleStatus`, is the only call site of `deriveStage` in `tools/specs.mjs`; batch progress (`deriveBatchProgress`) is a distinct, legitimately separate derived-state computation (task 08, D10), not a duplicate "what's next" navigator. |
| 2. A task with an active `execution.suspension` is reported via its suspension | Met | `node --test tools/tests/task-lifecycle.test.mjs` — suite `deriveStage — suspension-aware reporting (D8, AC2)` (lines 484-518), 4/4 passing. |
| 3. After `completed`/`safe_to_retry`, the controller is consulted before continuing; `partially_completed`/`not_retryable`/`unsafe_manual` always stop | Met | Suite `planContinuation — the resume-and-continue controller (AC3, AC4)` (lines 582-631), 9/9 passing — every non-continuable result (`partially_completed`, `not_retryable`, `unsafe_manual`) asserted to stop even with tasks remaining in scope. |
| 4. Never continues past an authorized scope's boundary | Met | Suite `scopeOf/isEndOfScope/nextInScope — authorized scope (AC4)` (lines 558-580) plus the "completed at the end of the scope stops" test (line 595) and single-task-scope test (line 601). |
| 5. A `confirm-required` result inside an authorized combined transition resumes in place after one confirmation | Met | `resolveAfterConfirmedRepair` D17 end-to-end test (lines 682-718): `approve` succeeds, a `REC-05` confirm-required stop is repaired, and the fresh inspection resumes with only the still-missing effects (`missing: ['branch', 'status']`), `resumed: true`. |
| 6. A confirmation is asked at most once per repair — a still-unresolved postcondition surfaces as a fresh `not_retryable`/`unsafe_manual`, never a second prompt | Met | Tests at lines 666-673 and 720-732: an unresolved repair maps to `not_retryable` (never back to a `confirm-required`-shaped result), and `resumed: true` is always set so the caller can tell this isn't the original stop. |
| 7. `deriveStage` reports each of the four `self_check` states correctly, without ever writing `self_check` | Met | Suite `deriveStage — self-check-aware reporting (D28, AC7)` (lines 520-556), covering not-run/failed/passed-and-fresh/passed-but-stale (including the "current state unknown" conservative-stale case); `describeSelfCheck` (`lifecycle.mjs:953-959`) only reads `task.self_check`, never assigns to it. |

## Architecture and documentation

- No conflict with `overview.md` § "Recovery model" / "Interaction model": the five-value
  postcondition vocabulary (`completed`/`safe_to_retry`/`partially_completed`/
  `not_retryable`/`unsafe_manual`) and the "never continue past scope" boundary are
  implemented exactly as specified, including the `unsafe_manual` never-auto-retried rule
  (`planContinuation` maps it straight to `stop`, no branch that could resume it silently).
- ADR-0006 § "Recovery and resume" point 5 states the resumable recovery handle "is the
  same postcondition-inspection function, re-invoked over fresh state" — consistent with
  how `resolveAfterConfirmedRepair` is designed (it consumes a fresh inspection result,
  it does not re-run the inspection itself).
- Documentation impact: task file states "None in this task — consolidated in task 11,"
  which matches — no `docs/**` files are touched by this task's own commit.
- `deriveStage`'s suspension-aware (`withSuspension`) and self-check-aware
  (`describeSelfCheck`) wrapper logic — which this task's own "Implementation
  constraints" describe as its responsibility — is, per `git log -S`, actually present
  since commit `f194053` (task 02's own implementation commit), before task 03 started.
  This is not a defect in the current state (AC2/AC7 both pass against what exists today,
  regardless of which commit introduced it), but it means task 03's own commit did not
  need to (and did not) add this part of the contract — see F3 below for the record.

## Tests

`node --test tools/tests/task-lifecycle.test.mjs` — **106/106 tests pass, 0 failures**
(15 suites, including the 6 suites this task added or extended:
`deriveStage — suspension-aware reporting`, `deriveStage — self-check-aware reporting`,
`scopeOf/isEndOfScope/nextInScope`, `planContinuation`, `stopReasonForSuspension`,
`resolveAfterConfirmedRepair`).

`node tools/specs.mjs validate` — `Validated 6 changes — no errors.` (gating, passed.)

`node tools/specs.mjs check` (non-gating, informational only) —
`stale: specs/index.generated.json`. Not self-caused by this task: the task's own diff
touches neither `specs/**` sources nor any generated index; the staleness is a
repository-wide fact caused elsewhere on this branch (later tasks/commits), per
`references/review-policy.md` § "Gating versus non-gating checks."

```
Gating validation: passed
Non-gating repository check: failed — specs/index.generated.json is stale, but not
  from this task's own diff (which never touches specs/** sources or docs/**)
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | `planContinuation`/`scopeOf`/`isEndOfScope`/`nextInScope`/`stopReasonForSuspension`/`resolveAfterConfirmedRepair` (all added by this task) are invoked from production code (not just tests) somewhere in `tools/specs.mjs` or `.claude/commands/nevo-ai/*.md` | Not currently true — repo-wide search finds these six names only in `tools/specs/lifecycle.mjs` (their own definitions) and `tools/tests/task-lifecycle.test.mjs`/`tools/tests/e2e-workflow.test.mjs`. `tools/specs.mjs` is one of this task's own `allowed_paths`, and the task's Goal states this controller should be the entry point "every conversational command and the batch controller call," but the implementation commit only touched `lifecycle.mjs`/the test file. Every stated acceptance criterion (1-7) is nonetheless met by the pure-function contract and its test suite, and ADR-0006 explicitly documents the "resumable recovery handle" as a re-invoked postcondition-inspection function rather than a dedicated call site — so this is not a correctness defect, but a real gap between the Goal's "single shared entry point" framing and what the batch controller (task 08's `deriveBatchProgress`) and the conversational layer (`spec-approve.md`'s documented "re-run `start`" prose) actually do, which is to reproduce equivalent behavior independently rather than calling into this task's functions. | Confirmed via `grep -rn "planContinuation\|scopeOf(\|nextInScope\|stopReasonForSuspension\|resolveAfterConfirmedRepair" tools/ .claude/` returning matches only in `lifecycle.mjs` and the two test files. | `tools/specs/lifecycle.mjs` (lines ~253-361) |
| F2 | INFORMATIONAL | — | — | `node tools/specs.mjs check` reports `specs/index.generated.json` stale; not caused by this task's diff | Command output, this run; task 03's own commit touches neither `specs/**` sources nor generated indexes | — |
| F3 | INFORMATIONAL | — | — | `deriveStage`'s suspension-/self-check-aware wrapper (`withSuspension`/`describeSelfCheck`), which this task's file lists as its own implementation constraint, was actually introduced in task 02's commit `f194053`, before task 03 began | `git log --oneline main..HEAD -S"withSuspension" -- tools/specs/lifecycle.mjs` returns only `f194053`; current state still satisfies AC2/AC7 | `tools/specs/lifecycle.mjs` (lines 930-959) |
| F4 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — clean | `Validated 6 changes — no errors.`, this run | — |
| F5 | INFORMATIONAL | — | — | `node --test tools/tests/task-lifecycle.test.mjs` — clean | `# pass 106`, `# fail 0`, this run | — |

F1 is a candidate for follow-up recording (not recorded — requires owner-facing
confirmation, out of scope for this subagent run).
