---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: repository-bound-handler-testability
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/repository-bound-handler-testability

Baseline: `reviews/repository-bound-handler-testability.md` as generated 2026-08-08 (prior
pass, read in full before this run overwrote it). This is a re-review triggered by a
genuine scope amendment: `owner-decisions.md` D39 (2026-08-08) added AC10 to this task,
extending its `gitRoot`/`activeDir` parameterization pattern to `handleSelfCheck`
(`tools/specs.mjs`) — the prior pass's own cross-task finding X1
(`reviews/implementation-review-14-21.md`) is what surfaced the gap. Every finding below
was re-verified against current file content, not memory of the prior pass.

## Verdict

`pass` — all ten acceptance criteria (nine plus the new AC10) are met, the diff
attributable to this task stays within `allowed_paths`, required verification passes,
and one prior non-blocking finding (F2/FU-013) remains open alongside one new
non-blocking finding (F3, area-doc staleness); neither gates the verdict.

## Checklist

- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | resolved | The comment above `handleStart`'s `not_retryable` branch claimed `handleStart` "can't be driven end-to-end in a fixture test" | No longer true, and the comment no longer says it | `tools/specs.mjs` (current, lines ~308-315): now reads "`handleStart`'s own end-to-end path (including this branch) is separately covered against a fixture repository (`tools/tests/handler-testability.test.mjs`, task 20, D34/D35)" — fixed opportunistically while D39's `handleSelfCheck` edit touched the same function; `follow-ups.yaml` FU-012 updated to `status: resolved` with matching resolution text | `tools/specs.mjs` |
| F2 | NON_BLOCKING | still-present | AC1/area doc name all five `handleStart` postcondition outcomes (`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`/`unsafe_manual`) as the coverage target | Still only 2 of 5 (`completed`, `not_retryable`) are exercised through the fixture harness in `handler-testability.test.mjs` — unchanged since the prior pass; already recorded as `follow-ups.yaml` FU-013 (`status: open`), no fresh recording needed | `tools/tests/handler-testability.test.mjs`, re-read this run (only two `test(...)` blocks name a postcondition outcome) | `tools/tests/handler-testability.test.mjs` |
| F3 | NON_BLOCKING | first-review | `areas/handler-testability.md`'s "Requirements" (item 1) and "Out of scope" sections still name exactly `handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes` as the parameterization surface | D39 amended this task's own file (`tasks/20-....md`) to add AC10 (`handleSelfCheck`) and updated its "Out of scope" line to list all four handlers, but the area doc was not amended alongside it — `areas/handler-testability.md` line 118 still reads "scoped exactly to what FU-007 named" against a three-handler list, now stale against the task file's own current AC10/Out-of-scope text | `areas/handler-testability.md` lines 29-32, 117-118, re-read this run; `tasks/20-....md` lines 129-134, 159-160 | `specs/active/nevo-ai-process-continuity-and-hardening/areas/handler-testability.md` |

Not a fresh follow-up decision needed for F1/F2 — F1 is resolved outright; F2 is already
persisted as FU-013 (`status: open`), unchanged. F3 is new this run and has no existing
`follow-ups.yaml` entry.

### Cross-task finding X1 (D39) — now resolved

The prior pass's own review recorded X1 (from `reviews/implementation-review-14-21.md`
and `owner-decisions.md` D39) as confirmed-unresolved: `handleSelfCheck` still hardcoded
`ROOT`. Verified directly against current `tools/specs.mjs` (line 441):
`handleSelfCheck`'s signature is now `handleSelfCheck(changeSlug, taskId, { activeDir =
ACTIVE_DIR, gitRoot = ROOT } = {})`, and all three `git.*` calls it makes
(`getCurrentRevision`, `getChangedFiles`, `getWorktreeDiff`) now use the passed
`gitRoot`, defaulting to the real `ROOT` only when not supplied. `requireChange` is
likewise now called with `activeDir`. A new fixture-backed test in
`handler-testability.test.mjs` (`describe('handleSelfCheck driven against a fixture
repository (D39, extends AC1\'s pattern)')`) drives a real `handleStart` → fixture commit
→ `handleSelfCheck` cycle and asserts `self_check.status === 'passed'` and
`implementation.changed_paths` includes the fixture-committed file, without touching the
real repository. `follow-ups.yaml`'s FU-007 resolution text was extended to name
`handleSelfCheck` explicitly, still `status: resolved`. **X1 is resolved.**

## Scope compliance

This task's own `allowed_paths` (current context packet, unchanged from the prior pass):
`tools/specs.mjs`, `tools/specs/service.mjs`, `tools/tests/fixture-repo.test-helper.mjs`,
`tools/tests/handler-testability.test.mjs`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`.

The current working tree's diff attributable to this task's own D39 work touches exactly
four of those: `tools/specs.mjs` (`handleSelfCheck` parameterization, `not_retryable`
comment fix), `tools/tests/handler-testability.test.mjs` (new D39 `describe` block),
`tools/tests/fixture-repo.test-helper.mjs` (new `commitFile` helper and
`t.verification`-section support, both needed by the new test), and `follow-ups.yaml`
(FU-007 extended, FU-012 resolved). All four are exact `allowed_paths` entries —
`compliant` by construction; `classifyScopeFinding` not needed. `tools/specs/service.mjs`
is unchanged this round (already parameterized in the prior pass).

The working tree also carries edits to files outside this task's own `allowed_paths`,
inspected directly (`git diff HEAD`) and attributed by their own docstrings/amendment
notes to other tasks' declared scope, not this task's:

- `tools/specs/lifecycle.mjs` — `detectProvenanceOverlap` (new function, docstring cites
  "D34/D35, task 15, AC7/AC9") and `resolveScopeCheckPaths` (docstring cites "wired here
  by task 19"). Both are inside task 15's own `allowed_paths`
  (`tasks/15-deterministic-implementation-provenance.md`, confirmed by direct read) or
  task 19's. `handleSelfCheck` calls `detectProvenanceOverlap` (imported into
  `tools/specs.mjs`, this task's own allowed file), but the function's *definition*
  lives in a file this task doesn't own — consuming an already-scoped sibling-task
  addition through an allowed import is not a scope violation for this task, same
  precedent the prior pass already applied to this exact file.
- `.claude/commands/nevo-ai/task-review.md`, `tasks/19-unowned-drift-correction-flow.md`,
  `tools/tests/unowned-drift.test.mjs` — task 19's own D37/D40 corrective work (confirmed
  by task 19's own "Amended 2026-08-08 — owner-decisions.md D37/D40" notes).
- `tools/tests/owner-workflow-acceptance.test.mjs` — task 21's own D38 corrective work
  (ADR-0006 item 70a names it directly).
- `tools/tests/provenance.test.mjs` — task 15's own scope (in its `allowed_paths`).
- `owner-decisions.md`, `reviews/implementation-review-14-21.md`,
  `tasks/20-repository-bound-handler-testability.md` — the specification/decision-record
  layer itself (D39's own amendment, and its own review-artifact trail), not an
  "implementation" path any task's `allowed_paths`/`forbidden_paths` governs; no task's
  own file lists its own `tasks/*.md` path in `allowed_paths` (confirmed: task 20's own
  frontmatter does not), so this is not evaluated via `classifyScopeFinding` — consistent
  with how the prior pass treated the same category of file.
- `docs/decisions/ADR-0006-process-continuity-and-hardening.md` — in this task's own
  `allowed_paths`, so any section change is scope-compliant regardless of which task's
  subsection changed; this round's diff added subsection 67a (this task's own D39 note)
  alongside 47a/64a/70a (tasks 15/19/21's own corrective notes in the same shared file).

No scope exception required for this task.

## Verification

- `node --test tools/tests/handler-testability.test.mjs` — passed (9/9, up from 8/8 at
  the prior pass — the new D39 `describe` block)
- `node --test tools/tests/*.test.mjs` — passed (849/849, up from 840/840)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 10 acceptance criteria covered

AC1-AC6, AC8-AC9 re-verified against current content, unchanged in substance from the
prior pass. AC7 re-confirmed against current `follow-ups.yaml`: FU-007 is `status:
resolved` with resolution text now naming `handleSelfCheck` explicitly alongside the
original three handlers, exactly as AC7's amended text requires ("only after AC1-AC6 and
AC10 pass ... resolution text names `handleSelfCheck` explicitly"). AC10 (new this round)
confirmed directly: `handleSelfCheck` accepts `{ activeDir, gitRoot }` defaulting to
`ACTIVE_DIR`/`ROOT`, and the new fixture-backed test drives it end-to-end (`handleStart`
→ fixture commit → `handleSelfCheck`), asserting both `self_check` and
`implementation.changed_paths` are written correctly without touching the real
repository.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` gained subsection 67a
("Corrective pass (D39, 2026-08-08): `handleSelfCheck` gains the same `{ activeDir,
gitRoot }` parameterization as `handleStart`"), consistent with the implementation.
Production call sites (`tools/specs.mjs`'s `self-check` command registration, line 1292:
`.action(handleSelfCheck)`) still pass no extra arguments — identical wiring pattern to
`start`'s own `.action(handleStart)` (line 1226), already regression-tested for default
behavior under AC5. See F3 for the one area-doc inconsistency this round surfaced (not
blocking — `areas/handler-testability.md` is outside this task's own `allowed_paths`, so
fixing it here would itself be a scope violation; it needs a `spec-refine` pass instead).

## Tests

`tools/tests/handler-testability.test.mjs` gained one new `describe` block (`handleSelfCheck`
against a fixture, D39); `tools/tests/fixture-repo.test-helper.mjs` gained a `commitFile`
helper and `verification`-section support for fixture tasks, both consumed by the new
test. Neither test file writes into the real repository's own `specs/`/`docs/` trees
during the run (verified: the new test only asserts against `loadChange('fx-selfcheck',
f.activeDir)`, a fixture path).
