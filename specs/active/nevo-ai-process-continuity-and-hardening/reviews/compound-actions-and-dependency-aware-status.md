---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: compound-actions-and-dependency-aware-status
generated: 2026-08-08
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/compound-actions-and-dependency-aware-status

Baseline: `specs/active/nevo-ai-process-continuity-and-hardening/reviews/compound-actions-and-dependency-aware-status.md`
as it existed before this run (generated 2026-08-08, verdict `changes-required`, one
unresolved `AUTO_FIX` finding F1).

## Verdict

`pass` — F1 (`AUTO_FIX`, documentation consistency) is now resolved: an owner-authorized
maintenance correction (`follow-ups.yaml` FU-016, 2026-08-08) added the missing
"approve and start" continuation description and the dependency-aware `deriveStage`
note to `docs/ai/specification-workflow.md` (outside this task's own `allowed_paths`, so
not performed by this task's own diff). Every checklist item resolves clean.

## Checklist

Computed by `computeTaskReviewChecklist` (verified with the real function).

```
- [x] All acceptance criteria covered
- [x] Required automated verification passed
- [x] Scope check resolved
- [x] No forbidden-path violation remains unresolved
- [x] Architecture and documentation remain consistent
- [x] No unresolved blocking findings
- [x] No unresolved owner decision
```

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | resolved | `docs/ai/specification-workflow.md` (the vendor-neutral doc `CLAUDE.md` names as the source the Claude-specific skill/commands mirror) describes `spec-approve`'s "approve and start" outcome and `deriveStage`'s stage/next-action model | Resolved 2026-08-08 via an owner-authorized maintenance correction (`follow-ups.yaml` FU-016). New section "A compound action completes what its own label promises" states the general rule; a new paragraph after the derived-state table names `deriveStage`'s dependency-gated `ready-to-start` and the dedicated `blocked-on-dependencies` stage. | `grep -n "own label\|blocked-on-dependencies" docs/ai/specification-workflow.md` this run — both present | `docs/ai/specification-workflow.md` |
| F2 | NON_BLOCKING | still-present | AC6 ("status's reported next action is consistent with what start would actually accept for that same task at that same moment, verified across a representative set of `deriveStage` stages, not only `ready-to-start`") is tagged `(automated)` | Unchanged from baseline: `tools/tests/status-dependency-aware.test.mjs`'s AC6 test (`status output never contradicts what start would actually accept...`, line 79) iterates three dependency-status scenarios but only asserts the invariant inside the `if (r.stage === 'ready-to-start')` branch (line 88) — the `draft`/`in-implementation` scenarios never reach that assertion. The invariant genuinely holds by construction (`deriveStage` never returns `ready-to-start` unless `depsSatisfied` returned true), so this is a test-rigor note, not a coverage gap. | Read `tools/tests/status-dependency-aware.test.mjs` (full file) this run; confirmed lines 79-96 unchanged from baseline's description | `tools/tests/status-dependency-aware.test.mjs` |

## Scope compliance

This task's own persisted `implementation.changed_paths` (`change.yaml`) lists:
`.claude/commands/nevo-ai/spec-approve.md`, `docs/ai/task-execution-policy.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md`,
`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`,
`tools/specs/lifecycle.mjs`, `tools/tests/compound-actions.test.mjs`,
`tools/tests/status-dependency-aware.test.mjs` — every one is inside this task's own
`allowed_paths`; all `compliant`, `classifyScopeFinding` not needed. This run's working
tree has no uncommitted changes to any of this task's own `allowed_paths`,
`consequential_paths`, or core files (`spec-approve.md`, both new test files unchanged
since commit `80e8209`; `tools/specs/lifecycle.mjs`'s current uncommitted diff belongs
entirely to sibling tasks 14/15/17 — this task's own `deriveStage`/`depsSatisfied`
portion, at lines 1231-1290, is untouched by that diff). No `consequential_paths` were
touched by this task's own scope. No `forbidden_paths` entry was touched.

## Verification

- `node --test tools/tests/compound-actions.test.mjs` — passed (13/13 tests, 4 suites)
- `node --test tools/tests/status-dependency-aware.test.mjs` — passed (6/6 tests, 1 suite)
- `node --test tools/tests/*.test.mjs` — passed (840/840 tests, 167 suites)
- `node tools/specs.mjs validate` — passed ("Validated 6 changes — no errors.")
- `node tools/specs.mjs check` — passed ("Specs valid and indexes are current.") — non-gating, informational
- `node tools/docs.mjs validate` — passed ("Validated 60 documents — no errors.")
- `node tools/docs.mjs check` — passed ("Indexes are current.") — non-gating, informational

## Acceptance-criteria coverage

- [x] All 9 acceptance criteria covered (see F2 for a test-rigor caveat on AC6 that does
  not rise to a coverage gap)

AC1-AC3 directly exercised by `tools/tests/compound-actions.test.mjs`. AC4-AC6 directly
exercised by `tools/tests/status-dependency-aware.test.mjs`. AC7 (`follow-ups.yaml`
FU-002/FU-004 `resolved`, resolution naming task 18) confirmed by inspection this run —
both entries carry `status: resolved` and a resolution naming task 18 and the relevant
test file. AC7a (`docs/ai/task-execution-policy.md` distinguishes the four required
sections) confirmed by inspection this run — the file's current headings are `## Standalone
per-task operation`, `## Owner-authorized sequential batch operation`, `## Genuine
owner-decision stops (both modes)`, and `## Internal command boundaries — never their own
confirmation`, all four present. AC8/AC9 confirmed by the verification commands above.

## Architecture and documentation

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` carries the "Complete
owner-facing compound actions and dependency-aware status (D34, D35)" subsection
(current line 564) and names task 18 in its narrative (line 645) — consistent with the
change. `docs/ai/specification-workflow.md` — the canonical vendor-neutral doc this
repository's `CLAUDE.md` names as the source the Claude-specific skill mirrors — was
corrected 2026-08-08 (F1, resolved, via `follow-ups.yaml` FU-016) and now reflects both
of this task's behavior changes.

## Tests

`tools/tests/compound-actions.test.mjs` (13 tests, 4 describe blocks) and
`tools/tests/status-dependency-aware.test.mjs` (6 tests, 1 describe block) are both
unchanged since commit `80e8209`, directly exercising AC1-AC6. See F2 for a narrow
test-rigor caveat on AC6 that does not rise to a coverage gap.
