---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: deterministic-implementation-provenance
generated: 2026-08-07
verdict: changes-required
unresolved_required_fixes: 0
unresolved_owner_decisions: 2
unresolved_needs_clarification: 0
scope_exceptions:
  - finding: F1
    path: tools/lib/git.mjs
    reason: git.mjs is a natural home for shared git helpers; every other path this task touched is in-scope. Accepted during the /nevo-ai:implementation-review nevo-ai-process-continuity-and-hardening --tasks 14-21 consolidated decision stage.
    decision: accepted
    confirmed_by: owner
    confirmed_at: 2026-08-07
    task_fingerprint: "7013dbba4965bbd8387de72f3d0f6a964b71ea06c0c75ac28324026fee1d56d0"
---

# Review: nevo-ai-process-continuity-and-hardening/deterministic-implementation-provenance

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — two unmet acceptance criteria (AC6, AC7, with AC9's dependent
regression test also missing) remain unresolved; see F2-F3. The `tools/lib/git.mjs`
scope violation (F1) was accepted as an owner-approved exception during the
consolidated decision stage of `/nevo-ai:implementation-review
nevo-ai-process-continuity-and-hardening --tasks 14-21` (2026-08-07) — see
`scope_exceptions` above.

## Checklist

Computed by `computeTaskReviewChecklist` (verified with the real function, not composed
by hand).

```
- [ ] All acceptance criteria covered
  - AC6: not met — see F2
  - AC7: not met — see F3
  - AC9 (required automated regression test): missing — see F3
- [x] Required automated verification passed
- [x] Scope check resolved
  - 1 owner-approved exception recorded (F1, `tools/lib/git.mjs`)
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [ ] No unresolved owner decision
  - 2 unresolved owner decision(s) remain (F2, F3) — corrective task requested,
    see `owner-decisions.md`
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | accepted | Every path this task's diff touches is inside `allowed_paths`/`consequential_paths` | *(accepted — owner-approved exception, not an active blocker)* `tools/lib/git.mjs` gained two new, task-15-attributed exports (`getWorktreeDiff`, `findCommitsMentioning`), outside the task's `allowed_paths`/`consequential_paths` (`classifyScopeFinding` → `outside-allowed`); the exception is recorded in this file's `scope_exceptions` frontmatter. | `git diff -- tools/lib/git.mjs` (this run); `classifyScopeFinding` output: `outside-allowed`; `scope_exceptions` entry, `confirmed_by: owner`, `confirmed_at: 2026-08-07` | `tools/lib/git.mjs` |
| F2 | OWNER_DECISION | first-review | AC6: scope-check evidence for a task with a persisted `implementation` block reads `implementation.changed_paths`, "not a fresh `attributeTouchedPaths` pattern match" | Half of AC6 is done (task 16's `implementationFingerprint` field in `PER_TASK_REVIEW_FIELDS` does read `computeImplementationFingerprintFromProvenance`, which consumes `changed_paths`). The other half — `task-review.md` step 4's own scope-violation classification — still calls `classifyScopeFinding(path, { allowedPaths, forbiddenPaths })` unchanged, a pure pattern match, never consulting a task's persisted `implementation.changed_paths`. This task's own "Out of scope" section attributes that wiring to task 16, but `.claude/commands/**` is in *this* task's own `forbidden_paths` (so task 15 cannot close it directly), and task 16's own "Out of scope" section separately excludes "Changing `/nevo-ai:task-review`... own report/prompt shape" — so no task in the current plan actually closes this half of AC6. Needs an owner decision: implement it via a new/amended task, or narrow AC6's wording. | Read `.claude/commands/nevo-ai/task-review.md` step 4 (unchanged `classifyScopeFinding(path, { allowedPaths, forbiddenPaths })` call) and this task's/task 16's own "Out of scope" sections, this run | `.claude/commands/nevo-ai/task-review.md` (unchanged), `specs/active/.../tasks/15-....md` § Out of scope, `specs/active/.../tasks/16-....md` § Out of scope |
| F3 | OWNER_DECISION | first-review | AC7: a later task's review/self-check inspects current repository state for a regression against an earlier task's already-attributed evidence when both touch the same file; AC9: a regression test mirrors the D33 `describeSelfCheck`/`staleEvidenceTasks` HEAD-equality guard for the new provenance fields | No such regression-detection code or test exists anywhere in the diff (`grep`-verified across `lifecycle.mjs`/`service.mjs`/`specs.mjs`/`tools/tests/provenance.test.mjs` for "regression" — zero matches). This is a real gap, not just a missing test: `handleSelfCheck` (tools/specs.mjs) recomputes `changed_paths` on every self-check run as `computeTaskAttributedChangedPaths(git.getChangedFiles(ROOT, task.implementation.baseline_revision), packet.allowed_paths)` — a live diff from this task's own `baseline_revision` to current `HEAD`, re-filtered by `allowed_paths` pattern matching every time. If task A's self-check is *re-run* after task B commits an edit to a file matching task A's own `allowed_paths` pattern, task B's edit would be silently attributed to task A's `changed_paths` on that re-run — nothing detects or flags it. This directly contradicts area requirement 2 ("computed once and persisted, not re-derived by pattern-matching every time...") and ADR-0006 item 43's documented guarantee ("task B editing a file never rewrites task A's already-persisted record") for exactly the re-run case AC7 exists to cover. The AC2 test in `provenance.test.mjs` does not catch this: it calls the pure `computeTaskAttributedChangedPaths` function twice with two independently-constructed input lists, never exercising the real `handleSelfCheck` re-run path against a shared file. | `grep -n "regression" tools/specs/lifecycle.mjs tools/specs/service.mjs tools/specs.mjs` — no matches, this run; read `handleSelfCheck` (`tools/specs.mjs` ~L438-469) and `computeTaskAttributedChangedPaths` (`tools/specs/lifecycle.mjs` ~L309-313), this run | `tools/specs.mjs` (`handleSelfCheck`), `tools/specs/lifecycle.mjs` (`computeTaskAttributedChangedPaths`) |
| F4 | NON_BLOCKING | first-review | The task's own "Implementation constraints" names a `computeChangedPaths(task, { baseline, worktree })`-shaped function combining `git diff <baseline>..HEAD --name-only` with `classifyDirtyWorktree`'s task-related uncommitted files | The shipped function is `computeTaskAttributedChangedPaths(changedFiles, allowedPaths)` — a simpler pure pattern-filter over `git.getChangedFiles`'s already-unioned committed+untracked list; it never calls `classifyDirtyWorktree`. The net behavior (unrelated files excluded) is equivalent for the cases tested, but the implementation diverges from the task's own stated design without a documented rationale for the substitution. | Read `tools/specs/lifecycle.mjs` L299-313 and `tools/specs.mjs` `handleSelfCheck`, this run | `tools/specs/lifecycle.mjs`, `tools/specs.mjs` |
| F5 | NON_BLOCKING | first-review | AC4: `computeChangeFingerprint`/`computeTaskFingerprint` exclusion is "tested for each of the four fields independently" (`baseline_revision`, `review_revision`, `changed_paths`, `worktree_patch_fingerprint`) | Only `changed_paths` is varied in true isolation between two fingerprint computations; `baseline_revision` is tested conflated with a `status` change in the same write, and `review_revision`/`worktree_patch_fingerprint` are never independently varied at all. The underlying exclusion is nonetheless structurally guaranteed — `computeTaskFingerprint` only ever reads `task.id`/`task.depends_on`/`task.file` off the `change.yaml` task entry, never `task.implementation` — so this is a test-rigor gap, not a behavioral defect. | Read `tools/tests/provenance.test.mjs` L128-167 (only two of four fields independently varied) and `tools/specs/service.mjs` L461-482 (`computeTaskFingerprint`'s `ownProjection` never reads `implementation`), this run | `tools/tests/provenance.test.mjs`, `tools/specs/service.mjs` |

## Scope compliance

Every file in this task's own diff is inside `allowed_paths` **except** `tools/lib/git.mjs`
(F1, `outside-allowed` — accepted as an owner-approved exception, see `scope_exceptions`
above). `docs/index.generated.md`/`docs/index.generated.json`/
`specs/active.generated.md`/`specs/index.generated.json` (this task's declared
`consequential_paths`) are unchanged by this diff — regeneration was not needed. No
`forbidden_paths` path was touched.

## Verification

- `node --test tools/tests/provenance.test.mjs` — passed (15/15)
- `node --test tools/tests/*.test.mjs` — passed (826/826, 166 suites)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] AC1, AC2, AC3, AC4, AC5, AC8, AC10, AC11 — met
- AC6: not met — see F2
- AC7: not met — see F3
- AC9: not met (required automated regression test missing) — see F3

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` § "Implementation
provenance and attribution (D34, D35)" (items 41-47) accurately documents what was
actually built — it does not overclaim AC6's task-review wiring or AC7's regression
detection, both of which are genuinely absent, so there is no doc/implementation
mismatch there. `.claude/skills/nevo-ai-spec-workflow/references/context-policy.md`'s
new "Attributed changed paths take priority over pattern matching" section correctly
states the intended policy, but (per F2) the one command flow (`task-review.md` step 4)
that would need to act on it hasn't been changed to do so yet.

## Tests

`tools/tests/provenance.test.mjs` covers AC1 (`nextImplementationBaseline`), AC2/AC3
(`computeTaskAttributedChangedPaths`), AC4 (fingerprint-tier exclusion, partially —
see F5), AC5 (`computeImplementationFingerprintFromProvenance`), and AC8
(`handleApplyProvenance`'s confirmation guard). No test exists for AC7 or AC9 (see F3).
`handleStart`/`handleSelfCheck`'s own real-repository writes are not driven
end-to-end in a fixture-backed test yet — the test file's own header names this as the
same limitation FU-007 already recorded, closed for every repository-bound handler by
task 20, not this task's own gap.
