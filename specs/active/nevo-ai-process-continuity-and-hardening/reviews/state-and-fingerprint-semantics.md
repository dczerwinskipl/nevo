---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: state-and-fingerprint-semantics
generated: 2026-08-05
verdict: pass
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/state-and-fingerprint-semantics

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — every acceptance criterion is met by the current code, all four of the task's
own verification commands pass, and the diff attributable to this task's own
implementation commit stays entirely within `allowed_paths`. One `NON_BLOCKING` test-
coverage observation is noted; it does not affect the verdict.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | A dedicated task-level test proves "removing an unrelated task (not named in any task's `semantic_references.dependency_contracts`) leaves another task's own `computeTaskFingerprint` output unchanged," symmetric to the existing "adding an unrelated task" test | Missing — only the change-level effect of removing an unrelated task is tested (`fingerprint.test.mjs:209`); the task-level "add" direction is tested (`fingerprint.test.mjs:361`) but the task-level "remove" direction has no dedicated test | Read `tools/tests/fingerprint.test.mjs` in full: line 209's test only asserts `computeChangeFingerprint` changes, never asserting a sibling task's `computeTaskFingerprint` is unaffected by the same removal; line 361 covers the symmetric "add" case at the task level, but no equivalent "remove" case exists | `tools/tests/fingerprint.test.mjs` |
| F2 | INFORMATIONAL | — | Task's own "## Verification" commands all pass | `node --test tools/tests/fingerprint.test.mjs` (64/64 pass), `node --test tools/tests/task-lifecycle.test.mjs` (106/106 pass), `node tools/specs.mjs validate` ("Validated 6 changes — no errors."), `node tools/docs.mjs validate` ("Validated 60 documents — no errors.") | Command output, this run | — |
| F3 | INFORMATIONAL | — | This task's own implementation commit (`d753d2a`) stayed within `allowed_paths` | `git show --stat d753d2a` touches exactly `docs/ai/specification-workflow.md`, `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`, `tools/specs/validation.mjs`, `tools/tests/fingerprint.test.mjs`, `tools/tests/task-lifecycle.test.mjs` — all six are in the task's declared `allowed_paths`; none of `forbidden_paths` (`src/**`, `tests/**`, `examples/**`, `docs/development/**`, `docs/usage/**`, `docs/reference/**`, `.claude/commands/**`, `.claude/skills/**`) appear | `git show --stat d753d2a`, this run | `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`, `tools/specs/validation.mjs` |
| F4 | INFORMATIONAL | — | `superseded` no longer appears as a task-status value anywhere in `tools/specs/` | `grep` for `STATUS_ORDER`/status-scoped `superseded` finds only `service.mjs`'s `STATUS_ORDER` array, which does not list `superseded`; all other `superseded` matches in the repo refer to owner-decision supersession (a distinct D18/D26 concept), not the removed task status | `tools/specs/service.mjs:578-581` | `tools/specs/service.mjs` |

F1 is a candidate for follow-up recording (not recorded — requires owner-facing
confirmation, out of scope for this subagent run).

## Scope compliance

Confirmed. This task's own implementation commit (`d753d2a`, "feat(specs): three-tier
semantic fingerprint, execution.suspension/self_check schemas, removed status
vocabulary (task 01)") touched exactly the six files declared in `allowed_paths` —
`tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`, `tools/specs/validation.mjs`,
`tools/tests/fingerprint.test.mjs`, `tools/tests/task-lifecycle.test.mjs`,
`docs/ai/specification-workflow.md` — and none of `forbidden_paths`. These same shared
files were subsequently touched by later tasks (02-12) on this same branch, which is
expected (they are the shared foundation this change's other areas build on) and not a
scope violation attributable to *this* task.

## Acceptance-criteria coverage

All 11 acceptance criteria from `tasks/01-state-and-fingerprint-semantics.md` are met:

1. **Every invalidation-matrix row is a distinct test.** Met — `fingerprint.test.mjs`
   covers: task T's own status change (no change-level/task-level effect), an unrelated
   task's status/body change, shared constraint text changing, an owner decision
   changing alone, task added (change-level `Yes`, D27), task removed (change-level
   `Yes`, D27), dependency-graph shape changes, task reordering (no effect), a task's
   own body change, decision/constraint reference changes (both referenced and
   unreferenced), decision supersession resolution, and `dependency_contracts`
   propagation.
2. **`execution.suspension` never changes any fingerprint tier's output.** Met —
   `fingerprint.test.mjs:269` proves this directly for the task-level tier; the
   change-level and implementation-level tiers structurally never read `execution` at
   all (`computeChangeFingerprint` only reads `overview.md` + task id/`depends_on`;
   `computeImplementationFingerprint` wraps the task-level tier plus explicit
   `revision`/`evidence` parameters).
3. **A task depending on `abandoned` is never `next`-ready.** Met —
   `task-lifecycle.test.mjs:420` proves `depsSatisfied` returns `false` for an
   `abandoned` dependency (only `implemented`/`verified`/`archived` satisfy, per
   `DEPENDENCY_SATISFYING_STATUSES`); `isTaskReady`/`getNext` both call `depsSatisfied`.
4. **`superseded` has real semantics or no longer appears.** Met — removed outright;
   `service.mjs`'s `STATUS_ORDER` (the only place it was ever referenced) no longer
   lists it, and `node tools/specs.mjs validate` passes clean.
5. **`execution.suspension`'s shape is validated; a malformed `kind` fails.** Met —
   `validateSuspension` in `validation.mjs:40-73`; `fingerprint.test.mjs:498` proves a
   bogus `kind` is rejected.
6. **`docs/ai/specification-workflow.md` accurately describes the model.** Met —
   "State model: statuses, suspension, and semantic fingerprints" section documents the
   status vocabulary, `execution.suspension`, `semantic_references`, `self_check`, and
   the three fingerprint tiers with an accurate field table; content matches the current
   code (verified by direct comparison, not just presence).
7. **`blocked`/`needs-decision` fail `validate` with the fixed message.** Met —
   `REMOVED_STATUSES`/`removedStatusMessage` in `lifecycle.mjs:24-29`, wired into
   `validateStatusValue` (`validation.mjs:20-27`); `task-lifecycle.test.mjs:448-459`
   proves the exact message for both values at both task and change level.
8. **Invalid `semantic_references` entries fail `validate`.** Met —
   `validateSemanticReferences` (`validation.mjs:129-152`) rejects an out-of-`depends_on`
   `dependency_contracts` entry, an unresolvable `decisions`/`constraints` entry, and a
   superseded `decisions` entry (naming the replacement); all four cases are tested in
   `fingerprint.test.mjs:622-` ("semantic_references integrity validation").
9. **`computeTaskFingerprint` changes when and only when a referenced entry's target
   changes.** Met for all three lists — `decisions` (`fingerprint.test.mjs:315`/322),
   `constraints` (`:347`/354), `dependency_contracts` (`:305`/295) each have both a
   "changes when referenced" and "unaffected when unreferenced" test.
10. **Task addition/removal invalidation (D27).** Met — change-level invalidates on both
    add (`:196`) and remove (`:209`); task-level unaffected when unreferenced on add
    (`:361`); see F1 above for the one missing symmetric task-level "remove" test
    (non-blocking — structurally guaranteed by the code, since `computeTaskFingerprint`
    never reads a task outside its own `dependency_contracts` closure).
11. **`self_check`'s shape is validated; no field changes any fingerprint tier.** Met —
    `validateSelfCheck` (`validation.mjs:81-119`) checks `status`, `fingerprint`,
    `revision`, `failed_criteria` (only with `status: failed`), and each `commands`
    entry's `command`/`exit_code`; `fingerprint.test.mjs:282` proves exclusion from the
    task-level tier (change-level/implementation-level never read it either, same
    structural argument as `execution.suspension`).

## Architecture and documentation

Consistent with `overview.md` § "Proposed architecture" → "State model" and every
relevant owner decision (D6, D7, D8, D13, D16, D18, D26, D27, D28, D29). No ADR conflict
— ADR-0006 (folded in by task 11) already documents the tiered-fingerprint/suspension
model this task implements. `docs/ai/specification-workflow.md` was updated in the same
commit as the code it documents; no undocumented behavior change found.

## Tests

Behavior changes are covered by both named test files declared in this task's
"## Verification" section. No behavior change was found without a corresponding test.
Non-gating repository check: not applicable to this task (no `*.generated.*` artifact is
in this task's own scope).

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`).
