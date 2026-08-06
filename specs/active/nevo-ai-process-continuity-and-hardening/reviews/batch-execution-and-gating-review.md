---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: batch-execution-and-gating-review
generated: 2026-08-05T17:43:40Z
verdict: blocked
unresolved_required_fixes: 0
unresolved_owner_decisions: 2
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/batch-execution-and-gating-review

## Verdict

`blocked` — the task's own core logic (four-mode selection, derived progress, hard-stop/
risk-signal split, evidence freshness, self-check writer, gating batch review) is
correct, thoroughly tested, and matches its area/owner-decision model, but the diff that
actually makes it work (commit `aa71381`) writes to files outside this task's declared
`allowed_paths`/`consequential_paths` — a scope violation, which `task-review.md` itself
names as the canonical example of `blocked` rather than `changes-required`.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | first-review | Every file this task's diff touches is listed in the task's own `allowed_paths` or `consequential_paths` | Task 08's load-bearing logic (real whole-batch diff via `git.getChangedFiles`, quote-aware self-check command parsing via `splitShellWords`) was added in `tools/lib/git.mjs` and the new `tools/lib/shell-words.mjs` — neither is in `allowed_paths` (`tools/lib/git.mjs` is task 02's declared file per `tasks/02-recovery-classification-and-machine-readable-errors.md`) or in `consequential_paths` (context packet reports `"consequential_paths": []`). The same commit (`aa71381`) also touched `.claude/commands/nevo-ai/spec-review.md`, `package.json`, the new `.github/workflows/tool-tests.yml`, and test files not declared for this task (`tools/tests/cli-smoke.test.mjs`, `tools/tests/verification-command.test.mjs`, `tools/tests/git.test.mjs`, `tools/tests/task-lifecycle.test.mjs`, `tools/tests/e2e-workflow.test.mjs`) — none of these appear in any task's declared paths at all for the `.github`/`package.json` items. Remediation is a judgment call (retroactively extend this task's declared scope vs. treat the commit as a legitimate cross-cutting fix vs. split it after the fact), not a mechanical one. | `git show --stat aa71381` lists `tools/lib/git.mjs`, `tools/lib/shell-words.mjs` (new), `.claude/commands/nevo-ai/spec-review.md`, `package.json`, `.github/workflows/tool-tests.yml`, and the test files above; task 08's context packet's `allowed_paths` is exactly `[tools/specs/lifecycle.mjs, tools/specs/service.mjs, tools/specs.mjs, tools/tests/batch.test.mjs, .claude/commands/nevo-ai/task-review.md, .claude/commands/nevo-ai/task-next.md, .claude/skills/nevo-ai-spec-workflow/templates/review-report.md, .claude/skills/nevo-ai-spec-workflow/references/review-policy.md]`; `handleBatchReview` (`tools/specs.mjs:558`) calls `git.getChangedFiles`, and `handleSelfCheck`'s `runVerificationCommand` (`tools/specs.mjs:404-411`) calls `splitShellWords` — both load-bearing for this task's own acceptance criteria (AC7/AC10/AC11/AC17). | `tools/lib/git.mjs`, `tools/lib/shell-words.mjs` |
| F2 | OWNER_DECISION | first-review | `staleEvidenceTasks` (D19/D28, area requirement 5a(b)) compares each batched task's `self_check.fingerprint` **and** `self_check.revision` against its *current* semantic fingerprint/revision as one predicate, separate from the file-overlap check (5a(a)) | The actual implementation of `staleEvidenceTasks` in `tools/specs/lifecycle.mjs` only ever compares `fingerprint`; it never receives or compares a "current revision" value at all — `handleBatchReview` (`tools/specs.mjs`) never computes one to pass in. The fingerprint+revision comparison the area doc and AC18 both name explicitly *is* correctly implemented elsewhere — `describeSelfCheck` (`tools/specs/lifecycle.mjs:953-959`), used by `deriveStage` for the single-task resume path — but that code path is never invoked by the gating batch review. This may be an intentional, arguably superior substitution (the real per-file diff-overlap check is more precise than a raw revision-equality comparison, which would over-invalidate every earlier task's evidence the moment *any* later commit lands, regardless of relevance — exactly what D19's own rationale warns against), but as written it is a literal deviation from the task's own "Implementation constraints" text and AC18's wording, untested for the revision-only case. This is a design question for the owner to confirm (accept the substitution and correct the written AC/area text to match, or require the literal revision check) rather than a fix an agent should silently pick a side on. | `tools/specs/lifecycle.mjs:732-753` (`staleEvidenceTasks`) never references `self_check.revision`; compare to `tools/specs/lifecycle.mjs:953-959` (`describeSelfCheck`), which does `selfCheck.fingerprint === current.fingerprint && selfCheck.revision === current.revision`. `tools/tests/batch.test.mjs`'s AC18 test (`"a self_check.fingerprint no longer matching the current fingerprint is stale..."`) only exercises the fingerprint half. | `tools/specs/lifecycle.mjs` (`staleEvidenceTasks`), `tools/specs.mjs` (`handleBatchReview`) |
| F3 | INFORMATIONAL | first-review | — | `node tools/specs.mjs check` reports `stale: specs/index.generated.json`, but regenerating and diffing it shows the only change is task 12 (`implementation-review-orchestration`)'s own `self_check` block being newly present in `change.yaml` — an unrelated, currently-in-implementation task, not anything task 08's own diff touches (task 08's `allowed_paths` never includes any `specs/**` source file). Per review-policy's "Gating versus non-gating checks," this is repository-wide non-gating staleness attributable to other, unrelated work, not a blocking finding for this task. Reverted the accidental regeneration (`git checkout -- specs/index.generated.json specs/active.generated.md specs/archive.generated.md`) to keep this review read-only. | `node tools/specs.mjs check` → `stale: specs/index.generated.json`; `git diff -- specs/index.generated.json` after a throwaway `generate` showed only task 12's `self_check` block appearing. | — |
| F4 | NON_BLOCKING | first-review | — | `tools/tests/batch.test.mjs` (and, consistently, task 10's `tools/tests/e2e-workflow.test.mjs`) exercise every batch mechanism exclusively at the pure `lifecycle.mjs`-function level; none of the actual CLI handlers this task adds (`handleBatchStart`, `handleBatchStatus`, `handleBatchReview`, `handleSelfCheck`) are exercised against a real fixture with real file I/O/git, unlike `tools/tests/start.test.mjs`'s convention of fixture-backed tests for comparable I/O-touching code. All manual verification below passes, so this is a coverage-depth observation, not a demonstrated defect — candidate for follow-up recording (not recorded — requires owner-facing confirmation, out of scope for this subagent run). | `Grep` for `handleBatchStart\|handleBatchReview\|handleBatchStatus\|handleSelfCheck` across `tools/tests/` matches only `tools/tests/batch.test.mjs` (the exported-function list, not a call) and `tools/tests/verification-command.test.mjs` (tests `runVerificationCommand`/`splitShellWords` directly, still not the full `handleSelfCheck` I/O path). | `tools/tests/batch.test.mjs`, `tools/tests/e2e-workflow.test.mjs` |
| F5 | INFORMATIONAL | first-review | — | The task's own comment header in `tools/tests/batch.test.mjs` ("`// Run: node --test tools/tests/`") uses the bare-directory form that fails on this Windows repo (`MODULE_NOT_FOUND`) rather than the working `node --test tools/tests/*.test.mjs`. This is not unique to this task — the identical comment appears in several test files that predate this change on `main` (e.g. `tools/tests/fs-safety.test.mjs`, `tools/tests/bash-guard.test.mjs`, `tools/tests/index-generation.test.mjs`), and the task's own "## Verification" section (and `package.json`'s `test` script, and the new CI workflow) already use explicit file paths / the correct glob, not the broken bare form. Pre-existing repo-wide convention, not introduced or worsened by this task. | `git log main -1 -- tools/tests/fs-safety.test.mjs` shows the file predates this branch; `package.json`'s `"test"` script uses `node --test tools/tests/*.test.mjs`. | `tools/tests/batch.test.mjs:6` |

## Scope compliance

**Not clean.** `docs/development/**`, `src/**`, `tests/**`, `examples/**` (this task's
`forbidden_paths`) are untouched by either commit that implements this task
(`a25ad2f`, `aa71381`) — confirmed via `git show --stat` on both. However, the diff that
completes this task's own acceptance criteria (`aa71381`) touches several files outside
`allowed_paths`/`consequential_paths` — see F1. The original implementation commit
(`a25ad2f`) alone stayed entirely within `allowed_paths`.

## Acceptance-criteria coverage

All 18 acceptance criteria have a directly corresponding, passing automated test in
`tools/tests/batch.test.mjs` (cross-checked by name/AC-tag against every `describe`/
`test` block) and/or `tools/tests/e2e-workflow.test.mjs`, with one caveat:

- AC1–AC17: met, with real test coverage (selection modes and rejection, single-
  in-implementation invariant, derived-progress reconstruction after interruption,
  risk-signal/hard-stop split, temporary-inconsistency exemption, evidence-staleness
  detection, verdict-table correctness, `self_check` write shape).
- AC18: **partially met** — the fingerprint half is implemented and tested; the
  `self_check.revision` half named explicitly in the AC's own text is not implemented as
  its own predicate in the gating-review path (see F2). Whether the actual
  fingerprint-plus-real-diff-overlap design already satisfies AC18's intent, or the
  literal revision comparison is still required, is the open question in F2.

## Architecture and documentation

Consistent with `areas/batch-execution-and-gating-review.md` (D10, D11, D19, D20, D24,
D28) and the referenced owner decisions — read in full; every requirement/constraint in
the area doc maps to a corresponding function or test, with the one exception noted in
F2. Documentation impact named by the task file (`task-review.md`, `task-next.md`,
`review-policy.md`, `templates/review-report.md`) is fully delivered — all four were
updated across `a25ad2f`/`aa71381`, verified by direct reading:
`task-review.md`'s step 9a0 implements the batch-continuation offer exactly as the area
doc describes (including the `until-checkpoint` boundary and
`validationBlocksContinuation`); `task-next.md`'s step 5 names `batch-start` as an
available alternative without ever running it; `review-policy.md` carries the full
"Batch review" section; `templates/review-report.md` carries the batch frontmatter/
section shape. No `docs/development/**` architecture doc describes batch execution, so
no drift there.

## Tests

`node --test tools/tests/batch.test.mjs` — 67/67 passing (12 suites), run just now.
`node --test tools/tests/task-lifecycle.test.mjs` — 106/106 passing (15 suites), run just
now. `node tools/specs.mjs validate` — `Validated 6 changes — no errors.`, run just now.
Real output, not assumed. (Separately confirmed, per this review's own instructions: the
bare `node --test tools/tests/` form does fail on this Windows repo with
`MODULE_NOT_FOUND` — but this task's own "## Verification" section never uses that form,
so it is not a finding against this task; see F5 for the unrelated stale-comment
observation.)

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs
validate` — both clean).
Non-gating repository check: `node tools/specs.mjs check` failed (`stale:
specs/index.generated.json`) — caused by unrelated task 12 self-check state, not this
task's diff (see F3); `node tools/docs.mjs check` passed (`Indexes are current.`).
