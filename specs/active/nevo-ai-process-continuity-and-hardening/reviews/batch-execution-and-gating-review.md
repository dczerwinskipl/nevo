---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: batch-execution-and-gating-review
generated: 2026-08-06T18:06:26Z
verdict: changes-required
unresolved_required_fixes: 0
unresolved_owner_decisions: 2
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/batch-execution-and-gating-review

## Verdict

`changes-required` — the task's own core logic (four-mode selection, derived progress,
hard-stop/risk-signal split, evidence freshness, self-check writer, gating batch review)
is correct, thoroughly tested, and matches its area/owner-decision model, but two
unresolved `OWNER_DECISION` findings remain open (F1: a scope finding classified
`outside-allowed`, resolvable via the D31 owner-approved-exception menu but not yet
resolved; F2: an undocumented predicate substitution in `staleEvidenceTasks`). Per D31,
an unresolved `outside-allowed` scope finding routes to `changes-required`, not
`blocked` — `blocked` is reserved for a more fundamental stop (verification evidence
that cannot be produced at all, or a `forbidden`-classified path), neither of which
applies here.

Baseline read in full before this run touched the file
(`specs/active/nevo-ai-process-continuity-and-hardening/reviews/batch-execution-and-gating-review.md`,
generated `2026-08-05T17:43:40Z`, verdict `blocked`). Both of its findings (F1, F2)
re-verified against current file/commit contents below; their exact predicates are
unchanged since that baseline.

## Checklist

- [ ] All acceptance criteria covered
  - AC18: not fully met — see F2 (the `self_check.revision` half of the staleness
    predicate is not implemented in the gating-review path)
- [x] Required automated verification passed
- [ ] Scope check resolved
  - F1: unresolved `outside-allowed` scope finding (`tools/lib/git.mjs`,
    `tools/lib/shell-words.mjs`) — no `scope_exceptions` entry recorded
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [ ] No unresolved blocking findings
  - F1, F2 (see below)
- [ ] No unresolved owner decision
  - 2 unresolved owner decisions (F1, F2)

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | still-present | Every file this task's diff touches is either in the task's own `allowed_paths` or classifies `compliant`/is exempt as `consequential_paths` | Re-verified against current commit content: `getChangedFiles` (`tools/lib/git.mjs`, added in `aa71381`) is task 08's own real whole-batch-diff logic (D19/D24, used by `handleBatchReview`); `splitShellWords` (`tools/lib/shell-words.mjs`, new file, `aa71381`) is task 08's own quote-aware self-check verification-command tokenizer (D28, used by `runVerificationCommand`). Both are load-bearing for this task's own acceptance criteria (AC7, AC10, AC11, AC17) but neither path is in `allowed_paths` (`tools/lib/**` is not declared) or `consequential_paths` (`[]`). `classifyScopeFinding(path, {allowedPaths, forbiddenPaths})` returns `outside-allowed` for both — neither matches a `forbidden_paths` pattern (`src/**`, `tests/**`, `examples/**`, `docs/development/**`), so this is resolvable via the D31 owner-approved-exception menu (accept / return to declared scope / leave unresolved) — not something this review can decide on its own. The same commit also touches several other undeclared paths, all likewise `outside-allowed`, none `forbidden`: `.claude/commands/nevo-ai/spec-review.md`, `package.json`, `.github/workflows/tool-tests.yml` (new), `tools/tests/cli-smoke.test.mjs`, `tools/tests/verification-command.test.mjs`, `tools/tests/git.test.mjs`, `tools/tests/task-lifecycle.test.mjs`, `tools/tests/e2e-workflow.test.mjs` — these are incidental to a broader post-hoc fix commit spanning multiple tasks' concerns (per the commit's own message, "addresses an external re-review... six work packets"), not load-bearing for task 08's own acceptance criteria specifically, and not attributable to any task's declared scope as written. No `scope_exceptions` entry exists in this file's frontmatter and no owner decision in `owner-decisions.md` (checked D30-D32, the only recent entries) addresses this. Unresolved. | `git show aa71381 -- tools/lib/git.mjs` / `tools/lib/shell-words.mjs` shows both files' content is exactly `getChangedFiles`/`splitShellWords`; `git show aa71381 --stat` lists all touched paths; task 08's context packet `allowed_paths` = `[tools/specs/lifecycle.mjs, tools/specs/service.mjs, tools/specs.mjs, tools/tests/batch.test.mjs, .claude/commands/nevo-ai/task-review.md, .claude/commands/nevo-ai/task-next.md, .claude/skills/nevo-ai-spec-workflow/templates/review-report.md, .claude/skills/nevo-ai-spec-workflow/references/review-policy.md]`, `consequential_paths: []`; `owner-decisions.md` D30/D31/D32 concern tasks 12/13, not this finding. | `tools/lib/git.mjs`, `tools/lib/shell-words.mjs` (+ incidental paths above) |
| F2 | OWNER_DECISION | still-present | `staleEvidenceTasks` (D19/D28, area requirement 5a(b)) compares each batched task's `self_check.fingerprint` **and** `self_check.revision` against its *current* semantic fingerprint/revision as one predicate, separate from the file-overlap check (5a(a)) | Re-read `tools/specs/lifecycle.mjs` just now: `staleEvidenceTasks` (lines 732-753) still only ever compares `task.self_check.fingerprint !== currentFp` — it never receives or compares a "current revision" value; `handleBatchReview` still never computes one to pass in. The fingerprint+revision comparison the area doc (requirement 5a(b)) and AC18 both name explicitly is still correctly implemented only in `describeSelfCheck` (lines 953-959: `selfCheck.fingerprint === current.fingerprint && selfCheck.revision === current.revision`), which serves the single-task resume path (`deriveStage`), not the gating batch review. Checked for documentation of this as an intentional substitution since the baseline: the task file's AC18 text, the area doc's requirement 5a(b) text, and `owner-decisions.md` (D30-D32, the only entries added since the baseline review) are all unchanged and still describe the literal fingerprint-and-revision comparison — no ADR or decision record documents the substitution. Still undocumented, still a live design question for the owner (accept the substitution and correct the written AC/area text, or require the literal revision check). | `tools/specs/lifecycle.mjs:732-753` (`staleEvidenceTasks`, re-read this run) vs. `tools/specs/lifecycle.mjs:953-959` (`describeSelfCheck`); `grep` for `self_check.revision`/`AC18` across `specs/active/nevo-ai-process-continuity-and-hardening/` finds only the pre-existing task/area text and the prior reviews, no new documentation. | `tools/specs/lifecycle.mjs` (`staleEvidenceTasks`), `tools/specs.mjs` (`handleBatchReview`) |
| F3 | NON_BLOCKING | still-present | — | `tools/tests/batch.test.mjs` (and task 10's `tools/tests/e2e-workflow.test.mjs`) still exercise every batch mechanism only at the pure `lifecycle.mjs`-function level — none of `handleBatchStart`/`handleBatchStatus`/`handleBatchReview`/`handleSelfCheck` are exercised against a real fixture with real file I/O/git, unlike `tools/tests/start.test.mjs`'s fixture-backed convention. All verification below passes; coverage-depth observation, not a demonstrated defect. Candidate for follow-up recording — left unrecorded pending the orchestrator's centralized decision collection for this run. | `Grep` for `handleBatchStart\|handleBatchReview\|handleBatchStatus\|handleSelfCheck` in `tools/tests/` matches only a comment in `tools/tests/batch.test.mjs` referencing `handleBatchReview`, not a call. | `tools/tests/batch.test.mjs` |

## Scope compliance

**Not clean — 1 unresolved `outside-allowed` finding (F1), 0 `forbidden`.**
`docs/development/**`, `src/**`, `tests/**`, `examples/**` (this task's `forbidden_paths`)
remain untouched by either commit that implements this task (`a25ad2f`, `aa71381`) —
confirmed via `git show --stat` on both, re-checked this run. `a25ad2f` (the original
implementation) stays entirely within `allowed_paths`. `aa71381` (the completing fix
commit) touches, outside `allowed_paths`/`consequential_paths`: `tools/lib/git.mjs`,
`tools/lib/shell-words.mjs` (new — both load-bearing for this task, see F1),
`.claude/commands/nevo-ai/spec-review.md`, `package.json`,
`.github/workflows/tool-tests.yml` (new), `tools/tests/cli-smoke.test.mjs`,
`tools/tests/verification-command.test.mjs`, `tools/tests/git.test.mjs`,
`tools/tests/task-lifecycle.test.mjs`, `tools/tests/e2e-workflow.test.mjs`. Every one of
these classifies `outside-allowed` via `classifyScopeFinding` (none matches a
`forbidden_paths` pattern). No `scope_exceptions` entry is recorded in this file — F1 is
unresolved. No owner decision recorded elsewhere accepts, rejects, or otherwise resolves
it.

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
- AC18: **not fully met** — the fingerprint half is implemented and tested; the
  `self_check.revision` half named explicitly in the AC's own text is not implemented as
  its own predicate in the gating-review path (F2).

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
