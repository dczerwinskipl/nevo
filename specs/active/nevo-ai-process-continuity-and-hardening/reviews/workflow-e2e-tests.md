---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: workflow-e2e-tests
generated: 2026-08-05
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/workflow-e2e-tests

## Verdict

`changes-required` — one scenario the task itself requires (`REC-03`, "stale generated
file repairs and the original validation retries") has no test anywhere in the repo that
actually exercises that behavior; the test carrying that name only feeds synthetic input
into a generic, unrelated postcondition classifier.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Scope compliance

Confirmed compliant. This task's own diff is exactly one file,
`tools/tests/e2e-workflow.test.mjs`:

- `git show --stat c63bef9` ("test(specs): cross-mechanism end-to-end tests proving
  tasks 01-09 work together (task 10)") — `tools/tests/e2e-workflow.test.mjs | 873
  ++++...`, one file.
- A later, repo-wide fix commit (`aa71381`, not attributed to any single task — commit
  message: "Addresses an external re-review ... applied directly to the tooling rather
  than through the per-task review process") touched this same file by 4 lines
  (`git show aa71381 -- tools/tests/e2e-workflow.test.mjs`), adding the `checkpointTask`/
  `checkpointReached` fields to an existing assertion. Still entirely inside
  `tools/tests/**`.

Both allowed_paths (`tools/tests/**`) and forbidden_paths (`src/**`, `tests/**`,
`examples/**`, `docs/**`, `.claude/commands/**`, `.claude/skills/**`, `AGENTS.md`,
`CLAUDE.md`) from `node tools/specs.mjs context nevo-ai-process-continuity-and-hardening
workflow-e2e-tests` are respected — no forbidden path is touched by this task's diff.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | The task's own "Recovery" scenario list requires "`REC-03` (stale generated file) repairs and the original validation retries," and requires every scenario to "actually exercise the real implementation ... no test doubles standing in for the mechanism under test." | No test anywhere in `tools/tests/**` proves this — the only test with this name feeds a fabricated `{ ok: false, reason: 'stale generated file' }` object into `inspectApprovePostconditions`, a fully generic ok/not-ok → result-class mapper with zero knowledge of generated files, staleness, or regeneration. Add a real test that stales a generated index (e.g. `specs/index.generated.json`), shows `node tools/specs.mjs check` detects it, an automatic repair regenerates it, and the original failing validation then succeeds on retry. | `inspectApprovePostconditions` (`tools/specs/lifecycle.mjs:254-262`) only branches on `approvalResult.ok`/`idempotent` — nothing stale-file-specific. `cli-errors.test.mjs:31` tests only that `REC-03` is classified `{name: STALE_GENERATED_FILE, class: automatic}`, no behavior. `grep -r "stale generated\|staleGeneratedFile" tools/tests` matches only the one synthetic test itself. | `tools/tests/e2e-workflow.test.mjs:240-246` |
| F2 | NON_BLOCKING | first-review | The task's "Context and follow-ups" list requires "missing inferred context produces a deterministic warning," proven against the real mechanism. | The test under this name never calls `computeRoutingWarnings` (the actual warning-producing function) — it calls `validateRoutingTables` from `docs.mjs` instead and its own comment states the real coverage is deferred: "Reuses service.mjs's computeRoutingWarnings indirectly is covered by context.test.mjs." The underlying mechanism is genuinely and thoroughly tested end-to-end elsewhere (including against a real task via `buildContextPacket`), so no functional gap exists repo-wide — only this task's own claim to prove it "together" isn't actually exercised here. | `tools/tests/e2e-workflow.test.mjs:366-375` vs. `tools/specs/service.mjs:68-87` (`computeRoutingWarnings`) vs. genuine coverage at `tools/tests/context.test.mjs:181-186` | `tools/tests/e2e-workflow.test.mjs:366-375` |
| F3 | NON_BLOCKING | first-review | The task's "Context and follow-ups" list requires "a `context_exceptions` entry without a valid `decision` reference is rejected." | The test only asserts `parseOwnerDecisions(...).has('D99') === false` — it never calls `validateContextExceptions` (the actual rejection mechanism). That function is genuinely tested directly in `validation.test.mjs`, so no functional gap exists repo-wide, but this task's own test is a proxy, not a proof of rejection. | `tools/tests/e2e-workflow.test.mjs:377-380` vs. `tools/specs/validation.mjs:165-176` (`validateContextExceptions`) vs. genuine direct coverage at `tools/tests/validation.test.mjs:13-59` | `tools/tests/e2e-workflow.test.mjs:377-380` |
| F4 | NON_BLOCKING | first-review | The task's "Second refinement pass — batch selection modes (D20)" list requires "`until-checkpoint` stops exactly at the requested checkpoint." | The `until-checkpoint` test in this file only asserts its `orderedTasks` selection equals `all-approved-reachable`'s, and its own title states the stopping behavior is out of scope here ("checkpoint bounds execution, not selection"). The actual checkpoint-boundary mechanism (`deriveBatchProgress`'s `checkpointReached`) is genuinely tested with real transitions in `batch.test.mjs`, so no functional gap exists repo-wide. | `tools/tests/e2e-workflow.test.mjs:650-653` vs. genuine coverage at `tools/tests/batch.test.mjs:183-206` (`checkpointReached` true/false transitions) | `tools/tests/e2e-workflow.test.mjs:650-653` |
| F5 | NON_BLOCKING | first-review | The task file's own "## Verification" section literally specifies `node --test tools/tests/` (no glob). | This exact invocation fails outright on this Windows checkout: `Error: Cannot find module 'D:\repos\git\nevo\tools\tests'` (`MODULE_NOT_FOUND`), 0 tests run. The working form used elsewhere in this repo (and by task 12's own, later-written Verification section) is `node --test tools/tests/*.test.mjs`. This is inherited spec text — tasks 01, 04, 09, and 10 itself all use the same unglobbed form; task 10 cannot correct its own task file under its own `allowed_paths` (`tools/tests/**` only). | Direct run, this session: `node --test tools/tests/` → `not ok 1 - tools\\tests`, `MODULE_NOT_FOUND`. `node --test tools/tests/*.test.mjs` → 112 suites, 669 tests run. `grep -rn "node --test tools/tests/$" specs/active/.../tasks/*.md` also matches tasks 04 and 11; task 12 already uses the glob form. | `specs/active/nevo-ai-process-continuity-and-hardening/tasks/10-workflow-e2e-tests.md:230` |
| F6 | INFORMATIONAL | — | Non-gating repository check (`node tools/specs.mjs check`) | Fails: `stale: specs/active.generated.md`, `stale: specs/archive.generated.md`, `stale: specs/index.generated.json`. Not self-caused by this task's diff — this task touches only `tools/tests/e2e-workflow.test.mjs`, no `specs/**` source. Confirmed cause: `node tools/specs.mjs generate` (run, diffed, then reverted via `git checkout`) shows the only real change is task 12's (`implementation-review-orchestration`, still `status: in-implementation`) `self_check` block, present in `change.yaml` but not yet folded into `specs/index.generated.json`. Gating validation is clean: `node tools/specs.mjs validate` → "Validated 6 changes — no errors."; `node tools/docs.mjs validate` → "Validated 60 documents — no errors."; `node tools/docs.mjs check` → "Indexes are current." | — |

## Acceptance-criteria coverage

1. "Every scenario listed above has a passing automated test." — **Not fully met.**
   Every scenario has a test *by that name*, but `REC-03` (F1) doesn't actually test the
   named behavior, and three further scenarios (F2-F4) are proxy assertions rather than
   proofs of the named mechanism — though those three are separately, genuinely proven
   elsewhere in the repo, so only F1 is a real coverage gap.
2. "`node --test tools/tests/` passes in full, with the new cross-mechanism scenarios
   clearly attributable to this task." — **Untestable as literally written** (F5); using
   the correct glob form, `node --test tools/tests/*.test.mjs` → 112 suites, 668 pass /
   669 total. The one failure (`tools/specs.mjs CLI smoke tests` → `check exits 0 when
   generated indexes are current`) is the same, pre-existing, non-self-caused staleness
   as F6 — not a regression this task introduced. Every scenario group in this file is
   attributable to this task via its own `describe` block (`Fingerprints`, `Recovery`,
   `Batch`, `Context and follow-ups`, `Finalization`, `D16` through `D28`).
3. "No test in this task's added files touches `docs/**`/`.claude/**` as its subject —
   only `tools/`-level mechanisms are exercised (inspection)." — **Met.** The only
   `docs/`-shaped strings in the file are fixture literals passed to
   `validateRoutingTables` (real function, real repo module, `tools/docs.mjs`), not
   references to the real `docs/**` tree.

## Architecture and documentation

No `docs/development/**` architecture doc describes end-to-end test behavior, so there is
no drift to detect here. "Documentation impact: None" (the task's own claim) is accurate
— this task adds tests only; task 11 (already `implemented`) owns the consolidated
documentation and ADR.

## Tests

This task *is* the test-coverage deliverable. Test-coverage findings are folded into
"Findings" above (F1-F4) rather than repeated here. Verification evidence:

```
node --test tools/tests/*.test.mjs
# 112 suites, 669 tests, 668 pass, 1 fail (pre-existing, unrelated — see F6)

node tools/specs.mjs validate
# Validated 6 changes — no errors.
```
