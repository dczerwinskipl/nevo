---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: finalization-hardening-and-migration
generated: 2026-08-05
verdict: changes-required
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 1
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/finalization-hardening-and-migration

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — one unresolved `OWNER_DECISION` finding (F1): task 09's own
behavior change (splitting `finalize`'s merge/branch-deletion sequence) left
`docs/development/git-workflow.md` describing the old, now-inaccurate single-call
behavior, and no task in this change (09 or 11) has that file in its `allowed_paths` —
fixing it requires an owner decision on how to close the gap, not a mechanical edit this
task can make within its own scope.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | OWNER_DECISION | first-review | `docs/development/git-workflow.md`'s "Merge strategy" section accurately describes `finalize`'s current merge/branch-deletion behavior | It does not. The doc still says `node tools/specs.mjs finalize` "performs exactly this (`gh pr merge --squash --delete-branch`)" — but task 09 replaced that single call with `gh pr merge --squash` (no `--delete-branch`) followed by a separate, gated branch-deletion step only after the post-merge check passes (D9/D23/D25). This is exactly the "architecture drift" case `references/review-policy.md` § "Architecture drift detection" calls blocking. Neither task 09 (`forbidden_paths` includes `docs/development/**`) nor task 11 (same `forbidden_paths` entry, confirmed by reading `tasks/11-workflow-docs-and-adr-migration.md`'s front matter) is authorized to edit this file, so no task in this change can close the gap without an owner decision (grant a scope exception, add a follow-up/new task, or explicitly accept the drift). | Read `docs/development/git-workflow.md:71-73` this run: `` `node tools/specs.mjs finalize` performs exactly this (`gh pr merge --squash --delete-branch`) once its gate passes ``. Read `tools/lib/github.mjs:207-209` (`mergePr` — `gh pr merge --squash`, no `--delete-branch`) and `tools/specs.mjs`'s `runPostMergeCheck` (lines ~800-814 — branch deletion only after `computeCheckFailures()` returns clean) this run, confirming the actual behavior no longer matches the doc. `git log -p --follow` on the file shows this line predates task 09 and was never touched by it. | `docs/development/git-workflow.md` |
| F2 | NON_BLOCKING | first-review | `tools/tests/finalize.test.mjs`'s "leaves the worktree clean" test (line 199-206) meaningfully asserts on the dirty file's content | It doesn't — line 204 is `assert.equal(git(['show', ':a.txt']).includes('dirty') \|\| true, true)`, a tautology (`X \|\| true` is always `true` regardless of `X`), so it silently verifies nothing about the file content. The test's real coverage comes from the other two assertions in the same block (`isWorkingTreeClean` is `false`, no repair branch created). Candidate for follow-up recording (not recorded — requires owner-facing confirmation, out of scope for this subagent run). | Read `tools/tests/finalize.test.mjs:199-206` this run. | `tools/tests/finalize.test.mjs:204` |
| F3 | INFORMATIONAL | — | — | Gating validation: passed | `node tools/specs.mjs validate` → "Validated 6 changes — no errors."; `node tools/docs.mjs validate` → "Validated 60 documents — no errors." (this run) | — |
| F4 | INFORMATIONAL | — | — | Non-gating repository check: `specs check` reports stale generated indexes; `docs check` is clean. Not self-caused by task 09's own diff — task 09's status-transition commit (`3b51130`) regenerated `specs/index.generated.json` in the same commit; the current staleness is attributable to task 12 (`implementation-review-orchestration`, currently `status: in-implementation`), an unrelated in-flight task. | `node tools/specs.mjs check` → `stale: specs/active.generated.md`, `stale: specs/archive.generated.md`, `stale: specs/index.generated.json`; `node tools/docs.mjs check` → "Indexes are current." (this run). `git show --stat 3b51130` confirms `specs/index.generated.json` was updated alongside task 09's own `change.yaml` status write. | — |
| F5 | INFORMATIONAL | — | — | `node --test tools/tests/finalize.test.mjs` — 13/13 tests pass, covering AC1, AC2, AC3, AC5, AC6, AC7, AC8 directly by name | Command output, this run: "# tests 13 / # pass 13 / # fail 0" | `tools/tests/finalize.test.mjs` |
| F6 | INFORMATIONAL | — | — | AC4 (migration notes) verified by direct inspection, not just read as prose | `specs/archive/nevo-documentation-architecture/reviews/spec.md:11`'s recorded `spec_fingerprint: 3ab09624e4f09309c251bac9918ef4ab8492d70114e496997f777f562be43a87` matches the task file's quoted value exactly; `tools/specs.mjs`'s `handleFingerprint`/`handleApprove` (diff in commit `c509c28`) confirmed switched from `computeSpecFingerprint` to `computeChangeFingerprint`/`computeTaskFingerprint`, matching the migration notes verbatim | `specs/archive/nevo-documentation-architecture/reviews/spec.md`, `tools/specs.mjs` |
| F7 | INFORMATIONAL | — | — | `follow-ups.yaml`'s FU-001 (recorded by this same task) accurately describes a real, separate limitation: `computeChangeFingerprint` (`tools/specs/service.mjs`, outside task 09's `allowed_paths`) only hashes `overview.md` + the task graph shape, not owner-decisions.md/shared constraints per D7's full stated design | Read `tools/specs/service.mjs:432-438`'s `computeChangeFingerprint` this run: confirms it hashes only `overview.md` content and the task graph (id + `depends_on`, sorted) — no `owner-decisions.md` read. FU-001's `reason` field matches this exactly. Correctly `severity: non-blocking`, `status: open`, out of task 09's own scope. | `specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`, `tools/specs/service.mjs` |

## Scope compliance

Confirmed within scope. Task 09's actual implementation diff (commit `c509c28`, "feat(specs): verify-before-destructive-cleanup finalize sequence, guarded repair branch, fingerprint-tier migration (task 09)") touched exactly: `.claude/commands/nevo-ai/spec-finalize.md`, `specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`, `specs/active/nevo-ai-process-continuity-and-hardening/tasks/09-finalization-hardening-and-migration.md`, `tools/lib/github.mjs`, `tools/specs.mjs`, `tools/tests/finalize.test.mjs` — every one of these is listed in the task's `allowed_paths`, and none touch any entry in `forbidden_paths` (`src/**`, `tests/**`, `examples/**`, `docs/development/**`, `specs/archive/nevo-documentation-architecture/tasks/**`, `specs/archive/nevo-documentation-architecture/change.yaml`). The current working tree has no uncommitted changes to any file in this task's scope (only untracked `reviews/*.md` files for other tasks, unrelated to task 09). No scope violation.

## Acceptance-criteria coverage

1. `finalize` does not call branch deletion until after the post-merge check has run and passed — **met**. `runPostMergeCheck` (`tools/specs.mjs`) only runs `git push origin --delete <branch>` / `git branch -D <branch>` after `computeCheckFailures()` returns an empty array. Proven by `finalize.test.mjs`'s AC1 test (passing).
2. A failed post-merge check leaves the branch intact, reports the merged SHA/failed check/diagnostic branch name, and writes no entry into `follow-ups.yaml` — **met**. `handleFinalize`'s failure branch only logs to `console.error` and sets `process.exitCode = 1`; no `addFollowUp` call exists on that path. Proven by the AC2 test (passing).
3. A successful post-merge check proceeds to delete the branch and reports success — **met**. Proven by the AC3 test (passing).
4. Migration notes correctly identify no `change.yaml` schema change is needed and exactly one re-review per stale fingerprint tier is the expected cost — **met**, verified by direct inspection (F6), not just by reading the prose.
5. The repair branch is created only after confirmation and only when the full nine-step guard sequence passes, in the documented order — **met** (the confirmation step itself lives in `spec-finalize.md`'s conversational flow, outside this task's automated test scope by design; the nine-step sequence's order is code-verified). Proven by the AC5 test (passing).
6. Each guard failure mode stops without creating the branch and names which guard failed — **met**. Four distinct guard-failure tests each assert `result.failedGuard` and `branchCreated: false`.
7. A guard failure after the local `main` switch/fast-forward (step 8) reports that the switch/fast-forward already happened; a guard failure before the switch reports at most a completed `fetch` — **met**, exactly as tested (`mainSwitched`/`fetchRan` asserted per scenario).
8. No `reset`, `clean`, force-checkout, or automatic stash is ever executed by the repair-branch flow — **met** by code inspection (`tools/lib/git.mjs`'s `checkoutBranch`/`createAndCheckoutBranch` never pass `-f`; `createRepairBranch` never calls `reset`/`clean`/stash) and by the AC8-proxy test, modulo the F2 test-quality nit (does not weaken the criterion's actual coverage, which comes from the other assertions in the same test).

## Architecture and documentation

`docs/ai/specification-workflow.md`'s classification-rule contradiction (line 61, D6) is task 11's responsibility, not task 09's, and is out of scope here. The one architecture-documentation gap found is F1 above: `docs/development/git-workflow.md`'s "Merge strategy" section still describes the pre-task-09 single-call `gh pr merge --squash --delete-branch` behavior, which task 09 replaced with a two-step, gated sequence — and no task in this change is authorized to edit that file to fix it. `spec-finalize.md` itself (in scope, `allowed_paths`) was correctly and fully updated to describe the reordered sequence, the post-merge check, and the diagnostic-anchor/repair-branch flow with its truthful failure semantics — verified by reading the full file this run.

## Tests

Behavior changes are covered: `tools/tests/finalize.test.mjs` (13 tests, all passing) directly exercises `runPostMergeCheck` (AC1-AC3, against a real disposable temp git repo + temp "origin" remote) and `createRepairBranch` (AC5-AC8, all four guard-failure modes plus the happy path). No test gap identified for this task's own acceptance criteria, aside from the F2 non-blocking nit inside one existing test.
