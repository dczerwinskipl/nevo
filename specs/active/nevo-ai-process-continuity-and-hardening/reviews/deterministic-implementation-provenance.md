---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: deterministic-implementation-provenance
generated: 2026-08-08
verdict: changes-required
unresolved_required_fixes: 0
unresolved_owner_decisions: 2
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: tools/lib/git.mjs
    reason: Dedicated git helpers (getWorktreeDiff, findCommitsMentioning) belong
      naturally in the shared git module; every other path this task touched is
      in-scope. Re-affirms D36 — the underlying change is unchanged, only the
      task's semantic fingerprint moved (AC5/AC5a/AC8a wording edits).
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-08
    task_fingerprint: "bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15"
---

# Review: nevo-ai-process-continuity-and-hardening/deterministic-implementation-provenance

Baseline read in full from the prior `reviews/deterministic-implementation-provenance.md`
(generated 2026-08-07, verdict `changes-required`, F1 accepted as a D36 scope exception,
F2/F3 open `OWNER_DECISION` findings, F4/F5 `NON_BLOCKING`). This run re-verifies every
baseline finding's exact predicate against current file contents and computes new
findings independently.

## Verdict

`changes-required` — AC6 and AC7/AC9 remain unmet (F2, F3, unchanged from baseline). F1
(the D36 scope exception for `tools/lib/git.mjs`) was found invalid this run — the
task's own semantic fingerprint changed since acceptance — and was re-affirmed by the
owner at the consolidated decision stage (2026-08-08, `owner-decisions.md` D41), against
the current fingerprint; its lifecycle is now `accepted` and it no longer contributes to
the unresolved-blocking count.

## Checklist

Computed by `computeTaskReviewChecklist` (verified with the real function).

```
- [ ] All acceptance criteria covered
  - AC6: not met — see F2
  - AC7: not met — see F3
  - AC9 (required automated regression test): missing — see F3
- [x] Required automated verification passed
- [x] Scope check resolved
  - tools/lib/git.mjs is outside allowed_paths/consequential_paths; F1 re-accepted
    as an owner-approved exception against the current task fingerprint (D41)
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [ ] No unresolved owner decision
  - 2 unresolved owner decision(s) remain (F2, F3) — F1 accepted (D41), excluded
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | Every existing `scope_exceptions` entry is still valid: same path, and `isScopeExceptionValid` confirms the task's current semantic fingerprint matches the fingerprint recorded at acceptance | The D36 exception recorded `task_fingerprint: 7013dbba4965bbd8387de72f3d0f6a964b71ea06c0c75ac28324026fee1d56d0` for `tools/lib/git.mjs` (`getWorktreeDiff`/`findCommitsMentioning`, still present, unchanged since D36). `node tools/specs.mjs fingerprint nevo-ai-process-continuity-and-hardening --task deterministic-implementation-provenance` now prints `bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15` — `computeTaskFingerprint` hashes the task file's own `body` text, and `tasks/15-deterministic-implementation-provenance.md` was edited since D36 (AC5/AC5a/AC8a wording and "Implementation constraints" corrections). `isScopeExceptionValid(exception, { path, taskFingerprint })` returned `false` for the stale D36 pair (verified by direct call, this run) — the underlying `tools/lib/git.mjs` change itself has not further expanded beyond what D36 covered (still exactly the same two exports), only the recorded fingerprint went stale, but per policy a changed task fingerprint invalidates the exception outright regardless of cause. At the consolidated decision stage (2026-08-08) the owner re-accepted the exception against the current fingerprint — recorded as `owner-decisions.md` D41 and this file's own `scope_exceptions` frontmatter entry. F1's lifecycle is now `accepted`; excluded from the unresolved-blocking count. | `node tools/specs.mjs fingerprint ... --task deterministic-implementation-provenance` (this run) = `bfaa1704...`; `owner-decisions.md` D36 (original) and D41 (re-acceptance); `isScopeExceptionValid` called directly, this run; `git diff HEAD -- tools/lib/git.mjs` — empty (no further change to the file itself since D36) | `tools/lib/git.mjs`; `owner-decisions.md` D36, D41 |
| F2 | OWNER_DECISION | still-present | AC6: scope-check evidence for a task with a persisted `implementation` block reads `implementation.changed_paths`, "not a fresh `attributeTouchedPaths` pattern match" | Unchanged from baseline. `.claude/commands/nevo-ai/task-review.md` step 4 still calls `classifyScopeFinding(path, { allowedPaths, forbiddenPaths })` unchanged — a pure pattern match, never consulting a task's persisted `implementation.changed_paths`. D37 (2026-08-07) decided to close this via a new corrective task; no such task file exists under `specs/active/.../tasks/` (only tasks 01-21, unchanged) and `task-review.md`'s own diff this run (confirmed via `git diff HEAD`) only touches step 8's report-minimization wording (task 14's own corrective scope), not step 4. D37's decision has not yet been executed. | Read `.claude/commands/nevo-ai/task-review.md` step 4, full current content, this run (unchanged pattern-match call); `git diff HEAD -- .claude/commands/nevo-ai/task-review.md` — only step 8 changed; `ls specs/active/.../tasks/` — no task 22 or later exists; `owner-decisions.md` D37 | `.claude/commands/nevo-ai/task-review.md` (step 4, unchanged) |
| F3 | OWNER_DECISION | still-present | AC7: a later task's review/self-check inspects current repository state for a regression against an earlier task's already-attributed evidence when both touch the same file; AC9: a regression test mirrors the D33 `describeSelfCheck`/`staleEvidenceTasks` HEAD-equality guard for the new provenance fields | Unchanged from baseline. `grep -rn "regression" tools/specs/lifecycle.mjs tools/specs/service.mjs tools/specs.mjs tools/tests/provenance.test.mjs` — zero matches, this run. `handleSelfCheck` (`tools/specs.mjs` L438-477) still recomputes `attributedPaths` from a live `git.getChangedFiles(ROOT, task.implementation.baseline_revision)` pattern-filtered by `allowed_paths` on every self-check re-run, with no check for whether a later task's edit to a shared file landed in that recomputation — the exact gap AC7 exists to close. `handleSelfCheck` still hardcodes `ROOT` (not parameterized), consistent with D39's still-open decision to extend task 20's `gitRoot` pattern to it; D39 names this as the concrete root cause behind this task's own F3 gap, and remains unresolved (task 20's scope, not this task's). ADR-0006 item 43 still states, unqualified, that "task B editing a file never rewrites task A's already-persisted record" — true for the normal case, but does not itself claim (nor does the code implement) detection for the re-run-after-a-later-edit case AC7 covers, so this is not a new doc/implementation mismatch beyond what F3 already names. | `grep -rn "regression" ...` — no matches, this run; read `handleSelfCheck` (`tools/specs.mjs` L438-477) and `computeTaskAttributedChangedPaths` (`tools/specs/lifecycle.mjs` L309), this run; `owner-decisions.md` D39 (open); `docs/decisions/ADR-0006-...md` item 43, this run | `tools/specs.mjs` (`handleSelfCheck`), `tools/specs/lifecycle.mjs` (`computeTaskAttributedChangedPaths`) |
| F4 | NON_BLOCKING | still-present | The task's own "Implementation constraints" names a `computeChangedPaths(task, { baseline, worktree })`-shaped function combining `git diff <baseline>..HEAD --name-only` with `classifyDirtyWorktree`'s task-related uncommitted files | Unchanged from baseline. The shipped function is still `computeTaskAttributedChangedPaths(changedFiles, allowedPaths)` (`tools/specs/lifecycle.mjs` L309) — a simpler pure pattern-filter, never calling `classifyDirtyWorktree` directly (that classification happens inside `git.getChangedFiles`'s own union upstream). Net behavior is equivalent for tested cases; the implementation still diverges from the task's own stated design without documented rationale. | `grep -n "function computeTaskAttributedChangedPaths\|function computeChangedPaths" tools/specs/lifecycle.mjs` — only the former exists, this run | `tools/specs/lifecycle.mjs` |
| F5 | NON_BLOCKING | still-present | AC4: `computeChangeFingerprint`/`computeTaskFingerprint` exclusion is "tested for each of the four fields independently" (`baseline_revision`, `review_revision`, `changed_paths`, `worktree_patch_fingerprint`) | Unchanged from baseline. `tools/tests/provenance.test.mjs`'s "AC4" describe block (L128-166) still has only two tests: one that changes all four `implementation` fields together in one before/after diff (not isolated), and one that isolates `changed_paths` alone. `review_revision`/`worktree_patch_fingerprint` are still never varied in isolation for the `computeTaskFingerprint`/`computeChangeFingerprint` exclusion (the new AC5a tests added this run isolate those two fields, but for `computeImplementationFingerprintFromProvenance`'s *inclusion* behavior, a different function/concern than AC4's exclusion guarantee). Still a test-rigor gap, not a behavioral defect — `computeTaskFingerprint`'s `ownProjection` never reads `implementation` at all. | Read `tools/tests/provenance.test.mjs` L128-166, this run | `tools/tests/provenance.test.mjs`, `tools/specs/service.mjs` |

## Scope compliance

Every file this task's diff touches is inside `allowed_paths` **except**
`tools/lib/git.mjs` (F1) — the file itself is unchanged since D36; the
previously-accepted exception was found invalid this run (fingerprint mismatch) and
re-accepted by the owner at the consolidated decision stage (D41), recorded against the
current fingerprint, not carried forward silently.
`docs/index.generated.md`/`docs/index.generated.json`/`specs/active.generated.md`/
`specs/index.generated.json` (`consequential_paths`) changed as a direct, mechanical
consequence of `tools/specs.mjs generate`/`tools/docs.mjs generate` — not a scope
finding. No `forbidden_paths` path was touched. `tasks/15-deterministic-implementation-provenance.md`
itself was also edited this round (AC5/AC5a wording, AC8a added) — not classified as a
scope finding: no task in this change ever lists its own task file in `allowed_paths`
(task files are edited via `/nevo-ai:spec-refine`'s own, separately-governed scope amendment
path, per the D40 precedent — `owner-decisions.md`), so this is expected spec-maintenance,
not an implementation-diff scope violation.

## Verification

- `node --test tools/tests/provenance.test.mjs` — passed (24/24)
- `node --test tools/tests/*.test.mjs` — passed (840/840, 167 suites)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] AC1, AC2, AC3, AC4, AC5, AC5a, AC8, AC8a, AC10, AC11 — met (10/13). AC5a and AC8a
  are new since the baseline review — both are now implemented and independently tested
  (`computeImplementationFingerprintFromProvenance` no longer folds `baseline_revision`/
  `review_revision` with `||` and now includes `worktree_patch_fingerprint`;
  `resolveProvenanceMappings`/`apply-provenance --mappings` land several legacy
  provenance mappings together under one `--confirm`).
- AC6: not met — see F2
- AC7: not met — see F3
- AC9: not met (required automated regression test missing) — see F3

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` § "Implementation
provenance and attribution (D34, D35)" (items 41-47) was updated this round to describe
the AC5a/AC8a corrections accurately (items 44, 46). Item 43's guarantee ("task B editing
a file never rewrites task A's already-persisted record") remains true for the case it
describes and is not a new mismatch — it does not claim, and the code does not implement,
detection for the re-run-after-a-later-edit case F3/AC7 covers; that gap is already named
by F3, not a separate doc/implementation inconsistency. `.claude/skills/nevo-ai-spec-workflow/references/context-policy.md`'s
"Attributed changed paths take priority over pattern matching" section still states the
intended policy without the one command flow (`task-review.md` step 4) that would need to
act on it having been updated (F2, unchanged).

## Tests

`tools/tests/provenance.test.mjs` (24 tests, up from 15) covers AC1-AC5, AC5a (two new
tests this round), AC8, and AC8a (`resolveProvenanceMappings`, four new tests, plus two
new `handleApplyProvenance` error-path tests). No test exists for AC7 or AC9 (see F3).
`handleStart`/`handleSelfCheck`'s own real-repository writes are still not driven
end-to-end in a fixture-backed test — `handleSelfCheck` remains unparameterized
(hardcoded `ROOT`), per D39 (task 20's open scope, not this task's).
