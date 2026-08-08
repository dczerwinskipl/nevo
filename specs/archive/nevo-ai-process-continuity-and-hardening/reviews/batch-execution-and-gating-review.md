---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: batch-execution-and-gating-review
generated: 2026-08-06T18:06:26Z
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: tools/lib/git.mjs
    reason: getChangedFiles is this task's own real whole-batch-diff logic (D19/D24), load-bearing for AC7/AC10/AC11/AC17.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
  - finding: F1
    path: tools/lib/shell-words.mjs
    reason: splitShellWords is this task's own quote-aware self-check verification-command tokenizer (D28), load-bearing for AC7/AC10/AC11/AC17.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
  - finding: F1
    path: package.json
    reason: Incidental, already-tested CI/infra scoping from the same completing commit (aa71381, "scoped tool-tests CI") — no task declares this file.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
  - finding: F1
    path: .github/workflows/tool-tests.yml
    reason: Incidental, already-tested CI/infra scoping from the same completing commit (aa71381, "scoped tool-tests CI") — no task declares this file.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
  - finding: F1
    path: tools/tests/cli-smoke.test.mjs
    reason: Incidental, already-tested CI/infra scoping from the same completing commit (aa71381, "scoped tool-tests CI") — no task declares this file.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
  - finding: F1
    path: tools/tests/verification-command.test.mjs
    reason: Incidental, already-tested CI/infra scoping from the same completing commit (aa71381, "scoped tool-tests CI") — no task declares this file.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-06
    task_fingerprint: "b12e59ee8257cbbc8d41cd4b76a3f33945507fa4c03d8e818420b2644978c0bb"
---

# Review: nevo-ai-process-continuity-and-hardening/batch-execution-and-gating-review

## Verdict

`pass` — the task's own core logic (four-mode selection, derived progress,
hard-stop/risk-signal split, evidence freshness, self-check writer, gating batch review)
is correct, thoroughly tested, and matches its area/owner-decision model. Both findings
from the prior pass are now closed by explicit owner decisions: F1's scope exception is
accepted (recorded below); F2 is resolved by D33 (`self_check.revision` was never meant
to be compared against the batch's current `HEAD` — `tasks/08-....md` AC18 and
`areas/batch-execution-and-gating-review.md` requirement 5a(b) are corrected to match
the implementation, not the other way around).

Baseline read in full before this run touched the file
(`specs/active/nevo-ai-process-continuity-and-hardening/reviews/batch-execution-and-gating-review.md`,
generated `2026-08-05T17:43:40Z`, verdict `blocked`; re-reviewed 2026-08-06 to
`changes-required` before this update). Both of its findings (F1, F2) re-verified
against current file/commit contents; owner decisions collected and applied this run.

## Checklist

- [x] All acceptance criteria covered
  - AC18 corrected (D33) to describe only the `fingerprint` comparison the code
    actually implements; the `revision` field stays audit/provenance metadata
- [x] Required automated verification passed
- [x] Scope check resolved
  - 6 owner-approved exceptions recorded (F1: `tools/lib/git.mjs`,
    `tools/lib/shell-words.mjs`, `package.json`, `.github/workflows/tool-tests.yml`,
    `tools/tests/cli-smoke.test.mjs`, `tools/tests/verification-command.test.mjs`)
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | Every file this task's diff touches is either in the task's own `allowed_paths` or classifies `compliant`/is exempt as `consequential_paths` | *(accepted — owner-approved exceptions, not active blockers)* `tools/lib/git.mjs`/`tools/lib/shell-words.mjs` are load-bearing for AC7/AC10/AC11/AC17; `package.json`/`.github/workflows/tool-tests.yml`/`tools/tests/cli-smoke.test.mjs`/`tools/tests/verification-command.test.mjs` are incidental, already-tested CI/infra scoping from the same completing commit (`aa71381`). All six classify `outside-allowed` (never `forbidden`) and are now recorded as accepted exceptions in this file's `scope_exceptions` frontmatter. The implementation still exceeded its declared scope; this note states that every time the report is written, per D31. | `scope_exceptions` entries above; `git show aa71381 --stat`. | `tools/lib/git.mjs`, `tools/lib/shell-words.mjs`, `package.json`, `.github/workflows/tool-tests.yml`, `tools/tests/cli-smoke.test.mjs`, `tools/tests/verification-command.test.mjs` |
| F2 | OWNER_DECISION | resolved | `staleEvidenceTasks` (D19/D28, area requirement 5a(b)) compares each batched task's `self_check.fingerprint` against its *current* semantic fingerprint as the staleness predicate | *(resolved — D33)* The area doc/AC18 text describing a `self_check.revision`-vs-current-`HEAD` comparison was itself wrong, not the code: in a sequential batch `HEAD` advances after every task, so a literal revision-equality predicate would flag every already-passing earlier task as stale purely from later tasks committing — a real regression the owner explicitly rejected once surfaced, also already falsified by two passing `batch.test.mjs` fixtures that never set `self_check.revision` at all. `tasks/08-....md` AC18 and `areas/batch-execution-and-gating-review.md` requirement 5a(b) are corrected to describe the fingerprint-only predicate the code has always correctly implemented; `revision` stays recorded as audit/provenance metadata only. No code change to `staleEvidenceTasks`. | `owner-decisions.md` D33; corrected `tasks/08-....md`/`areas/batch-execution-and-gating-review.md` text (re-read after edit). | `tools/specs/lifecycle.mjs` (`staleEvidenceTasks`, unchanged), `tasks/08-....md`, `areas/batch-execution-and-gating-review.md` (both corrected) |
| F3 | NON_BLOCKING | still-present | — | `tools/tests/batch.test.mjs` (and task 10's `tools/tests/e2e-workflow.test.mjs`) still exercise every batch mechanism only at the pure `lifecycle.mjs`-function level — none of `handleBatchStart`/`handleBatchStatus`/`handleBatchReview`/`handleSelfCheck` are exercised against a real fixture with real file I/O/git, unlike `tools/tests/start.test.mjs`'s fixture-backed convention. All verification below passes; coverage-depth observation, not a demonstrated defect. Candidate for follow-up recording — left unrecorded pending the orchestrator's centralized decision collection for this run. | `Grep` for `handleBatchStart\|handleBatchReview\|handleBatchStatus\|handleSelfCheck` in `tools/tests/` matches only a comment in `tools/tests/batch.test.mjs` referencing `handleBatchReview`, not a call. | `tools/tests/batch.test.mjs` |

## Scope compliance

`docs/development/**`, `src/**`, `tests/**`, `examples/**` (this task's `forbidden_paths`)
remain untouched by either commit that implements this task (`a25ad2f`, `aa71381`) —
confirmed via `git show --stat` on both. `a25ad2f` (the original implementation) stays
entirely within `allowed_paths`. `aa71381` (the completing fix commit) touches, outside
`allowed_paths`/`consequential_paths`: `tools/lib/git.mjs`, `tools/lib/shell-words.mjs`
(load-bearing for this task), `.claude/commands/nevo-ai/spec-review.md` (in task 04's own
`allowed_paths`), `package.json`, `.github/workflows/tool-tests.yml`,
`tools/tests/cli-smoke.test.mjs`, `tools/tests/verification-command.test.mjs` (incidental
CI/infra scoping, no task declares these four), `tools/tests/git.test.mjs`,
`tools/tests/task-lifecycle.test.mjs` (in task 02's own `allowed_paths`),
`tools/tests/e2e-workflow.test.mjs` (in task 10's own `allowed_paths`). Every
undeclared-for-this-task path classifies `outside-allowed` via `classifyScopeFinding`
(never `forbidden`); the six not covered by another task's own declared scope
(`tools/lib/git.mjs`, `tools/lib/shell-words.mjs`, `package.json`,
`.github/workflows/tool-tests.yml`, `tools/tests/cli-smoke.test.mjs`,
`tools/tests/verification-command.test.mjs`) are now recorded as owner-approved
exceptions in this file's `scope_exceptions` frontmatter (F1, accepted).

## Verification

- `node --test tools/tests/batch.test.mjs` — passed (67/67, 12 suites)
- `node --test tools/tests/task-lifecycle.test.mjs` — passed (106/106, 15 suites)
- `node tools/specs.mjs validate` — passed (`Validated 6 changes — no errors.`)

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs
validate` — both clean, run just now).
Non-gating repository check: `node tools/specs.mjs check` — passed (`Specs valid and
indexes are current.`); `node tools/docs.mjs check` — passed (`Indexes are current.`).
Both non-gating checks are now clean (the baseline's `F3` — stale
`specs/index.generated.json` from unrelated task 12 state — no longer applies; task 12
was regenerated/verified since).

## Acceptance-criteria coverage

- AC1-AC17: met, with real test coverage (selection modes and rejection,
  single-in-implementation invariant, derived-progress reconstruction after
  interruption, risk-signal/hard-stop split, temporary-inconsistency exemption,
  evidence-staleness detection, verdict-table correctness, `self_check` write shape) —
  re-confirmed by the passing test run above.
- AC18: **met** — the fingerprint comparison is implemented and tested; its own text is
  now corrected (D33) to state that `self_check.revision` is audit/provenance metadata,
  not a second staleness predicate compared against the batch's current `HEAD`.

## Architecture and documentation

Consistent with `areas/batch-execution-and-gating-review.md` (D10, D11, D19, D20, D24,
D28) and the referenced owner decisions, re-read in full this run — every
requirement/constraint maps to a corresponding function or test, with the one exception
still open in F2. Documentation impact named by the task file (`task-review.md`,
`task-next.md`, `review-policy.md`, `templates/review-report.md`) remains fully
delivered — all four still carry the batch-execution content (`task-review.md`'s step
9a0 batch-continuation offer including the `until-checkpoint` boundary and
`validationBlocksContinuation`; `task-next.md`'s `batch-start` mention; `review-policy.md`'s
"Batch review" section; `templates/review-report.md`'s batch frontmatter/section shape).
No `docs/development/**` architecture doc describes batch execution, so no drift there.

## Tests

Behavior changes have corresponding automated test coverage for every acceptance
criterion except AC18's revision half (F2) and the CLI-handler I/O depth gap (F3,
non-blocking).
