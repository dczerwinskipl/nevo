---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: workflow-e2e-tests
generated: 2026-08-06
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/workflow-e2e-tests

## Verdict

`pass` — F1 is resolved: `REC-03`'s test now exercises the real detect→regenerate→clean
cycle via `checkSpecsIndexes`/`buildSpecsIndexes`/`writeSpecsIndexes`
(`tools/specs/service.mjs`) against the repo's actual generated indexes, restoring
original content in a `finally` regardless of outcome.

Baseline: `specs/active/nevo-ai-process-continuity-and-hardening/reviews/workflow-e2e-tests.md`
as it existed before this run (generated 2026-08-05, verdict `changes-required`). Every
baseline finding was re-checked against current file content, not memory.

## Checklist

- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

No findings.

Baseline finding, re-verified against current content this run:

| ID | Category | Lifecycle | Predicate | Evidence |
|---|---|---|---|---|
| F1 | AUTO_FIX | resolved | AC1 + task's own "Recovery" scenario list require `REC-03` (stale generated file) to repair and the original validation to retry, using the real mechanism, no test doubles | The test now corrupts `specs/active.generated.md`, confirms `checkSpecsIndexes()` reports it `stale`, calls `writeSpecsIndexes(buildSpecsIndexes())` to repair it, confirms `checkSpecsIndexes()` is then clean, and restores all three generated files byte-for-byte in a `finally` (including `index.generated.json`, whose `generated` timestamp field moves on every regenerate). Ran this run: passes, repo left clean (`git status --porcelain` on the three generated files — no output). |
| F2 | NON_BLOCKING | still-present | The "Context and follow-ups" scenario "missing inferred context produces a deterministic warning" is proven against the real mechanism (`computeRoutingWarnings`). | Test still calls `validateRoutingTables` (`docs.mjs`), not `computeRoutingWarnings`; its own comment still defers real coverage to `context.test.mjs`. No repo-wide functional gap (genuinely covered at `tools/tests/context.test.mjs:181-186`) — only this task's own "prove it together" claim isn't exercised here. | `tools/tests/e2e-workflow.test.mjs:368-375` | `tools/tests/e2e-workflow.test.mjs:368-375` |
| F3 | NON_BLOCKING | still-present | "A `context_exceptions` entry without a valid `decision` reference is rejected" is proven via the real rejection mechanism (`validateContextExceptions`). | Test still only asserts `parseOwnerDecisions(...).has('D99') === false`, never calling `validateContextExceptions`. Genuinely covered directly at `tools/tests/validation.test.mjs:13-59`. | `tools/tests/e2e-workflow.test.mjs:378` | `tools/tests/e2e-workflow.test.mjs:378` |
| F4 | NON_BLOCKING | still-present | "`until-checkpoint` stops exactly at the requested checkpoint" is proven. | Test still only asserts `until-checkpoint`'s `orderedTasks` selection equals `all-approved-reachable`'s; title still states the stopping behavior is out of scope here. Genuinely covered at `tools/tests/batch.test.mjs:183-206` (`checkpointReached` transitions). | `tools/tests/e2e-workflow.test.mjs:650-653` | `tools/tests/e2e-workflow.test.mjs:650-653` |
| F5 | NON_BLOCKING | still-present | The task file's own "## Verification" section literally specifies `node --test tools/tests/` (no glob). | Still fails outright on this Windows checkout (`Cannot find module 'D:\repos\git\nevo\tools\tests'`, `MODULE_NOT_FOUND`). `node --test tools/tests/*.test.mjs` is the working form. Inherited spec text this task cannot fix under its own `allowed_paths` (`tools/tests/**` only) — task 10's task file is outside that scope. | `specs/active/nevo-ai-process-continuity-and-hardening/tasks/10-workflow-e2e-tests.md:230`; direct run this session confirms both invocations | `specs/active/.../tasks/10-workflow-e2e-tests.md:230` |

F1 is resolved. F2-F5 remain non-blocking, not recorded as follow-ups this run.

## Scope compliance

Confirmed compliant, unchanged since the baseline review. The task's diff is still
exactly one file, `tools/tests/e2e-workflow.test.mjs`, across its two contributing
commits (`c63bef9`, `aa71381`) — no further commits have touched it since
(`git log aa71381..HEAD -- tools/tests/e2e-workflow.test.mjs` is empty). Entirely inside
`allowed_paths` (`tools/tests/**`); no `forbidden_paths` entry (`src/**`, `tests/**`,
`examples/**`, `docs/**`, `.claude/commands/**`, `.claude/skills/**`, `AGENTS.md`,
`CLAUDE.md`) is touched. No scope exception needed.

## Verification

- `node --test tools/tests/*.test.mjs` — passed: 696/696 tests, 118 suites
- `node tools/specs.mjs validate` — passed

Gating validation: passed. Non-gating repository check: passed (indexes current).

## Acceptance-criteria coverage

- [x] All 3 acceptance criteria covered

## Architecture and documentation

Unchanged from baseline: no `docs/development/**` architecture doc describes end-to-end
test behavior, so there is no drift to detect. "Documentation impact: None" (the task's
own claim) remains accurate — task 11 (`workflow-docs-and-adr-migration`, already
`pass` per the last aggregate review) owns consolidated documentation.

## Tests

This task *is* the test-coverage deliverable; coverage gaps are folded into "Findings"
(F1-F5) above rather than repeated here.
