---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: deterministic-implementation-provenance
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: tools/lib/git.mjs
    reason: Dedicated git helpers (getWorktreeDiff, findCommitsMentioning) belong
      naturally in the shared git module; every other path this task touched is
      in-scope. Re-affirms D36/D41 — the underlying change is unchanged, only the
      task's semantic fingerprint moved (AC5/AC5a/AC8a wording edits).
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-08
    task_fingerprint: "bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15"
---

# Review: nevo-ai-process-continuity-and-hardening/deterministic-implementation-provenance

Baseline read in full from the prior `reviews/deterministic-implementation-provenance.md`
(generated 2026-08-08, verdict `changes-required`, F1 accepted D41 scope exception,
F2/F3 open `OWNER_DECISION` findings, F4/F5 `NON_BLOCKING`). This is the third review pass:
`owner-decisions.md` D37 closed F2/F3 by amending existing tasks rather than creating a
new corrective task (AC7/AC9 implemented directly in this task's own scope; AC6 wired into
`task-review.md` step 4 via task 19's own scope). This run re-verifies every baseline
finding's exact predicate against current file contents and computes new findings
independently.

## Verdict

`pass` — AC6 (F2) and AC7/AC9 (F3) are now genuinely met; the D41 scope exception for
`tools/lib/git.mjs` (F1) is re-verified valid against the current, unchanged task
fingerprint. All 13 acceptance criteria covered, full verification suite passes, no
unresolved blocking finding or owner decision remains. F4/F5 (`NON_BLOCKING`, unchanged
from baseline) keep this report in the expanded shape rather than the fully compact
3-row form.

## Checklist

Computed by `computeTaskReviewChecklist` (verified with the real function; verdict `pass`).

```
- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
  - 1 owner-approved exception recorded
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | Every existing `scope_exceptions` entry is still valid: same path, and `isScopeExceptionValid` confirms the task's current semantic fingerprint matches the fingerprint recorded at acceptance | `tools/lib/git.mjs` (`getWorktreeDiff`/`findCommitsMentioning`) remains outside `allowed_paths`, unchanged since D36/D41 | `git diff HEAD -- tools/lib/git.mjs` — empty, this run; `git diff HEAD -- specs/active/.../tasks/15-deterministic-implementation-provenance.md` — empty, this run (task file unchanged since D41's re-acceptance); `node tools/specs.mjs fingerprint nevo-ai-process-continuity-and-hardening --task deterministic-implementation-provenance` = `bfaa1704353da9130836c68c5f810c540607726ca1b69650609f29a27a4d1c15`, matches the D41-recorded `task_fingerprint` exactly; `isScopeExceptionValid` called directly this run, returned `true` | `tools/lib/git.mjs`; `owner-decisions.md` D36, D41 |
| F2 | OWNER_DECISION | resolved | AC6: scope-check evidence for a task with a persisted `implementation` block reads `implementation.changed_paths`, "not a fresh `attributeTouchedPaths` pattern match" | `resolveScopeCheckPaths(task, liveDiffPaths)` (`tools/specs/lifecycle.mjs`, added this task's own scope) now exists and computes the deterministic union of a task's persisted `implementation.changed_paths` and the live diff — never a replacement, live paths always included. `.claude/commands/nevo-ai/task-review.md` step 4 (task 19's own scope, D37) now calls it: "Compute the union via `resolveScopeCheckPaths(task, liveDiffPaths)` (`tools/specs/lifecycle.mjs`, D37) — never re-derived by hand." AC6 genuinely closed — the union semantics correctly mean a persisted `changed_paths` (itself always a subset of `allowed_paths` by construction) can never by itself hide a genuine out-of-scope violation, since the live diff is never dropped. | Read `tools/specs/lifecycle.mjs` `resolveScopeCheckPaths` (L1961) and `.claude/commands/nevo-ai/task-review.md` step 4, full current content, this run | `tools/specs/lifecycle.mjs`, `.claude/commands/nevo-ai/task-review.md` |
| F3 | OWNER_DECISION | resolved | AC7: a later task's review/self-check inspects current repository state for a regression against an earlier task's already-attributed evidence when both touch the same file; AC9: a regression test mirrors the D33 `describeSelfCheck`/`staleEvidenceTasks` HEAD-equality guard for the new provenance fields | `detectProvenanceOverlap(tasks, taskId, attributedPaths)` (`tools/specs/lifecycle.mjs`, this task's own scope) is real, data-only (no revision/HEAD parameter — 3-argument signature verified), and is now wired into `handleSelfCheck` (`tools/specs.mjs`), which calls it with the freshly-recomputed `attributedPaths` on every self-check re-run and logs a note for each cross-task overlap found. `tools/tests/provenance.test.mjs`'s new "AC7, AC9" describe blocks (24→29 tests) cover it: 4 unit tests for `detectProvenanceOverlap` itself (overlap found, no overlap, missing `implementation` block skipped, no-HEAD-argument arity check), plus one real fixture-backed end-to-end test (`createFixtureRepo` + real `handleStart`/`handleSelfCheck`) proving task A's self-check attributes `shared/file.mjs`, task B's later self-check on the same file surfaces the overlap via `detectProvenanceOverlap`, and task A's own persisted record is unaffected (extends AC2). AC7/AC9 genuinely closed. | `git diff HEAD -- tools/specs/lifecycle.mjs tools/specs.mjs` (this run) — `detectProvenanceOverlap` added and wired into `handleSelfCheck`; `node --test tools/tests/provenance.test.mjs` — 29/29 passed, this run; read the new describe blocks (L108-186), this run | `tools/specs/lifecycle.mjs`, `tools/specs.mjs`, `tools/tests/provenance.test.mjs` |
| F4 | NON_BLOCKING | still-present | The task's own "Implementation constraints" names a `computeChangedPaths(task, { baseline, worktree })`-shaped function combining `git diff <baseline>..HEAD --name-only` with `classifyDirtyWorktree`'s task-related uncommitted files | Unchanged from baseline. The shipped function is still `computeTaskAttributedChangedPaths(changedFiles, allowedPaths)` (`tools/specs/lifecycle.mjs` L309) — a simpler pure pattern-filter, never calling `classifyDirtyWorktree` directly. Net behavior equivalent for tested cases; the implementation still diverges from the task's own stated design without documented rationale. | `grep -n "function computeTaskAttributedChangedPaths\|function computeChangedPaths" tools/specs/lifecycle.mjs` — only the former exists, this run | `tools/specs/lifecycle.mjs` |
| F5 | NON_BLOCKING | still-present | AC4: `computeChangeFingerprint`/`computeTaskFingerprint` exclusion is "tested for each of the four fields independently" (`baseline_revision`, `review_revision`, `changed_paths`, `worktree_patch_fingerprint`) | Unchanged from baseline. `tools/tests/provenance.test.mjs`'s "AC4" describe block (L215-254, unchanged this pass) still has three tests: one that changes `baseline_revision`/`review_revision`/`changed_paths`/`worktree_patch_fingerprint` together in one before/after diff (not isolated), one that isolates `changed_paths` alone, one that isolates `baseline_revision` alone at the change-fingerprint level. `review_revision`/`worktree_patch_fingerprint` are still never varied in isolation for the `computeTaskFingerprint`/`computeChangeFingerprint` exclusion guarantee. Still a test-rigor gap, not a behavioral defect — `computeTaskFingerprint`'s `ownProjection` never reads `implementation` at all. | Read `tools/tests/provenance.test.mjs` L215-254, this run | `tools/tests/provenance.test.mjs`, `tools/specs/service.mjs` |

## Scope compliance

Every file this task's own diff touches is inside `allowed_paths`
(`tools/specs/lifecycle.mjs`, `tools/specs.mjs`, `tools/tests/provenance.test.mjs`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`) **except**
`tools/lib/git.mjs` (F1) — the file itself is unchanged since D36/D41; the D41-accepted
exception re-verified valid this run (same path, same task fingerprint).
`tools/specs.mjs` is also touched this round by task 20's own `{ activeDir, gitRoot }`
parameterization of `handleSelfCheck` (D39) — both tasks legitimately share this file in
their own `allowed_paths`; not a scope finding for either.
`docs/index.generated.md`/`docs/index.generated.json`/`specs/active.generated.md`/
`specs/index.generated.json` (`consequential_paths`) changed as a direct, mechanical
consequence of `tools/specs.mjs generate`/`tools/docs.mjs generate` — not a scope finding.
No `forbidden_paths` path was touched by this task's own diff.
The shared working tree also carries other tasks' own corrective work this round —
`.claude/commands/nevo-ai/task-review.md`, `follow-ups.yaml`, `tasks/19-...md`,
`tasks/20-...md`, `tools/tests/fixture-repo.test-helper.mjs`,
`tools/tests/handler-testability.test.mjs`, `tools/tests/owner-workflow-acceptance.test.mjs`,
`tools/tests/unowned-drift.test.mjs`, `owner-decisions.md` — all outside this task's own
`allowed_paths`/`forbidden_paths` list, but explicitly attributed by `owner-decisions.md`
D37/D38/D39 to tasks 19/20/21's own scope (or, for task/owner-decision files, the
separately-governed spec-maintenance path, D40 precedent), not this task's diff; not
re-flagged here as an unexplained anomaly.

## Verification

- `node --test tools/tests/provenance.test.mjs` — passed (29/29)
- `node --test tools/tests/*.test.mjs` — passed (849/849, 171 suites)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 13 acceptance criteria covered (AC1, AC2, AC3, AC4, AC5, AC5a, AC6, AC7, AC8,
  AC8a, AC9, AC10, AC11). AC6, AC7, and AC9 are newly met since the baseline review — see
  F2/F3 (both `resolved`).

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` items 47a and 64a (added
this round) document the AC7/AC9 `detectProvenanceOverlap` mechanism and the AC6
`resolveScopeCheckPaths` union wiring, both accurately matching the shipped code.
`.claude/skills/nevo-ai-spec-workflow/references/context-policy.md`'s "Attributed changed
paths take priority over pattern matching" section is now acted on by
`task-review.md` step 4 (F2, resolved).

## Tests

`tools/tests/provenance.test.mjs` (29 tests, up from 24) adds real coverage for AC7/AC9:
four unit tests for `detectProvenanceOverlap` plus one fixture-backed end-to-end test
driving `handleStart`/`handleSelfCheck` against a real two-task fixture repository,
proving the cross-task overlap surfaces correctly and an earlier task's own persisted
record is never retroactively rewritten. No behavior change to `describeSelfCheck`/
`staleEvidenceTasks` (D33 untouched, confirmed by inspection).
